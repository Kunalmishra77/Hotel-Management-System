/**
 * Build the client-facing workbook "Woodpecker – Information Needed": a first
 * sheet with every question (A–E) and an answer column, then one sheet per
 * data check (from audit-portal.mjs, run fresh) listing the bookings concerned.
 *   node scripts/build-client-questions.mjs <out.xlsx>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/build-client-questions.mjs <out.xlsx>");

const QUESTIONS = [
  ["A", "Invoices and GST (please check with your CA)"],
  ["1", "From 30 Oct, all tax invoices are issued from the portal only (series continues from WASPL :853/ 26-27). Please confirm that paper invoices will no longer be issued."],
  ["2", "Do you have paper invoices issued before 19 Oct or after 27 Oct? If yes, please share copies — portal numbers 685–729 and 837–852 may overlap with them."],
  ["3", "For a whole apartment above ₹7,500 per night, should room GST be 18% or 5%?"],
  ["4", "Laundry, extra bed and food are currently billed at 5% GST. Please confirm these rates."],
  ["5", "Extra bed / extra person charges were sometimes collected separately and not shown on the invoice (e.g. ₹500, ₹1,500). From now on, should they appear on the GST invoice?"],
  ["6", "For MakeMyTrip / Agoda bookings the portal records the full amount paid by the guest. Should the OTA commission (e.g. ₹2,183 billed, ₹1,802 received) be recorded as an expense?"],
  ["7", "Paper bills always printed \"D-1/17\". The portal prints the actual property where the guest stayed. Please confirm this is correct."],
  ["B", "Older stays (before 19 Oct) — see the sheets in this file"],
  ["8", "Stays with no room rate (₹0) — sheet \"Missing room rate\". Please give the actual rate or paper bill for each."],
  ["9", "Stays where the invoice amount differs from the bill — sheet \"Invoice vs bill\". Which amount is correct? (e.g. Dr KV Ramarao: invoice ₹1,050, bill ₹36,487.50)"],
  ["10", "Checked-out stays with a balance — sheet \"Balance due or credit\". Amounts due: collect or write off? Credits: refund or adjust?"],
  ["11", "Checked-out stays without a GST invoice — sheet \"No GST invoice\". Should invoices be issued? (Most are the ₹0 stays above.)"],
  ["12", "Stays with no room assigned — sheet \"No room assigned\". Which room did the guest stay in?"],
  ["13", "Possible duplicate bookings — sheet \"Possible duplicates\". One booking or two?"],
  ["14", "Guests sharing a mobile number — sheet \"Same mobile number\". Same person? If yes, we will merge the profiles."],
  ["C", "Payments and credit"],
  ["15", "Gopal Sharma ₹2,940 (via Mr A Rungta) and IIT Delhi ₹2,730 are on credit. When and how will these be paid? Should a company credit account be opened?"],
  ["16", "Kumar Balwant (invoice #813): the paper bill shows payments of ₹7,750 against a bill of ₹8,250. How much was actually received?"],
  ["17", "Satish PR (invoice #824): the paper bill shows ₹15 more than the bill. Was ₹15 extra collected?"],
  ["D", "Expenses"],
  ["18", "\"₹33,000 to ajay\" (7 Sep, Head Office) was entered twice, 14 minutes apart. One payment or two?"],
  ["19", "Expenses entered by Admin / Manager / Accounts are now approved automatically; above ₹25,000 a Manager's or Accounts' entry needs the Admin's approval. Is this fine?"],
  ["20", "Would you like to set monthly budgets per category for each property? (Expenses → \"Set budgets\")"],
  ["E", "Operations"],
  ["21", "Bookings whose arrival date has passed but are not checked in — sheet \"Not checked in\". Check in or mark as no-show?"],
];

// Fresh data: run the portal audit into a temp workbook, then copy its sheets.
const tmp = join(mkdtempSync(join(tmpdir(), "wp-audit-")), "audit.xlsx");
execFileSync(process.execPath, ["scripts/audit-portal.mjs", tmp], { stdio: "ignore" });
const audit = new ExcelJS.Workbook();
await audit.xlsx.readFile(tmp);

const wb = new ExcelJS.Workbook();
wb.creator = "Agentix";
const q = wb.addWorksheet("Questions");
q.columns = [{ header: "#", width: 6 }, { header: "Question", width: 110 }, { header: "Your answer", width: 60 }];
q.getRow(1).font = { bold: true };
q.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1F2" } };
for (const [no, text] of QUESTIONS) {
  const row = q.addRow([no, text, ""]);
  row.alignment = { wrapText: true, vertical: "top" };
  if (/^[A-E]$/.test(no)) { row.font = { bold: true }; row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } }; }
}
q.views = [{ state: "frozen", ySplit: 1 }];

// Only the checks that need the client (room-status drift is internal housekeeping).
const SKIP = /ROOM STATUS DRIFT|INHOUSE but/i;
const NAMES = [
  [/NO ROOM CHARGE/i, "Missing room rate"], [/INVOICE DOESNT MATCH/i, "Invoice vs bill"],
  [/WITH BALANCE/i, "Balance due or credit"], [/WITHOUT A GST/i, "No GST invoice"],
  [/NO ROOM ALLOCATED/i, "No room assigned"], [/POSSIBLE DUPLICATE/i, "Possible duplicates"],
  [/SHARING A MOBILE/i, "Same mobile number"], [/CONFIRMED but arrival/i, "Not checked in"],
];
// BK-QDIOVGL0 is Kumar Balwant's extra-person entry, kept apart on purpose (paper bill #832).
const KNOWN = /BK-QDIOVGL0/;
audit.eachSheet((src) => {
  if (SKIP.test(src.name) || src.rowCount <= 1) return;
  const dst = wb.addWorksheet(NAMES.find(([re]) => re.test(src.name))?.[1] ?? src.name);
  dst.columns = [{ width: 5 }, { width: 120 }, { width: 50 }];
  src.eachRow((r, i) => {
    const vals = r.values.slice(1);
    if (i > 1 && /Possible duplicates/.test(dst.name) && KNOWN.test(String(vals[1]))) return;
    const row = dst.addRow(i === 1 ? ["#", vals[1], "Your answer"] : vals);
    if (i === 1) { row.font = { bold: true }; row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1F2" } }; }
    row.alignment = { wrapText: true, vertical: "top" };
  });
  dst.views = [{ state: "frozen", ySplit: 1 }];
});

await wb.xlsx.writeFile(out);
console.log(`Wrote ${out}: ${wb.worksheets.map((w) => `${w.name} (${w.rowCount - 1})`).join(", ")}`);
