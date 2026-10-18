/** READ-ONLY. Invoice-vs-folio reconciliation report for the accountant.
 *
 *  A tax invoice is immutable — by GST law and by the DB trigger. When the folio
 *  behind one is corrected afterwards, the invoice keeps the old figures and the
 *  correction has to be a CREDIT NOTE (and, where the folio is now HIGHER, a
 *  supplementary invoice). This lists every invoice that no longer matches, with
 *  the GST period it falls in, so the accountant can decide what to issue and when.
 *
 *  Writes CSV to stdout:  node scripts/report-invoice-mismatches.mjs > report.csv
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const r2 = (p) => (Number(p) / 100).toFixed(2);
const d = (x) => x.toISOString().slice(0, 10);
/** GST return period an invoice belongs to (month of issue). */
const period = (x) => x.toISOString().slice(0, 7);

try {
  const folios = await prisma.folio.findMany({
    where: { invoices: { some: {} } },
    select: {
      id: true, propertyId: true,
      reservation: { select: { code: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } } } },
      lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true, createdAt: true } },
      invoices: { select: { id: true, number: true, type: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true, issuedAt: true } },
    },
  });
  const props = new Map((await prisma.property.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));

  const rows = [];
  for (const f of folios) {
    const revd = new Set(f.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    const act = f.lines.filter((l) => !revd.has(l.id) && !(l.type === "REVERSAL" && l.reversalOfId));
    const fBase = act.reduce((s, l) => s + BigInt(l.amountPaise), 0n);
    const fGst = act.reduce((s, l) => s + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise), 0n);
    const iBase = f.invoices.reduce((s, i) => s + BigInt(i.taxableValuePaise), 0n);
    const iGst = f.invoices.reduce((s, i) => s + BigInt(i.cgstPaise) + BigInt(i.sgstPaise) + BigInt(i.igstPaise), 0n);
    const dBase = iBase - fBase, dGst = iGst - fGst;
    const diff = dBase + dGst;
    if (diff <= 100n && diff >= -100n) continue; // sub-rupee rounding, not a correction

    const original = f.invoices.find((i) => i.type === "TAX_INVOICE") ?? f.invoices[0];
    rows.push({
      property: props.get(f.propertyId) ?? f.propertyId,
      booking: f.reservation?.code ?? "",
      guest: (f.reservation?.guest.fullName ?? "").replace(/,/g, " "),
      stay: f.reservation ? `${d(f.reservation.checkInDate)} to ${d(f.reservation.checkOutDate)}` : "",
      invoiceNo: original.number,
      invoiceDate: d(original.issuedAt),
      gstPeriod: period(original.issuedAt),
      invoiceTaxable: r2(iBase), invoiceGst: r2(iGst), invoiceTotal: r2(iBase + iGst),
      folioTaxable: r2(fBase), folioGst: r2(fGst), folioTotal: r2(fBase + fGst),
      diffTaxable: r2(dBase), diffGst: r2(dGst), diffTotal: r2(diff),
      action: diff > 0n ? "CREDIT NOTE (invoice is higher than the folio)" : "SUPPLEMENTARY INVOICE (folio is higher)",
    });
  }
  rows.sort((a, b) => a.gstPeriod.localeCompare(b.gstPeriod) || a.invoiceNo.localeCompare(b.invoiceNo));

  const cols = ["property","booking","guest","stay","invoiceNo","invoiceDate","gstPeriod","invoiceTaxable","invoiceGst","invoiceTotal","folioTaxable","folioGst","folioTotal","diffTaxable","diffGst","diffTotal","action"];
  console.log(cols.join(","));
  for (const r of rows) console.log(cols.map((c) => `"${r[c]}"`).join(","));

  const sum = (k) => rows.reduce((s, r) => s + Number(r[k]), 0).toFixed(2);
  console.log(`"TOTAL","${rows.length} invoice(s)","","","","","","${sum("invoiceTaxable")}","${sum("invoiceGst")}","${sum("invoiceTotal")}","${sum("folioTaxable")}","${sum("folioGst")}","${sum("folioTotal")}","${sum("diffTaxable")}","${sum("diffGst")}","${sum("diffTotal")}",""`);
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
