/** READ-ONLY. Invoices whose total no longer matches their folio.
 *  A tax invoice is immutable by law and by DB trigger; when the folio behind it
 *  is corrected afterwards, the fix is a CREDIT NOTE, not an edit. This finds the
 *  ones that need one. node scripts/scan-invoice-folio-mismatch.mjs
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const inr = (x) => `₹${(Number(x)/100).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
const d = (x) => x.toISOString().slice(0,10);
try {
  const folios = await p.folio.findMany({
    where: { invoices: { some: {} } },
    select: { id:true, propertyId:true,
      reservation:{select:{code:true,guest:{select:{fullName:true}}}},
      lines:{select:{id:true,type:true,amountPaise:true,cgstPaise:true,sgstPaise:true,igstPaise:true,reversalOfId:true}},
      invoices:{select:{number:true,type:true,taxableValuePaise:true,cgstPaise:true,sgstPaise:true,igstPaise:true,totalPaise:true,issuedAt:true,cancelsInvoiceId:true}} },
  });
  let bad = 0, minor = 0, minorNet = 0n;
  let netTaxable = 0n, netGst = 0n;
  for (const f of folios) {
    const revd = new Set(f.lines.filter(l=>l.reversalOfId).map(l=>l.reversalOfId));
    const act = f.lines.filter(l=>!revd.has(l.id)&&!(l.type==="REVERSAL"&&l.reversalOfId));
    const fBase = act.reduce((s,l)=>s+BigInt(l.amountPaise),0n);
    const fGst  = act.reduce((s,l)=>s+BigInt(l.cgstPaise)+BigInt(l.sgstPaise)+BigInt(l.igstPaise),0n);
    // Credit notes carry negative amounts, so summing all invoices gives the net invoiced.
    const iBase = f.invoices.reduce((s,i)=>s+BigInt(i.taxableValuePaise),0n);
    const iGst  = f.invoices.reduce((s,i)=>s+BigInt(i.cgstPaise)+BigInt(i.sgstPaise)+BigInt(i.igstPaise),0n);
    if (iBase === fBase && iGst === fGst) continue;
    const diff = (iBase - fBase) + (iGst - fGst);
    const material = diff > 100n || diff < -100n;   // more than ₹1
    if (!material) { minor++; minorNet += diff; continue; }
    bad++;
    netTaxable += iBase - fBase; netGst += iGst - fGst;
    console.log(`${f.reservation?.code ?? "(no booking)"} ${f.reservation?.guest.fullName ?? ""}`);
    console.log(`   folio   taxable ${inr(fBase)}  gst ${inr(fGst)}  = ${inr(fBase+fGst)}`);
    console.log(`   invoiced taxable ${inr(iBase)}  gst ${inr(iGst)}  = ${inr(iBase+iGst)}`);
    console.log(`   OVER-INVOICED BY taxable ${inr(iBase-fBase)}  gst ${inr(iGst-fGst)}`);
    for (const i of f.invoices) console.log(`     ${i.number} [${i.type}] ${inr(i.totalPaise)} issued ${d(i.issuedAt)}`);
    console.log("");
  }
  console.log(`MATERIAL (> ₹1): ${bad} folio(s) — these need a CREDIT NOTE.`);
  console.log(`sub-rupee rounding noise: ${minor} folio(s), net ${inr(minorNet)} — pre-existing, not from the repairs.`);
  console.log(`NET over-invoiced: taxable ${inr(netTaxable)} · GST ${inr(netGst)} · total ${inr(netTaxable+netGst)}`);
} catch(e){ console.error("Failed:",e.message); process.exitCode=1; }
finally { await p.$disconnect(); }
