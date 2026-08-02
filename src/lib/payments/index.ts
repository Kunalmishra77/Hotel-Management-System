/**
 * Payment provider abstraction — 06 T-14 (FR-11, integrations.md).
 *
 * Application code depends on `PaymentProvider`, never a gateway SDK. With no
 * live credentials the SANDBOX provider runs and the whole flow works end-to-end
 * (integrations.md: zero external accounts for dev/test/CI). Going live is a
 * config change — a new adapter, zero call-site changes.
 */
export type CreateOrderInput = { amountPaise: number; receipt: string; notes?: Record<string, string> };
export type ProviderOrder = { orderId: string; amountPaise: number };
export type RefundInput = { orderId: string; amountPaise: number };
export type ProviderRefund = { refundId: string; amountPaise: number };

export type PaymentProvider = {
  name: string;
  mode: "sandbox" | "live";
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  /**
   * Refund a captured order (23 FR-8 auto-refund when a paid web booking loses
   * its held room and cannot be reallocated). Idempotent on the gateway side.
   */
  refund(input: RefundInput): Promise<ProviderRefund>;
  /** The shared secret webhooks are signed with (HMAC-SHA256). */
  webhookSecret(): string;
};

/** Deterministic sandbox order id from the receipt (no real network). */
function sandboxOrderId(receipt: string): string {
  return `order_sandbox_${Buffer.from(receipt).toString("base64url").slice(0, 24)}`;
}

const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  mode: "sandbox",
  async createOrder(input) {
    return { orderId: sandboxOrderId(`${input.receipt}:${input.amountPaise}`), amountPaise: input.amountPaise };
  },
  async refund(input) {
    // Deterministic sandbox refund id; no real network (integrations.md).
    return { refundId: `rfnd_sandbox_${Buffer.from(input.orderId).toString("base64url").slice(0, 20)}`, amountPaise: input.amountPaise };
  },
  webhookSecret() {
    // `||` (not `??`): an empty env value must still fall back to the sandbox
    // secret, or signature verification would reject every webhook.
    return process.env.PAYMENTS_WEBHOOK_SECRET || "sandbox-webhook-secret";
  },
};

/**
 * The active provider. `PAYMENTS_MODE=live` with credentials would select a real
 * adapter; absent that, the sandbox runs (integrations.md sandbox↔live gating).
 */
export function resolvePaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  // Only the sandbox is implemented today; a live Razorpay/Cashfree adapter slots
  // in here behind the same interface when the client completes KYC.
  void env;
  return sandboxProvider;
}
