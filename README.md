# LeadAnchor

LeadAnchor catches the calls a small service business misses and turns them into booked, paid jobs.
When the owner can't pick up, an AI Dispatcher answers in the business's name, asks what the caller
needs, gets their permission to text, and sends a no-login request form. Every catch lands on a lead
board on the owner's phone, with an AI summary and photo read-out, and the dashboard shows the money
recovered.

This repository is the first build: **the core capture loop (Phase 1)** running fully on a laptop.
Services the spec names but that need accounts or approvals (Telnyx, WhatsApp, Firebase, Google
Business Profile, Stripe) sit behind adapters, with a local stand-in where needed, so everything can
be tried today and switched to the real service later without touching business code.

## Quick start

Requirements: **Node 22+** and **pnpm 10** (`corepack enable`). No Docker needed.

```bash
pnpm install
pnpm setup          # creates apps/api/.env and apps/web/.env.local with fresh secrets
```

Add your Google AI Studio key to `apps/api/.env` (`GEMINI_API_KEY=…`) to turn on AI summaries.

```bash
pnpm db:start       # local PostgreSQL 18 on port 5433 — keep this terminal open
pnpm db:migrate     # tables, database roles and row-level security
pnpm dev            # API on :4000, web app on :3000
```

Open <http://localhost:3000>, create an account, set up your business, then open **Call simulator**
and place a test call.

Want a ready-made business instead? `pnpm db:seed` creates a demo owner account with texting already
approved; the sign-in details are at the top of `apps/api/src/db/seed.ts`. It is for local use only.

The local database is UTF-8, so customers' emoji and accents are stored as typed. A database created
before that (on Windows it took the system code page, e.g. WIN1252) can be converted in place, keeping
its data: stop the API, then run `pnpm db:utf8`. The original stays as `leadanchor_old_<encoding>`
until you drop it.

## What works today

| Area | Capabilities (spreadsheet IDs) | Status |
|---|---|---|
| Business number and call routing | C-02, C-03 | Built. Simulated number locally; Telnyx number ordering in the adapter |
| Missed-call forwarding setup | C-01 | Built. Carrier codes with tap-to-dial and copy |
| Recognise new vs returning callers | C-04 | Built |
| "Tap to call back" for hang-ups (ghost leads) | C-05 | Built. In-app alert in real time; FCM push adapter ready |
| AI Dispatcher (greeting, one question, spoken consent, 60 s hard stop) | C-39, C-06 | Built and tested end to end in the simulator |
| One link text after a missed call | C-07 | Built, through the governed send path |
| No-login request form with photos | C-08, C-09 | Built. Mobile-first, EXIF/GPS stripped from photos |
| Lead board with call and text | C-12 | Built. Drag on tablet/desktop, "Move to…" sheet on phones |
| Voicemail transcripts turned into leads | C-13 | Built. Telnyx speech-to-text event mapped; Gemini extraction |
| Dashboard and value summary | C-14, C-40 | Built. "Recovered" counts only real job values |
| Consent ledger and STOP handling | C-27 | Built. Append-only and hash-chained (see Firebase below) |
| Carrier registration (EIN and sole-proprietor paths) | C-43 | Built. Encrypted EIN/DOB, masked display; approval simulated locally |
| Customer history on the lead | C-34 | Built |
| Service catalogue (drives the form) | C-17 | Seeded per trade; editing UI is next |
| Everything in Phase 2+ (quotes, payments, scheduling, reviews, campaigns, memberships) | C-15 … C-52 | Not started |

## Services named in the spec

| Service | How this build uses it |
|---|---|
| **Telnyx** (calls, SMS, speech-to-text, 10DLC) | Full Call Control adapter with signed-webhook verification (`docs/integrations/telnyx.md`). Locally the **call simulator** drives the same engine. Set `TELEPHONY_PROVIDER=telnyx` plus keys to go live. |
| **Meta WhatsApp** (via a BSP) | Cloud API adapter and webhook ready; needs a Meta Business account. The send policy only uses it inside the 24-hour customer window. |
| **Firebase** (FCM push, consent ledger) | FCM adapter and a **Firestore consent-ledger adapter** are built. This machine has no Java (needed by the Firebase emulator) and no Firebase project yet, so the ledger runs on an interim append-only, hash-chained Postgres table with the same fields. Switch with `CONSENT_LEDGER=firestore`. |
| **Google Business Profile**, **Stripe**, **Calendly/Jobber/Acuity**, **weather/holiday APIs** | Later phases; shown as "Later phase" on the Integrations screen. |
| **AI** (not named in the spec) | Google Gemini, model `gemini-3.8-flash`, behind an `AiProvider` port. |

## How it's built

```
apps/
  api/        Fastify + Drizzle + Better Auth + pg-boss (TypeScript)
    src/modules/       business logic: calls engine, leads, intake, messaging, compliance, dashboard
    src/integrations/  one adapter per vendor: telephony (Telnyx, simulator), ai (Gemini), messaging,
                       firebase, push, storage
    src/http/          routes: authenticated app, public form, provider webhooks, dev tools
  web/        Next.js 16 (App Router, Cache Components) + Tailwind 4 + shadcn/ui (Base UI)
    src/features/      one folder per screen: dashboard, leads, calls, intake, simulator, settings…
    src/components/    app shell, shared UI
packages/
  contracts/  shared vocabulary and zod schemas used by both apps
tools/
  dev-db/     runs a real PostgreSQL for development
docs/         Telnyx integration notes and the UI research brief
```

Key decisions:

- **Modular monolith, ports and adapters.** One API process; every vendor sits behind an interface,
  so providers can be swapped (the PDF requires this).
- **Call engine as a state machine** over normalised events. Commands to the provider are sent only
  after the state change commits; duplicate and out-of-order webhooks are harmless.
- **One governed send path.** Feature code never calls an SMS/WhatsApp provider. Every message goes
  through a policy (consent, STOP, carrier approval, 24-hour window, quiet hours, email-first
  marketing) and is stored with the decision and the reasons.
- **Multi-tenancy in the database.** Every business's rows carry `tenant_id`, protected by
  PostgreSQL row-level security; the app connects as a role that cannot bypass it.
- **Background work on pg-boss** (Postgres), with retries and backoff — no extra infrastructure.
- **Design** follows `docs/design/ui-research.md`: mobile-first, 44 px touch targets, bottom sheets,
  Archivo and Atkinson Hyperlegible Next, one accent colour, no AI-template look.

## Security

- Secrets live only in git-ignored env files; the browser never sees an API key (the web app proxies
  `/api` to the API).
- Tax IDs and dates of birth are AES-256-GCM encrypted and shown masked.
- Provider webhooks are signature-checked (Telnyx ed25519, Meta HMAC).
- Customer links are random tokens stored only as hashes and expire after 7 days.
- **Rotate the Gemini API key** that was shared in chat, and put the new one in `apps/api/.env`.

## Useful commands

```bash
pnpm test           # unit tests (send policy, consent detection, Telnyx webhooks)
pnpm typecheck      # all packages
pnpm db:studio      # browse the database
pnpm db:generate    # create a migration after changing apps/api/src/db/schema
```
