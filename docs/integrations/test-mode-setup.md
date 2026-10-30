# Free test-mode services: setup

Everything here is free and test-only. Until a service's keys are in `apps/api/.env`, the app keeps using its built-in simulator, so you can set these up in any order and nothing breaks in between. Keys go only in `apps/api/.env`, which git ignores and the browser never sees. The API restarts by itself when `.env` changes.

Suggested order: ngrok first (the webhook addresses below need it), then Stripe, Resend, Firebase, Google Calendar, WhatsApp, and Telnyx last.

To check a service, open **Integrations** in the app: it shows each one as **Live** or **Simulated**.

## 1. ngrok: a public address for webhooks

WhatsApp, Telnyx, Stripe and Resend send their events to the app over the internet. ngrok gives this computer one fixed public address. Only the API (port 4000) is exposed, not the web app.

1. Sign up at <https://dashboard.ngrok.com/signup>.
2. Install it: `winget install ngrok.ngrok`, or download it from <https://ngrok.com/download>.
3. Copy your authtoken (dashboard → **Your Authtoken**) and run once: `ngrok config add-authtoken <your token>`.
4. Dashboard → **Domains**: copy your free domain, for example `quiet-otter-123.ngrok-free.app`.
5. In `apps/api/.env`: `TUNNEL_URL=https://<your domain>`.
6. Whenever you test webhooks, run `pnpm tunnel` in a terminal and leave it open.

Below, `<tunnel>` means `https://<your domain>`.

## 2. Stripe (test mode)

1. Sign up at <https://dashboard.stripe.com/register>. Pick **United States** as the country: the app is for US businesses and charges in dollars. Test mode needs no business details or bank account.
2. Open **Connect** in the dashboard and click **Get started**. This lets each business have its own Stripe account, as the spec requires.
3. **Developers → API keys**: copy the **Secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks**: add an endpoint (an "event destination") at `<tunnel>/api/webhooks/stripe`. Set it to listen to events on **Connected accounts**, and pick `account.updated` plus all `checkout.session.*`, `payment_intent.*`, `customer.subscription.*` and `invoice.*` events. Copy its signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

When a business turns on card payments in the app, Stripe's own setup page opens. In test mode it accepts test values: SMS code `000000`, SSN `000-00-0000`, routing number `110000000`, account number `000123456789`.

Test cards (any future date, any CVC): `4242 4242 4242 4242` pays; `4000 0000 0000 0341` saves but declines when charged, which is useful for membership retries; `4000 0000 0000 9995` always declines.

## 3. Resend (email)

1. Sign up at <https://resend.com/signup>.
2. **API Keys → Create API key** with **Sending access**, and put it in `RESEND_API_KEY`.
3. In `.env`:
   - `EMAIL_TRANSPORT=resend`
   - `EMAIL_FROM=LeadAnchor <onboarding@resend.dev>`
   - `EMAIL_TEST_RECIPIENT=<the email you signed up with>`

   Without your own domain, Resend only delivers to your sign-up address. So every test email goes there, with the real recipient shown at the top. Resend's test addresses `delivered@resend.dev`, `bounced@resend.dev` and `complained@resend.dev` go through unchanged: give a customer one of them to try a bounce or a spam report.
4. **Webhooks → Add endpoint** at `<tunnel>/api/webhooks/resend`, with the events `email.delivered`, `email.bounced` and `email.complained`. Copy its signing secret into `RESEND_WEBHOOK_SECRET`.

## 4. Firebase (phone alerts and the consent ledger)

1. Go to <https://console.firebase.google.com> and click **Add project**. Google Analytics isn't needed. The free Spark plan is enough.
2. **Project settings → General → Your apps**: add a **Web** app. From its config, copy these four values into `.env`:
   - `apiKey` into `FIREBASE_WEB_API_KEY`
   - `messagingSenderId` into `FIREBASE_MESSAGING_SENDER_ID`
   - `appId` into `FIREBASE_WEB_APP_ID`
   - `projectId` into `FIREBASE_PROJECT_ID`

   These four are public by design: every browser that gets alerts needs them. The API hands them out; they aren't written into the code.
3. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**: copy the key into `FIREBASE_VAPID_KEY`.
4. **Project settings → Service accounts → Generate new private key**. Save the file as `apps/api/secrets/firebase-service-account.json` (git ignores that folder), and set `GOOGLE_APPLICATION_CREDENTIALS=./secrets/firebase-service-account.json`. This file is the real secret: never share it.
5. Set `FCM_ENABLED=true`. Then, in the app, open **Settings → Phone alerts** and turn alerts on in this browser.
6. Consent ledger: **Build → Firestore Database → Create database**, in production mode with a US location. Then set `CONSENT_LEDGER=local-and-firestore`. The app keeps checking consent against its own ledger, so nothing already recorded is lost, and every new yes or no is also written to Firestore.

## 5. Google Calendar

1. Go to <https://console.cloud.google.com> and pick your Firebase project (it is also a Google Cloud project), or create a new one.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **Google Auth Platform** (the OAuth consent screen): set the app name to LeadAnchor, the audience to **External**, and your email as the contact. Under **Audience**, leave it in **Testing** and add your Google account as a **Test user**.
4. **Clients → Create client → Web application**. Add the redirect URI `http://localhost:3000/api/calendar/google/callback`. Copy the client ID and secret into `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
5. In the app, open `http://localhost:3000` (not the network address), go to **Settings → Online booking**, and connect Google Calendar. While the app is in Testing, Google ends the connection after 7 days; just connect again.

## 6. WhatsApp (Meta's free test number)

1. At <https://developers.facebook.com>, go to **My Apps → Create app** and pick the WhatsApp use case ("Connect with customers through WhatsApp"). Meta creates a free test business number.
2. **WhatsApp → API Setup**:
   - Copy the **Phone number ID** into `WHATSAPP_PHONE_NUMBER_ID`.
   - Copy the **access token** into `WHATSAPP_ACCESS_TOKEN`. The temporary token lasts 24 hours. For one that lasts, create a System User in Meta Business Settings with the `whatsapp_business_messaging` permission.
   - Under **To**, add and verify your own WhatsApp number (up to 5 numbers).
3. **App settings → Basic**: copy the **App secret** into `WHATSAPP_APP_SECRET`.
4. Make up a long random string and put it in `WHATSAPP_VERIFY_TOKEN`.
5. Set `WHATSAPP_TEST_BUSINESS=demo-plumbing-heating-9feb`: messages to the test number go to that business.
6. **WhatsApp → Configuration → Webhook**: set the callback URL to `<tunnel>/api/webhooks/whatsapp` and the verify token to the string from step 4. The API and `pnpm tunnel` must be running. Click **Verify and save**, then subscribe to the **messages** field.
7. Try it: send the `hello_world` template from API Setup to your phone, then reply from your phone. The chat shows up in **Chats**, and the assistant answers.

## 7. Telnyx trial (last)

The trial gives $5 of credit, one phone number (a local one in your signup country, with that country's paperwork), and calls and texts only to and from your own verified mobile, with 15 delivery attempts in total. Telnyx adds a short notice before any machine speech. That is enough to prove a call or a text works once or twice.

1. Sign up at <https://telnyx.com/sign-up>, then verify your email and your mobile. That mobile becomes the only number that can call or text the trial.
2. **Numbers → Search & buy**: order one local number. The trial allows a single order, and Telnyx takes the number back after 30 days.
3. **Voice → Programmable Voice**: create a Call Control (Voice API) application with the webhook `<tunnel>/api/webhooks/telnyx`, and assign the number to it. Copy the application ID into `TELNYX_CONNECTION_ID`.
4. **Messaging**: create a messaging profile with the same webhook, and assign the number to it. Copy its ID into `TELNYX_MESSAGING_PROFILE_ID`.
5. **API Keys**: create one and put it in `TELNYX_API_KEY`. Under **Keys & Credentials → Public Key**, copy the public key into `TELNYX_PUBLIC_KEY`.
6. In `.env`, set:
   - `TELEPHONY_PROVIDER=telnyx`
   - `SMS_PROVIDER=telnyx`
   - `CARRIER_REGISTRY=simulator` (the trial can't file real carrier registrations)
   - `TELNYX_TEST_BUSINESS=demo-plumbing-heating-9feb`
   - `TELNYX_TEST_NUMBER=<the number you bought, in +E.164 form>`

   The demo business then answers on that number.
