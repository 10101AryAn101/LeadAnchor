import { type PublicProfile, TRADE_LABELS } from "@leadanchor/contracts";
import { IconBrandGoogle, IconCalendarEvent, IconExternalLink, IconMessage, IconPhone, IconShieldCheck, IconUserOff } from "@tabler/icons-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stars } from "@/features/reviews/stars";
import { formatPhone, smsHref, telHref } from "@/lib/format";

export const metadata: Metadata = { title: "Pro profile" };

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-41: the business's public profile, linked from the first text a new customer gets. No login. */
export default function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileLoader params={params} />
      </Suspense>
    </main>
  );
}

async function ProfileLoader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let profile: PublicProfile | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/profile/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (response.ok) profile = (await response.json()) as PublicProfile;
  } catch {
    profile = null;
  }

  if (!profile) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconUserOff className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold">We couldn&apos;t find this business</h1>
        <p className="text-muted-foreground">The link may be mistyped, or the profile was taken down.</p>
      </div>
    );
  }
  return <ProfileView slug={slug} profile={profile} />;
}

function ProfileView({ slug, profile }: { slug: string; profile: PublicProfile }) {
  const place = [profile.city, profile.state].filter(Boolean).join(", ");
  const licensed = Boolean(profile.licenseNumber);
  const insured = Boolean(profile.insuranceCarrier);
  const trust = licensed && insured ? "Licensed & Insured" : licensed ? "Licensed" : insured ? "Insured" : null;

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-5 py-8 sm:py-12">
      <header className="space-y-3">
        <p className="text-[15px] text-muted-foreground">
          {TRADE_LABELS[profile.trade]}
          {place && ` in ${place}`}
        </p>
        <h1 className="font-display text-[32px] leading-tight font-semibold">{profile.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {trust && (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-subtle px-3 text-sm font-semibold text-primary-subtle-foreground">
              <IconShieldCheck className="size-4" /> {trust}
            </span>
          )}
          {profile.rating && (
            <a
              href={profile.rating.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-medium hover:bg-muted/70"
            >
              <span className="tabular font-semibold">{profile.rating.average.toFixed(1)}</span>
              <Stars rating={profile.rating.average} className="text-[15px]" />
              <span className="text-muted-foreground">
                {profile.rating.count} Google {profile.rating.count === 1 ? "review" : "reviews"}
              </span>
            </a>
          )}
          {profile.yearsInBusiness != null && profile.yearsInBusiness > 0 && (
            <span className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-sm font-medium">
              {profile.yearsInBusiness} year{profile.yearsInBusiness === 1 ? "" : "s"} in business
            </span>
          )}
        </div>
        {(profile.phone || profile.bookingUrl) && (
          <div className="flex flex-wrap gap-2 pt-2">
            {profile.bookingUrl && (
              <Button size="lg" nativeButton={false} render={<a href={profile.bookingUrl} />}>
                <IconCalendarEvent /> Book online
              </Button>
            )}
            {profile.phone && (
              <>
                <Button size="lg" variant={profile.bookingUrl ? "outline" : "default"} nativeButton={false} render={<a href={telHref(profile.phone)} />}>
                  <IconPhone /> Call {formatPhone(profile.phone)}
                </Button>
                <Button size="lg" variant="outline" nativeButton={false} render={<a href={smsHref(profile.phone)} />}>
                  <IconMessage /> Text
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {(licensed || insured) && (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="text-[17px] font-bold">Licence and insurance</h2>
          <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
            {profile.licenseNumber && (
              <div>
                <dt className="text-sm text-muted-foreground">Licence number{profile.state ? ` (${profile.state})` : ""}</dt>
                <dd className="font-semibold">{profile.licenseNumber}</dd>
              </div>
            )}
            {profile.insuranceCarrier && (
              <div>
                <dt className="text-sm text-muted-foreground">Insured with</dt>
                <dd className="font-semibold">{profile.insuranceCarrier}</dd>
              </div>
            )}
          </dl>
          <p className="text-sm text-muted-foreground">These details are provided by {profile.name}.</p>
        </section>
      )}

      {profile.photos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">Recent work</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {profile.photos.map((photo) => (
              <a
                key={photo.id}
                href={`/api/public/profile/${slug}/photos/${photo.id}?variant=full`}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                aria-label={photo.caption ? `Photo: ${photo.caption}` : "Photo of recent work"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our API, owner-approved only */}
                <img src={`/api/public/profile/${slug}/photos/${photo.id}`} alt={photo.caption ?? "Recent work"} className="size-full object-cover" />
                {photo.caption && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-background/90 px-2 py-1 text-[13px]">{photo.caption}</span>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      {profile.reviews.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">What customers say on Google</h2>
          <ul className="space-y-3">
            {profile.reviews.map((review) => (
              <li key={`${review.reviewer}-${review.publishedAt}`} className="space-y-1.5 rounded-lg border bg-card p-4">
                <p className="flex items-center gap-2">
                  <Stars rating={review.rating} className="text-[15px]" />
                  <span className="font-semibold">{review.reviewer}</span>
                </p>
                <p className="text-[15px] leading-6">{review.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.services.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">What we do</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {profile.services.map((service) => (
              <li key={service.name} className="px-4 py-3">
                <p className="font-semibold">{service.name}</p>
                {service.description && <p className="text-[15px] text-muted-foreground">{service.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(profile.googleProfileUrl || profile.website) && (
        <section className="flex flex-wrap gap-2">
          {profile.googleProfileUrl && (
            <Button variant="outline" nativeButton={false} render={<a href={profile.googleProfileUrl} target="_blank" rel="noopener noreferrer" />}>
              <IconBrandGoogle /> See us on Google
            </Button>
          )}
          {profile.website && (
            <Button variant="outline" nativeButton={false} render={<a href={profile.website} target="_blank" rel="noopener noreferrer" />}>
              <IconExternalLink /> Website
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-5 py-12">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-12 w-56 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
