import { formatPhone } from "@leadanchor/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { systemDb, type Tx } from "../../db/client";
import { callEvents, calls, leads, phoneNumbers, tenants, type CallState } from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { QUEUES } from "../../jobs/queue";
import { logger } from "../../lib/logger";
import type { CallHandle, TelephonyEvent, TelephonyProvider } from "../../integrations/telephony/types";
import { CONSENT_TEXT_VERSION, type ConsentLedger } from "../compliance/consent-ledger";
import { findCustomerByPhone, upsertCustomerByPhone } from "../customers/customer.repo";
import { createIntakeLink } from "../intake/intake.service";
import { OPEN_STAGES, addLeadEvent, captureLead } from "../leads/lead-capture";
import { advanceLead } from "../leads/pipeline";
import { requestMessage } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import * as script from "./script";

type Call = typeof calls.$inferSelect;
type Tenant = typeof tenants.$inferSelect;

/**
 * The call-capture engine (C-02 … C-06, C-13, C-39). A state machine over
 * normalised telephony events. It never talks to a provider directly — commands
 * go through the TelephonyProvider port, issued only after the state change is
 * committed so the next webhook always sees the new state.
 *
 *   ringing ─▶ ringing_owner ─┬─ owner answers ─▶ bridged ─▶ completed (answered)
 *                             ├─ caller hangs up ─▶ completed (ghost lead + "tap to call back")
 *                             └─ no answer / voicemail detected
 *                                   ├─ new caller   ─▶ greeting ─▶ listening ─▶ consent_question ─▶ consent ─▶ goodbye
 *                                   └─ known caller ─▶ voicemail_prompt ─▶ voicemail ─▶ (transcript later)
 */
