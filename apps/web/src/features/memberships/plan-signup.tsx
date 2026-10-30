"use client";

import { type MembershipStatus, type PublicPlan, planPrice } from "@leadanchor/contracts";
import { IconCheck, IconCircleCheck, IconLock } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { BusinessHeader, ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";

/**
 * C-48, C-49: a plan's sign-up page. What's included and every term are shown in full before they
 * pay; they tick a box agreeing to the recurring charge; Stripe's hosted page takes the card.
 */
export function PlanSignup({
  token,
  data,
  joinedId,
}: {
  token: string;
  data: PublicPlan;
  joinedId: string | null;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8">
      <BusinessHeader business={data.business} />
      {joinedId ? (
        <Joined token={token} membershipId={joinedId} data={data} />
      ) : (
        <SignUp token={token} data={data} />
      )}
      <div className="border-t pt-5">
        <p className="mb-3 text-[15px] text-muted-foreground">
          {joinedId ? "Questions?" : "Questions first?"}
        </p>
        <ContactButtons business={data.business} />
      </div>
    </div>
  );
}

function PlanCard({ data }: { data: PublicPlan }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div>
        <h1 className="font-display text-[26px] leading-tight font-semibold">{data.plan.name}</h1>
        <p className="tabular mt-1 text-[19px] font-semibold text-primary">
          {planPrice(data.plan.priceCents, data.plan.interval)}
        </p>
      </div>
      {data.plan.description && (
        <p className="text-[15px] leading-6 text-muted-foreground">{data.plan.description}</p>
      )}
      {data.plan.includes.length > 0 && (
        <ul className="space-y-2 text-[15px]">
          {data.plan.includes.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
                <IconCheck className="size-3.5" stroke={3} />
              </span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignUp({ token, data }: { token: string; data: PublicPlan }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const join = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/public/membership-plans/${encodeURIComponent(token)}/join`, {
        method: "POST",
        body: { name, phone, email, consent, company },
      }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => {
      if (isApiError(error) && error.fields) setErrors(error.fields);
      toast.error(isApiError(error) ? error.message : "That didn't work. Please try again.");
    },
  });

  if (!data.available)
    return (
      <>
        <PlanCard data={data} />
        <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
          {data.business.name} isn&apos;t taking new members for this plan right now. Call them to
          ask about it.
        </p>
      </>
    );
  const ready =
    name.trim().length >= 2 &&
    phone.replace(/\D/g, "").length >= 10 &&
    /\S+@\S+\.\S+/.test(email) &&
    consent;
  return (
    <>
      <PlanCard data={data} />
      <section aria-labelledby="terms" className="space-y-2 rounded-lg bg-muted p-4">
        <h2 id="terms" className="font-semibold">
          Before you join
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-6">
          {data.terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      </section>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          join.mutate();
        }}
      >
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="join-name">Your name</FieldLabel>
          <Input
            id="join-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldError errors={(errors.name ?? []).map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={Boolean(errors.phone)}>
          <FieldLabel htmlFor="join-phone">Your mobile number</FieldLabel>
          <Input
            id="join-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <FieldError errors={(errors.phone ?? []).map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="join-email">Email</FieldLabel>
          <Input
            id="join-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError errors={(errors.email ?? []).map((message) => ({ message }))} />
        </Field>
        {/* Hidden from people; only bots fill it in. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
        <label className="flex cursor-pointer gap-3 rounded-lg border border-input bg-card p-3.5">
          <Checkbox
            className="mt-1"
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked === true)}
          />
          <span className="text-[15px] leading-6">{data.consentText}</span>
        </label>
        {errors.consent && <p className="text-sm text-destructive">{errors.consent[0]}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={!ready || join.isPending}>
          {join.isPending ? <Spinner /> : <IconLock />} Continue to secure payment
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Your card is entered on Stripe&apos;s secure page.
        </p>
      </form>
    </>
  );
}

/** Back from the payment page: they're in (the welcome email is on its way). */
function Joined({
  token,
  membershipId,
  data,
}: {
  token: string;
  membershipId: string;
  data: PublicPlan;
}) {
  const { data: joined } = useQuery({
    queryKey: ["plan-joined", token, membershipId],
    queryFn: () =>
      api<{ status: MembershipStatus }>(
        `/public/membership-plans/${encodeURIComponent(token)}/joined/${encodeURIComponent(membershipId)}`,
      ),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 2000 : false),
    retry: false,
  });
  if (!joined || joined.status === "pending")
    return (
      <p className="flex items-center gap-2 rounded-lg border p-4 text-[15px]">
        <Spinner className="size-4" /> Confirming your membership…
      </p>
    );
  return (
    <section className="space-y-3 rounded-xl border bg-card p-6 text-center shadow-sm">
      <IconCircleCheck className="mx-auto size-12 text-primary" />
      <h1 className="font-display text-[26px] leading-tight font-semibold">
        You&apos;re a member!
      </h1>
      <p className="text-[15px] leading-6 text-muted-foreground">
        Welcome to {data.plan.name}. A welcome email and your receipt are on their way. Every
        receipt has a link to update your card or cancel, any time.
      </p>
    </section>
  );
}
