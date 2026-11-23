import { type PublicBusiness, TRADE_LABELS } from "@leadanchor/contracts";
import { IconLinkOff, IconMessage, IconPhone, IconShieldCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { formatPhone, smsHref, telHref } from "@/lib/format";

/** The business at the top of a customer-facing page: who they are, and how to reach them. */
export function BusinessHeader({ business }: { business: PublicBusiness }) {
  const place = [business.city, business.state].filter(Boolean).join(", ");
  const licensed = Boolean(business.licenseNumber);
  const insured = Boolean(business.insuranceCarrier);
  // Self-attested (C-41): "Licensed & Insured", never "Verified".
  const trust =
    licensed && insured ? "Licensed & Insured" : licensed ? "Licensed" : insured ? "Insured" : null;
  return (
    <header className="space-y-3">
      <p className="text-[15px] text-muted-foreground">
        {TRADE_LABELS[business.trade]}
        {place && ` in ${place}`}
      </p>
      <h1 className="font-display text-[28px] leading-tight font-semibold">{business.name}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {trust && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-subtle px-3 text-sm font-semibold text-primary-subtle-foreground">
            <IconShieldCheck className="size-4" /> {trust}
          </span>
        )}
        {business.yearsInBusiness != null && business.yearsInBusiness > 0 && (
          <span className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-sm font-medium">
            {business.yearsInBusiness} year{business.yearsInBusiness === 1 ? "" : "s"} in business
          </span>
        )}
        <a
          href={business.profileUrl}
          className="inline-flex h-7 items-center text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          About us
        </a>
      </div>
    </header>
  );
}

export function ContactButtons({ business }: { business: PublicBusiness }) {
  if (!business.phone) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" nativeButton={false} render={<a href={telHref(business.phone)} />}>
        <IconPhone /> Call {formatPhone(business.phone)}
      </Button>
      <Button variant="outline" nativeButton={false} render={<a href={smsHref(business.phone)} />}>
        <IconMessage /> Text
      </Button>
    </div>
  );
}

export function BrokenLink({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <IconLinkOff className="size-6" />
      </span>
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}
