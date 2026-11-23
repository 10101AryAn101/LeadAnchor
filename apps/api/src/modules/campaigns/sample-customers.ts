import { eq, inArray } from "drizzle-orm";
import { customers, leads, tenants } from "../../db/schema";
import { tenantWork } from "../../db/unit-of-work";

interface Sample {
  name: string;
  /** Fictional 555-01xx numbers in Austin's other area code, clear of the simulators' 512 ones. */
  phone: string;
  email: string | null;
  monthsAgo: number;
  service: string;
  valueCents: number;
  /** Lost: asked, got a quote, didn't book. */
  outcome?: "won" | "lost";
  tags?: string[];
}

const SAMPLES: Sample[] = [
  {
    name: "Linda Park",
    phone: "+17375550141",
    email: "linda.park@example.com",
    monthsAgo: 14,
    service: "Water heater repair or replacement",
    valueCents: 145_000,
  },
  {
    name: "Robert Hayes",
    phone: "+17375550142",
    email: "robert.hayes@example.com",
    monthsAgo: 9,
    service: "Drain cleaning",
    valueCents: 18_000,
  },
  {
    name: "Sofia Martinez",
    phone: "+17375550143",
    email: "sofia.martinez@example.com",
    monthsAgo: 8,
    service: "Leak repair",
    valueCents: 32_000,
    tags: ["Warranty"],
  },
  {
    name: "James O'Neil",
    phone: "+17375550144",
    email: "james.oneil@example.com",
    monthsAgo: 7,
    service: "Toilet repair",
    valueCents: 16_500,
  },
  {
    name: "Grace Kim",
    phone: "+17375550145",
    email: "grace.kim@example.com",
    monthsAgo: 12,
    service: "Garbage disposal install",
    valueCents: 38_000,
  },
  {
    name: "Daniel Brooks",
    phone: "+17375550146",
    email: "daniel.brooks@example.com",
    monthsAgo: 3,
    service: "Drain cleaning",
    valueCents: 15_000,
  },
  {
    name: "Emily Chen",
    phone: "+17375550147",
    email: "emily.chen@example.com",
    monthsAgo: 2,
    service: "Fixture installation",
    valueCents: 24_000,
    tags: ["Commercial"],
  },
  {
    name: "Marcus Lee",
    phone: "+17375550148",
    email: "marcus.lee@example.com",
    monthsAgo: 10,
    service: "Sewer line",
    valueCents: 220_000,
    tags: ["Commercial"],
  },
  {
    name: "Hannah Wright",
    phone: "+17375550149",
    email: "hannah.wright@example.com",
    monthsAgo: 18,
    service: "Water heater repair or replacement",
    valueCents: 98_000,
  },
  {
    name: "Tom Alvarez",
    phone: "+17375550150",
    email: null,
    monthsAgo: 11,
    service: "Leak repair",
    valueCents: 26_000,
  },
  {
    name: "Priya Nair",
    phone: "+17375550151",
    email: "priya.nair@example.com",
    monthsAgo: 4,
    service: "Leak repair",
    valueCents: 0,
    outcome: "lost",
  },
  {
    name: "Kevin Walsh",
    phone: "+17375550152",
    email: "kevin.walsh@example.com",
    monthsAgo: 2,
    service: "Water heater repair or replacement",
    valueCents: 0,
    outcome: "lost",
  },
];

/**
 * Development only: a dozen past customers with finished (or lost) jobs from the last year and a
 * half, so a new business can try every campaign audience. Added once; example.com emails only.
 */
export async function addSampleCustomers(tenantId: string) {
  return tenantWork(tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) return { added: 0 };
    const taken = new Set(
      (
        await tx
          .select({ phone: customers.phoneE164 })
          .from(customers)
          .where(
            inArray(
              customers.phoneE164,
              SAMPLES.map((sample) => sample.phone),
            ),
          )
      ).map((row) => row.phone),
    );
    let added = 0;
    for (const sample of SAMPLES) {
      if (taken.has(sample.phone)) continue;
      const doneAt = new Date();
      doneAt.setUTCMonth(doneAt.getUTCMonth() - sample.monthsAgo);
      const askedAt = new Date(doneAt.getTime() - 4 * 86_400_000);
      const [customer] = await tx
        .insert(customers)
        .values({
          tenantId,
          phoneE164: sample.phone,
          name: sample.name,
          email: sample.email,
          firstSeenAt: askedAt,
          lastContactAt: doneAt,
          createdAt: askedAt,
        })
        .returning({ id: customers.id });
      const won = sample.outcome !== "lost";
      await tx.insert(leads).values({
        tenantId,
        customerId: customer!.id,
        stage: won ? "won" : "lost",
        source: "manual",
        title: sample.service,
        serviceCategory: sample.service,
        valueCents: won ? sample.valueCents : null,
        tags: sample.tags ?? [],
        stageChangedAt: doneAt,
        wonAt: won ? doneAt : null,
        lastActivityAt: doneAt,
        createdAt: askedAt,
      });
      added += 1;
    }
    return { added };
  });
}
