# Telnyx integration reference (LeadAnchor)

Last verified: 2026-10-28. Covers Call Control (Voice API v2), webhooks, Numbers, Messaging, 10DLC and speech-to-text, called with plain `fetch` against `https://api.telnyx.com/v2`.

**How this was verified.** Field names, enums, defaults and paths come from the OpenAPI 3.1 specs that Telnyx's API reference is generated from:

- `https://developers.telnyx.com/openapi/source/external/call-control/call-control.json`
- `.../call-recordings/call-recordings.json`, `.../numbers/numbers.json`, `.../messaging/messaging.json`, `.../messaging/10dlc.json`
- Webhook example catalog: `https://developers.telnyx.com/data/webhook-events.json`

Behaviour comes from the guides on developers.telnyx.com and the articles on support.telnyx.com linked in each section. **UNVERIFIED** marks anything no official Telnyx source confirms. When Telnyx sources disagree, this file follows the OpenAPI spec and lists the conflict in section 10.

Conventions: **A** is the inbound caller leg and **B** is the outbound leg to the owner's cell. All numbers are E.164, for example `+15125550100`.

---

## 0. Account and app setup

Docs: [Create Call Control App](https://developers.telnyx.com/api-reference/call-control-applications/create-a-call-control-application) · [Voice API fundamentals](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-fundamentals) · [Support: configuring Call Control apps](https://support.telnyx.com/en/articles/4374050-configuring-call-control-texml-applications-voice-api) · [Support: SIP response codes](https://support.telnyx.com/en/articles/4409457-telnyx-sip-response-codes) · [Call Control v1→v2 migration](https://developers.telnyx.com/docs/development/migration/call-control-migration-guide)

- Every request sends `Authorization: Bearer <TELNYX_API_KEY>` and `Content-Type: application/json`.
- A **Call Control Application** (shown as "Voice API Application" in the portal) owns the voice webhook URL. Its `id` is the `connection_id` that numbers and `POST /v2/calls` use.
- `POST /v2/call_control_applications` requires `application_name` and `webhook_event_url`:

```json
{
  "application_name": "leadanchor-voice",
  "webhook_event_url": "https://api.leadanchor.app/webhooks/telnyx/voice",
  "webhook_event_failover_url": "https://failover.leadanchor.app/webhooks/telnyx/voice",
  "webhook_api_version": "2",
  "inbound": { "shaken_stir_enabled": true },
  "outbound": { "outbound_voice_profile_id": "<outbound voice profile id>" }
}
```

- **`webhook_api_version` defaults to `"1"`. Set it to `"2"`.** Everything in this file is the v2 format. v1 has a different envelope and signs with HMAC-SHA256 in `X-Telnyx-Signature`.
- Other app fields:
  - `webhook_timeout_secs`: 0–30, default null.
  - `first_command_timeout` (default false) and `first_command_timeout_secs` (default 30): hang up a call if your app sends no command in time.
  - `anchorsite_override` (default `"Latency"`), `dtmf_type` (default `"RFC 2833"`), `call_cost_in_webhooks` (bool), `inbound.channel_limit`, `outbound.channel_limit`.
- **Outbound legs (transfer and dial) need an Outbound Voice Profile on the app.** Without one, the call fails with SIP 403 `D38` (no Outbound Profile assigned). A `from` number that is not on your account fails with `D35` (invalid caller origination number).
- **Webhook public key:** Mission Control → Keys & Credentials → Public Key. There is one key pair per account, shared by all products (see section 5).

---

## 1. Call Control webhook envelope

Docs: [Voice API webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks) · [Receiving webhooks (voice)](https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks) · [call.initiated schema](https://developers.telnyx.com/api-reference/callbacks/call-initiated)

```json
{
  "data": {
    "record_type": "event",
    "event_type": "call.initiated",
    "id": "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    "occurred_at": "2026-10-28T15:04:05.521992Z",
    "payload": {
      "call_control_id": "v3:MdI91X4lWFEs7IgbBEOT9M4AigoY08M0WWZFISt1Yw2axZ_IiE4pqg",
      "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      "call_session_id": "428c31b6-abf3-3bc1-b7f4-5013ef9657c1",
      "connection_id": "1494404757140276705",
      "client_state": null,
      "from": "+15125550111",
      "to": "+15125550100",
      "direction": "incoming",
      "state": "parked",
      "start_time": "2026-10-28T15:04:05.400000Z"
    }
  },
  "meta": { "attempt": 1, "delivered_to": "https://api.leadanchor.app/webhooks/telnyx/voice" }
}
```

| Field | Meaning |
|---|---|
| `data.record_type` | Always `"event"`. |
| `data.event_type` | Event name, e.g. `call.hangup` (see section 2). |
| `data.id` | Unique per event (UUID). Deduplicate on this. |
| `data.occurred_at` | ISO-8601 time of the event. Use it to reconcile out-of-order delivery. |
| `payload.call_control_id` | Per-leg token for `/v2/calls/{call_control_id}/actions/*`, e.g. `v3:...`. Telnyx examples put it in the path as-is. |
| `payload.call_leg_id` | Unique ID of this leg. |
| `payload.call_session_id` | Shared by related legs, such as A and B of a transfer. |
| `payload.connection_id` | The Call Control App ID. |
| `payload.from` / `payload.to` | Number or SIP URI. |
| `payload.direction` | `incoming` or `outgoing`. Present on `call.initiated`. |
| `payload.state` | `parked` or `bridging` on `call.initiated`, `answered` on `call.answered`, `hangup` on `call.hangup`. |
| `payload.client_state` | Base64 string you set on an earlier command, echoed back. `null` or absent when unset. |
| `payload.start_time` | Present on `call.initiated`, `call.answered` and `call.hangup`. |
| `payload.end_time` | **Not in the current schema of any call webhook** (older doc examples had it on `call.hangup`; UNVERIFIED whether it is still sent). For the end time, use `data.occurred_at` of `call.hangup`, or `GET /v2/calls/{call_control_id}`, which returns `start_time`, `end_time`, `call_duration` and `is_alive` for up to 10 minutes after the call ends. |
| `meta.attempt` | Delivery attempt number, starting at 1 and incremented on retries. |
| `meta.delivered_to` | The URL this delivery went to. |

Delivery rules for voice webhooks:

- Telnyx does not guarantee order. Expect out-of-order, near-simultaneous and duplicate webhooks.
- Acknowledge with a 2xx quickly and process asynchronously.
- Commands are separate API calls. Telnyx ignores the body of your webhook response.

---

## 2. Event types and payloads

Docs: [Callbacks reference](https://developers.telnyx.com/api-reference/callbacks/call-hangup) (one page per event) · [AMD guide](https://developers.telnyx.com/docs/voice/programmable-voice/answering-machine-detection) · [STT guide](https://developers.telnyx.com/docs/voice/programmable-voice/speech-to-text) · [call.recording.transcription.saved](https://developers.telnyx.com/api-reference/callbacks/call-recording-transcription-saved) · [call.ai_gather.ended](https://developers.telnyx.com/api-reference/callbacks/call-ai-gather-ended)

Every event carries the common fields from section 1. The table lists only the extra fields.

| `event_type` | Fires when | Extra payload fields / enums |
|---|---|---|
| `call.initiated` | An inbound call arrives (`direction:"incoming"`, `state:"parked"`), or dial/transfer creates an outbound leg (`direction:"outgoing"`). | `start_time`, `state` (`parked`/`bridging`), `caller_id_name`, `call_screening_result` (e.g. `spam_likely`), `shaken_stir_attestation`, `shaken_stir_validated` (needs `inbound.shaken_stir_enabled`), `offered_codecs`, `connection_codecs`, `custom_headers[]`, `sip_headers[]` (`User-to-User`, `Diversion`), `tags[]` |
| `call.answered` | A leg is answered, by your `answer` or by the far end. | `start_time`, `state:"answered"`, `custom_headers`, `sip_headers`, `tags` |
| `call.hangup` | A leg ends: hangup, reject, remote hangup or timeout. | `start_time`, `state:"hangup"`, `hangup_cause`, `hangup_source`, `sip_hangup_cause` (a SIP code such as `"603"`, or `"unspecified"`, e.g. on inbound calls), `call_quality_stats` (`inbound`/`outbound` jitter, MOS and packet counts, or null), `tags` |
| `call.bridged` | Two legs are connected by bridge or transfer. | Common fields only (`from`, `to`). |
| `call.speak.started` / `call.speak.ended` | TTS starts / finishes. | `ended.status`: `completed`, `call_hangup`, `cancelled_amd` |
| `call.dtmf.received` | Each digit during a gather. | `digit` |
| `call.gather.ended` | A DTMF gather finishes. | `digits` (string), `status`: `valid`, `invalid`, `call_hangup`, `cancelled`, `cancelled_amd`, `timeout` |
| `call.playback.started` / `call.playback.ended` | Audio starts / finishes. | `media_url`, `media_name`, `overlay`. `ended` adds `status` (`completed`, `call_hangup`, `cancelled`, `cancelled_amd`, `file_not_found`, `failed`, `unknown`) and `status_detail`. |
| `call.recording.saved` | A recording stops, through `record_stop` or hangup. | `recording_started_at`, `recording_ended_at`, `channels` (`single`/`dual`), `recording_urls.{mp3,wav}` (**valid 10 minutes**), `public_recording_urls.{mp3,wav}` (Telnyx support must enable these). **There is no `duration` field**: subtract the two timestamps, or read `duration_millis` from `GET /v2/recordings/{recording_id}`. The schema also has no `call_control_id` or `recording_id`, so correlate on `call_leg_id`, `call_session_id` or `client_state`. |
| **`call.recording.transcription.saved`** | The post-recording STT result is ready (`record_start` with `transcription:true`). | `recording_id`, `recording_transcription_id`, `transcription_text`, `status:"completed"`, `calling_party_type` (`pstn`/`sip`) |
| `call.recording.error` | A recording failed. | `reason`, e.g. `Internal server error` |
| `call.machine.detection.ended` | Standard AMD gives its verdict. | `result`: `human`, `machine`, `not_sure`. Telnyx recommends treating `not_sure` as human. |
| `call.machine.greeting.ended` | Standard AMD detects the end of the greeting or a beep. | `result`: `beep_detected`, `ended`, `not_sure` |
| `call.machine.premium.detection.ended` | Premium AMD gives its verdict. | `result`: `human_residence`, `human_business`, `machine`, `silence`, `fax_detected`, `not_sure` |
| `call.machine.premium.greeting.ended` | Premium AMD detects a beep. | `result`: `beep_detected`, `no_beep_detected`, `prompt_ended` (`prompt_ended` only in iOS-screening mode) |
| `call.machine.premium.call_screening.detected` | Mode `premium_ios_call_screening_detection` detects an Apple Call Screening tone. | `result:"screening"`. AMD then restarts, and another `...premium.detection.ended` follows. |
| `call.transcription` | Real-time STT result from `transcription_start`. | `transcription_data.{transcript, is_final, confidence (number or null), transcription_track (inbound/outbound; only with engine B)}` |
| `call.ai_gather.ended` | `gather_using_ai` finishes. | `result` (object shaped by your `parameters` JSON Schema), `message_history[]` (`{role: "assistant"/"user", content}`), `status`: `valid` or `invalid` |
| `call.ai_gather.partial_results` | Only with `send_partial_results:true`. | `partial_results`, `message_history` |
| `call.ai_gather.message_history_updated` | Only with `send_message_history_updates:true`. | `message_history` |
| `call.cost` | After the call, only if the app has `call_cost_in_webhooks:true`. | `status` (`success`/`error`), `total_cost`, `billed_duration_secs`, `cost_parts[]` |

AMD events also carry `from` and `to`. `gather_using_ai` additionally emits `call.conversation.created` (with `conversation_id`) and `call.conversation.ended`.

### `call.hangup` example and enums

```json
{
  "data": {
    "record_type": "event",
    "event_type": "call.hangup",
    "id": "8f0c0f2e-0b8a-4f39-9c55-6f0b3f7a1d10",
    "occurred_at": "2026-10-28T15:04:24.100000Z",
    "payload": {
      "call_control_id": "v3:B-leg...",
      "call_leg_id": "b1...", "call_session_id": "428c31b6-abf3-3bc1-b7f4-5013ef9657c1",
      "connection_id": "1494404757140276705",
      "client_state": "eyJsZWciOiJvd25lciJ9",
      "from": "+15125550100", "to": "+15125550199",
      "start_time": "2026-10-28T15:04:06.000000Z",
      "state": "hangup",
      "hangup_cause": "timeout",
      "hangup_source": "unknown",
      "sip_hangup_cause": "unspecified",
      "call_quality_stats": null
    }
  },
  "meta": { "attempt": 1, "delivered_to": "https://api.leadanchor.app/webhooks/telnyx/voice" }
}
```

(The `hangup_source` and `sip_hangup_cause` values in this example are illustrative: UNVERIFIED for this exact scenario.)

| Field | Values (from the OpenAPI enum) | Meaning |
|---|---|---|
| `hangup_cause` | `call_rejected`, `normal_clearing`, `originator_cancel`, `timeout`, `time_limit`, `user_busy`, `not_found`, `no_answer`, `unspecified` | Documented: `timeout` means a dial/transfer `timeout_secs` ran out. `time_limit` means `time_limit_secs` ran out. `no_answer` replaces `timeout` on dial when `retry_on_timeout:false`. The rest are **UNVERIFIED interpretations**: `call_rejected` (603 / declined), `user_busy` (486), `not_found` (404), `originator_cancel` (caller abandoned before answer), `normal_clearing` (normal end after answer). |
| `hangup_source` | `caller`, `callee`, `unknown` | The party that ended the call. |

**Do not detect a ghost lead from `hangup_cause` alone.** Use call state: A sent `call.hangup` before A was ever answered or bridged.

---

## 3. Commands

Docs: [Sending commands](https://developers.telnyx.com/docs/voice/programmable-voice/sending-commands) · [Command retries](https://developers.telnyx.com/docs/voice/programmable-voice/command-retries) · API reference: [answer](https://developers.telnyx.com/api-reference/call-commands/answer-call), [transfer](https://developers.telnyx.com/api-reference/call-commands/transfer-call), [speak](https://developers.telnyx.com/api-reference/call-commands/speak-text), [gather_using_speak](https://developers.telnyx.com/api-reference/call-commands/gather-using-speak), [gather_using_ai](https://developers.telnyx.com/api-reference/call-commands/gather-using-ai), [record_start](https://developers.telnyx.com/api-reference/call-commands/recording-start), [transcription_start](https://developers.telnyx.com/api-reference/call-commands/transcription-start), [playback_start](https://developers.telnyx.com/api-reference/call-commands/play-audio-url), [hangup](https://developers.telnyx.com/api-reference/call-commands/hangup-call), [reject](https://developers.telnyx.com/api-reference/call-commands/reject-a-call), [bridge](https://developers.telnyx.com/api-reference/call-commands/bridge-calls), [client_state_update](https://developers.telnyx.com/api-reference/call-commands/update-client-state), [dial](https://developers.telnyx.com/api-reference/call-commands/dial), [retrieve call status](https://developers.telnyx.com/api-reference/call-information/retrieve-a-call-status)

### 3.0 Common contract

- **Path:** `POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/{action}`
- **Success:** `200 {"data":{"result":"ok"}}`. A 200 only means Telnyx accepted the command; the outcome arrives by webhook.
  - `answer` with `record` also returns `recording_id`.
  - `gather_using_ai` also returns `conversation_id`.
  - `transfer` does **not** return the new leg's ID. You learn it from B's webhooks.
- **Errors:** 403, 404, or `422` with `errors[].code`. Codes seen in the spec:

| Code | Meaning |
|---|---|
| `90018` | Call has already ended |
| `90034` | Call not answered yet (media commands before `answer`) |
| `90015` | Invalid Call Control ID |
| `90033` | Unable to execute command |
| `90054` | Call transcription already in progress |
| `90020` | Recording triggered before audio started |
| `90072` | Recording could not be started |
| `90040` | Downloading audio file failed |
| `90103` | Dials per second limit exceeded |

- **`client_state`** must be a valid **Base64** string. Telnyx echoes it in every later webhook of that leg. You can change it with `client_state_update` (`{"client_state": "..."}`, required).
  - Transfer and dial also take `target_leg_client_state` / `client_state`, which apply to the new leg.
  - The maximum size is UNVERIFIED. Keep it small: store state server-side and put an ID in it.

  ```ts
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
  const dec = <T>(s?: string | null) => (s ? (JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T) : null);
  ```

- **`command_id`** is an idempotency key. Telnyx ignores a repeated `command_id` for the same `call_control_id`; the voice webhook guides say repeats are ignored "within 60 seconds". For dial, a repeated `command_id` makes Telnyx ignore later Dial commands.
  - Telnyx's command-retries guide says to use a UUIDv4 per logical command.
  - On a 5xx, or no HTTP response within 500 ms, resend the identical command with the **same** `command_id`.
- **Per-command overrides:** `webhook_url` and `webhook_url_method` (`POST`/`GET`).
  - Dial, answer and transfer also take `webhook_urls` (an event-type → URLs map) and `webhook_retries_policies`, e.g. `{"call.hangup":{"retries_ms":[1000,2000,5000]}}` (max 5 retries, total delay ≤ 60 s).
- **`answer` first:** most media commands need an answered call (`90034` otherwise). `transfer`, `reject` and `hangup` work on an unanswered inbound call.

### 3.1 `answer`: `POST /v2/calls/{id}/actions/answer`

- **Params (all optional):** `client_state`, `command_id`, `webhook_url`, `webhook_url_method`.
- **Recording on answer:** `record: "record-from-answer"` plus `record_channels` (`single`/`dual`, default `dual`), `record_format` (`mp3`/`wav`, default `mp3`), `record_max_length` (s, 0 = unlimited), `record_timeout_secs`, `record_track` (`both`/`inbound`/`outbound`), `record_trim: "trim-silence"`, `record_custom_file_name`.
- **Transcription on answer:** `transcription: true` plus `transcription_config` (same shape as `transcription_start`).
- **Also available:** streaming (`stream_*`), `preferred_codecs`, `custom_headers`, `sip_headers`, `assistant` (start a Telnyx AI assistant).
- **Webhook:** `call.answered`.

### 3.2 `transfer`: `POST /v2/calls/{id}/actions/transfer`

Telnyx dials a new leg and bridges it to this call when it answers.

**Expected webhooks:**
- `call.initiated` and `call.bridged` for leg B
- `call.answered` or `call.hangup`
- AMD events if requested: `call.machine.detection.ended`, `call.machine.greeting.ended`, `call.machine.premium.detection.ended`, `call.machine.premium.greeting.ended`, `call.machine.premium.call_screening.detected`

| Param | Type / default | Notes |
|---|---|---|
| `to` | string, **required** | E.164 or SIP URI. `"+1555…,123"` sends DTMF after answer. |
| `from` | string. Defaults to the **`to` of the original call** (your Telnyx number). | Caller ID the owner sees. |
| `diversion` | string (the A leg's `to`) | Lets you present the original caller's number as `from`. Telnyx treats `from` as verified when an active inbound call matches `to = diversion` and that `from`. |
| `from_display_name` | string, ≤128 chars | SIP display name. Whether it shows on a PSTN cell phone is UNVERIFIED. |
| `timeout_secs` | int, default **30**, min **5**, max 600 | If B does not answer in time, **B** gets `call.hangup` with `hangup_cause:"timeout"`. |
| `time_limit_secs` | int, default 14400, range 30–14400 | Maximum leg duration, after which `hangup_cause:"time_limit"`. |
| `answering_machine_detection` | `premium`, `premium_ios_call_screening_detection`, `detect`, `detect_beep`, `detect_words`, `greeting_end`, `disabled` (default) | Runs on leg B. |
| `answering_machine_detection_config` | object | Standard defaults: `total_analysis_time_millis` 3500, `greeting_duration_millis` 3500, `after_greeting_silence_millis` 800, `between_words_silence_millis` 50, `initial_silence_millis` 3500, `maximum_number_of_words` 5, `maximum_word_length_millis` 3500, `silence_threshold` 256, `greeting_total_analysis_time_millis` 5000, `greeting_silence_duration_millis` 1500, plus `beep_*` tuning. **Premium honours only `total_analysis_time_millis` and `greeting_duration_millis`** (plus `prompt_end_timeout_millis` in iOS mode). |
| `early_media` | bool, default **true** | `false` stops B's early media (ringback or announcements) from reaching A. |
| `audio_url` / `media_name` | string | Played **to B on answer, before the bridge**. Useful as an owner "whisper", e.g. "LeadAnchor call for Acme". |
| `park_after_unbridge` | `"self"` | When B hangs up after the bridge, A is parked instead of hung up. **The default hangs A up.** |
| `client_state` | base64 | Applies to A's later webhooks. |
| `target_leg_client_state` | base64 | Added to **every webhook of the new leg**. Use it to recognise B. |
| `command_id` | string | Idempotency key. |
| `webhook_url`, `webhook_url_method`, `webhook_urls`, `webhook_urls_method`, `webhook_retries_policies` | | See 3.0. |
| `record`, `record_channels`, `record_format`, `record_max_length`, `record_timeout_secs`, `record_track`, `record_trim`, `record_custom_file_name` | | Record from answer. |
| Rarely needed | | `privacy` (`id`/`none`), `send_digits_on_answer`, `custom_headers`, `sip_headers` (User-to-User), `sip_auth_username`/`sip_auth_password`, `sip_transport_protocol`, `media_encryption`, `mute_dtmf`, `sound_modifications`, `sip_region` (default `US`), `preferred_codecs`, `route_to_mobile` |

**When the target does not answer (verified).** This holds for timeout, busy, reject and unreachable alike:

1. Telnyx sends **`call.hangup` for leg B**. B's `client_state` equals your `target_leg_client_state`, and B shares A's `call_session_id`.
2. **The original leg A stays active.** It stays parked and unanswered if you transferred before answering, and you can send it more commands, including another transfer.

Sources: the transfer reference, and Telnyx's Edge Compute guide [Handling Calls](https://developers.telnyx.com/docs/edge-compute/telnyx-api/handling-calls), which describes the same failure behaviour for a transfer issued on `call.initiated`.

### 3.3 `speak`: `POST /v2/calls/{id}/actions/speak`

- **Required:**
  - `payload`: text or SSML, ≤ 3000 chars.
  - `voice`: format `<Provider>.<Model>.<VoiceId>`, e.g. `Telnyx.KokoroTTS.af`, `AWS.Polly.Joanna-Neural`, `Azure.en-US-AvaMultilingualNeural`. ElevenLabs needs `voice_settings.api_key_ref`.
- **Optional:**
  - `payload_type`: `text` (default) or `ssml`.
  - `service_level`: `premium` (default) or `basic` (`basic` allows only en-US text).
  - `language`: e.g. `en-US`. Ignored for Polly voices.
  - `voice_settings`, `loop`.
  - `target_legs`: `self` (default), `opposite` or `both`.
  - `stop`: `current` or `all`.
  - `client_state`, `command_id`.
- Repeated speak commands are queued.
- **Webhooks:** `call.speak.started`, `call.speak.ended`.

### 3.4 `gather_using_speak`: `POST /v2/calls/{id}/actions/gather_using_speak`

- **Required:** `payload`, `voice`. The call must be answered.
- **Optional (defaults in brackets):**
  - `invalid_payload`, `payload_type`, `service_level`, `language`
  - `minimum_digits` [1], `maximum_digits` [128], `maximum_tries` [3], `timeout_millis` [60000]
  - `terminating_digit` [`#`]; `""` disables it.
  - `valid_digits` [`0123456789#*`], `inter_digit_timeout_millis` [5000]
  - `client_state`, `command_id`
- **Webhooks:** `call.dtmf.received` (one per digit), then `call.gather.ended`.

### 3.5 `gather_using_ai` (exists): `POST /v2/calls/{id}/actions/gather_using_ai`

- **Required:** `parameters`, a JSON Schema object. Its `required` list decides when the gather ends. With no required fields, the gather ends at the first value.
- **Optional:**
  - `greeting` (≤ 3000 chars)
  - `voice` (default `Telnyx.KokoroTTS.af`), `voice_settings`, `language`
  - `assistant`: `{ model (default "Qwen/Qwen3-235B-A22B"), instructions, tools[], openai_api_key_ref }`
  - `transcription`: `{ model (default "distil-whisper/distil-large-v2"; also deepgram/nova-3, deepgram/flux, ...), language }`
  - `message_history[]`, `send_partial_results`, `send_message_history_updates`
  - `user_response_timeout_ms` (default 10000), `gather_ended_speech` (≤ 3000)
  - `interruption_settings.enable` (default true), `client_state`, `command_id`
- **Webhooks:** `call.conversation.created`, `call.ai_gather.ended`, `call.conversation.ended`, plus the optional partial-results and message-history events.
- Answer the call first. The guide also suggests `suppression_start` (noise suppression) for better accuracy.

LeadAnchor example (new-caller fallback):

```json
{
  "greeting": "Hi, you've reached Acme Plumbing. Sorry we missed you. Briefly, what do you need help with, and is it OK if we text you a link to book?",
  "parameters": {
    "type": "object",
    "properties": {
      "need": { "type": "string", "description": "What the caller needs, in their own words" },
      "sms_consent": { "type": "boolean", "description": "True only if the caller clearly agreed to receive a text message" }
    },
    "required": ["need", "sms_consent"]
  },
  "voice": "Telnyx.KokoroTTS.af",
  "user_response_timeout_ms": 8000,
  "client_state": "eyJzdGVwIjoiYWlfZ2F0aGVyIn0=",
  "command_id": "7d0f3a52-6f3e-4c55-9a7a-1d2c3b4a5e6f"
}
```

`call.ai_gather.ended` then carries `payload.result` = `{"need":"...","sms_consent":true}` and `payload.status` = `valid` or `invalid`. Keep `message_history` as consent evidence.

### 3.6 `record_start`: `POST /v2/calls/{id}/actions/record_start` (voicemail)

**Required:** `format` (`mp3`/`wav`), `channels` (`single`/`dual`).

| Param | Default | Notes |
|---|---|---|
| `play_beep` | — | Beep at the start of recording. |
| `max_length` | 0 (unlimited) | Seconds, max 14400. |
| `timeout_secs` | 0 (off) | Stops recording after this much silence. The timer starts once speech is detected. Silence detection uses call transcription and is billed. |
| `recording_track` | `both` | `both`, `inbound` or `outbound`. A single track is mono. |
| `trim` | — | `"trim-silence"` |
| `custom_file_name` | — | |
| `transcription` | false | Post-recording STT. |
| `transcription_engine` | `A` | `A` = Google, `B` = Telnyx, `deepgram/nova-3` (English only). |
| `transcription_language` | `en-US` | |
| `transcription_profanity_filter`, `transcription_speaker_diarization`, `transcription_min_speaker_count`, `transcription_max_speaker_count` | | Google only. |
| `client_state`, `command_id` | | |

- Recording stops on hangup or `record_stop` (`{recording_id?, client_state?, command_id?}`).
- **Webhooks:** `call.recording.saved`, `call.recording.transcription.saved`, `call.recording.error`.

### 3.7 `transcription_start` (real-time): `POST /v2/calls/{id}/actions/transcription_start`

- `transcription_engine`: `Google` (default), `Telnyx`, `Deepgram`, `Azure`, `xAI`, `AssemblyAI`, `Speechmatics`, `Soniox`, `Parakeet`, `Humain`, `Reson8`, `Cohere`. Legacy `A` = Google and `B` = Telnyx still work.
- `transcription_engine_config` is selected by its `transcription_engine` value:
  - Google: `language`, `interim_results`, `model`, `hints`, ...
  - Telnyx: `language`, `transcription_model` (`openai/whisper-tiny` default, `openai/whisper-large-v3-turbo`).
  - Deepgram: `transcription_model` (`deepgram/nova-2`, `nova-3`, `flux`, ...), `language`, `interim_results`, `keyterms`, ...
- `transcription_tracks`: `inbound` (default), `outbound` or `both`.
- Also `client_state`, `command_id`. Stop with `transcription_stop`.
- **Webhook:** `call.transcription`.

### 3.8 Playback, hangup, reject, bridge

- **`playback_start`**
  - Source: `audio_url`, `media_name` or `playback_content` (base64 mp3/wav). Set the type with `audio_type` (`mp3` default / `wav`).
  - Options: `loop` (1–100 or `"infinity"`), `overlay`, `stop`, `target_legs`, `cache_audio` (default true), `client_state`, `command_id`.
  - Webhooks: `call.playback.started`, `call.playback.ended`.
  - Stop with `playback_stop` (`stop`: `all` default / `current`; `overlay`).
- **`hangup`**
  - Params: `client_state`, `command_id`, `custom_headers`, `reason` (SIP `Reason` text when cancelling an unanswered outbound leg).
  - Webhooks: `call.hangup`, plus `call.recording.saved` if recording.
- **`reject`** (unanswered inbound only)
  - Requires `cause`: `CALL_REJECTED` (603), `NOT_FOUND` (404), `TEMPORARILY_UNAVAILABLE` (480) or `USER_BUSY` (486).
  - Webhook: `call.hangup`.
- **`bridge`**
  - Requires `call_control_id` of the other leg.
  - Optional:
    - `park_after_unbridge: "self"`, `hold_after_unbridge`, `prevent_double_bridge`
    - `play_ringtone` with `ringtone` (country code, default `us`); this ringtone plays while the other call is still unanswered.
    - `mute_dtmf`, `record*`, `client_state`, `command_id`, plus `queue` / `video_room_id` alternatives.
  - Webhook: `call.bridged` for **both** legs.

### 3.9 Dial a new leg: `POST /v2/calls`

**Required:** `connection_id`, `to`, `from`.

| Param | Default | Notes |
|---|---|---|
| `to` | | String, or an array of destinations. Whether an array rings them simultaneously is UNVERIFIED. |
| `timeout_secs` | 30 | 5–600. On expiry, `call.hangup` with `hangup_cause:"timeout"`. |
| `retry_on_timeout` | **true** | Keeps trying alternate routes after `timeout_secs`. Set **`false`** for a hard ring budget; the cause is then `no_answer`. |
| `time_limit_secs` | 14400 | |
| `answering_machine_detection` (+ `_config`) | | Same values as transfer. |
| `link_to` | | Another call's `call_control_id`; the new leg shares its `call_session_id`. |
| `bridge_on_answer` | false | Needs `link_to`. Auto-bridges to the `link_to` call on answer. |
| `bridge_intent` | false | Needs `link_to`. `from` is overwritten with the linked call's `from`. |
| `park_after_unbridge` | | `"self"`; needs `link_to`. |
| `prevent_double_bridge` | false | |
| `client_state`, `command_id` | | |
| `webhook_url*`, `webhook_urls`, `webhook_retries_policies` | | |
| `audio_url` / `media_name` | | Played on answer. |
| `send_digits_on_answer` | | |
| `record*`, `transcription` + `transcription_config` | | |
| `custom_headers`, `sip_headers`, `from_display_name`, `diversion`, `privacy`, `sip_region` | | |

Example:

```json
{
  "connection_id": "1494404757140276705",
  "to": "+15125550199",
  "from": "+15125550100",
  "link_to": "v3:A-leg...",
  "bridge_on_answer": true,
  "timeout_secs": 18,
  "retry_on_timeout": false,
  "answering_machine_detection": "premium",
  "client_state": "eyJsZWciOiJvd25lciJ9",
  "command_id": "c1b5c0de-0d1a-4c47-8f0e-5b7f1b0c9a11"
}
```

The response is `{"data":{"call_control_id","call_leg_id","call_session_id","is_alive":false,"record_type":"call","client_state",...}}`.

**Webhooks:** `call.initiated`, then `call.answered` or `call.hangup`, plus AMD events.

---

## 4. Ringing the owner first (LeadAnchor call flow)

Docs: [Transfer](https://developers.telnyx.com/api-reference/call-commands/transfer-call) · [Edge Compute: Handling Calls (transfer on call.initiated)](https://developers.telnyx.com/docs/edge-compute/telnyx-api/handling-calls) · [AMD](https://developers.telnyx.com/docs/voice/programmable-voice/answering-machine-detection)

### 4.1 Facts

| Question | Answer | Status |
|---|---|---|
| Can `transfer` run on an unanswered inbound call? | Yes. Telnyx's own guide issues `transfer` straight from `call.initiated` with no `answer`: Telnyx dials the destination and bridges the caller when it answers. The AMD guide likewise mentions AMD when transferring an inbound call. | Verified |
| What does the caller hear while the owner's phone rings? | `early_media` defaults to `true`, so B's early media (the owner's carrier ringback, or an announcement if the carrier plays one) is passed to the caller. | Verified that early media is passed. What the caller hears with `early_media:false`, and during the brief parked moment before your first command (carrier ringback or silence), is **UNVERIFIED**. |
| How do you know the owner did not answer? | `call.hangup` on **B**, identified by `target_leg_client_state` or by `call_control_id` ≠ A. `hangup_cause` is `timeout` for a ring timeout; other causes (busy, rejected, not found) also mean "not connected". | Verified |
| Is A still usable after a failed transfer? | Yes. A stays active and can be answered, transferred again, and so on. | Verified |
| What happens to A when B hangs up after a bridge? | A hangs up by default. With `park_after_unbridge:"self"`, A is parked instead. | Verified |
| Does Telnyx wait for the AMD verdict before bridging a transfer? | Not documented. Assume the bridge happens on answer: the caller may hear the start of the owner's voicemail greeting until you hang up B. | **UNVERIFIED** |
| Does transfer retry alternate routes after `timeout_secs`, like dial's `retry_on_timeout`? | Transfer has no such parameter. | **UNVERIFIED** |
| Does A receive `call.answered` / `call.bridged` when a transfer from an unanswered A connects? | `call.bridged` is documented for leg B. | **UNVERIFIED** for A |

### 4.2 Recommended transfer request (sent on A's `call.initiated`)

```json
{
  "to": "+15125550199",
  "timeout_secs": 18,
  "answering_machine_detection": "premium",
  "answering_machine_detection_config": { "total_analysis_time_millis": 5000 },
  "park_after_unbridge": "self",
  "early_media": true,
  "audio_url": "https://cdn.leadanchor.app/whisper/new-lead.mp3",
  "client_state": "<b64 {\"tenant\":\"t_123\",\"leg\":\"caller\"}>",
  "target_leg_client_state": "<b64 {\"tenant\":\"t_123\",\"leg\":\"owner\"}>",
  "command_id": "<uuid, reused on retry>"
}
```

`from` is omitted, so the owner sees the business's Telnyx number. To show the caller's number instead, set `from` to the caller and `diversion` to the business number.

`audio_url` is optional. Note that it is also played into a voicemail box if the owner's voicemail answers.

### 4.3 State machine

Webhooks can arrive in any order. Keep per-`call_session_id` state, deduplicate on `data.id`, and treat 422 `90018` (call has already ended) as a normal race.

| # | Webhook (leg) | Condition | Action |
|---|---|---|---|
| 1 | `call.initiated` (A, `direction:"incoming"`) | Tenant found by `payload.to` | Persist the A IDs, then send the `transfer` on A from 4.2. |
| 2 | `call.initiated` (B; `client_state` decodes to `leg:"owner"`) | — | Persist B's `call_control_id`. |
| 3 | `call.answered` (B) / `call.bridged` | — | Mark the session "owner connected, AMD pending". |
| 4 | `call.machine.premium.detection.ended` (B) | `machine` or `fax_detected`. Whether to include `silence` is a product decision. | `hangup` B. A survives because of `park_after_unbridge`. Continue at step 6; **A is already answered**. |
| 4b | Same | `human_residence`, `human_business` or `not_sure` | Connected. Done. |
| 5 | `call.hangup` (B) | B was never bridged (cause `timeout`, `user_busy`, `call_rejected`, `not_found`, ...) | If A is alive, `answer` A, then go to step 6. A `90018` error means the caller is gone: treat as a ghost lead. |
| 5b | `call.hangup` (B) | After a human bridge | `hangup` A. It is parked, and the caller would otherwise hear silence. |
| 6 | Fallback | Caller is NEW | `gather_using_ai` (3.5) → on `call.ai_gather.ended`, `speak` a goodbye and `hangup` on `call.speak.ended` → if `result.sms_consent === true`, `POST /v2/messages`. If you use `gather_ended_speech` instead, it is UNVERIFIED whether it has finished when `call.ai_gather.ended` arrives, so an immediate hangup could cut it off. |
| 6' | Fallback | Caller is KNOWN | `speak` a "leave a message after the tone" prompt → on `call.speak.ended`, `record_start` `{format:"mp3", channels:"single", play_beep:true, max_length:120, timeout_secs:5, recording_track:"inbound", transcription:true, transcription_engine:"B"}` → `call.recording.saved` + `call.recording.transcription.saved` → LLM extraction. |
| 7 | `call.hangup` (A) | A was never answered or bridged | **Ghost lead.** If B is still ringing, `hangup` B and ignore 422. |

### 4.4 Keeping the owner's carrier voicemail from "answering"

1. **Ring budget below voicemail pickup:** `timeout_secs: 18` (the minimum is 5). The 20–30 s pickup time of carrier voicemail varies by carrier and owner settings; it does not come from Telnyx and is UNVERIFIED.
2. **AMD on the transfer leg** catches voicemail that picks up inside the window: declined calls, DND, phone off or busy-forwarding. Telnyx recommends `premium` AMD.
   - On `machine`, hang up B (needs `park_after_unbridge:"self"`).
   - Keep `total_analysis_time_millis` short (about 4–5 s). The guide's premium default is 30 s, but the spec says 3500 ms; set it explicitly.
   - Risk: a business owner who answers with a long scripted greeting may be classified as `machine`. Tune with call data.
3. **Strict alternative that never exposes the caller to voicemail** (composed from documented commands; the end-to-end behaviour is UNVERIFIED):
   1. `POST /v2/calls` to the owner with `link_to` = A, no `bridge_on_answer`, `timeout_secs:18` and `retry_on_timeout:false`.
   2. On B's `call.answered`, send `gather_using_speak` to B: "New call for Acme, press 1 to accept."
   3. On `call.gather.ended` with `digits:"1"`, `bridge` A↔B. Otherwise `hangup` B and run the fallback.
   - Whether A must be answered before it can be bridged, and what the caller hears meanwhile, are UNVERIFIED. The safest option is to `answer` A and play a ringback file with `playback_start` and `loop:"infinity"`.

---

## 5. Webhook security and delivery

Docs: [Webhook fundamentals](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks) · [Messaging webhooks (signing details)](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks) · [Messaging migration guide (signature format)](https://developers.telnyx.com/docs/development/migration/messaging-migration-guide) · [Node SDK webhooks](https://developers.telnyx.com/docs/development/sdk/node/webhooks) · [Voice API webhooks (response codes)](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks) · [Support: webhooks](https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks)

### 5.1 Signature verification recipe (voice, messaging and 10DLC all use the same scheme)

| Item | Value |
|---|---|
| Headers | `telnyx-signature-ed25519` (Base64 signature) and `telnyx-timestamp` (Unix seconds, as a string). Node lowercases header names. |
| Signed message | UTF-8 bytes of `` `${telnyx-timestamp}|${rawBody}` ``: the timestamp, a pipe, then the **exact raw request body bytes**. Never re-serialize parsed JSON. |
| Algorithm | Ed25519 (EdDSA). |
| Public key | Mission Control → Keys & Credentials → Public Key, one per account. It is Base64 that decodes to the raw **32-byte** Ed25519 public key; Telnyx's official Go sample base64-decodes it straight into `ed25519.PublicKey`. Store it as `TELNYX_PUBLIC_KEY`. |
| Replay window | The messaging guide says to reject a `telnyx-timestamp` more than **5 minutes** old (300 s) and to keep server clocks synced with NTP. |
| On failure | Return 4xx. 401/403 are not retried for voice (see 5.2). |

Node 22, no dependencies. This recipe was self-tested with a generated key pair: valid signatures pass; a tampered body, a re-serialized body and a stale timestamp all fail.

```ts
import { createPublicKey, verify, type KeyObject } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // DER header for a raw 32-byte key

export function telnyxPublicKey(base64Key: string): KeyObject {
  const raw = Buffer.from(base64Key, "base64");
  if (raw.length !== 32) throw new Error("TELNYX_PUBLIC_KEY must decode to 32 bytes");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export function verifyTelnyxWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  key: KeyObject,
  toleranceSec = 300,
): boolean {
  const sig = headers["telnyx-signature-ed25519"];
  const ts = headers["telnyx-timestamp"];
  if (typeof sig !== "string" || typeof ts !== "string" || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  try {
    return verify(null, Buffer.concat([Buffer.from(`${ts}|`, "utf8"), rawBody]), key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
```

Fastify must keep the raw bytes. Override the JSON parser inside an encapsulated plugin that holds only the webhook routes:

```ts
app.register(async (hooks) => {
  // If Fastify reports FST_ERR_CTP_ALREADY_PRESENT, call hooks.removeContentTypeParser("application/json") first.
  hooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as any).rawBody = body;
    try { done(null, JSON.parse((body as Buffer).toString("utf8"))); } catch (e) { done(e as Error, undefined); }
  });
  hooks.post("/webhooks/telnyx/voice", async (req, reply) => {
    if (!verifyTelnyxWebhook((req as any).rawBody, req.headers, TELNYX_KEY)) return reply.code(403).send();
    // persist + dedupe on body.data.id, enqueue, then ack immediately
    return reply.code(200).send();
  });
});
```

Notes:

- Telnyx's own Node sample on the messaging page passes `JSON.stringify(req.body)`. Do not copy that: verification needs the original bytes.
- The OpenAPI says these headers are "compatible with Standard Webhooks for SDK generation". The signed string, however, is `timestamp|body`, so do not plug in a generic Standard Webhooks verifier.
- The official SDKs (`client.webhooks.unwrap(rawBody, {headers})`) also verify against `TELNYX_PUBLIC_KEY`. The `unsafeUnwrap` variant does not verify.

### 5.2 Delivery, retries and failover (product-specific)

| Product | Where the URL is set | Success / timeout | Retries and failover |
|---|---|---|---|
| **Call Control** | App `webhook_event_url` and `webhook_event_failover_url`; per-command `webhook_url` / `webhook_urls` | 2xx = success. 3xx redirects are followed (up to 3). **408, 429 and 5xx are retried; other 4xx are not.** `webhook_timeout_secs` is configurable (0–30). | The failover URL is used after **two consecutive failed attempts** to the primary. Without a custom retry delay (a portal setting), the retry is immediate. Dial, answer and transfer accept per-event `webhook_retries_policies` (≤ 5 retries, ≤ 60 s total). The default timeout and full retry schedule are **UNVERIFIED**. |
| **Messaging** | Per-message `webhook_url` / `webhook_failover_url`, otherwise the messaging profile's URLs, otherwise no webhook | Any 2xx within **2 s**. 3xx counts as failure. | Up to **3 attempts per URL** with exponential backoff, then the failover URL with the same pattern: up to 6 attempts total. |
| **10DLC** | Brand and campaign `webhookURL` / `webhookFailoverURL`. Phone-number events use the campaign's URLs. | Non-2xx or timeout means a retry. | **5 attempts, 30 s apart**, then marked failed. |

On all products: deduplicate on `data.id`, never rely on ordering, and acknowledge before slow work. Failed voice deliveries can be listed with `GET /v2/webhook_deliveries?filter[status][eq]=failed&filter[event_type]=call.initiated`.

---

## 6. Phone numbers

Docs: [Number search guide](https://developers.telnyx.com/docs/numbers/phone-numbers/number-search) · [List available numbers](https://developers.telnyx.com/api-reference/phone-number-search/list-available-phone-numbers) · [Number orders guide](https://developers.telnyx.com/docs/numbers/phone-numbers/number-orders) · [Create number order](https://developers.telnyx.com/api-reference/phone-number-orders/create-a-number-order) · [Update phone number](https://developers.telnyx.com/api-reference/phone-number-configurations/update-a-phone-number) · [Update number messaging settings](https://developers.telnyx.com/api-reference/number-settings/update-the-messaging-profile-andor-messaging-product-of-a-phone-number)

### 6.1 Search: `GET /v2/available_phone_numbers` (free, read-only)

Filters use deepObject query parameters.

| Filter | Notes |
|---|---|
| `filter[country_code]=US` | **Always required.** |
| `filter[phone_number_type]` | `local`, `toll_free`, `mobile`, `national` or `shared_cost` |
| `filter[national_destination_code]` | Area code, e.g. `512` |
| `filter[locality]` | City |
| `filter[administrative_area]` | US state or CA province, e.g. `TX` |
| `filter[rate_center]` | |
| `filter[features][]` | Repeatable: `sms`, `mms`, `voice`, `fax`, `emergency`, `hd_voice`, `international_sms`, `local_calling` |
| `filter[phone_number][starts_with]`, `[ends_with]`, `[contains]` | Pattern match. Named this way in the spec; the search guide calls them `filter[starts_with]` etc. and also lists `filter[consecutive]`. |
| `filter[limit]`, `filter[best_effort]`, `filter[reservable]`, `filter[exclude_held_numbers]`, `filter[quickship]` | `quickship` applies to toll-free only. |

```
GET /v2/available_phone_numbers?filter[country_code]=US&filter[phone_number_type]=local&filter[national_destination_code]=512&filter[features][]=voice&filter[features][]=sms&filter[limit]=5
```

Each item in `data[]` has: `phone_number`, `record_type:"available_phone_number"`, `best_effort`, `quickship`, `reservable`, `region_information[]`, `cost_information {upfront_cost, monthly_cost, currency}`, `features[] {name}`.

### 6.2 Order: `POST /v2/number_orders`

```json
{
  "phone_numbers": [{ "phone_number": "+15125550100" }],
  "connection_id": "1494404757140276705",
  "messaging_profile_id": "<tenant messaging profile id>",
  "customer_reference": "tenant_t_123"
}
```

- The response `data` holds `id`, `status`, `phone_numbers[] {id, phone_number, status, requirements_met, ...}`, `connection_id`, `messaging_profile_id` and `sub_number_orders_ids`.
- Order `status`: `pending`, `success` or `failure`.
- Poll `GET /v2/number_orders/{id}`, or subscribe to the `number_order.complete` webhook (set up through portal notification settings).
- US local numbers normally need no regulatory documents. Non-US numbers may need `bundle_id` or `requirement_group_id`.

### 6.3 Attach a number to the Call Control App and a Messaging Profile

- **At order time:** set `connection_id` (the Call Control App ID) and `messaging_profile_id` as in 6.2.
- **Later, voice:** `PATCH /v2/phone_numbers/{id}` with `{"connection_id":"<app id>"}`.
- **Later, messaging:** `PATCH /v2/phone_numbers/{id}/messaging` with `{"messaging_profile_id":"<uuid>"}`. `""` unassigns; omitting or `null` keeps the current value.
- `{id}` is the phone-number resource ID (e.g. `"1293384261075731499"`). Find it with `GET /v2/phone_numbers?filter[phone_number]=15125550100`; this filter takes **digits only**, and non-digits return nothing. Whether `{id}` also accepts the E.164 string is UNVERIFIED.
- `GET /v2/phone_numbers/{id}` shows `connection_id`, `messaging_profile_id`, `messaging_campaign_id` and `status` (`active`, `purchase-pending`, ...).

---

## 7. Messaging (SMS)

Docs: [Send a message](https://developers.telnyx.com/api-reference/messages/send-a-message) · [Messaging webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks) · [Inbound message schema](https://developers.telnyx.com/api-reference/callbacks/inbound-message) · [Delivery update schema](https://developers.telnyx.com/api-reference/callbacks/delivery-update) · [Create messaging profile](https://developers.telnyx.com/api-reference/profiles/create-a-messaging-profile) · [Opt-in/out](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out)

### 7.1 Messaging profile: `POST /v2/messaging_profiles`

- **Required:** `name`, `whitelisted_destinations` (e.g. `["US"]`).
- **Optional:** `webhook_url`, `webhook_failover_url`, `webhook_api_version` (`"2"` default), `enabled`, `number_pool_settings`, `url_shortener_settings`, `daily_spend_limit` / `daily_spend_limit_enabled`, `mobile_only`, `smart_encoding`, `mms_fall_back_to_sms`.
- **Multi-tenant note:** STOP block rules apply at the **messaging profile** level. An opt-out from one number blocks every number on that profile, so use one profile per tenant.

### 7.2 Send: `POST /v2/messages`

```json
{
  "from": "+15125550100",
  "to": "+15125550111",
  "text": "Acme Plumbing: thanks for calling! Book here: https://lnk.leadanchor.app/abc123 Reply STOP to opt out.",
  "messaging_profile_id": "<uuid>",
  "webhook_url": "https://api.leadanchor.app/webhooks/telnyx/messaging",
  "webhook_failover_url": "https://failover.leadanchor.app/webhooks/telnyx/messaging"
}
```

- **Required:** `to`.
- `from` is required when sending from a number, short code or alphanumeric sender.
- `text` is required for SMS.
- `messaging_profile_id` is required only for number-pool or alphanumeric sending.
- Other fields: `media_urls[]` (MMS, < 1 MB total), `subject`, `type` (`SMS`/`MMS`), `use_profile_webhooks` (default true; per-message URLs are tried first), `auto_detect`, `encoding` (`auto`/`gsm7`/`ucs2`), `send_at`.
- The response `data` is the message: `id`, `to[0].status:"queued"`, `parts`, `encoding`, `cost`, `tcr_campaign_id`, `errors[]`.
- A blocked recipient (opted out) returns error `40300` (Blocked due to STOP message).

### 7.3 Inbound: `message.received`

Key payload fields:

- `id`, `direction:"inbound"`, `type` (`SMS`/`MMS`), `text`
- `from {phone_number, carrier, line_type}`
- `to[] {phone_number, carrier, line_type, status:"webhook_delivered"}`
- `media[] {url, content_type, sha256, size}`. Media links expire after 30 days.
- `messaging_profile_id`, `received_at`, `encoding`, `parts`, `cost`, `errors[]`
- `autoresponse_type`, e.g. `STOP`, `HELP` or `START`, when a keyword triggered an auto-response

Telnyx handles keywords automatically:

| Keywords | Effect |
|---|---|
| `STOP`, `STOPALL`, `STOP ALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` | Create a block rule. |
| `START`, `UNSTOP` | Remove the block. |

You can customise auto-responses with `/v2/messaging_profiles/{profile_id}/autoresp_configs`.

### 7.4 Delivery status: `message.sent` → `message.finalized`

- `message.sent`: accepted and sent to the carrier. `sent_at` is set and `to[].status` is `sent`.
- `message.finalized`: terminal state. `completed_at` is set, and the payload adds `cost_breakdown`, `tcr_campaign_id`, `tcr_campaign_registered` and `tcr_campaign_billable`.
- The spec also lists `message.read`, for RCS and WhatsApp.

`to[].status` values:

| Status | Meaning |
|---|---|
| `queued` | Queued at Telnyx |
| `sending` | Being sent to the carrier |
| `sent` | Sent to the carrier |
| `delivered` | Carrier confirmed delivery |
| `sending_failed` | Telnyx could not send to the carrier |
| `delivery_failed` | Carrier could not deliver |
| `delivery_unconfirmed` | No confirmation received |
| `expired` | In the spec only |
| `read` | In the spec only (RCS/WhatsApp) |

`errors[]` items are `{code, title, detail, source.pointer}`. Common codes from the guide: `40001` invalid destination, `40002` not in service, `40300` unreachable or STOP-blocked, `40008` filtered by carrier, `40010` blocked as spam, `47000` 10DLC campaign required.

---

## 8. 10DLC registration via API

Docs: [Brand registration](https://developers.telnyx.com/docs/messaging/10dlc/brand-registration) · [Create brand](https://developers.telnyx.com/api-reference/brands/create-brand) · [Sole proprietor guide](https://developers.telnyx.com/docs/messaging/10dlc/sole-proprietor) · [Trigger OTP](https://developers.telnyx.com/api-reference/brands/trigger-brand-sms-otp) · [Verify OTP](https://developers.telnyx.com/api-reference/brands/verify-brand-sms-otp) · [Campaign registration](https://developers.telnyx.com/docs/messaging/10dlc/campaign-registration) · [Submit campaign](https://developers.telnyx.com/api-reference/campaign/submit-campaign) · [Qualify by use case](https://developers.telnyx.com/api-reference/campaign/qualify-by-usecase) · [Use-case samples](https://developers.telnyx.com/docs/messaging/10dlc/campaign-use-cases) · [Number assignment](https://developers.telnyx.com/docs/messaging/10dlc/phone-number-assignment) · [Assign number to campaign](https://developers.telnyx.com/api-reference/phone-number-campaigns/create-new-phone-number-campaign) · [Event notifications](https://developers.telnyx.com/docs/messaging/10dlc/event-notifications) · [Rate limits](https://developers.telnyx.com/docs/messaging/10dlc/10dlc-rate-limits) · [ISV/reseller onboarding](https://developers.telnyx.com/docs/messaging/10dlc/isv-reseller-onboarding) · [Get enum](https://developers.telnyx.com/api-reference/enum/get-enum)

**Flow:** brand → (SOLE_PROPRIETOR only: OTP verification) → optional vetting → campaign → wait for carrier provisioning → put the number on a messaging profile → assign the number to the campaign → send.

All paths below are under `https://api.telnyx.com/v2`. The 10DLC API uses **camelCase** JSON.

### 8.1 Create brand: `POST /v2/10dlc/brand`

The spec requires `entityType`, `displayName`, `country`, `email` and `vertical`. Each brand creation costs a non-refundable $4.

| Entity type | Fields |
|---|---|
| Standard: `PRIVATE_PROFIT`, `PUBLIC_PROFIT`, `NON_PROFIT`, `GOVERNMENT` | Add `companyName` (legal name), `ein` (9 digits), `phone`, `street`, `city`, `state` (2 letters), `postalCode` (5-digit ZIP), `website`. `PUBLIC_PROFIT` also needs `stockSymbol`, `stockExchange` and `businessContactEmail`. |
| `SOLE_PROPRIETOR` (no EIN) | `firstName`, `lastName`, `displayName`, `email`, `phone`, **`mobilePhone`** (a US/CA mobile; the OTP goes there), `street`, `city`, `state`, `postalCode`, `country:"US"`, `vertical`. Omit `ein` and `companyName`. |

- `vertical` values: `AGRICULTURE`, `COMMUNICATION`, `CONSTRUCTION`, `EDUCATION`, `ENERGY`, `ENTERTAINMENT`, `FINANCIAL`, `GAMBLING`, `GOVERNMENT`, `HEALTHCARE`, `HOSPITALITY`, `HUMAN_RESOURCES`, `INSURANCE`, `LEGAL`, `MANUFACTURING`, `NGO`, `POLITICAL`, `POSTAL`, `PROFESSIONAL`, `REAL_ESTATE`, `RETAIL`, `TECHNOLOGY`, `TRANSPORTATION`. Trades usually map to `CONSTRUCTION` or `PROFESSIONAL`.
- Optional: `webhookURL`, `webhookFailoverURL`, `isReseller`, `mock` (test brand), `ipAddress`, `altBusinessId` / `altBusinessIdType`.
- Response fields:
  - `brandId` (Telnyx UUID) and `tcrBrandId` (e.g. `BXXXXXX`)
  - `status`: `OK`, `REGISTRATION_PENDING` or `REGISTRATION_FAILED`
  - `identityStatus`: `VERIFIED`, `UNVERIFIED`, `SELF_DECLARED` or `VETTED_VERIFIED`. The SP guide also shows `PENDING`, which is not in the enum.
  - `failureReasons`
- Optional vetting for higher throughput: `POST /v2/10dlc/brand/{brandId}/externalVetting` with `{"evpId":"AEGIS","vettingClass":"STANDARD"}`. It takes 1–7 business days; list results with `GET .../externalVetting`.

### 8.2 Sole-proprietor OTP

1. **Trigger:** `POST /v2/10dlc/brand/{brandId}/smsOtp` with `{"pinSms":"Acme: your verification code is @OTP_PIN@","successSms":"Acme: brand verified."}`.
   - Both fields are required, ≤ 500 chars each, and `pinSms` must contain `@OTP_PIN@`.
   - Returns `{brandId, referenceId}`. Calling it again sends a new PIN.
2. **Status:** `GET /v2/10dlc/brand/{brandId}/smsOtp` or `GET /v2/10dlc/brand/smsOtp/{referenceId}`.
   - Returns `deliveryStatus` (`PENDING`, `DELIVERED_HANDSET`, `DELIVERY_FAILED`, `VERIFIED` or `EXPIRED`), `requestDate`, `verifyDate`, `deliveryStatusDetails`.
3. **Verify:** `PUT /v2/10dlc/brand/{brandId}/smsOtp` with `{"otpPin":"123456"}` (6 digits).
   - The PIN expires after **24 h**.
   - On success, `identityStatus` becomes `VERIFIED`, the `successSms` is sent, and the brand fee is charged.
   - Campaigns cannot be created before this step.

SP limits:

| Limit | Value |
|---|---|
| Campaigns per brand | 1 (use case `SOLE_PROPRIETOR`) |
| Numbers per campaign | 1 |
| SP brands per mobile number | Max 3 |
| AT&T throughput | 15 SMS/min |
| T-Mobile throughput | 1,000 SMS/day |

### 8.3 Campaign: `POST /v2/10dlc/campaignBuilder`

1. **Check eligibility first:** `GET /v2/10dlc/campaignBuilder/brand/{brandId}/usecase/{usecase}` returns fees and `minSubUsecases` / `maxSubUsecases`.
2. **Valid values:** `GET /v2/10dlc/enum/usecase` (other enums: `vertical`, `entityType`, `campaignStatus`, ...).

The spec requires `brandId`, `description` and `usecase`. The guide's required set adds:

- `sample1`, `sample2`
- `messageFlow` (how **end users** opt in)
- `helpMessage`
- `optinKeywords`, `optoutKeywords`, `helpKeywords` (comma-separated)

Other fields:

- `sample3`–`sample5`, `subUsecases[]` (for `MIXED` / `LOW_VOLUME`)
- `subscriberOptin`, `subscriberOptout`, `subscriberHelp`
- `embeddedLink`, `embeddedLinkSample`, `embeddedPhone`
- `numberPool`, `ageGated`, `directLending`
- `optinMessage`, `optoutMessage`
- `privacyPolicyLink`, `termsAndConditions`, `termsAndConditionsLink`
- `autoRenewal`, `referenceId` (prevents duplicates), `resellerId`, `mnoIds[]`, `tag[]`
- `webhookURL`, `webhookFailoverURL`

**Use cases.** Standard: `CUSTOMER_CARE`, `DELIVERY_NOTIFICATION`, `ACCOUNT_NOTIFICATION`, `MARKETING`, `2FA`, `SECURITY_ALERT`, `POLLING_VOTING`, `CHARITY`, `POLITICAL`, `MIXED`. Special: `LOW_VOLUME`, `SOLE_PROPRIETOR`, `EMERGENCY`, `AGENTS_FRANCHISES`, `SWEEPSTAKES`.

| Use case | Notes |
|---|---|
| `LOW_VOLUME` | Under 6,000 msgs/month, AT&T class T at 75 SMS/min. It cannot be upgraded; a new campaign is needed. |
| `MIXED` | The guide's "safest" choice. Needs sub-use-cases (2–5 per TCR: UNVERIFIED; read `min/maxSubUsecases`). |
| `CUSTOMER_CARE` | For reactive service messages. |

- The use case cannot be changed after creation.
- Creation charges a non-refundable upfront fee covering 3 months; see `GET /v2/10dlc/campaign/usecase/cost`.
- After creation, only the sample messages can be edited.
- Typical approval: TCR review, then T-Mobile (instant to 24 h), AT&T (1–3 days) and Verizon (1–3 days).

Verbal opt-in on a call is LeadAnchor's consent path, so describe it explicitly in `messageFlow`. Whether carriers accept this wording is UNVERIFIED. Example:

> "Callers who reach Acme's line after a missed call are asked by an automated assistant whether they agree to receive one text with a booking link; only callers who say yes are texted. Consent and the call transcript are stored. Reply STOP to opt out, HELP for help."

Response fields: `campaignId` (Telnyx UUID), `tcrCampaignId`, `campaignStatus` (`TCR_PENDING`, `TCR_ACCEPTED`, `TCR_FAILED`, `TCR_SUSPENDED`, `TCR_EXPIRED`, `TELNYX_ACCEPTED`, `TELNYX_FAILED`, `MNO_PENDING`, `MNO_ACCEPTED`, `MNO_REJECTED`, `MNO_PROVISIONED`, `MNO_PROVISIONING_FAILED`), `submissionStatus` (`CREATED`, `PENDING`, `FAILED`), `status` (`ACTIVE`, `EXPIRED`), `failureReasons`, `isTMobileRegistered`.

**Success path:** `TCR_PENDING` → `TCR_ACCEPTED` → `MNO_PENDING` → `MNO_PROVISIONED`. Appeal `TELNYX_FAILED` or `MNO_REJECTED` with `POST /v2/10dlc/campaign/{campaignId}/appeal`.

### 8.4 Assign the number

**Prerequisites:** the number is already on a messaging profile, the campaign is active and provisioned, and the number is not on another campaign (one campaign per number).

- **Single number:** `POST /v2/10dlc/phone_number_campaigns` with `{"phoneNumber":"+15125550100","campaignId":"<campaignId>"}`. The response has `assignmentStatus`: `PENDING_ASSIGNMENT`, `ASSIGNED`, `FAILED_ASSIGNMENT`, `PENDING_UNASSIGNMENT` or `FAILED_UNASSIGNMENT`. Poll `GET /v2/10dlc/phone_number_campaigns/{phoneNumber}`; remove with `DELETE` on the same path.
- **Whole messaging profile:** `POST /v2/10dlc/phoneNumberAssignmentByProfile` with `{"messagingProfileId","campaignId"}` (or `tcrCampaignId` for campaigns shared from another CSP). Returns a `taskId`; poll `GET .../phoneNumberAssignmentByProfile/{taskId}` and `GET .../{taskId}/phoneNumbers`.

### 8.5 Status: webhooks and polling

Webhooks go to the brand's or campaign's `webhookURL` in the standard envelope (`data.event_type`, `data.id`, `data.occurred_at`, `data.payload`, `meta`).

| `data.event_type` | `payload.type` values | Other payload fields |
|---|---|---|
| `10dlc.brand.update` | `REGISTRATION` (failures, in `reasons`), `REVET`, `ORDER_EXTERNAL_VETTING`, `TCR_BRAND_UPDATE` | `eventType` (`BRAND_ADD`, ...), `status`, `brandId`, `tcrBrandId` |
| `10dlc.campaign.update` | `REGISTRATION`, `TELNYX_REVIEW` (`ACCEPTED`/`REJECTED`), `MNO_REVIEW` (`ACCEPTED`/`REJECTED`), `TELNYX_EVENT` (`DORMANT` = suspended), `VERIFIED` (= `MNO_PROVISIONED`), `NUMBER_POOL_PROVISIONED` / `NUMBER_POOL_DEPROVISIONED`, `TCR_EVENT` | `eventType` (`CAMPAIGN_ADD`, `CAMPAIGN_EXPIRED`, `MNO_CAMPAIGN_OPERATION_*`, ...), `campaignId` (Telnyx UUID; the TCR ID may appear only in `description`), `description`, `status` |
| `10dlc.phone_number.update` | `ASSIGNMENT`, `DELETION` (`status: success/failed`, `reasons[]`), `STATUS_UPDATE` (`status`: `ADDED`, `DELETED`, `PENDING` or `FAILED`) | `campaignId`, `phoneNumber` |

Polling endpoints:

- `GET /v2/10dlc/brand/{brandId}` (`status`, `identityStatus`, `failureReasons`)
- `GET /v2/10dlc/brand/feedback/{brandId}`
- `GET /v2/10dlc/campaign/{campaignId}` (`campaignStatus`, `status`)
- `GET /v2/10dlc/campaign/{campaignId}/operationStatus`
- `GET /v2/10dlc/campaign/{campaignId}/mnoMetadata`
- `GET /v2/10dlc/phone_number_campaigns/{phoneNumber}`

Telnyx's event naming is inconsistent across pages (see section 10). Key the handler on `data.event_type` starting with `10dlc.`, and poll as a backstop.

### 8.6 ISV / multi-tenant notes (LeadAnchor registers on behalf of businesses)

- Each customer business needs **its own brand**, because a brand is the legal entity. Telnyx recommends **one brand and one campaign per customer**: it isolates throughput and compliance status. T-Mobile daily caps are per brand.
- `messageFlow` and the samples must describe the **end user's** consent and the messages actually sent. Telnyx says ISVs are accountable for customer traffic. Keep opt-in records (the guide suggests 4 years, per CTIA).
- **Partner (shared) campaigns** only apply if campaigns are registered at another CSP and shared to Telnyx. The APIs are:
  - `GET /v2/10dlc/partner_campaigns` (and `/{campaignId}`)
  - `GET /v2/10dlc/partnerCampaign/{campaignId}/sharing` (`PENDING`, `ACCEPTED` or `DECLINED`)
  - `POST /v2/10dlc/campaign/acceptSharing/{campaignId}`
  - Number assignment through `phoneNumberAssignmentByProfile` with `tcrCampaignId`
  - Rejected partner campaigns go through a CSP `CAMPAIGN_NUDGE`, not the appeal API.
- When Telnyx itself is the CSP, use the native endpoints in 8.1–8.4. The brand's `isReseller` and the campaign's `resellerId` fields exist; how they apply to LeadAnchor is UNVERIFIED and worth checking with Telnyx support.
- Use a **level 2 verified** Telnyx account. Without vetting a brand is in the Basic tier: AT&T 240 SMS/min and T-Mobile 2,000 SMS/day. Enhanced vetting raises those limits.

---

## 9. Speech-to-text for voicemail

Docs: [record_start](https://developers.telnyx.com/api-reference/call-commands/recording-start) · [call.recording.transcription.saved](https://developers.telnyx.com/api-reference/callbacks/call-recording-transcription-saved) · [Recording storage (10-minute links)](https://developers.telnyx.com/docs/voice/programmable-voice/storing-call-recordings) · [Retrieve recording](https://developers.telnyx.com/api-reference/call-recordings/retrieve-a-call-recording) · [Retrieve recording transcription](https://developers.telnyx.com/api-reference/call-recordings/retrieve-a-recording-transcription) · [STT REST API](https://developers.telnyx.com/docs/voice/stt/rest-api) · [STT REST parameters](https://developers.telnyx.com/docs/voice/stt/rest-api/parameters) · [Transcribe endpoint](https://developers.telnyx.com/api-reference/audio/transcribe-speech-to-text) · [In-call STT](https://developers.telnyx.com/docs/voice/programmable-voice/speech-to-text)

**Recommended path: `record_start` with `transcription: true`.** One webhook delivers the text and no extra upload is needed.

```json
{
  "format": "mp3", "channels": "single", "play_beep": true,
  "max_length": 120, "timeout_secs": 5, "recording_track": "inbound",
  "transcription": true, "transcription_engine": "B", "transcription_language": "en-US",
  "client_state": "eyJzdGVwIjoidm9pY2VtYWlsIn0=", "command_id": "<uuid>"
}
```

- `transcription_engine`: `A` = Google (default), `B` = Telnyx's in-house engine (the STT guide claims better accuracy and lower latency), or `deepgram/nova-3` (English only).
- **Events, in an order that is not guaranteed:**
  1. `call.recording.saved` with `recording_urls.mp3`, valid for **10 minutes**. Download or forward it right away.
  2. `call.recording.transcription.saved` with `transcription_text` and `recording_id`. Feed this to the LLM.
- **Later lookups:**
  - `GET /v2/recordings/{recording_id}` returns `duration_millis` and fresh `download_urls`.
  - `GET /v2/recordings?filter[call_leg_id]=...` finds a recording without its ID.
  - `GET /v2/recording_transcriptions/{id}` and `GET /v2/recording_transcriptions?filter[recording_id]=...` return `transcription_text` and `status` (`in-progress` or `completed`).
- Latency, minimum and maximum duration of post-recording transcription are UNVERIFIED. Add a timeout and use the fallback below if no transcription event arrives.

**Fallback or alternative model: `POST /v2/ai/audio/transcriptions`** (synchronous, OpenAI-compatible, `multipart/form-data`).

- `model`: `openai/whisper-large-v3-turbo` (default), `openai/whisper-tiny`, `deepgram/nova-3`, `deepgram/nova-2` (and medical variants), `nvidia/parakeet-v3`, `reson8/prerecorded`.
- Audio source: `file` **or** `file_url`. A `file_url` must be public; Telnyx downloads it with a 15 s timeout. Max file size is 100 MB.
- Other fields: `language`, `response_format` (`json` returns `{"text": "..."}`; `verbose_json` adds segments for Deepgram and Reson8 only), `model_config` (Deepgram and Reson8).
- There are no async results or webhooks.
- The 10-minute `recording_urls` link is a public pre-signed URL, so it can be passed as `file_url` while still valid.

```ts
const form = new FormData();
form.set("model", "openai/whisper-large-v3-turbo");
form.set("file_url", recordingUrlMp3);
form.set("language", "en");
const res = await fetch("https://api.telnyx.com/v2/ai/audio/transcriptions", {
  method: "POST", headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }, body: form,
});
const { text } = (await res.json()) as { text: string };
```

**Real-time STT** (`transcription_start` → `call.transcription`) streams interim and final transcripts during a live call. It is not needed for voicemail.

---

## 10. UNVERIFIED items and Telnyx doc conflicts

**Not confirmed by official sources (test in staging):**

1. Whether a transfer with AMD waits for the AMD result before bridging. The caller may hear the owner's voicemail greeting.
2. What the caller hears with `early_media:false`, and while the inbound leg is parked before the first command.
3. Whether the A leg gets `call.answered` / `call.bridged` when a transfer from an unanswered call connects. Also whether `state:"bridging"` marks transfer-created legs.
4. Exact `hangup_cause` / `hangup_source` values when:
   - the caller abandons during the owner ring
   - the owner declines
   - Telnyx cancels B because A hung up (and whether it does so automatically)
5. Whether transfer retries alternate routes after `timeout_secs`. Dial does this by default: `retry_on_timeout:true`.
6. Maximum size of `client_state`.
7. Whether `end_time` is still sent on `call.hangup`, and whether `call_control_id` / `recording_id` appear on `call.recording.saved` in practice. Neither is in the current schema.
8. The Call Control webhook default timeout and full retry schedule. Only these are documented: failover after two consecutive failures; an immediate retry unless a delay is configured; 408, 429 and 5xx retried.
9. Carrier voicemail pickup timing (about 20–30 s).
10. Whether bridging works on an unanswered inbound leg (or auto-answers it), and whether `answer` on a leg already answered through a transfer returns an error.
11. Whether `PATCH /v2/phone_numbers/{id}` accepts an E.164 number as `{id}`.
12. Carrier acceptance of verbal opt-in wording; how `isReseller` / `resellerId` apply; TCR's 2–5 sub-use-case range.
13. Post-recording transcription latency and duration limits.

**Conflicts between Telnyx pages (this file follows the OpenAPI spec):**

| Topic | Conflict | Followed here |
|---|---|---|
| AMD defaults | Spec: `total_analysis_time_millis` default 3500 ms and `prompt_end_timeout_millis` 5000. AMD guide: 30 s for both premium values. | Set both explicitly. |
| 10DLC webhook names | `10dlc.brand.update`, `10dlc.campaign.update`, `10dlc.phone_number.update` (event-notifications guide, with full examples) vs `brand.created` / `brand.updated` / `brand.vetted` / `brand.deleted` (brand guide) vs `campaign.status_update` / `brand.status_update` (ISV guide). The OpenAPI `campaignStatusUpdate` schema is a flat object (`brandId`, `campaignId`, `type`, `status`, ...). | Event-notifications guide; poll as a backstop. |
| Number assignment path | Spec: `/v2/10dlc/phone_number_campaigns`. Number-assignment guide: `/v2/10dlc/phoneNumberCampaign`. | Spec. |
| Campaign creation path | Spec: `POST /v2/10dlc/campaignBuilder`. ISV guide: `POST /v2/10dlc/campaign`, which is GET-only in the spec. | Spec. |
| Vetting path | Spec: `/v2/10dlc/brand/{id}/externalVetting`. ISV guide: `/brand/{id}/vetting`. | Spec. |
| `identityStatus` | SP guide shows `PENDING`, which is not in the spec enum. | Handle unknown values. |
| Brand webhook update example | The event-notifications page curl omits `/v2` (`https://api.telnyx.com/10dlc/brand/:brandid`). | Use `/v2`. |
| Redirects | Voice guide: 3xx followed (up to 3). Messaging support article: 3xx counts as failure. | Treat as product-specific. |
| Low-volume throughput | Use-case guide attributes the 75 msg/min limit to T-Mobile. Rate-limit page: AT&T class T is 75 TPM and T-Mobile uses per-brand daily caps. | Rate-limit page. |