export class CallEngine {
  private readonly hardStops = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly telephony: TelephonyProvider,
    private readonly consent: ConsentLedger,
  ) {}

  async handle(event: TelephonyEvent): Promise<void> {
    if (event.kind === "call.incoming") return this.onIncoming(event);

    const [call] = await systemDb
      .select({ id: calls.id, tenantId: calls.tenantId })
      .from(calls)
      .where(and(eq(calls.provider, this.telephony.name), eq(calls.providerSessionId, event.sessionId)))
      .limit(1);
    if (!call) {
      logger.warn({ kind: event.kind, sessionId: event.sessionId }, "call event for unknown session ignored");
      return;
    }

    await tenantWork(call.tenantId, async (tx, fx) => {
      // Lock the call row so concurrent webhooks for the same call apply in order.
      const [locked] = await tx.select().from(calls).where(eq(calls.id, call.id)).for("update");
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, call.tenantId));
      if (!locked || !tenant) return;

      await this.recordEvent(tx, locked, event);
      const ctx: StepContext = { tx, fx, call: locked, tenant, handle: { sessionId: locked.providerSessionId, callControlId: locked.providerCallId } };

      switch (event.kind) {
        case "owner.answered":
          return this.onOwnerAnswered(ctx);
        case "owner.unavailable":
          return this.onOwnerUnavailable(ctx);
        case "playback.finished":
          return this.onPlaybackFinished(ctx, event.tag);
        case "speech.result":
          return this.onSpeech(ctx, event.tag, event.transcript);
        case "speech.timeout":
          return this.onSpeech(ctx, event.tag, "");
        case "recording.saved":
          await tx.update(calls).set({ recordingUrl: event.recordingUrl }).where(eq(calls.id, locked.id));
          return;
        case "recording.transcribed":
          return this.onVoicemailTranscribed(ctx, event.text);
        case "caller.hangup":
          return this.onHangup(ctx, event.cause, event.occurredAt);
      }
    });
  }

  /* ── Steps ─────────────────────────────────────────────────────────────── */

  private async onIncoming(event: Extract<TelephonyEvent, { kind: "call.incoming" }>) {
    const [number] = await systemDb
      .select({ tenantId: phoneNumbers.tenantId })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.e164, event.to), eq(phoneNumbers.status, "active")))
      .limit(1);
    if (!number) {
      logger.warn({ to: event.to }, "inbound call to a number no business owns");
      return;
    }

    await tenantWork(number.tenantId, async (tx, fx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, number.tenantId));
      if (!tenant) return;
      const customer = await findCustomerByPhone(tx, tenant.id, event.from);

      const [call] = await tx
        .insert(calls)
        .values({
          tenantId: tenant.id,
          provider: this.telephony.name,
          providerSessionId: event.sessionId,
          providerCallId: event.callControlId,
          fromE164: event.from,
          toE164: event.to,
          customerId: customer?.id ?? null,
          callerType: customer ? "known" : "new",
          startedAt: event.occurredAt,
        })
        .onConflictDoNothing()
        .returning();
      if (!call) return; // duplicate delivery

      await this.recordEvent(tx, call, event, { callerType: call.callerType });
      fx.publish({ type: "call.updated", callId: call.id });

      const ctx: StepContext = { tx, fx, call, tenant, handle: { sessionId: event.sessionId, callControlId: event.callControlId } };
      if (!tenant.ownerCellE164) return this.startFallback(ctx);

      await this.setState(ctx, "ringing_owner");
      fx.afterCommit(() =>
        this.telephony.ringOwner(ctx.handle, { ownerE164: tenant.ownerCellE164!, fromE164: event.from, timeoutSecs: tenant.ringTimeoutSecs }),
      );
    });
  }

  private async onOwnerAnswered(ctx: StepContext) {
    if (ctx.call.state !== "ringing_owner") return;
    const customer = await upsertCustomerByPhone(ctx.tx, ctx.tenant.id, ctx.call.fromE164);
    // The owner is talking to them now, so their open job (if any) counts as contacted.
    const [open] = await ctx.tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.customerId, customer.id), inArray(leads.stage, OPEN_STAGES)))
      .orderBy(desc(leads.lastActivityAt))
      .limit(1);
    await ctx.tx
      .update(calls)
      .set({ state: "bridged", outcome: "answered", answeredAt: new Date(), customerId: customer.id, leadId: open?.id ?? null })
      .where(eq(calls.id, ctx.call.id));
    if (open) {
      await addLeadEvent(ctx.tx, { tenantId: ctx.tenant.id, leadId: open.id, type: "call.answered", data: { callId: ctx.call.id } });
      await advanceLead(ctx.tx, ctx.fx, { tenantId: ctx.tenant.id, leadId: open.id, reason: "owner_answered" });
    }
    ctx.fx.publish({ type: "call.updated", callId: ctx.call.id });
  }

  private async onOwnerUnavailable(ctx: StepContext) {
    if (ctx.call.state !== "ringing_owner") return;
    await this.startFallback(ctx);
  }

  /** The owner couldn't answer: new callers meet the AI Dispatcher, known callers get voicemail. */
  private async startFallback(ctx: StepContext) {
    const { tenant, call, handle } = ctx;
    if (call.callerType === "new" && tenant.dispatcherEnabled) {
      await this.setState(ctx, "greeting");
      ctx.fx.afterCommit(async () => {
        await this.telephony.answer(handle);
        this.armHardStop(handle);
        await this.telephony.say(handle, { text: script.greeting(tenant.name), tag: "greeting" });
      });
      return;
    }

    const customer = call.customerId ? await findCustomerByPhone(ctx.tx, tenant.id, call.fromE164) : null;
    await this.setState(ctx, "voicemail_prompt");
    ctx.fx.afterCommit(async () => {
      await this.telephony.answer(handle);
      await this.telephony.say(handle, { text: script.voicemailPrompt(tenant.name, script.firstNameOf(customer?.name)), tag: "vm_prompt" });
    });
  }

  private async onPlaybackFinished(ctx: StepContext, tag: string) {
    const { call, handle } = ctx;
    if (tag === "greeting" && call.state === "greeting") {
      await this.setState(ctx, "listening");
      ctx.fx.afterCommit(() => this.telephony.listen(handle, { maxSecs: script.DISPATCHER_LISTEN_SECS, tag: "need" }));
    } else if (tag === "consent_question" && call.state === "consent_question") {
      await this.setState(ctx, "consent");
      ctx.fx.afterCommit(() => this.telephony.listen(handle, { maxSecs: script.CONSENT_LISTEN_SECS, tag: "consent" }));
    } else if (tag === "vm_prompt" && call.state === "voicemail_prompt") {
      await this.setState(ctx, "voicemail");
      ctx.fx.afterCommit(() => this.telephony.recordVoicemail(handle, { maxSecs: script.VOICEMAIL_MAX_SECS }));
    } else if (tag === "goodbye") {
      ctx.fx.afterCommit(() => this.telephony.hangup(handle));
    }
  }

  private async onSpeech(ctx: StepContext, tag: string, transcript: string) {
    const { tx, call, tenant, handle } = ctx;

    if (tag === "need" && call.state === "listening") {
      await tx.update(calls).set({ transcript: transcript || null }).where(eq(calls.id, call.id));
      await this.setState(ctx, "consent_question");
      ctx.fx.afterCommit(() => this.telephony.say(handle, { text: script.CONSENT_QUESTION, tag: "consent_question" }));
      return;
    }

    if (tag !== "consent" || call.state !== "consent") return;

    const agreed = script.isAffirmative(transcript);
    const need = call.transcript?.trim() || null;

    const { lead } = await captureLead(tx, ctx.fx, {
      tenant,
      phoneE164: call.fromE164,
      source: "ai_dispatcher",
      title: need ? truncate(need, 60) : agreed ? "Asked for a text with the request form" : "Asked for a call back",
      summary: need,
      needsCallback: !agreed,
      event: { type: "call.dispatcher", data: { callId: call.id, need, consent: agreed ? "yes" : "no", answer: transcript || null } },
    });
    await tx.update(calls).set({ leadId: lead.id, customerId: lead.customerId }).where(eq(calls.id, call.id));

    if (agreed) {
      const now = new Date();
      await this.consent.record(
        {
          tenantId: tenant.id,
          phoneE164: call.fromE164,
          type: "sms_transactional",
          action: "GRANTED",
          source: "voice_ack",
          textVersion: CONSENT_TEXT_VERSION,
          evidence: `Asked: "${script.CONSENT_QUESTION}" — caller said: "${transcript}" (${now.toISOString()})`,
          grantedTo: `${tenant.name} (${tenant.id})`,
          callId: call.id,
        },
        tx,
      );
      await tx.update(calls).set({ consentCapturedAt: now }).where(eq(calls.id, call.id));
      await addLeadEvent(tx, {
        tenantId: tenant.id,
        leadId: lead.id,
        type: "consent.granted",
        actor: "customer",
        data: { channel: "sms", source: "voice_ack", textVersion: CONSENT_TEXT_VERSION, answer: transcript },
      });

      // C-07: one link message — through the governed send path, never directly.
      const url = await createIntakeLink(tx, { tenantId: tenant.id, leadId: lead.id, customerId: lead.customerId });
      await requestMessage(tx, ctx.fx, {
        tenant,
        customerId: lead.customerId,
        leadId: lead.id,
        to: call.fromE164,
        purpose: "transactional",
        body: `Hi, it's ${tenant.name} — sorry we missed your call! Tell us what you need (photos help): ${url}\nReply STOP to opt out.`,
      });
    }

    await notifyOwner(tx, ctx.fx, {
      tenantId: tenant.id,
      kind: "dispatcher_lead",
      title: `New call from ${formatPhone(call.fromE164)}`,
      body: need ? `“${truncate(need, 110)}”` : agreed ? "Asked for a text link." : "Wants a call back.",
      leadId: lead.id,
    });

    if (need) {
      ctx.fx.enqueue(QUEUES.extractCallerNeed, { tenantId: tenant.id, leadId: lead.id, callId: call.id, transcript: need, source: "ai_dispatcher" });
    }

    await this.setState(ctx, "goodbye");
    const line = agreed ? script.goodbyeAfterYes(tenant.name) : script.goodbyeAfterNo(tenant.name);
    ctx.fx.afterCommit(() => this.telephony.say(handle, { text: line, tag: "goodbye" }));
  }

  private async onVoicemailTranscribed(ctx: StepContext, text: string) {
    const { tx, call, tenant } = ctx;
    await tx.update(calls).set({ transcript: text }).where(eq(calls.id, call.id));
    if (!call.leadId) return;

    await addLeadEvent(tx, { tenantId: tenant.id, leadId: call.leadId, type: "voicemail.transcribed", data: { callId: call.id, text } });
    ctx.fx.enqueue(QUEUES.extractCallerNeed, { tenantId: tenant.id, leadId: call.leadId, callId: call.id, transcript: text, source: "voicemail" });
    ctx.fx.publish({ type: "lead.updated", leadId: call.leadId });
    ctx.fx.publish({ type: "call.updated", callId: call.id });

    const customer = call.customerId ? await findCustomerByPhone(tx, tenant.id, call.fromE164) : null;
    await notifyOwner(tx, ctx.fx, {
      tenantId: tenant.id,
      kind: "voicemail",
      title: `Voicemail from ${customer?.name ?? formatPhone(call.fromE164)}`,
      body: `“${truncate(text, 120)}”`,
      leadId: call.leadId,
    });
  }

  private async onHangup(ctx: StepContext, cause: string, at: Date) {
    const { tx, call, tenant } = ctx;
    if (call.state === "completed") return;
    this.disarmHardStop(ctx.handle);

    const base = {
      state: "completed" as const,
      endedAt: at,
      hangupCause: cause,
      durationSecs: Math.max(0, Math.round((at.getTime() - call.startedAt.getTime()) / 1000)),
    };

    switch (call.state) {
      case "bridged":
        await tx.update(calls).set({ ...base, outcome: "answered" }).where(eq(calls.id, call.id));
        break;

      case "ringing":
      case "ringing_owner":
      case "voicemail_prompt": {
        // C-05: they hung up before leaving anything — capture the number and alert the owner.
        const { lead } = await captureLead(tx, ctx.fx, {
          tenant,
          phoneE164: call.fromE164,
          source: "missed_call",
          title: "Hung up before leaving a message",
          needsCallback: true,
          event: { type: "call.ghost", data: { callId: call.id, cause } },
        });
        await tx.update(calls).set({ ...base, outcome: "ghost", leadId: lead.id, customerId: lead.customerId }).where(eq(calls.id, call.id));
        const customer = await findCustomerByPhone(tx, tenant.id, call.fromE164);
        await notifyOwner(tx, ctx.fx, {
          tenantId: tenant.id,
          kind: "ghost_call",
          title: `Missed call from ${customer?.name ?? formatPhone(call.fromE164)}`,
          body: "They hung up before leaving a message. Tap to call back.",
          leadId: lead.id,
        });
        break;
      }

      case "greeting":
      case "listening":
      case "consent_question": {
        const need = call.transcript?.trim() || null;
        const { lead } = await captureLead(tx, ctx.fx, {
          tenant,
          phoneE164: call.fromE164,
          source: "ai_dispatcher",
          title: need ? truncate(need, 60) : "Hung up during the AI greeting",
          summary: need,
          needsCallback: true,
          event: { type: "call.dispatcher_abandoned", data: { callId: call.id, need } },
        });
        await tx
          .update(calls)
          .set({ ...base, outcome: "dispatcher_abandoned", leadId: lead.id, customerId: lead.customerId })
          .where(eq(calls.id, call.id));
        await notifyOwner(tx, ctx.fx, {
          tenantId: tenant.id,
          kind: "ghost_call",
          title: `Missed call from ${formatPhone(call.fromE164)}`,
          body: need ? `Hung up after saying: “${truncate(need, 90)}”` : "Hung up during the greeting. Tap to call back.",
          leadId: lead.id,
        });
        if (need) ctx.fx.enqueue(QUEUES.extractCallerNeed, { tenantId: tenant.id, leadId: lead.id, callId: call.id, transcript: need, source: "ai_dispatcher" });
        break;
      }

      case "consent":
      case "goodbye":
        await tx
          .update(calls)
          .set({ ...base, outcome: call.leadId ? "dispatcher_completed" : "dispatcher_abandoned" })
          .where(eq(calls.id, call.id));
        break;

      case "voicemail": {
        // The recording exists; its transcript arrives in a moment via recording.transcribed.
        const { lead } = await captureLead(tx, ctx.fx, {
          tenant,
          phoneE164: call.fromE164,
          source: "voicemail",
          title: "Left a voicemail",
          needsCallback: true,
          event: { type: "call.voicemail", data: { callId: call.id } },
        });
        await tx.update(calls).set({ ...base, outcome: "voicemail", leadId: lead.id, customerId: lead.customerId }).where(eq(calls.id, call.id));
        break;
      }
    }

    ctx.fx.publish({ type: "call.updated", callId: call.id });
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  private async setState(ctx: StepContext, state: CallState) {
    await ctx.tx.update(calls).set({ state }).where(eq(calls.id, ctx.call.id));
    ctx.call = { ...ctx.call, state };
    ctx.fx.publish({ type: "call.updated", callId: ctx.call.id });
  }

  private async recordEvent(tx: Tx, call: Call, event: TelephonyEvent, extra: Record<string, unknown> = {}) {
    const { eventId, occurredAt, sessionId, callControlId, kind, ...data } = event;
    void eventId;
    void sessionId;
    void callControlId;
    await tx.insert(callEvents).values({ tenantId: call.tenantId, callId: call.id, type: kind, data: { ...data, ...extra }, occurredAt });
  }

  /** C-39: the AI conversation is cut off server-side at 60 seconds, whatever happens. */
  private armHardStop(handle: CallHandle) {
    this.disarmHardStop(handle);
    const timer = setTimeout(() => {
      this.hardStops.delete(handle.sessionId);
      logger.info({ sessionId: handle.sessionId }, "dispatcher hard stop reached — hanging up");
      void this.telephony.hangup(handle).catch((error) => logger.error({ err: error }, "hard-stop hangup failed"));
    }, script.DISPATCHER_HARD_STOP_SECS * 1000);
    timer.unref();
    this.hardStops.set(handle.sessionId, timer);
  }

  private disarmHardStop(handle: CallHandle) {
    const timer = this.hardStops.get(handle.sessionId);
    if (timer) clearTimeout(timer);
    this.hardStops.delete(handle.sessionId);
  }
}

interface StepContext {
  tx: Tx;
  fx: Effects;
  call: Call;
  tenant: Tenant;
  handle: CallHandle;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
