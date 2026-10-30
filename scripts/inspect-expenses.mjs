/** READ-ONLY: profile expenses by status / property / month / creator + largest drafts + possible duplicates. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const props = new Map((await prisma.property.findMany({ select: { id: true, code: true, name: true } })).map((p) => [p.id, `${p.code}`]));
const ex = await prisma.expense.findMany({ select: { id: true, status: true, propertyId: true, head: true, subCategory: true, description: true, amountPaise: true, spentOn: true, createdAt: true, createdById: true, approvedById: true } });
const users = new Map((await prisma.user.findMany({ select: { id: true, name: true, roleAssignments: { select: { role: true } } } })).map((u) => [u.id, `${u.name} (${[...new Set(u.roleAssignments.map((r) => r.role))].join("/")})`]));
const r = (p) => Number(p) / 100;
const tally = (key) => { const m = new Map(); for (const e of ex) { const k = key(e); const v = m.get(k) ?? [0, 0]; v[0]++; v[1] += r(e.amountPaise); m.set(k, v); } return [...m].sort(); };
console.log("BY PROPERTY/STATUS"); for (const [k, v] of tally((e) => `${props.get(e.propertyId)} ${e.status}`)) console.log(" ", k, v[0], `₹${v[1].toLocaleString("en-IN")}`);
console.log("BY MONTH/STATUS"); for (const [k, v] of tally((e) => `${e.spentOn.toISOString().slice(0, 7)} ${e.status}`)) console.log(" ", k, v[0], `₹${v[1].toLocaleString("en-IN")}`);
console.log("BY CREATOR/STATUS"); for (const [k, v] of tally((e) => `${users.get(e.createdById) ?? e.createdById} ${e.status}`)) console.log(" ", k, v[0]);
console.log("BY HEAD (DRAFT)"); for (const [k, v] of tally((e) => (e.status === "DRAFT" ? e.head : "~other"))) console.log(" ", k, v[0], `₹${v[1].toLocaleString("en-IN")}`);
console.log("LARGEST DRAFTS"); for (const e of ex.filter((x) => x.status === "DRAFT").sort((a, b) => Number(b.amountPaise - a.amountPaise)).slice(0, 15)) console.log(" ", `₹${r(e.amountPaise).toLocaleString("en-IN")}`, props.get(e.propertyId), e.head, e.subCategory ?? "", "|", e.description ?? "", e.spentOn.toISOString().slice(0, 10));
const seen = new Map(); for (const e of ex) { const k = `${e.propertyId}|${e.spentOn.toISOString().slice(0, 10)}|${e.amountPaise}|${(e.description ?? "").trim().toLowerCase()}|${e.head}`; seen.set(k, [...(seen.get(k) ?? []), e]); }
const dups = [...seen.values()].filter((v) => v.length > 1);
console.log(`POSSIBLE DUPLICATES (same property, day, amount, text): ${dups.length} groups, ${dups.reduce((n, v) => n + v.length - 1, 0)} extra rows`);
for (const v of dups.slice(0, 15)) console.log(" ", v.length, "×", props.get(v[0].propertyId), v[0].spentOn.toISOString().slice(0, 10), `₹${r(v[0].amountPaise)}`, v[0].description, v.map((x) => x.status).join(","), v.map((x) => x.createdAt.toISOString().slice(0, 16)).join(" "));
await prisma.$disconnect();
