# Running LeadAnchor: staff console, monitoring and data retention

## Operator console (module 14)

`/ops` in the web app is for LeadAnchor's own staff. List their emails in `apps/api/.env`:

```
OPERATOR_EMAILS=you@leadanchor.com,teammate@leadanchor.com
```

A staff member signs in as usual; the account menu then shows **Operator console**. Anyone else who opens `/ops` sees "LeadAnchor staff only".

- **Overview:** businesses by status, new this week, trials ending in three days, failed payments, and people who signed up but never set up a business.
- **System health:** background jobs, provider webhooks and customer messages that failed in the last 24 hours, server errors, and open alerts.
- **A business's page:** owner, plan and billing, phone line and carrier registration, connections, the last 30 days, recent failures and its audit trail.
- **Support actions:** extend a trial, suspend or unsuspend, remove from the trusted pros network, and erase a cancelled business's customer data. Each one goes in that business's audit trail with the staff member's email.

## Tracing

Every request gets an id: the caller's `x-request-id` if it sends a sensible one, otherwise a new one. It's on every log line for that request, in the response's `x-request-id` header, and next to each server error in the console.

Full traces (requests and provider webhooks, database queries, calls out to providers, and each background job) use OpenTelemetry. They're off until you say where to send them, in `apps/api/.env`:

```
# Any OTLP backend: Jaeger, Grafana Cloud (free tier), Honeycomb…
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=leadanchor-api

# Or print spans in the API's terminal while debugging
OTEL_TRACES_EXPORTER=console
```

For a local trace viewer, run Jaeger (`docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one`), set the endpoint above, restart the API and open <http://localhost:16686>.

## Alerts

Every five minutes a health check looks at the last 15 minutes:

| Alert | When |
|---|---|
| Background jobs | 3 or more failed |
| Provider webhooks | 3 or more failed to apply |
| Customer messages | 5 or more failed to send |
| Server errors | 3 or more |

A new alert is emailed once to everyone in `OPERATOR_EMAILS` and shown in the console. It clears itself once its 15 minutes are quiet again.

## Data retention

Deleted every night at 3:30 AM once past their time:

| What | Kept for |
|---|---|
| Provider webhooks, applied or ignored | 30 days |
| Provider webhooks that failed | 90 days |
| Server errors | 30 days |
| Cleared health alerts | 90 days |
| Read owner notifications | 180 days |

Also:

- Identity numbers for carrier registration (tax ID, date of birth) are stored encrypted and deleted once the registration is approved (C-43).
- Card numbers never reach LeadAnchor: only the card brand and last four digits.
- A business's own customers, jobs, messages and payments stay while it's a customer. After it cancels, staff can erase them from its page in the console, which needs its name typed to confirm. The business record, its billing history, the consent ledger and the audit trail stay: they're the legal record.
