/** READ-ONLY backup of the billing/booking state before the paper-bill conformance. */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const out = process.argv[2];
const data = {
  takenAt: new Date().toISOString(),
  invoices: await prisma.invoice.findMany(),
  invoiceLines: await prisma.invoiceLine.findMany(),
  series: await prisma.companyInvoiceSeries.findMany(),
  payments: await prisma.payment.findMany(),
  folioLines: await prisma.folioLine.findMany(),
  folios: await prisma.folio.findMany(),
  reservations: await prisma.reservation.findMany(),
  allocations: await prisma.roomAllocation.findMany(),
  guests: await prisma.guest.findMany({ select: { id: true, fullName: true, gstNumber: true } }),
};
writeFileSync(out, JSON.stringify(data, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
console.log("backup:", out, Object.fromEntries(Object.entries(data).filter(([k]) => k !== "takenAt").map(([k, v]) => [k, v.length])));
await prisma.$disconnect();
