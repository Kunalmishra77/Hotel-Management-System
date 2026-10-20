/** READ-ONLY. Every folio with a positive balance — what the Billing page's
 *  "Outstanding dues" tile is actually made of, and whether each one is real.
 *  node scripts/audit-outstanding.mjs
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const inr=x=>`₹${(Number(x)/100).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
const d=x=>x?x.toISOString().slice(0,10):"—";
try{
 const folios=await p.folio.findMany({select:{id:true,propertyId:true,
  reservation:{select:{id:true,code:true,status:true,source:true,checkInDate:true,checkOutDate:true,transferredFromId:true,guestId:true,guest:{select:{fullName:true}}}},
  lines:{select:{amountPaise:true,cgstPaise:true,sgstPaise:true,igstPaise:true}},
  payments:{select:{amountPaise:true,isRefund:true}}}});
 const props=new Map((await p.property.findMany({select:{id:true,name:true}})).map(x=>[x.id,x.name]));
 const rows=[];
 for(const f of folios){
  const ch=f.lines.reduce((s,l)=>s+BigInt(l.amountPaise)+BigInt(l.cgstPaise)+BigInt(l.sgstPaise)+BigInt(l.igstPaise),0n);
  const pd=f.payments.reduce((s,x)=>s+(x.isRefund?-BigInt(x.amountPaise):BigInt(x.amountPaise)),0n);
  const bal=ch-pd;
  if(bal>0n) rows.push({f,bal,ch,pd});
 }
 rows.sort((a,b)=>Number(b.bal-a.bal));
 let total=0n;
 console.log(`${rows.length} folio(s) with a positive balance\n`);
 console.log("  BOOKING       STATUS       PROPERTY          GUEST                      STAY                   BALANCE");
 for(const r of rows){
  total+=r.bal;
  const x=r.f.reservation;
  console.log(`  ${(x?.code??"(direct sale)").padEnd(13)} ${(x?.status??"-").padEnd(12)} ${(props.get(r.f.propertyId)??"").slice(0,17).padEnd(17)} ${(x?.guest.fullName??"").slice(0,25).padEnd(25)} ${d(x?.checkInDate)}→${d(x?.checkOutDate)}  ${inr(r.bal).padStart(11)}`);
 }
 console.log(`\n  TOTAL OUTSTANDING (sum of positive folio balances): ${inr(total)}`);
 // Which of these are legs of a linked journey whose OTHER leg holds a credit?
 console.log(`\n=== linked-journey check (credit sitting on the other leg) ===`);
 let overstated=0n;
 for(const r of rows){
  const x=r.f.reservation; if(!x) continue;
  const sibs=await p.reservation.findMany({where:{guestId:x.guestId,OR:[{transferredFromId:x.id},{id:x.transferredFromId??"__none__"}]},
    select:{code:true,folio:{select:{lines:{select:{amountPaise:true,cgstPaise:true,sgstPaise:true,igstPaise:true}},payments:{select:{amountPaise:true,isRefund:true}}}}}});
  for(const s of sibs){
   if(!s.folio) continue;
   const ch=s.folio.lines.reduce((a,l)=>a+BigInt(l.amountPaise)+BigInt(l.cgstPaise)+BigInt(l.sgstPaise)+BigInt(l.igstPaise),0n);
   const pd=s.folio.payments.reduce((a,y)=>a+(y.isRefund?-BigInt(y.amountPaise):BigInt(y.amountPaise)),0n);
   const sb=ch-pd;
   if(sb<0n){ const off=(-sb)>r.bal?r.bal:-sb; overstated+=off;
    console.log(`  ${x.code} owes ${inr(r.bal)} but linked ${s.code} holds ${inr(-sb)} credit → overstated by ${inr(off)}`); }
  }
 }
 if(overstated===0n) console.log("  none — no linked leg is holding a credit");
 else console.log(`\n  TRUE OUTSTANDING after netting linked journeys: ${inr(total-overstated)}`);
}catch(e){console.error("Failed:",e.message);process.exitCode=1;}
finally{await p.$disconnect();}
