/**
 * Event-consumer composition root (Phase 3). One place that wires every domain
 * consumer to the outbox dispatcher, imported by BOTH the standalone worker
 * (`scripts/worker.ts`) and the in-process dispatcher (`instrumentation.ts`) so
 * the list can never drift between them. Each register fn is individually
 * idempotent, so calling this more than once is safe.
 */
import { registerGuestHistoryConsumer } from "@/features/guest-history/consumer";
import { registerHousekeepingConsumer } from "@/features/housekeeping/consumer";
import { registerCommunicationsConsumer } from "@/features/communications/events/consumer";
import { registerAiSentimentConsumer } from "@/features/ai/consumer";
import { registerChannelsConsumer } from "@/features/channels/consumer";
import { registerInventoryConsumer } from "@/features/inventory/consumer";
import { registerAccountingConsumer } from "@/features/accounting/consumer";
import { registerNotificationsConsumer } from "@/features/notifications/consumer";

export function registerAllConsumers(): void {
  registerGuestHistoryConsumer();
  registerHousekeepingConsumer();
  registerCommunicationsConsumer();
  registerAiSentimentConsumer();
  registerChannelsConsumer();
  registerInventoryConsumer();
  registerAccountingConsumer();
  registerNotificationsConsumer();
}
