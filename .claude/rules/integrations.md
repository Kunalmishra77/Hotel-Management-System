# Integrations

## Golden rule
Every external provider sits behind an **interface** in `src/lib/{payments,messaging,ai,integrations}`. Application/domain code depends on the interface, never the SDK. Swapping providers = new adapter, zero call-site changes.

## Sandbox ↔ live gating
- Each integration has a mode env (`*_MODE = sandbox|test|live`, `AI_PROVIDER=mock|…`).
- **With no live credentials, the adapter runs in sandbox/mock and the whole app still works end-to-end** (messages logged to an outbox, payments simulated, AI returns deterministic stubs). This is mandatory — dev/test/CI need zero external accounts.
- Going live is a **config change**, never a code change.

## What can be built now vs. what the client must unblock
| Integration | Buildable + sandbox-verifiable now | Client action required before LIVE |
|---|---|---|
| Payments (Razorpay/Cashfree) | ✅ full test mode | Business KYC (PAN, GST, bank) |
| WhatsApp (Meta/Gupshup/Twilio) | ✅ sandbox | Meta-approved WABA via BSP + template approval |
| SMS (MSG91/Twilio) | ✅ | TRAI **DLT** sender-ID + template registration |
| Email (Resend/SES) | ✅ | Domain verification (SPF/DKIM) |
| OTA / channel (Booking/Agoda/MMT/Goibibo/Airbnb) | ✅ connector layer + mapping | **Certified connectivity partnership** per OTA, or a channel-manager aggregator account |
| Accounting (Tally/Zoho) | ✅ export + API adapter | Zoho OAuth app / Tally connector on client machine |

Be honest in specs about the live blocker; never imply we can bypass OTA certification or DLT with code.

## Contracts (all providers implement these shapes)
- `PaymentProvider`: createOrder, capture, refund, verifyWebhook, getStatus.
- `MessagingProvider` (per channel): sendTemplate, sendSession, verifyWebhook, deliveryStatus.
- `ChannelManager`: pushAvailability, pushRates, pullReservations, ack, mapRoomType.
- `AccountingProvider`: pushInvoice, pushExpense, pushPayment, reconcile.
- All calls are **idempotent** (idempotency key), **retried with backoff** via pg-boss, and **signature-verified** on inbound webhooks.

## Reliability
- Inbound events (OTA reservation, payment webhook) are written to an inbox and processed once (dedupe on provider id).
- Outbound sends use the outbox pattern tied to domain events; failures retry, then dead-letter with admin alert.
