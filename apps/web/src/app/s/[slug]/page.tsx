import { type PublicProfile, TRADE_LABELS } from "@leadanchor/contracts";
import {
  IconBrandGoogle,
  IconBrandWhatsapp,
  IconCalendarEvent,
  IconFileText,
  IconMessage,
  IconMessages,
  IconPhone,
  IconShieldCheck,
  IconWorldOff,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscoverySections } from "@/features/profile/discovery-sections";
import { Stars } from "@/features/reviews/stars";
import { formatPhone, smsHref, telHref } from "@/lib/format";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ preview?: string }>;

async function loadProfile(slug: string): Promise<PublicProfile | null> {
  try {
    const response = await fetch(`${API_URL}/api/public/profile/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as PublicProfile) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const profile = await loadProfile((await params).slug);
  if (!profile) return { title: "Website", robots: { index: false } };
  const place = [profile.city, profile.state].filter(Boolean).join(", ");
  return {
    title: {
      absolute: `${profile.name} | ${TRADE_LABELS[profile.trade]}${place ? ` in ${place}` : ""}`,
    },
    description:
      profile.discovery?.answers[0]?.text ??
      `${profile.name}: ${TRADE_LABELS[profile.trade].toLowerCase()}${place ? ` in ${place}` : ""}. Call, text or book online.`,
    // Only a live site is for search engines; the owner's preview isn't.
    robots: profile.siteLive ? undefined : { index: false, follow: false },
  };
}

/**
 * C-33: the business's one-page website (the add-on), built entirely from what LeadAnchor knows:
 * no editing. Every button leads to the business: call, text, WhatsApp, chat, book or a quote.
 */
export default function SitePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  return (
    <Suspense fallback={<SiteSkeleton />}>
      <SiteLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SiteLoader({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const profile = await loadProfile(slug);
  if (!profile || (!profile.siteLive && preview !== "1")) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconWorldOff className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold">This website isn&apos;t live</h1>
        <p className="text-muted-foreground">
          The link may be mistyped, or the business has taken the site down.
        </p>
      </main>
    );
  }
  return <Site slug={slug} profile={profile} preview={!profile.siteLive} />;
}

function Site({
  slug,
  profile,
  preview,
}: {
  slug: string;
  profile: PublicProfile;
  preview: boolean;
}) {
  const place = [profile.city, profile.state].filter(Boolean).join(", ");
  const trust =
    profile.licenseNumber && profile.insuranceCarrier
      ? "Licensed & Insured"
      : profile.licenseNumber
        ? "Licensed"
        : profile.insuranceCarrier
          ? "Insured"
          : null;
  const quoteUrl = `/r/${slug}?src=website`;
  const chatUrl = `/c/${slug}`;

  return (
    <div className="min-h-dvh bg-background pb-24">
      {profile.discovery && (
        <script
          type="application/ld+json"
          // C-42 on the website too: the same structured data, "<" escaped so it can't close the tag.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(profile.discovery.jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}
      {preview && (
        <p className="bg-signal-subtle px-4 py-2 text-center text-sm font-medium text-signal-strong">
          Preview: this website goes live when the business adds it in LeadAnchor.
        </p>
      )}

      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-5">
          <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
            {profile.name}
          </span>
          {profile.phone && (
            <Button nativeButton={false} render={<a href={telHref(profile.phone)} />}>
              <IconPhone /> <span className="tabular">{formatPhone(profile.phone)}</span>
            </Button>
          )}
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/40">
          <div className="mx-auto max-w-5xl space-y-5 px-5 py-12 sm:py-16">
            <p className="text-[15px] font-medium text-muted-foreground">
              {TRADE_LABELS[profile.trade]}
              {place && ` in ${place}`}
            </p>
            <h1 className="max-w-3xl font-display text-[36px] leading-tight font-semibold sm:text-[48px]">
              {profile.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {trust && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-subtle px-3 text-sm font-semibold text-primary-subtle-foreground">
                  <IconShieldCheck className="size-4" /> {trust}
                </span>
              )}
              {profile.rating && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-background px-3 text-sm font-medium">
                  <span className="tabular font-semibold">{profile.rating.average.toFixed(1)}</span>
                  <Stars rating={profile.rating.average} className="text-[15px]" />
                  <span className="text-muted-foreground">
                    {profile.rating.count} Google{" "}
                    {profile.rating.count === 1 ? "review" : "reviews"}
                  </span>
                </span>
              )}
              {profile.yearsInBusiness != null && profile.yearsInBusiness > 0 && (
                <span className="inline-flex h-8 items-center rounded-full bg-background px-3 text-sm font-medium">
                  {profile.yearsInBusiness} year{profile.yearsInBusiness === 1 ? "" : "s"} in
                  business
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {profile.bookingUrl ? (
                <Button size="lg" nativeButton={false} render={<a href={profile.bookingUrl} />}>
                  <IconCalendarEvent /> Book online
                </Button>
              ) : (
                <Button size="lg" nativeButton={false} render={<a href={quoteUrl} />}>
                  <IconFileText /> Get a quote
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<a href={chatUrl} />}
              >
                <IconMessages /> Chat with us
              </Button>
              {profile.bookingUrl && (
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={<a href={quoteUrl} />}
                >
                  <IconFileText /> Send photos for a quote
                </Button>
              )}
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl space-y-12 px-5 py-12">
          {profile.services.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold">What we do</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {profile.services.map((service) => (
                  <li key={service.name} className="flex flex-col rounded-lg border bg-card p-4">
                    <p className="font-semibold">{service.name}</p>
                    {service.description && (
                      <p className="mt-1 flex-1 text-[15px] text-muted-foreground">
                        {service.description}
                      </p>
                    )}
                    <a
                      href={quoteUrl}
                      className="mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold text-primary"
                    >
                      Ask about {service.name.toLowerCase()} →
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.photos.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold">Recent work</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {profile.photos.map((photo) => (
                  <figure
                    key={photo.id}
                    className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by our API, owner-approved only */}
                    <img
                      src={`/api/public/profile/${slug}/photos/${photo.id}`}
                      alt={photo.caption ?? "Recent work"}
                      className="size-full object-cover"
                    />
                    {photo.caption && (
                      <figcaption className="absolute inset-x-0 bottom-0 truncate bg-background/90 px-2 py-1 text-[13px]">
                        {photo.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </section>
          )}

          {profile.reviews.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold">What customers say</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {profile.reviews.map((review) => (
                  <li
                    key={`${review.reviewer}-${review.publishedAt}`}
                    className="space-y-1.5 rounded-lg border bg-card p-4"
                  >
                    <Stars rating={review.rating} className="text-[15px]" />
                    <p className="text-[15px] leading-6">{review.text}</p>
                    <p className="text-sm font-semibold text-muted-foreground">
                      {review.reviewer}, on Google
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profile.discovery && (
            <DiscoverySections discovery={profile.discovery} name={profile.name} />
          )}

          {(profile.licenseNumber || profile.insuranceCarrier) && (
            <section className="space-y-2 rounded-lg border bg-card p-5">
              <h2 className="text-[17px] font-bold">Licence and insurance</h2>
              <p className="text-[15px]">
                {profile.licenseNumber &&
                  `Licence ${profile.state ? `(${profile.state}) ` : ""}#${profile.licenseNumber}. `}
                {profile.insuranceCarrier && `Insured with ${profile.insuranceCarrier}.`}
              </p>
              <p className="text-sm text-muted-foreground">
                These details are provided by {profile.name}.
              </p>
            </section>
          )}
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground">
          <p>
            {profile.name}
            {place && ` · ${place}`}
            {profile.phone && ` · ${formatPhone(profile.phone)}`}
          </p>
          <div className="flex items-center gap-4">
            {profile.googleProfileUrl && (
              <a
                href={profile.googleProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <IconBrandGoogle className="size-4" /> Google
              </a>
            )}
            <span>Website by LeadAnchor</span>
          </div>
        </div>
      </footer>

      {/* C-33: call, text, WhatsApp and chat stay under the thumb on every screen. */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur"
        aria-label="Contact"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-4 gap-1 px-2">
          {profile.phone && (
            <a
              href={telHref(profile.phone)}
              className="flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold"
            >
              <IconPhone className="size-6 text-primary" /> Call
            </a>
          )}
          {profile.phone && (
            <a
              href={smsHref(profile.phone)}
              className="flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold"
            >
              <IconMessage className="size-6 text-primary" /> Text
            </a>
          )}
          {profile.whatsappLink && (
            <a
              href={profile.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold"
            >
              <IconBrandWhatsapp className="size-6 text-[#1f9d55]" /> WhatsApp
            </a>
          )}
          <a
            href={chatUrl}
            className="flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold"
          >
            <IconMessages className="size-6 text-primary" /> Chat
          </a>
        </div>
      </nav>
    </div>
  );
}

function SiteSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-5 py-16">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-12 w-80" />
      <Skeleton className="h-12 w-56 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}
