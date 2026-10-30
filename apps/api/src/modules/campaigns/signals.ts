import type { CampaignTrigger } from "@leadanchor/contracts";
import { and, eq, gt, inArray, isNotNull, like, lt, ne, sql } from "drizzle-orm";
import { holidays, weather } from "../../container";
import { systemDb } from "../../db/client";
import { campaigns, customers, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";
import { logger } from "../../lib/logger";
import { localDate, shiftDate, zonedTime } from "../../lib/zoned";
import { notifyOwner } from "../notifications/notify";
import { copyContextOf } from "./campaign.service";
import { type Copy, holidayCopy, weatherCopy } from "./copy";

type Tenant = typeof tenants.$inferSelect;

/** Weather this close is worth an offer: far enough out to book, near enough to trust. */
const WEATHER_DAYS = { from: 1, to: 5 };
/** Holidays are suggested this far ahead. */
const HOLIDAY_DAYS = { from: 7, to: 21 };
/** One cold snap (or heat wave) is one suggestion, even when it lasts several days. */
const WEATHER_COOLDOWN_DAYS = 7;

const FREEZING_F = 32;
const HEAT_WAVE_F = 100;

export interface Idea {
  key: string;
  trigger: CampaignTrigger;
  copy: Copy;
}

/** "Tue, Nov 3" */
const shortDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
/** "Thursday, November 26" */
const longDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/** What's worth suggesting today: a freeze or heat wave in the forecast, or a holiday ahead (C-30). */
export async function ideasFor(tenant: Tenant, today: string): Promise<Idea[]> {
  const ctx = copyContextOf(tenant);
  const place = [tenant.city, tenant.state].filter(Boolean).join(", ");
  const ideas: Idea[] = [];

  const forecast = (
    await weather.forecast(tenant.id, {
      city: tenant.city,
      state: tenant.state,
      postalCode: tenant.postalCode,
    })
  ).filter(
    (day) =>
      day.date >= shiftDate(today, WEATHER_DAYS.from) &&
      day.date <= shiftDate(today, WEATHER_DAYS.to),
  );
  const freeze = forecast.find((day) => day.lowF <= FREEZING_F);
  const freezeCopy = freeze && weatherCopy("freeze", ctx, shortDay(freeze.date), freeze.lowF);
  if (freeze && freezeCopy) {
    ideas.push({
      key: `freeze:${freeze.date}`,
      trigger: {
        kind: "freeze",
        title: `Freeze forecast for ${shortDay(freeze.date)}`,
        detail: `A low of ${freeze.lowF}°F${place ? ` in ${place}` : ""}.`,
        date: freeze.date,
      },
      copy: freezeCopy,
    });
  }
  const heat = forecast.find((day) => day.highF >= HEAT_WAVE_F);
  const heatCopy = heat && weatherCopy("heat", ctx, shortDay(heat.date), heat.highF);
  if (heat && heatCopy) {
    ideas.push({
      key: `heat:${heat.date}`,
      trigger: {
        kind: "heat",
        title: `Heat wave forecast for ${shortDay(heat.date)}`,
        detail: `A high of ${heat.highF}°F${place ? ` in ${place}` : ""}.`,
        date: heat.date,
      },
      copy: heatCopy,
    });
  }

  for (const holiday of await holidays.between(
    shiftDate(today, HOLIDAY_DAYS.from),
    shiftDate(today, HOLIDAY_DAYS.to),
  )) {
    const copy = holidayCopy(holiday, ctx, longDay(holiday.date));
    if (!copy) continue;
    ideas.push({
      key: `holiday:${holiday.key}:${holiday.date.slice(0, 4)}`,
      trigger: {
        kind: "holiday",
        title: `${holiday.name.charAt(0).toUpperCase()}${holiday.name.slice(1)} is on ${longDay(holiday.date)}`,
        detail: "Customers book ahead of holidays, so an early offer fills your calendar.",
        date: holiday.date,
      },
      copy,
    });
  }
  return ideas;
}

/**
 * Drafts this business's new suggestions and tells the owner. Each freeze, heat wave or holiday is
 * suggested once; a suggestion lapses after its day; nothing is sent without approval (C-30).
 */
export async function checkSignals(tenantId: string): Promise<number> {
  const [tenant] = await systemDb.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return 0;
  const today = localDate(new Date(), tenant.timezone);
  const ideas = await ideasFor(tenant, today);

  return tenantWork(tenantId, async (tx, fx) => {
    await tx
      .update(campaigns)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(and(eq(campaigns.status, "suggested"), lt(campaigns.suggestedUntil, new Date())));
    if (ideas.length === 0) return 0;
    // Suggestions only help a business that can email someone.
    const [reachable] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(isNotNull(customers.email), ne(customers.email, "")));
    if (!reachable?.count) return 0;

    let created = 0;
    for (const idea of ideas) {
      if (idea.trigger.kind !== "holiday") {
        const [recent] = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(
            and(
              like(campaigns.triggerKey, `${idea.trigger.kind}:%`),
              gt(campaigns.createdAt, new Date(Date.now() - WEATHER_COOLDOWN_DAYS * 86_400_000)),
            ),
          )
          .limit(1);
        if (recent) continue;
      }
      const [row] = await tx
        .insert(campaigns)
        .values({
          tenantId,
          kind: "seasonal",
          status: "suggested",
          name: idea.copy.name,
          audience: { segment: "customers", months: 6, service: null, tag: null },
          subject: idea.copy.subject,
          body: idea.copy.body,
          trigger: idea.trigger,
          triggerKey: idea.key,
          suggestedUntil: zonedTime(idea.trigger.date, "23:59", tenant.timezone),
        })
        .onConflictDoNothing()
        .returning({ id: campaigns.id });
      if (!row) continue;
      created += 1;
      await notifyOwner(tx, fx, {
        tenantId,
        kind: "campaign",
        title: `${idea.trigger.title}: an offer is ready`,
        body: `We drafted “${idea.copy.subject}” for your past customers. Nothing is sent until you approve it.`,
        path: `/campaigns/${row.id}`,
      });
    }
    return created;
  });
}

/** Every six hours: each business's forecast and calendar (C-30). */
export async function campaignSignalsTickJob() {
  const active = await systemDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(inArray(tenants.status, ["trial", "active"]));
  for (const { id } of active) {
    try {
      await checkSignals(id);
    } catch (error) {
      logger.warn({ err: error, tenantId: id }, "campaign suggestions failed for a business");
    }
  }
}
