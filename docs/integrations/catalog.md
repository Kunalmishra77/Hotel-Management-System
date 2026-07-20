# Integration Catalog

The single reference for every external integration. Governing rule: [`.claude/rules/integrations.md`](../../.claude/rules/integrations.md) — every provider sits behind an interface; the app runs fully in **sandbox/mock** with zero credentials; going live is a **config change, never a code change**.

## At a glance

| Integration | Interface (`src/lib/…`) | Spec | Buildable + sandbox now | LIVE requires (client action) | Config env |
|---|---|---|---|---|---|
| **Payments** | `lib/payments` `PaymentProvider` | [06](../../specs/06-billing-payments/), [23](../../specs/23-booking-engine/) | ✅ test mode | Business KYC (PAN, GST, bank) w/ Razorpay/Cashfree | `PAYMENTS_MODE/PROVIDER/KEY_*` |
| **WhatsApp** | `lib/messaging` `MessagingProvider` | [12](../../specs/12-communications/) | ✅ sandbox/outbox | Meta-approved WABA via BSP + template (HSM) approval | `WHATSAPP_*`, `MESSAGING_MODE` |
| **SMS** | `lib/messaging` | [12](../../specs/12-communications/) | ✅ sandbox | TRAI **DLT** sender-ID + template registration (MSG91/Twilio) | `SMS_*` |
| **Email** | `lib/messaging` | [12](../../specs/12-communications/) | ✅ sandbox | Domain SPF/DKIM verification (Resend/SES/Postmark) | `EMAIL_*` |
| **OTA / Channel** | `lib/integrations/channel` `ChannelManager` | [13](../../specs/13-booking-channel-integrations/) | ✅ mock adapter | **Certified connectivity partnership** per OTA, or a channel-manager aggregator account | `CHANNEL_MANAGER_*`, `CHANNEL_MODE` |
| **Accounting** | `lib/integrations/accounting` `AccountingProvider` | [22](../../specs/22-accounting-sync/) | ✅ mock | Tally connector / Zoho OAuth app | `ACCOUNTING_PROVIDER`, `ZOHO_*` |
| **AI / LLM** | `lib/ai` `LLMProvider` | [18](../../specs/18-ai-features/) | ✅ mock (deterministic) | An API key (Anthropic/OpenAI) or a local model | `AI_PROVIDER`, `*_API_KEY` |
| **Object storage** | `lib/integrations` (S3-compatible) | [00](../../specs/00-platform/), [04](../../specs/04-guest-crm/) | ✅ MinIO/local | S3 bucket in India region (`ap-south-1`) | `STORAGE_*` |

## Provider contracts (interfaces every adapter implements)
- **`PaymentProvider`**: `createOrder`, `capture`, `refund`, `verifyWebhook`, `getStatus`. Idempotent; webhooks signature-verified + inbox-deduped.
- **`MessagingProvider`** (per channel): `sendTemplate`, `sendSession`, `verifyWebhook`, `deliveryStatus`. LIVE requires an approved template id (WhatsApp HSM / DLT).
- **`ChannelManager`**: `pushAvailability`, `pushRates`, `pullReservations`, `ack`, `mapRoomType`. Inbound deduped on `(provider, externalId)`; one availability truth (03).
- **`AccountingProvider`**: `pushInvoice`, `pushExpense`, `pushPayment`, `reconcile`. Idempotent on `(provider, entityType, entityId)`.
- **`LLMProvider`**: `complete` (structured output zod-validated), `embed`. LLM never mutates data; NL→structured query only.

## Reliability model (all integrations)
- **Outbox** for outbound (tied to domain events) → retry with backoff via `pg-boss` → dead-letter + admin alert. Front desk is never blocked by an integration failure.
- **Inbox** (`IntegrationInbox`, owned by [00](../../specs/00-platform/)) for inbound (payment/OTA/messaging webhooks) → signature-verify → dedupe on provider id → process exactly once.
- **Sandbox parity**: every adapter has a mock; `*_MODE`/`*_PROVIDER=mock` runs the full flow with no external account (dev/CI/demo).

## Honest live-activation blockers (code cannot bypass)
1. **OTA 2-way sync** needs certified connectivity with each OTA (Booking.com Connectivity Partner Programme, Agoda YCS, Expedia/EPS, MMT/Goibibo, Airbnb API), or an aggregator (SiteMinder/STAAH/eZee/Djubo/RateGain) — a weeks-to-months business process. → [ADR-0003](../architecture/adr/0003-provider-abstraction.md), [13](../../specs/13-booking-channel-integrations/).
2. **WhatsApp** needs a Meta-approved WhatsApp Business Account via a BSP + per-template approval; per-conversation cost.
3. **SMS (India)** needs TRAI **DLT** registration of sender-ID and each template.
4. **Payments** need business KYC before live keys are issued (test mode works immediately).
5. **Accounting** needs the client's Tally/Zoho account + OAuth app.

These are tracked as open questions in [schema-deltas.md](../architecture/schema-deltas.md). The connector code + sandbox verification are all in scope now; only activation waits on the client.
