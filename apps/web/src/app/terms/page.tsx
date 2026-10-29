import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of service" };

/** Public terms, including the SMS terms carriers look for (C-43 AC 7). */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="October 29, 2026"
      intro={
        <p>
          These terms apply to businesses that use LeadAnchor to catch missed calls, follow up by text and track jobs (&quot;you&quot;). Customers
          who get texts from a business can skip to the{" "}
          <a href="#sms" className="font-medium underline underline-offset-4">
            SMS terms
          </a>
          .
        </p>
      }
    >
      <LegalSection title="Your account">
        <p>
          Keep your sign-in safe; you are responsible for what happens in your account. The details you give us, including for carrier registration,
          must be accurate and yours to give.
        </p>
      </LegalSection>

      <LegalSection title="Texting rules">
        <ul>
          <li>Only text customers who agreed to it. LeadAnchor records each agreement and blocks texts without one.</li>
          <li>Anyone who replies STOP is never texted again unless they opt back in. LeadAnchor does this automatically.</li>
          <li>
            Automatic texts start only after US carriers approve your business. The carriers decide whether and when to approve, and their
            registration fees may be passed on to you.
          </li>
          <li>
            No spam, and nothing illegal or that carriers prohibit, such as content about cannabis, firearms, high-risk loans, gambling or
            hate.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Calls and recordings">
        <p>
          Missed calls can be answered by an automated assistant and recorded. You are responsible for meeting the call-recording notice laws where
          you and your callers are.
        </p>
      </LegalSection>

      <LegalSection title="Details written by AI">
        <p>
          Call summaries, job details and photo readings are produced by AI and can be wrong. Check them before you rely on them, for example before
          quoting a price.
        </p>
      </LegalSection>

      <LegalSection title="Your data">
        <p>
          Your business&apos;s records belong to you. We process them only to run LeadAnchor, as our{" "}
          <Link href="/privacy" className="font-medium underline underline-offset-4">
            Privacy policy
          </Link>{" "}
          describes.
        </p>
      </LegalSection>

      <LegalSection title="Ending the service">
        <p>You can stop using LeadAnchor at any time. We may suspend an account that breaks these terms or the carriers&apos; rules.</p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          LeadAnchor is provided as is. We aren&apos;t liable for calls or texts that carriers delay, filter or don&apos;t deliver. Our total
          liability is limited to the fees you paid us in the 12 months before the claim.
        </p>
      </LegalSection>

      <LegalSection id="sms" title="SMS terms for customers">
        <p>
          Businesses use LeadAnchor to text customers who agreed to it, about their request and job, and offers only if they agreed to those
          separately. Message frequency varies. Message and data rates may apply. Reply HELP for help, or STOP to cancel at any time. Carriers are
          not liable for delayed or undelivered messages.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>We will tell you about important changes to these terms before they apply.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <ContactLine />
      </LegalSection>
    </LegalPage>
  );
}
