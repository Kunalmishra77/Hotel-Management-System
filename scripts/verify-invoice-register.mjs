/** READ-ONLY: the invoice register is one gap-free WASPL series; each invoice = its lines; paper bills on the right stays. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const inv = await prisma.invoice.findMany({ select: { id: true, number: true, type: true, totalPaise: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, customerName: true, issuedAt: true, lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, folio: { select: { reservation: { select: { code: true } } } } } });
const n = inv.map((i) => Number((i.number.match(/^WASPL :(\d+)\/ 26-27$/) || [])[1]));
const bad = inv.filter((_, k) => !n[k]);
const sorted = n.filter(Boolean).sort((a, b) => a - b);
const dups = sorted.filter((x, k) => sorted[k - 1] === x);
const gaps = []; for (let x = sorted[0]; x <= sorted.at(-1); x++) if (!sorted.includes(x)) gaps.push(x);
const mismatch = inv.filter((i) => i.lines.length && i.lines.reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0) !== Number(i.totalPaise) && Math.abs(i.lines.reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0) - Number(i.totalPaise)) > 0);
const series = await prisma.companyInvoiceSeries.findFirst();
console.log(`invoices ${inv.length} · types ${[...new Set(inv.map((i) => i.type))]} · range ${sorted[0]}–${sorted.at(-1)} · bad format ${bad.length} · duplicates ${dups.length} · gaps ${gaps.length} · series next ${series.nextNumber}`);
console.log(`invoices whose lines ≠ total (round-off lines are part of lines): ${mismatch.length}`, mismatch.slice(0, 5).map((i) => i.number));
const paper = { 803: "BK-DC5QA207", 828: "BK-NHQMC7BO", 835: "BK-QF5QK7KR", 833: "BK-QERVCTY6", 814: "BK-HT2JJ4CA", 827: "BK-KNFC9WWL" };
for (const [no, code] of Object.entries(paper)) { const i = inv.find((x) => x.number === `WASPL :${no}/ 26-27`); console.log(no, i?.folio.reservation?.code === code ? "OK" : "WRONG", i?.customerName, Number(i?.totalPaise) / 100, i?.issuedAt.toISOString().slice(0, 10)); }
await prisma.$disconnect();
