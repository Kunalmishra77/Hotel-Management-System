/**
 * Payment receipt PDF — a premium, guest-facing acknowledgement of a payment (or
 * refund). Rendered on the fly via @react-pdf/renderer; amounts in INR (the
 * default PDF font can't draw the ₹ glyph). Figures come from the folio in paise.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { amountInWords } from "./domain/words";

export type ReceiptPdfData = {
  receiptNo: string;
  receivedAt: Date;
  property: { name: string; addressLine1: string | null; city: string | null; state: string | null; pincode: string | null; gstin: string | null };
  guestName: string;
  bookingCode: string | null;
  amountPaise: number;
  mode: string;
  reference: string | null;
  isRefund: boolean;
  balancePaise: number;
};

const INK = "#0f172a";
const MUTED = "#64748b";
const ACCENT = "#0e7490";
const LINE = "#e2e8f0";

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingHorizontal: 40, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  band: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: ACCENT, paddingBottom: 12, marginBottom: 18 },
  hotel: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  addr: { fontSize: 8, color: MUTED, marginTop: 3, maxWidth: 260, lineHeight: 1.4 },
  gstin: { fontSize: 8, marginTop: 3 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", color: ACCENT, letterSpacing: 1 },
  meta: { fontSize: 8, color: MUTED, marginTop: 4 },
  metaVal: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: LINE },
  label: { color: MUTED },
  val: { fontFamily: "Helvetica-Bold" },
  amountBox: { marginTop: 18, backgroundColor: ACCENT, borderRadius: 4, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amountLabel: { color: "#e0f2fe", fontSize: 10 },
  amountVal: { color: "#ffffff", fontSize: 18, fontFamily: "Helvetica-Bold" },
  words: { marginTop: 12, fontSize: 9 },
  wordsLabel: { color: MUTED },
  balance: { marginTop: 16, flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1, borderTopColor: LINE },
  foot: { marginTop: 30, fontSize: 8, color: MUTED, textAlign: "center" },
});

const money = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function ReceiptDoc({ data }: { data: ReceiptPdfData }) {
  const kind = data.isRefund ? "REFUND RECEIPT" : "PAYMENT RECEIPT";
  const propAddr = [data.property.addressLine1, data.property.city, data.property.state, data.property.pincode].filter(Boolean).join(", ");
  return (
    <Document title={`${kind} ${data.receiptNo}`}>
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <View>
            <Text style={s.hotel}>{data.property.name}</Text>
            {propAddr ? <Text style={s.addr}>{propAddr}</Text> : null}
            {data.property.gstin ? <Text style={s.gstin}>GSTIN: {data.property.gstin}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>{kind}</Text>
            <Text style={s.meta}>Receipt No.</Text>
            <Text style={s.metaVal}>{data.receiptNo}</Text>
            <Text style={s.meta}>Date</Text>
            <Text style={s.metaVal}>{fmtDate(data.receivedAt)}</Text>
          </View>
        </View>

        <View style={s.row}><Text style={s.label}>Received from</Text><Text style={s.val}>{data.guestName}</Text></View>
        {data.bookingCode ? <View style={s.row}><Text style={s.label}>Booking</Text><Text style={s.val}>{data.bookingCode}</Text></View> : null}
        <View style={s.row}><Text style={s.label}>Mode</Text><Text style={s.val}>{data.mode.replace(/_/g, " ")}</Text></View>
        {data.reference ? <View style={s.row}><Text style={s.label}>Reference</Text><Text style={s.val}>{data.reference}</Text></View> : null}

        <View style={s.amountBox}>
          <Text style={s.amountLabel}>{data.isRefund ? "Amount refunded (INR)" : "Amount received (INR)"}</Text>
          <Text style={s.amountVal}>{money(data.amountPaise)}</Text>
        </View>

        <Text style={s.words}>
          <Text style={s.wordsLabel}>In words: </Text>
          {amountInWords(data.amountPaise)}
        </Text>

        <View style={s.balance}>
          <Text style={s.label}>Balance due on folio</Text>
          <Text style={s.val}>INR {money(data.balancePaise)}</Text>
        </View>

        <Text style={s.foot}>Thank you. This is a computer-generated receipt and needs no signature.</Text>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDoc data={data} />);
}
