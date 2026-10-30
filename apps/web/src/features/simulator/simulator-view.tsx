"use client";

import type { SimulatorScenarioInput } from "@leadanchor/contracts";
import { IconInfoCircle, IconPhoneCall, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import { keys, useMe, useRegistration } from "@/lib/queries";
import { type CallTrace, CallTraceView } from "./call-trace";
import { PhonePreview } from "./phone-preview";
import { SimulatedCalendar } from "./sim-calendar";

type OwnerBehavior = SimulatorScenarioInput["ownerBehavior"];
type CallerBehavior = SimulatorScenarioInput["callerBehavior"];

const EXAMPLES = [
  "Hi, my water heater is leaking all over the garage floor. Can someone come out today? This is Dana.",
  "Our AC stopped cooling last night and it's 95 degrees in the house. My name is Luis.",
  "I'd like a quote to replace two bathroom faucets sometime next week.",
];

/** Fictional 555-01xx numbers can never ring a real person. */
const randomCaller = () => `(512) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => next[0] && onChange(next[0] as T)}
      variant="outline"
      aria-label={label}
      className="w-full flex-wrap"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="min-h-11 flex-1 px-3 text-[15px]">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function SimulatorView() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: registration } = useRegistration();
  // Random numbers must not be generated while Next.js prerenders the page, so pick one after mount.
  const [callerPhone, setCallerPhone] = useState("");
  // Opened from a job ("reply as the customer"): that customer's phone, before any test call.
  const [customerPhone, setCustomerPhone] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only values, read once after the page loads
    setCallerPhone(randomCaller());
    const digits = (new URLSearchParams(window.location.search).get("phone") ?? "").replace(/\D/g, "");
    if (/^1\d{10}$/.test(digits)) setCustomerPhone(`+${digits}`);
  }, []);
  const [callerName, setCallerName] = useState("");
  const [ownerBehavior, setOwnerBehavior] = useState<OwnerBehavior>("no_answer");
  const [callerBehavior, setCallerBehavior] = useState<CallerBehavior>("talks_to_dispatcher");
  const [utterance, setUtterance] = useState(EXAMPLES[0]!);
  const [consent, setConsent] = useState<SimulatorScenarioInput["consent"] & string>("yes");
  const [voicemailText, setVoicemailText] = useState("Hey, it's Dana again — the leak got worse after I turned the valve. Please call me back when you can.");
  const [session, setSession] = useState<{ id: string; phone: string } | null>(null);

  const trace = useQuery({
    queryKey: keys.simCall(session?.id ?? "none"),
    queryFn: () => api<CallTrace>(`/dev/simulator/calls/${session!.id}`),
    enabled: Boolean(session),
    retry: (count, error) => isApiError(error) && error.status === 404 && count < 10,
    retryDelay: 400,
    refetchInterval: (query) => (query.state.data?.call.state === "completed" ? false : 700),
  });

  const place = useMutation({
    mutationFn: (scenario: SimulatorScenarioInput) => api<{ sessionId: string }>("/dev/simulator/calls", { method: "POST", body: scenario }),
    onSuccess: ({ sessionId }, scenario) => setSession({ id: sessionId, phone: scenario.callerPhone }),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't place the call."),
  });

  const approve = useMutation({
    mutationFn: () => api("/dev/simulator/registration/approve", { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Carrier approval simulated — automatic texts are on.");
      void queryClient.invalidateQueries({ queryKey: keys.registration });
    },
  });

  const toE164 = (value: string) => `+1${value.replace(/\D/g, "").slice(-10)}`;
  const smsOn = registration?.status === "approved";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call simulator"
        description="Play the caller and watch LeadAnchor catch the call — the same engine that runs on Telnyx, without a phone bill. For development only."
      />

      {!smsOn && registration && (
        <div className="flex flex-col gap-3 rounded-lg bg-signal-subtle p-4 sm:flex-row sm:items-center">
          <IconInfoCircle className="size-5 shrink-0 text-signal-strong" />
          <p className="flex-1 text-[15px] text-signal-strong">
            Texts are blocked until carriers approve this business (10DLC). Calls still work; the text step will show as &ldquo;not sent&rdquo;.
          </p>
          <Button variant="outline" onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending && <Spinner />} Simulate carrier approval
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
        <section className="space-y-5 rounded-lg border bg-card p-5">
          <h2 className="text-[17px] font-bold">The call</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="callerPhone">Caller&apos;s number</FieldLabel>
              <div className="flex gap-2">
                <Input id="callerPhone" inputMode="tel" value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} />
                <Button variant="outline" size="icon" aria-label="New random caller" onClick={() => setCallerPhone(randomCaller())}>
                  <IconRefresh />
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="callerName">Caller&apos;s name (optional)</FieldLabel>
              <Input id="callerName" value={callerName} onChange={(e) => setCallerName(e.target.value)} />
            </Field>
          </div>

          <Field>
            <FieldLabel>When your cell rings</FieldLabel>
            <Segmented
              label="Owner"
              value={ownerBehavior}
              onChange={setOwnerBehavior}
              options={[
                { value: "no_answer", label: "No answer" },
                { value: "answers", label: "I pick up" },
                { value: "carrier_voicemail", label: "My voicemail" },
              ]}
            />
          </Field>

          <Field>
            <FieldLabel>The caller</FieldLabel>
            <Segmented
              label="Caller"
              value={callerBehavior}
              onChange={setCallerBehavior}
              options={[
                { value: "talks_to_dispatcher", label: "Stays on" },
                { value: "hangs_up_while_ringing", label: "Hangs up ringing" },
                { value: "hangs_up_during_greeting", label: "Hangs up on AI" },
              ]}
            />
            <FieldDescription>New callers meet the AI Dispatcher. Callers you already know get your voicemail instead.</FieldDescription>
          </Field>

          {callerBehavior === "talks_to_dispatcher" && (
            <>
              <Field>
                <FieldLabel htmlFor="utterance">What they tell the AI Dispatcher</FieldLabel>
                <Textarea id="utterance" rows={3} value={utterance} onChange={(e) => setUtterance(e.target.value)} />
                <div className="flex flex-wrap gap-2 pt-1">
                  {EXAMPLES.map((example, index) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setUtterance(example)}
                      className="min-h-9 rounded-full border border-input px-3 text-sm hover:bg-muted"
                    >
                      Example {index + 1}
                    </button>
                  ))}
                </div>
              </Field>
              <Field>
                <FieldLabel>Okay to text them?</FieldLabel>
                <Segmented
                  label="Consent"
                  value={consent}
                  onChange={setConsent}
                  options={[
                    { value: "yes", label: "They say yes" },
                    { value: "press1", label: "They press 1" },
                    { value: "no", label: "They say no" },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="voicemail">Their voicemail, if they&apos;re a returning caller</FieldLabel>
                <Textarea id="voicemail" rows={2} value={voicemailText} onChange={(e) => setVoicemailText(e.target.value)} />
              </Field>
            </>
          )}

          <Button
            size="lg"
            className="w-full"
            disabled={place.isPending}
            onClick={() =>
              place.mutate({
                callerPhone,
                callerName: callerName || undefined,
                ownerBehavior,
                callerBehavior,
                utterance,
                consent,
                voicemailText,
              })
            }
          >
            {place.isPending ? <Spinner /> : <IconPhoneCall />} Call {formatPhone(me?.tenant?.trackingNumber)}
          </Button>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-[17px] font-bold">What happened</h2>
          <CallTraceView trace={trace.data ?? null} waiting={Boolean(session) && !trace.data} />
        </section>

        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">{session || !customerPhone ? "The caller’s phone" : `${formatPhone(customerPhone)}’s phone`}</h2>
          <PhonePreview phone={session ? toE164(session.phone) : customerPhone} businessName={me?.tenant?.name ?? "Your business"} />
        </section>
      </div>

      <SimulatedCalendar />
    </div>
  );
}
