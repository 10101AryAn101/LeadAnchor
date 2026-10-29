import { REGISTRATION_ID_RETENTION_DAYS } from "@leadanchor/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy policy" };

/** Public privacy policy. Carriers check it before approving a business for texting (C-43 AC 7). */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="October 29, 2026"
      intro={
        <p>
          LeadAnchor is software that answers and follows up on calls, texts and service requests for local businesses. This policy explains what we
          collect, why, and what you can do about it, both for business owners who use LeadAnchor and for customers who contact those businesses.
        </p>
      }
    >
      <LegalSection title="What we collect">
        <p>From business owners:</p>
        <ul>
          <li>Your name, email and password (stored only as a secure hash).</li>
          <li>Business details: name, trade, city, phone numbers, and the license and insurance details you choose to show.</li>
          <li>Carrier-registration details, described below.</li>
        </ul>
        <p>From customers who contact a business:</p>
        <ul>
          <li>Your phone number and caller ID.</li>
          <li>Call recordings, voicemails and their transcripts, including what you tell the automated assistant.</li>
          <li>What you enter on a request form: name, address, email, a description of the job and photos.</li>
          <li>Texts and messages, and your answers to permission questions, with the time and the exact wording you agreed to.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>To answer and follow up on calls, send the request forms and updates you agreed to, and organize jobs for the business.</li>
          <li>To show the business your job history and send it a summary of results.</li>
          <li>To keep the proof of consent that texting rules require, and to honor STOP right away.</li>
        </ul>
        <p>We don&apos;t sell personal information.</p>
      </LegalSection>

      <LegalSection id="carrier-registration" title="Carrier registration (10DLC)">
        <p>
          US mobile carriers require every business that sends automatic texts to be registered with The Campaign Registry. To register a business,
          we collect these details once:
        </p>
        <ul>
          <li>Businesses with an EIN: the legal business name, EIN, business type, address, website, and a contact name, email and phone.</li>
          <li>
            Sole proprietors: legal name, date of birth, address, mobile number and email, plus a one-time code the carriers text to that mobile.
          </li>
        </ul>
        <p>
          We use these details only to register the business with the carriers. We send them to our telecom provider, Telnyx, which files them with
          The Campaign Registry and the mobile carriers.
        </p>
        <p>
          The EIN and date of birth are encrypted when stored and only ever shown as the last 4 digits. We delete the full EIN and date of birth{" "}
          {REGISTRATION_ID_RETENTION_DAYS} days after the carriers approve the business, and keep only the last 4 digits and the approval record.
        </p>
      </LegalSection>

      <LegalSection id="texting" title="Text messages">
        <p>
          A business texts you through LeadAnchor only after you agree: by saying yes or pressing 1 on a call, or by ticking a box on its request
          form. Offers need their own, separate yes. Agreeing to texts is never a condition of getting service.
        </p>
        <p>Message frequency varies. Message and data rates may apply. Reply STOP to stop at any time, or HELP for help.</p>
        <p>
          No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text-messaging opt-in data and
          consent are not shared with any third parties.
        </p>
      </LegalSection>

      <LegalSection title="The automated assistant and AI">
        <p>
          Missed calls can be answered by an automated assistant. We use Google&apos;s Gemini service to turn call transcripts into job details and
          to read photos customers send. Google processes this data under its API terms. The business sees the results and can correct them.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <ul>
          <li>The business you contacted, which sees your details and job history.</li>
          <li>
            Service providers that run LeadAnchor, each given only what it needs: Telnyx (calls and texts), The Campaign Registry and the mobile
            carriers (texting registration), Google (AI processing, and Firebase when connected), our email provider and our hosting provider.
          </li>
          <li>Authorities, when the law requires it.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Job, call and message records are kept while the business&apos;s account is open. Consent records are kept for at least four years,
          because they are the proof that you agreed. Carrier-registration IDs follow the {REGISTRATION_ID_RETENTION_DAYS}-day rule above.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is encrypted in transit. Tax IDs and dates of birth are also encrypted at rest. Each business can see only its own records, and every
          change to consent and registration is kept in a tamper-evident log.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          Reply STOP to any text to stop them. To see, correct or delete your information, ask the business you contacted, or contact us. Business
          owners can update their details in Settings. See also our{" "}
          <Link href="/terms" className="font-medium underline underline-offset-4">
            Terms of service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <ContactLine />
      </LegalSection>
    </LegalPage>
  );
}
