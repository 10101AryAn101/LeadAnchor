import { formatPhone } from "@leadanchor/contracts";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { systemDb, type Tx } from "../../db/client";
import { callEvents, calls, leads, phoneNumbers, tenants, type CallState } from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { QUEUES, enqueue } from "../../jobs/queue";
import { logger } from "../../lib/logger";
import type { CallHandle, TelephonyEvent, TelephonyProvider } from "../../integrations/telephony/types";
import { CONSENT_TEXT_VERSION, type ConsentLedger } from "../compliance/consent-ledger";
import { findCustomerByPhone, upsertCustomerByPhone } from "../customers/customer.repo";
import { createIntakeLink, noteLinkChannel } from "../intake/intake.service";
import { OPEN_STAGES, addLeadEvent, captureLead } from "../leads/lead-capture";
import { advanceLead } from "../leads/pipeline";
import { requestMessage } from "../messaging/send-path";
import { profileLine } from "../profile/profile";
import { notifyOwner } from "../notifications/notify";
import { RING_ECHO_WINDOW_SECS, missedOnOwnerCell, ringEchoOf } from "./routing";
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
 *
 * A call forwarded from the owner's own cell skips ringing_owner: they already missed it (C-01).
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
          return this.onSpeech(ctx, event.tag, event.partial ?? "", true);
        case "dtmf":
          return this.onKeypad(ctx, event.digit);
        case "recording.saved":
          await tx.update(calls).set({ recordingUrl: event.recordingUrl }).where(eq(calls.id, locked.id));
          // C-05: the length came in after the hang-up, and it's a real message after all.
          if (locked.outcome === "ghost" && (event.durationSecs ?? 0) >= script.VOICEMAIL_MIN_SECS) await this.messageAfterAll(ctx, { awaitingText: true });
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

      // C-01: our own forwarding test came back through the owner's carrier, so forwarding works.
      // It isn't a customer call: no call record, no lead, just end it.
      if (event.from === event.to && tenant.forwardingStatus === "checking") {
        await tx.update(tenants).set({ forwardingStatus: "verified", forwardingCheckedAt: new Date() }).where(eq(tenants.id, tenant.id));
        fx.publish({ type: "settings.updated" });
        fx.afterCommit(() => this.telephony.hangup({ sessionId: event.sessionId, callControlId: event.callControlId }));
        return;
      }

      // C-01: our own ring to the owner came straight back, because their phone is off or busy and
      // forwards calls here. Turn it away as busy: the ring to the owner ends, and the call that
      // rang them moves on to the AI Dispatcher or voicemail. Otherwise it would ring them again, and again.
      const ringing = tenant.ownerCellE164
        ? await tx
            .select({ id: calls.id, fromE164: calls.fromE164 })
            .from(calls)
            .where(
              and(
                eq(calls.tenantId, tenant.id),
                eq(calls.state, "ringing_owner"),
                gt(calls.startedAt, new Date(Date.now() - RING_ECHO_WINDOW_SECS * 1000)),
              ),
            )
            .orderBy(desc(calls.startedAt))
        : [];
      const echoOf = ringEchoOf(event, tenant.ownerCellE164, ringing);
      if (echoOf) {
        await tx.insert(callEvents).values({ tenantId: tenant.id, callId: echoOf.id, type: "owner.forwarded_back", data: { forwardedFrom: event.forwardedFrom ?? null } });
        fx.publish({ type: "call.updated", callId: echoOf.id });
        fx.afterCommit(() => this.telephony.reject({ sessionId: event.sessionId, callControlId: event.callControlId }));
        return;
      }

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

      const forwarded = missedOnOwnerCell(event, tenant.ownerCellE164);
      await this.recordEvent(tx, call, event, { callerType: call.callerType, ...(forwarded && { forwardedFromOwner: true }) });
      fx.publish({ type: "call.updated", callId: call.id });

      const ctx: StepContext = { tx, fx, call, tenant, handle: { sessionId: event.sessionId, callControlId: event.callControlId } };
      // C-01: they already missed it on their own cell, so it goes straight to the AI or voicemail.
      if (!tenant.ownerCellE164 || forwarded) return this.startFallback(ctx);

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

  private async onSpeech(ctx: StepContext, tag: string, transcript: string, timedOut = false) {
    const { tx, call, handle } = ctx;

    if (tag === "need" && call.state === "listening") {
      await tx.update(calls).set({ transcript: transcript || null }).where(eq(calls.id, call.id));
      await this.setState(ctx, "consent_question");
      // C-39: still talking when listening ended. Cut in once, then move on with what we heard.
      const cutIn = timedOut && Boolean(transcript);
      const text = cutIn ? `${script.INTERRUPT} ${script.CONSENT_QUESTION}` : script.CONSENT_QUESTION;
      // Kept on the call's record, with the words said, so the cut-in shows in what happened.
      if (cutIn) await tx.insert(callEvents).values({ tenantId: call.tenantId, callId: call.id, type: "dispatcher.cut_in", data: { line: script.INTERRUPT } });
      ctx.fx.afterCommit(() => this.telephony.say(handle, { text, tag: "consent_question" }));
      return;
    }

    if (tag !== "consent" || call.state !== "consent") return;
    // Only a finished answer counts as consent; half a sentence when time ran out is a no.
    const answer = timedOut ? "" : transcript;
    await this.finishConsent(ctx, { agreed: script.isAffirmative(answer), answer, source: "voice_ack" });
  }

  /** C-06: "press 1" works as well as saying yes. Other keys, or keys at other moments, don't count. */
  private async onKeypad(ctx: StepContext, digit: string) {
    if (ctx.call.state !== "consent") return;
    ctx.fx.afterCommit(() => this.telephony.stopListening(ctx.handle));
    await this.finishConsent(ctx, { agreed: digit === "1", answer: `Pressed ${digit}`, source: "ivr_dtmf" });
  }

  /** Saves the lead, records the caller's permission (spoken or keypad) and sends the one link text. */
  private async finishConsent(ctx: StepContext, input: { agreed: boolean; answer: string; source: "voice_ack" | "ivr_dtmf" }) {
    const { tx, call, tenant, handle } = ctx;
    const { agreed, answer, source } = input;
    const need = call.transcript?.trim() || null;

    const { lead } = await captureLead(tx, ctx.fx, {
      tenant,
      phoneE164: call.fromE164,
      source: "ai_dispatcher",
      title: need ? truncate(need, 60) : agreed ? "Asked for a text with the request form" : "Asked for a call back",
      summary: need,
      needsCallback: !agreed,
      event: { type: "call.dispatcher", data: { callId: call.id, need, consent: agreed ? "yes" : "no", answer: answer || null } },
    });
    await tx.update(calls).set({ leadId: lead.id, customerId: lead.customerId }).where(eq(calls.id, call.id));

    // Whether the link text actually goes out: before carrier approval (C-43) it's blocked.
    let texted = false;
    if (agreed) {
      const now = new Date();
      const said = source === "ivr_dtmf" ? `caller pressed ${answer.replace(/^Pressed /, "")}` : `caller said: "${answer}"`;
      await this.consent.record(
        {
          tenantId: tenant.id,
          phoneE164: call.fromE164,
          type: "sms_transactional",
          action: "GRANTED",
          source,
          textVersion: CONSENT_TEXT_VERSION,
          evidence: `Asked: "${script.CONSENT_QUESTION}" — ${said} (${now.toISOString()})`,
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
        data: { channel: "sms", source, textVersion: CONSENT_TEXT_VERSION, answer },
      });

      // C-07: one link message — through the governed send path, never directly.
      const link = await createIntakeLink(tx, { tenantId: tenant.id, leadId: lead.id, customerId: lead.customerId });
      const message = await requestMessage(tx, ctx.fx, {
        tenant,
        customerId: lead.customerId,
        leadId: lead.id,
        to: call.fromE164,
        purpose: "transactional",
        body: `Hi, it's ${tenant.name} — sorry we missed your call! Tell us what you need (photos help): ${link.url}\n${tenant.profileLinkInTexts ? `${profileLine(tenant)}\n` : ""}Reply STOP to opt out.`,
      });
      await noteLinkChannel(tx, link.id, message);
      texted = message.status !== "blocked";
      // C-07: no text means the owner has to call them back, so the job says so.
      if (!texted) await tx.update(leads).set({ needsCallback: true }).where(eq(leads.id, lead.id));
    }

    await notifyOwner(tx, ctx.fx, {
      tenantId: tenant.id,
      kind: "dispatcher_lead",
      title: `New call from ${formatPhone(call.fromE164)}`,
      body: [
        need ? `“${truncate(need, 110)}”` : agreed ? "Asked for a text link." : "Wants a call back.",
        agreed && !texted ? "Your texts aren't switched on yet, so call them back." : "",
      ]
        .filter(Boolean)
        .join(" "),
      leadId: lead.id,
      callbackPhone: agreed && !texted ? call.fromE164 : undefined,
    });

    if (need) {
      ctx.fx.enqueue(QUEUES.extractCallerNeed, { tenantId: tenant.id, leadId: lead.id, callId: call.id, transcript: need, source: "ai_dispatcher" });
    }

    await this.setState(ctx, "goodbye");
    // Never promise a text that can't go out (C-07): without one, someone calls them back.
    const line = agreed && texted ? script.goodbyeAfterYes(tenant.name) : script.goodbyeAfterNo(tenant.name);
    ctx.fx.afterCommit(() => this.telephony.say(handle, { text: line, tag: "goodbye" }));
  }

  private async onVoicemailTranscribed(ctx: StepContext, text: string) {
    const { tx, call } = ctx;
    await tx.update(calls).set({ transcript: text }).where(eq(calls.id, call.id));
    // C-05: words for a call taken as a hang-up at the beep: they left a message after all.
    if (call.outcome === "ghost" && text.trim()) await this.messageAfterAll(ctx, { awaitingText: false });
    // Before the hang-up there's no lead yet: the hang-up picks the transcript up (C-13).
    if (!call.leadId) return;
    await this.voicemailToLead(ctx, call.leadId, text);
  }

  /** C-13: the voicemail's words go on the job, are read for the caller's need, and alert the owner. */
  private async voicemailToLead(ctx: StepContext, leadId: string, text: string) {
    const { tx, tenant } = ctx;
    const call = { ...ctx.call, leadId };
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
      callbackPhone: call.fromE164,
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
      case "voicemail_prompt":
        // C-05: they hung up before leaving anything — capture the number and alert the owner.
        await this.captureGhost(ctx, base, cause, "Hung up before leaving a message");
        break;

      case "greeting":
      case "listening":
      case "consent_question":
      case "consent": {
        // Their answer to "can we text you?" already made the lead: the call just ended.
        if (call.leadId) {
          await tx.update(calls).set({ ...base, outcome: "dispatcher_completed" }).where(eq(calls.id, call.id));
          break;
        }
        // C-05: hanging up anywhere in the AI conversation, even while it waits for a yes, keeps the caller.
        const beforeAnswer = call.state === "consent";
        const need = call.transcript?.trim() || null;
        const { lead } = await captureLead(tx, ctx.fx, {
          tenant,
          phoneE164: call.fromE164,
          source: "ai_dispatcher",
          title: need ? truncate(need, 60) : beforeAnswer ? "Hung up before answering" : "Hung up during the AI greeting",
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
          body: need
            ? `Hung up after saying: “${truncate(need, 90)}”`
            : beforeAnswer
              ? "Hung up before saying if we can text them. Tap to call back."
              : "Hung up during the greeting. Tap to call back.",
          leadId: lead.id,
          callbackPhone: call.fromE164,
        });
        if (need) ctx.fx.enqueue(QUEUES.extractCallerNeed, { tenantId: tenant.id, leadId: lead.id, callId: call.id, transcript: need, source: "ai_dispatcher" });
        break;
      }

      case "goodbye":
        await tx
          .update(calls)
          .set({ ...base, outcome: call.leadId ? "dispatcher_completed" : "dispatcher_abandoned" })
          .where(eq(calls.id, call.id));
        break;

      case "voicemail": {
        // C-05: hanging up at the beep leaves no message to wait for. Words already in hand always mean a message.
        if (!call.transcript?.trim() && (await this.hungUpAtBeep(tx, call.id, at))) {
          await this.captureGhost(ctx, base, cause, "Hung up at the voicemail beep");
          break;
        }
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
        // C-13: the transcript can beat the hang-up; it was kept on the call, so it's used now.
        const early = call.transcript?.trim();
        if (early) {
          await this.voicemailToLead({ ...ctx, call: { ...call, customerId: lead.customerId } }, lead.id, early);
          break;
        }
        // The transcript alerts the owner; if none ever comes, this does.
        ctx.fx.enqueue(QUEUES.voicemailAlert, { tenantId: tenant.id, callId: call.id }, { startAfterSecs: script.VOICEMAIL_ALERT_FALLBACK_SECS });
        break;
      }
    }

    ctx.fx.publish({ type: "call.updated", callId: call.id });
  }

  /* ── Jobs ──────────────────────────────────────────────────────────────── */

  /** C-39 backup: if a restart lost the in-memory timer, the queued job still ends the AI conversation. */
  async hardStopJob(handle: CallHandle) {
    const [call] = await systemDb
      .select({ state: calls.state })
      .from(calls)
      .where(and(eq(calls.provider, this.telephony.name), eq(calls.providerSessionId, handle.sessionId)))
      .limit(1);
    if (!call || !DISPATCHER_STATES.includes(call.state)) return;
    logger.info({ sessionId: handle.sessionId }, "dispatcher hard stop (queued) — hanging up");
    await this.telephony.hangup(handle);
  }

  /** C-13: a voicemail that never got a transcript still reaches the owner. */
  async voicemailAlertJob({ tenantId, callId }: { tenantId: string; callId: string }) {
    await tenantWork(tenantId, async (tx, fx) => {
      const [call] = await tx.select().from(calls).where(eq(calls.id, callId));
      if (!call?.leadId || call.transcript) return;
      const customer = await findCustomerByPhone(tx, tenantId, call.fromE164);
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "voicemail",
        title: `Voicemail from ${customer?.name ?? formatPhone(call.fromE164)}`,
        body: "We couldn't turn it into text. Tap to call them back.",
        leadId: call.leadId,
        callbackPhone: call.fromE164,
      });
    });
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  /** C-05: a hang-up that left nothing behind. Keep the number as a lead and alert the owner. */
  /**
   * C-05: no message was left. The recording's own length says so when it's in (it's under 3
   * seconds); otherwise the time from the end of the greeting to the hang-up does, which is real
   * time on a real line. (The simulator plays a message faster than real time, so its length wins.)
   */
  private async hungUpAtBeep(tx: Tx, callId: string, hungUpAt: Date) {
    const [recording] = await tx
      .select({ data: callEvents.data })
      .from(callEvents)
      .where(and(eq(callEvents.callId, callId), eq(callEvents.type, "recording.saved")))
      .orderBy(desc(callEvents.occurredAt))
      .limit(1);
    const seconds = (recording?.data as { durationSecs?: number | null } | undefined)?.durationSecs;
    if (typeof seconds === "number") return seconds < script.VOICEMAIL_MIN_SECS;
    const [greeting] = await tx
      .select({ endedAt: callEvents.occurredAt })
      .from(callEvents)
      .where(and(eq(callEvents.callId, callId), eq(callEvents.type, "playback.finished"), sql`${callEvents.data}->>'tag' = 'vm_prompt'`))
      .orderBy(desc(callEvents.occurredAt))
      .limit(1);
    return greeting !== undefined && hungUpAt.getTime() - greeting.endedAt.getTime() < script.VOICEMAIL_MIN_SECS * 1000;
  }

  /**
   * C-05: a call taken for a hang-up at the beep turns out to have a message: it's a voicemail. The
   * words, when they come, alert the owner; if they don't, the usual fallback alert does.
   */
  private async messageAfterAll(ctx: StepContext, { awaitingText }: { awaitingText: boolean }) {
    const { tx, call, tenant } = ctx;
    await tx.update(calls).set({ outcome: "voicemail" }).where(eq(calls.id, call.id));
    ctx.call = { ...call, outcome: "voicemail" };
    if (awaitingText && !call.transcript) {
      ctx.fx.enqueue(QUEUES.voicemailAlert, { tenantId: tenant.id, callId: call.id }, { startAfterSecs: script.VOICEMAIL_ALERT_FALLBACK_SECS });
    }
    ctx.fx.publish({ type: "call.updated", callId: call.id });
  }

  private async captureGhost(ctx: StepContext, base: HangupFields, cause: string, title: string) {
    const { tx, call, tenant } = ctx;
    const { lead } = await captureLead(tx, ctx.fx, {
      tenant,
      phoneE164: call.fromE164,
      source: "missed_call",
      title,
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
      callbackPhone: call.fromE164,
    });
  }

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
    // The timer lives in memory; a queued job a moment later covers a server restart.
    void enqueue(QUEUES.dispatcherHardStop, { sessionId: handle.sessionId, callControlId: handle.callControlId }, { startAfterSecs: script.DISPATCHER_HARD_STOP_SECS + 2 }).catch(
      (error: unknown) => logger.error({ err: error }, "couldn't queue the dispatcher hard stop"),
    );
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

/** What every hang-up writes on the call. */
interface HangupFields {
  state: "completed";
  endedAt: Date;
  hangupCause: string;
  durationSecs: number;
}

/** Call states while the AI Dispatcher is talking (C-39). */
const DISPATCHER_STATES: CallState[] = ["greeting", "listening", "consent_question", "consent", "goodbye"];

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
