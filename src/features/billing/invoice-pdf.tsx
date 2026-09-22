/**
 * GST tax invoice — Tally-style layout matching the client's reference format.
 *
 * Full-border grid: company (legal-entity) header + invoice/stay meta box, then
 * the consignee, a description table (room stay consolidated to one line with
 * qty = nights, plus each extra charge), amount-in-words, a CGST/SGST summary
 * grouped by HSN·rate, and the declaration + signatory. Amounts render in INR
 * (the default PDF font can't draw the ₹ glyph). All figures come from the
 * folio/invoice in paise; this only formats them.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { amountInWords } from "./domain/words";
import { COMPANY_INFO } from "@/lib/constants/company";

export type InvoicePdfLine = {
  type: string; // ROOM, FOOD, LAUNDRY, …
  description: string;
  hsnSac: string | null;
  quantity: number;
  unitPaise: number;
  amountPaise: number; // taxable
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxRateBps: number;
};

export type InvoicePdfData = {
  number: string;
  issuedAt: Date;
  branch: { name: string; addressLine1: string | null; city: string | null; state: string | null; pincode: string | null };
  checkInDate: Date | null;
  checkOutDate: Date | null;
  bookingSource: string | null;
  paymentMethods: string | null;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  /** e.g. "Stay of Guest Mr Suresh Sharma in Room GF-1 at Hauz Khas D-1/17, New Delhi". */
  stayLabel: string;
  lines: InvoicePdfLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

const INK = "#111827";
const MUTED = "#4b5563";
const BORDER = "#000000";

const s = StyleSheet.create({
  page: { paddingTop: 24, paddingBottom: 30, paddingHorizontal: 28, fontSize: 8.5, color: INK, fontFamily: "Helvetica", lineHeight: 1.35 },
  title: { textAlign: "center", fontSize: 11, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 4 },
  frame: { borderWidth: 1, borderColor: BORDER },
  row: { flexDirection: "row" },
  // Header: company (left) + meta (right)
  headL: { width: "56%", padding: 6, borderRightWidth: 1, borderRightColor: BORDER },
  headR: { width: "44%" },
  legal: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  small: { fontSize: 7.8, color: INK, marginTop: 1 },
  metaRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  metaCellL: { width: "45%", padding: 3, borderRightWidth: 1, borderRightColor: BORDER, fontSize: 7.5, color: MUTED },
  metaCellR: { width: "55%", padding: 3, fontSize: 8, fontFamily: "Helvetica-Bold" },
  consignee: { padding: 6, borderTopWidth: 1, borderTopColor: BORDER },
  cLabel: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  cName: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 1 },
  // Description table
  thead: { flexDirection: "row", borderTopWidth: 1, borderColor: BORDER, backgroundColor: "#f3f4f6" },
  trow: { flexDirection: "row", borderTopWidth: 1, borderColor: BORDER },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", padding: 3 },
  td: { fontSize: 8, padding: 3 },
  cSl: { width: "5%", borderRightWidth: 1, borderColor: BORDER, textAlign: "center" },
  cDesc: { width: "43%", borderRightWidth: 1, borderColor: BORDER },
  cHsn: { width: "13%", borderRightWidth: 1, borderColor: BORDER, textAlign: "center" },
  cQty: { width: "9%", borderRightWidth: 1, borderColor: BORDER, textAlign: "right" },
  cRate: { width: "15%", borderRightWidth: 1, borderColor: BORDER, textAlign: "right" },
  cAmt: { width: "15%", textAlign: "right" },
  words: { padding: 6, borderTopWidth: 1, borderColor: BORDER },
  wLabel: { fontSize: 7, color: MUTED },
  wVal: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 1 },
  // Tax summary table
  txHead: { flexDirection: "row", backgroundColor: "#f3f4f6", borderColor: BORDER },
  txRow: { flexDirection: "row", borderTopWidth: 1, borderColor: BORDER },
  txH: { fontSize: 7, fontFamily: "Helvetica-Bold", padding: 3, textAlign: "center" },
  txD: { fontSize: 7.8, padding: 3 },
  txHsn: { width: "28%", borderRightWidth: 1, borderColor: BORDER },
  txTaxable: { width: "16%", borderRightWidth: 1, borderColor: BORDER, textAlign: "right" },
  txQuad: { width: "12%", borderRightWidth: 1, borderColor: BORDER, textAlign: "right" },
  txTotal: { width: "20%", textAlign: "right" },
  decl: { padding: 6, borderTopWidth: 1, borderColor: BORDER, flexDirection: "row", justifyContent: "space-between" },
  declText: { fontSize: 7.2, color: MUTED, width: "58%" },
  sign: { width: "40%", alignItems: "flex-end", justifyContent: "space-between" },
  signFor: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "right" },
  signAuth: { fontSize: 7.5, color: MUTED, marginTop: 26 },
  foot: { textAlign: "center", fontSize: 7, color: MUTED, marginTop: 6 },
});

