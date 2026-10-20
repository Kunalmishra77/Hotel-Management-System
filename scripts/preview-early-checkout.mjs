/** READ-ONLY. What `checkOut` WILL do for an in-house booking today — the nights
 *  it keeps, the nights it reverses, the room-nights it frees, and the exact
 *  amount to collect. Mirrors lifecycle-actions.checkOut; writes nothing.
 *  $env:CODE="BK-..."; node scripts/preview-early-checkout.mjs
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const inr=x=>`₹${(Number(x)/100).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
const d=x=>x.toISOString().slice(0,10);
const CODE=process.env.CODE;
try{
const r=await p.reservation.findFirstOrThrow({where:{code:CODE},select:{code:true,status:true,source:true,nights:true,ratePaise:true,
  checkInDate:true,checkOutDate:true,property:{select:{name:true,timezone:true}},
  allocations:{select:{startDate:true,endDate:true,room:{select:{number:true}}}},
  folio:{select:{lines:{select:{id:true,type:true,businessDate:true,amountPaise:true,cgstPaise:true,sgstPaise:true,igstPaise:true,reversalOfId:true}},payments:{select:{amountPaise:true,isRefund:true}}}}}});
// checkOut's own clamp: today in the property's timezone, min one night.
const todayStr=new Date().toLocaleDateString("en-CA",{timeZone:r.property.timezone});
const today=new Date(`${todayStr}T00:00:00.000Z`);
const minCO=new Date(Date.UTC(r.checkInDate.getUTCFullYear(),r.checkInDate.getUTCMonth(),r.checkInDate.getUTCDate()+1));
let eff=r.checkOutDate;
if(today.getTime()<r.checkOutDate.getTime()) eff = today.getTime()<minCO.getTime()?minCO:today;
const isEarly=eff.getTime()<r.checkOutDate.getTime();
const nightsKept=[];for(let t=r.checkInDate.getTime();t<eff.getTime();t+=86400000)nightsKept.push(d(new Date(t)));
console.log(`${r.code} [${r.status}] ${r.source} @ ${r.property.name} room ${r.allocations[0]?.room.number}`);
console.log(`  booked ${d(r.checkInDate)} → ${d(r.checkOutDate)} (${r.nights}n) · rate ${inr(r.ratePaise)}`);
console.log(`  today in ${r.property.timezone}: ${todayStr}  → early check-out: ${isEarly?"YES":"no"}`);
const L=r.folio.lines,rev=new Set(L.filter(l=>l.reversalOfId).map(l=>l.reversalOfId));
const act=L.filter(l=>!rev.has(l.id)&&!(l.type==="REVERSAL"&&l.reversalOfId));
let keep=0n,drop=0n;const dropped=[];
for(const l of act){
  const amt=BigInt(l.amountPaise)+BigInt(l.cgstPaise)+BigInt(l.sgstPaise)+BigInt(l.igstPaise);
  if(l.type==="ROOM"&&isEarly&&d(l.businessDate)>=d(eff)){drop+=amt;dropped.push(d(l.businessDate));}
  else keep+=amt;
}
const paid=r.folio.payments.reduce((s,x)=>s+(x.isRefund?-BigInt(x.amountPaise):BigInt(x.amountPaise)),0n);
console.log(`\n  nights KEPT (${nightsKept.length}): ${nightsKept.join(", ")}`);
console.log(`  nights REVERSED (${dropped.length}): ${dropped.join(", ")}  = ${inr(drop)} removed`);
console.log(`\n  charges now        ${inr(keep+drop)}`);
console.log(`  charges after      ${inr(keep)}`);
console.log(`  already paid       ${inr(paid)}`);
console.log(`  >>> TO COLLECT     ${inr(keep-paid)}`);
console.log(`\n  booking becomes ${d(r.checkInDate)} → ${d(eff)} (${nightsKept.length}n)`);
console.log(`  room ${r.allocations[0]?.room.number} freed from ${d(eff)} onward (alloc ${d(r.allocations[0].startDate)} → ${d(eff)})`);
}catch(e){console.error("Failed:",e.message);process.exitCode=1;}
finally{await p.$disconnect();}
