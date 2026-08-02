/**
 * 23 T-20 — public booking journey on a mobile viewport (AC-1/4/6/17).
 * search → select → guest details + consent → hold + sandbox deposit order →
 * signed payment webhook → CONFIRMED WEBSITE reservation + advance in 06 +
 * WebBookingConfirmed emitted (12 consumes it). Self-contained fixtures so the
 * spec does not depend on the seed-runner hook.
 */
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

const ORG_ID = "org_woodpecker";
// Payment/FolioLine are append-only, so this property can never be torn down.
// Make every fixture per-run-unique — a fresh property + room each run, so the
// booked window is always free and nothing collides with un-deletable leftovers.
const RUN = Date.now().toString(36);
const PROP = `be_e2e_prop_${RUN}`;
const CAT = `be_e2e_cat_${RUN}`;
const ROOM = `be_e2e_room_${RUN}`;
const SLUG = `be-e2e-site-${RUN}`;

function future(offsetDays: number): string {
  const dt = new Date(Date.now() + offsetDays * 86_400_000);
  return dt.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.property.upsert({
      where: { id: PROP },
      create: { id: PROP, orgId: ORG_ID, name: "BE E2E Property", code: `BEE${RUN}`.slice(0, 10), addressLine1: "1 Rd", city: "Bengaluru", state: "Karnataka", pincode: "560001", isActive: true },
      update: { isActive: true },
    });
    await prisma.roomCategory.upsert({
      where: { id: CAT },
      create: { id: CAT, propertyId: PROP, name: "E2E Deluxe", baseRatePaise: 400_000, gstBps: 1200, maxAdults: 2, maxChildren: 1 },
      update: {},
    });
    await prisma.room.upsert({
      where: { id: ROOM },
      create: { id: ROOM, propertyId: PROP, categoryId: CAT, number: "E2E1", status: "VACANT", isActive: true },
      update: { status: "VACANT", isActive: true },
    });
    await prisma.bookingEngineConfig.upsert({
      where: { propertyId: PROP },
      create: { propertyId: PROP, slug: SLUG, onlineSellableCategoryIds: [CAT], depositPolicy: "PCT", depositValue: 2000, checkoutTtlMin: 15, minLos: 1, cancelWindowHours: 48, gatewayProvider: "sandbox", isPublished: true },
      update: { isPublished: true, onlineSellableCategoryIds: [CAT] },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    // Only orders are deletable — Payment/FolioLine are append-only and the rest
    // is FK-restricted by them. The per-run-unique property + its rows persist by
    // design (never collide with the next run's fresh fixtures).
    await prisma.bookingEngineOrder.deleteMany({ where: { propertyId: PROP } });
  } finally {
    await prisma.$disconnect();
  }
});

test("search → book → pay (webhook) → CONFIRMED WEBSITE reservation + advance", async ({ page, request }) => {
  await page.goto(`/book/${SLUG}`);

  await page.getByLabel("Check-in").fill(future(30));
  await page.getByLabel("Check-out").fill(future(33));
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("E2E Deluxe")).toBeVisible();
  await page.getByRole("button", { name: "Book" }).first().click();

  await page.getByLabel("Name").fill("E2E Guest");
  await page.getByLabel("Mobile").fill("9700000123");
  await page.getByLabel(/accept the terms/i).check();
  await page.getByRole("button", { name: /^Pay/ }).click();

  await expect(page.getByText("Booking created")).toBeVisible();

  // The gateway would call the webhook; simulate the signed success delivery.
  const prisma = new PrismaClient();
  try {
    const order = await prisma.bookingEngineOrder.findFirstOrThrow({ where: { propertyId: PROP, status: "CREATED" }, orderBy: { createdAt: "desc" } });
    const rawBody = JSON.stringify({ event: "payment.captured", orderId: order.gatewayOrderId, paymentId: `e2e_pay_${Date.now()}`, amountPaise: order.amountPaise });
    const secret = process.env.PAYMENTS_WEBHOOK_SECRET || "sandbox-webhook-secret";
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    const res = await request.post("/api/webhooks/booking-payments", { data: rawBody, headers: { "content-type": "application/json", "x-webhook-signature": signature } });
    expect(res.status()).toBe(200);

    const reservation = await prisma.reservation.findFirstOrThrow({ where: { id: order.reservationId! } });
    expect(reservation.status).toBe("CONFIRMED");
    expect(reservation.source).toBe("WEBSITE");
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: reservation.id } });
    const payment = await prisma.payment.findFirstOrThrow({ where: { folioId: folio.id } });
    expect(Number(payment.amountPaise)).toBe(order.amountPaise);
    const confirmed = await prisma.domainEvent.count({ where: { type: "WebBookingConfirmed", aggregateId: reservation.id } });
    expect(confirmed).toBe(1);
  } finally {
    await prisma.$disconnect();
  }
});