const money = (paise: number) => (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const pct = (bps: number) => (bps / 100).toFixed(2);

/** Consolidate ROOM lines into one row (qty = nights); keep each extra line. */
function displayLines(lines: InvoicePdfLine[], stayLabel: string): InvoicePdfLine[] {
  const room = lines.filter((l) => l.type === "ROOM");
  const others = lines.filter((l) => l.type !== "ROOM");
  const out: InvoicePdfLine[] = [];
  if (room.length > 0) {
    const amt = room.reduce((n, l) => n + l.amountPaise, 0);
    out.push({
      type: "ROOM",
      description: stayLabel,
      hsnSac: room[0]!.hsnSac,
      quantity: room.length,
      unitPaise: room[0]!.unitPaise,
      amountPaise: amt,
      cgstPaise: room.reduce((n, l) => n + l.cgstPaise, 0),
      sgstPaise: room.reduce((n, l) => n + l.sgstPaise, 0),
      igstPaise: room.reduce((n, l) => n + l.igstPaise, 0),
      taxRateBps: room[0]!.taxRateBps,
    });
  }
  for (const l of others) out.push(l);
  return out;
}

/** Group by HSN·rate for the CGST/SGST summary table. */
function taxGroups(lines: InvoicePdfLine[]) {
  const map = new Map<string, { hsn: string; bps: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const l of lines) {
    const hsn = l.hsnSac ?? "—";
    const key = `${hsn}|${l.taxRateBps}`;
    const g = map.get(key) ?? { hsn, bps: l.taxRateBps, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += l.amountPaise; g.cgst += l.cgstPaise; g.sgst += l.sgstPaise; g.igst += l.igstPaise;
    map.set(key, g);
  }
  return [...map.values()];
}

function InvoiceDoc({ data }: { data: InvoicePdfData }) {
  const intra = data.igstPaise === 0;
  const disp = displayLines(data.lines, data.stayLabel);
  const groups = taxGroups(disp);
  const branchAddr = [data.branch.addressLine1, data.branch.city, data.branch.state, data.branch.pincode].filter(Boolean).join(", ");
  const meta: [string, string][] = [
    ["Invoice No.", data.number],
    ["Dated", fmtDate(data.issuedAt)],
    ["Check-in", fmtDate(data.checkInDate)],
    ["Check-out", fmtDate(data.checkOutDate)],
    ["Booking source", data.bookingSource || "—"],
    ["Payment method", data.paymentMethods || "—"],
  ];

  return (
    <Document title={`Tax Invoice ${data.number}`}>
      <Page size="A4" style={s.page} wrap>
        <Text style={s.title}>TAX INVOICE</Text>

        <View style={s.frame}>
          {/* Header: company + meta */}
          <View style={s.row}>
            <View style={s.headL}>
              <Text style={s.legal}>{COMPANY_INFO.legalName}</Text>
              {COMPANY_INFO.regOfficeLines.map((l, i) => <Text key={i} style={s.small}>{l}</Text>)}
              <Text style={s.small}>GSTIN/UIN: {COMPANY_INFO.gstin}</Text>
              <Text style={s.small}>State Name: {COMPANY_INFO.stateName}, Code: {COMPANY_INFO.stateCode}</Text>
              <Text style={s.small}>CIN: {COMPANY_INFO.cin}</Text>
              <Text style={s.small}>E-Mail: {COMPANY_INFO.email}</Text>
              {branchAddr ? <Text style={[s.small, { marginTop: 3, color: MUTED }]}>Branch: {data.branch.name} — {branchAddr}</Text> : null}
            </View>
            <View style={s.headR}>
              {meta.map(([k, v], i) => (
                <View key={i} style={s.metaRow}>
                  <Text style={s.metaCellL}>{k}</Text>
                  <Text style={s.metaCellR}>{v}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Consignee */}
          <View style={s.consignee}>
            <Text style={s.cLabel}>Consignee (Bill to)</Text>
            <Text style={s.cName}>{data.customerName}</Text>
            <Text style={s.small}>
              {data.customerGstin ? `GSTIN: ${data.customerGstin}   ` : ""}Place of supply: {data.placeOfSupply}
              {"   "}{intra ? "(Intra-state · CGST + SGST)" : "(Inter-state · IGST)"}
            </Text>
          </View>

          {/* Description table */}
          <View style={s.thead}>
            <Text style={[s.th, s.cSl]}>Sl</Text>
            <Text style={[s.th, s.cDesc]}>Description of goods / services</Text>
            <Text style={[s.th, s.cHsn]}>HSN/SAC</Text>
            <Text style={[s.th, s.cQty]}>Qty</Text>
            <Text style={[s.th, s.cRate]}>Rate</Text>
            <Text style={[s.th, s.cAmt]}>Amount</Text>
          </View>
          {disp.map((l, i) => (
            <View key={i} style={s.trow} wrap={false}>
              <Text style={[s.td, s.cSl]}>{i + 1}</Text>
              <Text style={[s.td, s.cDesc]}>{l.type === "ROOM" ? l.description : `${l.type.replace(/_/g, " ")}${l.description && l.description !== l.type ? ` — ${l.description}` : ""}`}</Text>
              <Text style={[s.td, s.cHsn]}>{l.hsnSac ?? "—"}</Text>
              <Text style={[s.td, s.cQty]}>{l.quantity}</Text>
              <Text style={[s.td, s.cRate]}>{money(l.unitPaise)}</Text>
              <Text style={[s.td, s.cAmt]}>{money(l.amountPaise)}</Text>
            </View>
          ))}
          {/* Taxable subtotal row */}
          <View style={[s.trow, { backgroundColor: "#f9fafb" }]} wrap={false}>
            <Text style={[s.td, s.cSl]}> </Text>
            <Text style={[s.td, s.cDesc, { fontFamily: "Helvetica-Bold", textAlign: "right" }]}>Taxable value</Text>
            <Text style={[s.td, s.cHsn]}> </Text>
            <Text style={[s.td, s.cQty]}> </Text>
            <Text style={[s.td, s.cRate]}> </Text>
            <Text style={[s.td, s.cAmt, { fontFamily: "Helvetica-Bold" }]}>{money(data.taxablePaise)}</Text>
          </View>

          {/* Amount in words */}
          <View style={s.words}>
            <Text style={s.wLabel}>Amount chargeable (in words)</Text>
            <Text style={s.wVal}>{amountInWords(data.totalPaise)}</Text>
          </View>

          {/* Tax summary */}
          <View style={s.txHead}>
            <Text style={[s.txH, s.txHsn]}>HSN/SAC</Text>
            <Text style={[s.txH, s.txTaxable]}>Taxable Value</Text>
            {intra ? (
              <>
                <Text style={[s.txH, s.txQuad]}>CGST Rate</Text>
                <Text style={[s.txH, s.txQuad]}>CGST Amt</Text>
                <Text style={[s.txH, s.txQuad]}>SGST Rate</Text>
                <Text style={[s.txH, s.txQuad]}>SGST Amt</Text>
              </>
            ) : (
              <>
                <Text style={[s.txH, s.txQuad]}>IGST Rate</Text>
                <Text style={[s.txH, s.txQuad]}>IGST Amt</Text>
                <Text style={[s.txH, s.txQuad]}> </Text>
                <Text style={[s.txH, s.txQuad]}> </Text>
              </>
            )}
            <Text style={[s.txH, s.txTotal]}>Total Tax</Text>
          </View>
          {groups.map((g, i) => (
            <View key={i} style={s.txRow} wrap={false}>
              <Text style={[s.txD, s.txHsn]}>{g.hsn}</Text>
              <Text style={[s.txD, s.txTaxable]}>{money(g.taxable)}</Text>
              {intra ? (
                <>
                  <Text style={[s.txD, s.txQuad]}>{pct(g.bps / 2)}%</Text>
                  <Text style={[s.txD, s.txQuad]}>{money(g.cgst)}</Text>
                  <Text style={[s.txD, s.txQuad]}>{pct(g.bps / 2)}%</Text>
                  <Text style={[s.txD, s.txQuad]}>{money(g.sgst)}</Text>
                </>
              ) : (
                <>
                  <Text style={[s.txD, s.txQuad]}>{pct(g.bps)}%</Text>
                  <Text style={[s.txD, s.txQuad]}>{money(g.igst)}</Text>
                  <Text style={[s.txD, s.txQuad]}> </Text>
                  <Text style={[s.txD, s.txQuad]}> </Text>
                </>
              )}
              <Text style={[s.txD, s.txTotal]}>{money(g.cgst + g.sgst + g.igst)}</Text>
            </View>
          ))}
          <View style={[s.txRow, { backgroundColor: "#f3f4f6" }]} wrap={false}>
            <Text style={[s.txD, s.txHsn, { fontFamily: "Helvetica-Bold" }]}>Total</Text>
            <Text style={[s.txD, s.txTaxable, { fontFamily: "Helvetica-Bold" }]}>{money(data.taxablePaise)}</Text>
            <Text style={[s.txD, s.txQuad]}> </Text>
            <Text style={[s.txD, s.txQuad, { fontFamily: "Helvetica-Bold" }]}>{money(intra ? data.cgstPaise : data.igstPaise)}</Text>
            <Text style={[s.txD, s.txQuad]}> </Text>
            <Text style={[s.txD, s.txQuad, { fontFamily: "Helvetica-Bold" }]}>{intra ? money(data.sgstPaise) : "—"}</Text>
            <Text style={[s.txD, s.txTotal, { fontFamily: "Helvetica-Bold" }]}>{money(data.cgstPaise + data.sgstPaise + data.igstPaise)}</Text>
          </View>

          {/* Grand total */}
          <View style={[s.txRow, { backgroundColor: "#111827" }]} wrap={false}>
            <Text style={[s.txD, { width: "68%", color: "#fff", fontFamily: "Helvetica-Bold", textAlign: "right", paddingRight: 8 }]}>Grand Total (INR)</Text>
            <Text style={[s.txD, s.txTotal, { color: "#fff", fontFamily: "Helvetica-Bold" }]}>{money(data.totalPaise)}</Text>
          </View>

          {/* Declaration + signatory */}
          <View style={s.decl}>
            <Text style={s.declText}>
              Declaration: We declare that this invoice shows the actual price of the particulars described and that all the particulars are true and correct.
            </Text>
            <View style={s.sign}>
              <Text style={s.signFor}>for {COMPANY_INFO.legalName}</Text>
              <Text style={s.signAuth}>Authorised Signatory</Text>
            </View>
          </View>
        </View>

        <Text style={s.foot}>This is a computer-generated tax invoice. All amounts are in Indian Rupees (INR).</Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc data={data} />);
}
