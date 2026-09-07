/**
 * Styled GST tax invoice (06 FR-12/16, 06 review F-1). A premium, statutory
 * document via @react-pdf/renderer — replaces the plain-text stub. Amounts are
 * rendered in INR (no ₹ glyph — the default PDF font can't draw U+20B9; the
 * document states the currency instead). All figures come from the folio/invoice
 * in paise; this only formats them.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { amountInWords } from "./domain/words";

export type InvoicePdfLine = {
  description: string;
  hsnSac: string | null;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

export type InvoicePdfData = {
  number: string;
  issuedAt: Date;
  property: {
    name: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
  };
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  lines: InvoicePdfLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

const INK = "#0f172a";
const MUTED = "#64748b";
const ACCENT = "#0e7490"; // deep teal — calm, premium
const LINE = "#e2e8f0";

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 44, paddingHorizontal: 34, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  band: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: ACCENT, paddingBottom: 12, marginBottom: 14 },
  hotel: { fontSize: 15, fontFamily: "Helvetica-Bold", color: INK },
  addr: { fontSize: 8, color: MUTED, marginTop: 3, maxWidth: 240, lineHeight: 1.4 },
  gstin: { fontSize: 8, color: INK, marginTop: 3 },
  invBox: { alignItems: "flex-end" },
  invLabel: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ACCENT, letterSpacing: 1 },
  invMeta: { fontSize: 8, color: MUTED, marginTop: 4 },
  invMetaVal: { fontSize: 9, color: INK, fontFamily: "Helvetica-Bold" },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  partyLabel: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
  partyName: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  partySub: { fontSize: 8, color: MUTED, marginTop: 2 },
  thead: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: LINE },
  th: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase" },
  tr: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: LINE },
  cDesc: { flex: 3.2 },
  cHsn: { flex: 1, textAlign: "center" },
  cNum: { flex: 1, textAlign: "right" },
  cTax: { flex: 1.3, textAlign: "right" },
  totals: { marginTop: 12, alignItems: "flex-end" },
  totRow: { flexDirection: "row", width: 240, justifyContent: "space-between", paddingVertical: 2 },
  totLabel: { fontSize: 9, color: MUTED },
  totVal: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  grand: { flexDirection: "row", width: 240, justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 8, marginTop: 4, backgroundColor: ACCENT, borderRadius: 3 },
  grandLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  grandVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  words: { marginTop: 12, fontSize: 8, color: INK },
  wordsLabel: { color: MUTED },
  footer: { position: "absolute", bottom: 24, left: 34, right: 34, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, flexDirection: "row", justifyContent: "space-between" },
  foot: { fontSize: 7.5, color: MUTED },
});

const money = (paise: number) => (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function InvoiceDoc({ data }: { data: InvoicePdfData }) {
  const intra = data.igstPaise === 0;
  const propAddr = [data.property.addressLine1, data.property.city, data.property.state, data.property.pincode].filter(Boolean).join(", ");
  return (
    <Document title={`Tax Invoice ${data.number}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.band}>
          <View>
            <Text style={s.hotel}>{data.property.name}</Text>
            {propAddr ? <Text style={s.addr}>{propAddr}</Text> : null}
            {data.property.gstin ? <Text style={s.gstin}>GSTIN: {data.property.gstin}</Text> : null}
          </View>
          <View style={s.invBox}>
            <Text style={s.invLabel}>TAX INVOICE</Text>
            <Text style={s.invMeta}>Invoice No.</Text>
            <Text style={s.invMetaVal}>{data.number}</Text>
            <Text style={s.invMeta}>Date</Text>
            <Text style={s.invMetaVal}>{fmtDate(data.issuedAt)}</Text>
          </View>
        </View>

        <View style={s.parties}>
          <View>
            <Text style={s.partyLabel}>Billed to</Text>
            <Text style={s.partyName}>{data.customerName}</Text>
            {data.customerGstin ? <Text style={s.partySub}>GSTIN: {data.customerGstin}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.partyLabel}>Place of supply</Text>
            <Text style={s.partyName}>{data.placeOfSupply}</Text>
            <Text style={s.partySub}>{intra ? "Intra-state · CGST + SGST" : "Inter-state · IGST"}</Text>
          </View>
        </View>

        <View style={s.thead}>
          <Text style={[s.th, s.cDesc]}>Description</Text>
          <Text style={[s.th, s.cHsn]}>HSN/SAC</Text>
          <Text style={[s.th, s.cNum]}>Qty</Text>
          <Text style={[s.th, s.cNum]}>Rate</Text>
          <Text style={[s.th, s.cNum]}>Taxable</Text>
          <Text style={[s.th, s.cTax]}>{intra ? "CGST" : "IGST"}</Text>
          {intra ? <Text style={[s.th, s.cTax]}>SGST</Text> : null}
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={s.cHsn}>{l.hsnSac ?? "—"}</Text>
            <Text style={s.cNum}>{l.quantity}</Text>
            <Text style={s.cNum}>{money(l.unitPaise)}</Text>
            <Text style={s.cNum}>{money(l.amountPaise)}</Text>
            <Text style={s.cTax}>{money(intra ? l.cgstPaise : l.igstPaise)}</Text>
            {intra ? <Text style={s.cTax}>{money(l.sgstPaise)}</Text> : null}
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totRow}><Text style={s.totLabel}>Taxable value</Text><Text style={s.totVal}>{money(data.taxablePaise)}</Text></View>
          {intra ? (
            <>
              <View style={s.totRow}><Text style={s.totLabel}>CGST</Text><Text style={s.totVal}>{money(data.cgstPaise)}</Text></View>
              <View style={s.totRow}><Text style={s.totLabel}>SGST</Text><Text style={s.totVal}>{money(data.sgstPaise)}</Text></View>
            </>
          ) : (
            <View style={s.totRow}><Text style={s.totLabel}>IGST</Text><Text style={s.totVal}>{money(data.igstPaise)}</Text></View>
          )}
          <View style={s.grand}><Text style={s.grandLabel}>Grand Total (INR)</Text><Text style={s.grandVal}>{money(data.totalPaise)}</Text></View>
        </View>

        <Text style={s.words}>
          <Text style={s.wordsLabel}>Amount in words: </Text>
          {amountInWords(data.totalPaise)}
        </Text>

        <View style={s.footer} fixed>
          <Text style={s.foot}>All amounts in Indian Rupees (INR). This is a computer-generated tax invoice.</Text>
          <Text style={s.foot}>{data.property.name}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc data={data} />);
}
