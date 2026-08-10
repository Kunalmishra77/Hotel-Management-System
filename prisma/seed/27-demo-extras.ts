/**
 * Demo-extras seed — populates the newer surfaces (owner payouts, renewal dates,
 * laundry reconciliation, field-staff tracking) so no page looks empty in a demo.
 * Pure DB (no object storage), idempotent (fixed ids + upserts). Runs on the shared
 * Supabase DB via `npm run db:seed`, so the content appears on the live site.
 */
import type { PrismaClient } from "@prisma/client";
import { resolveStorageAdapter } from "../../src/lib/storage";
import { ORG_ID, PROP_A_ID, USER_ADMIN_ID } from "./fixtures";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DEMO_DRIVER_ID = "staff_demo_driver_wmg";

export async function seedDemoExtras(prisma: PrismaClient): Promise<void> {
  // --- Owner payouts (management-fee model; PROP-A fee = 15%) -----------------
  const payouts = [
    { id: "payout_wmg_2026_05", period: "2026-05-01", rev: 48_000_000n, exp: 19_000_000n, fee: 7_200_000n, net: 21_800_000n, status: "PAID", ref: "UTR-2026-05-8841" },
    { id: "payout_wmg_2026_06", period: "2026-06-01", rev: 52_000_000n, exp: 20_000_000n, fee: 7_800_000n, net: 24_200_000n, status: "PAID", ref: "UTR-2026-06-9127" },
    { id: "payout_wmg_2026_07", period: "2026-07-01", rev: 50_000_000n, exp: 18_000_000n, fee: 7_500_000n, net: 24_500_000n, status: "COMPUTED", ref: null },
  ];
  for (const p of payouts) {
    const data = {
      propertyId: PROP_A_ID,
      periodMonth: d(p.period),
      grossRevenuePaise: p.rev,
      expensePaise: p.exp,
      managementFeeBps: 1500,
      managementFeePaise: p.fee,
      netPayablePaise: p.net,
      status: p.status,
      paidAt: p.status === "PAID" ? d(p.period) : null,
      paymentRef: p.ref,
      recordedById: USER_ADMIN_ID,
    };
    await prisma.ownerPayout.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
  }

  // --- Renewal / compliance dates (some overdue) -----------------------------
  const dates = [
    { id: "impdate_wmg_gst", kind: "GST", label: "GSTR-3B filing", dueDate: "2026-07-20", notes: "Monthly GST return" },
    { id: "impdate_wmg_fire", kind: "LICENCE", label: "Fire NOC renewal", dueDate: "2026-08-05", notes: "Fire department" },
    { id: "impdate_wmg_ins", kind: "INSURANCE", label: "Building insurance renewal", dueDate: "2026-11-30", notes: null },
    { id: "impdate_wmg_amc", kind: "AMC", label: "Lift AMC renewal", dueDate: "2026-12-15", notes: "OTIS contract" },
  ];
  for (const x of dates) {
    const data = { propertyId: PROP_A_ID, kind: x.kind, label: x.label, dueDate: d(x.dueDate), notes: x.notes, deletedAt: null };
    await prisma.propertyImportantDate.upsert({ where: { id: x.id }, create: { id: x.id, ...data }, update: data });
  }

  // --- Laundry batches (one reconciled with the MoM 250/149 example, one open) -
  const batches = [
    {
      id: "laundry_wmg_1", sentOn: "2026-08-08", vendor: "CleanCo Laundry", status: "RECONCILED", reconciledAt: d("2026-08-09"),
      items: [
        { id: "lbi_wmg_1a", itemName: "Bedsheet (double)", sentQty: 250, returnedQty: 149, toleranceQty: 0 },
        { id: "lbi_wmg_1b", itemName: "Bath towel", sentQty: 120, returnedQty: 118, toleranceQty: 2 },
      ],
    },
    {
      id: "laundry_wmg_2", sentOn: "2026-08-10", vendor: "CleanCo Laundry", status: "OPEN", reconciledAt: null,
      items: [
        { id: "lbi_wmg_2a", itemName: "Bedsheet (double)", sentQty: 200, returnedQty: 0, toleranceQty: 0 },
        { id: "lbi_wmg_2b", itemName: "Pillow cover", sentQty: 80, returnedQty: 0, toleranceQty: 0 },
      ],
    },
  ];
  for (const b of batches) {
    await prisma.laundryBatch.upsert({
      where: { id: b.id },
      create: { id: b.id, propertyId: PROP_A_ID, sentOn: d(b.sentOn), vendor: b.vendor, status: b.status, reconciledAt: b.reconciledAt, createdById: USER_ADMIN_ID },
      update: { status: b.status, reconciledAt: b.reconciledAt },
    });
    for (const it of b.items) {
      await prisma.laundryBatchItem.upsert({
        where: { id: it.id },
        create: { id: it.id, batchId: b.id, itemName: it.itemName, sentQty: it.sentQty, returnedQty: it.returnedQty, toleranceQty: it.toleranceQty },
        update: { returnedQty: it.returnedQty },
      });
    }
  }

  // --- Field staff (a tracked driver + recent location pings) -----------------
  await prisma.staff.upsert({
    where: { id: DEMO_DRIVER_ID },
    create: {
      id: DEMO_DRIVER_ID, propertyId: PROP_A_ID, name: "Ramesh Kumar", mobile: "9811100200",
      department: "Drivers", monthlySalaryPaise: 2_200_000, joinedOn: d("2025-06-01"),
      aadhaarMasked: "XXXX XXXX 4417", isActive: true, isFieldStaff: true, trackingToken: "demo-driver-wmg-6f2a91",
    },
    update: { isFieldStaff: true, trackingToken: "demo-driver-wmg-6f2a91", isActive: true },
  });
  const now = Date.now();
  const pings = [
    { id: "ping_demo_1", lat: 12.9758, lng: 77.6096, ago: 22 * 60_000 },
    { id: "ping_demo_2", lat: 12.9719, lng: 77.5937, ago: 9 * 60_000 },
    { id: "ping_demo_3", lat: 12.9698, lng: 77.5808, ago: 3 * 60_000 },
  ];
  for (const p of pings) {
    const data = { staffId: DEMO_DRIVER_ID, propertyId: PROP_A_ID, lat: p.lat, lng: p.lng, accuracyM: 14, capturedAt: new Date(now - p.ago) };
    await prisma.fieldStaffPing.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: { lat: p.lat, lng: p.lng, capturedAt: data.capturedAt } });
  }

  // --- Owner document vault (real, downloadable objects in encrypted storage) --
  // Only when object storage is configured (STORAGE_* env). Without it the seed
  // skips docs rather than creating rows whose download would 404.
  const docs = [
    { id: "doc_wmg_lease", category: "AGREEMENT", title: "Lease agreement — Woodpecker MG Road", body: "WOODPECKER APARTMENTS & SUITES\nLEASE AGREEMENT (sample demo document)\nProperty: Woodpecker MG Road (WMG)\nTerm: 9 years · Lock-in: 3 years\nThis is a sample document seeded for the demo owner vault." },
    { id: "doc_wmg_licence", category: "LICENCE", title: "Trade licence 2026-27", body: "BBMP TRADE LICENCE (sample demo document)\nProperty: Woodpecker MG Road\nValidity: FY 2026-27\nSeeded for the demo owner vault." },
    { id: "doc_wmg_statement", category: "STATEMENT", title: "Owner statement — May 2026", body: "OWNER STATEMENT — MAY 2026 (sample)\nRevenue ₹4,80,000 · Expenses ₹1,90,000 · Fee 15% ₹72,000\nNet payable to owner: ₹2,18,000" },
  ];
  try {
    const storage = resolveStorageAdapter();
    for (const doc of docs) {
      const bytes = Buffer.from(doc.body, "utf8");
      const key = `owner-docs/${ORG_ID}/${PROP_A_ID}/${doc.id}.txt`;
      const stored = await storage.put(key, bytes, { contentType: "text/plain" });
      const data = {
        propertyId: PROP_A_ID, category: doc.category, title: doc.title,
        objectKey: stored.key, checksum: stored.checksum, sizeBytes: bytes.length,
        contentType: "text/plain", uploadedById: USER_ADMIN_ID, uploadedByRole: "STAFF", deletedAt: null,
      };
      await prisma.propertyDocument.upsert({ where: { id: doc.id }, create: { id: doc.id, ...data }, update: data });
    }
  } catch (e) {
    console.log(`    · owner documents skipped (${(e as Error).message.split("\n")[0]})`);
  }
}
