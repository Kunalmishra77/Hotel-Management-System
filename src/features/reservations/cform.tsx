/**
 * Form C (FRRO) PDF — 03 T7. Generated for a foreign guest at check-in and stored
 * in encrypted object storage (like the payslip / ID scan); the DB row keeps only
 * `pdfObjectKey`. Passport/visa numbers are passed already MASKED by the caller —
 * the full values live encrypted on GuestId and never enter this document.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

export type CFormData = {
  propertyName: string;
  propertyAddress: string;
  guestName: string;
  nationality: string;
  passportNumberMasked: string | null;
  passportPlaceOfIssue: string | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
  visaNumberMasked: string | null;
  visaType: string | null;
  visaIssueDate: string | null;
  visaExpiryDate: string | null;
  arrivalFromCity: string | null;
  arrivalFromCountry: string | null;
  arrivalInIndiaDate: string | null;
  arrivalAtHotelDate: string;
  departureDate: string;
  nextDestination: string | null;
  purposeOfVisit: string | null;
  generatedAt: string;
};

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10 },
  title: { fontSize: 15, marginBottom: 2 },
  sub: { fontSize: 9, color: "#555", marginBottom: 14 },
  section: { fontSize: 11, marginTop: 10, marginBottom: 4, fontWeight: "bold" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottom: 0.5, borderColor: "#ddd" },
  label: { color: "#333" },
  value: { color: "#111" },
  note: { fontSize: 8, color: "#777", marginTop: 16 },
});

function Line({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || "—"}</Text>
    </View>
  );
}

export function cformDocument(data: CFormData): React.ReactElement {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Form C — Arrival Report of Foreigner</Text>
        <Text style={styles.sub}>
          {data.propertyName} · {data.propertyAddress}
        </Text>

        <Text style={styles.section}>Guest</Text>
        <Line label="Name" value={data.guestName} />
        <Line label="Nationality" value={data.nationality} />

        <Text style={styles.section}>Passport</Text>
        <Line label="Passport no." value={data.passportNumberMasked ?? "—"} />
        <Line label="Place of issue" value={data.passportPlaceOfIssue ?? "—"} />
        <Line label="Date of issue" value={data.passportIssueDate ?? "—"} />
        <Line label="Valid until" value={data.passportExpiryDate ?? "—"} />

        <Text style={styles.section}>Visa</Text>
        <Line label="Visa no." value={data.visaNumberMasked ?? "—"} />
        <Line label="Type" value={data.visaType ?? "—"} />
        <Line label="Date of issue" value={data.visaIssueDate ?? "—"} />
        <Line label="Valid until" value={data.visaExpiryDate ?? "—"} />

        <Text style={styles.section}>Arrival &amp; stay</Text>
        <Line
          label="Arriving from"
          value={[data.arrivalFromCity, data.arrivalFromCountry].filter(Boolean).join(", ")}
        />
        <Line label="Date of arrival in India" value={data.arrivalInIndiaDate ?? "—"} />
        <Line label="Date of arrival at hotel" value={data.arrivalAtHotelDate} />
        <Line label="Intended departure" value={data.departureDate} />
        <Line label="Next destination" value={data.nextDestination ?? "—"} />
        <Line label="Purpose of visit" value={data.purposeOfVisit ?? "—"} />

        <Text style={styles.note}>
          Generated {data.generatedAt}. For submission to the FRRO / FRO. Passport and visa numbers are
          shown masked; the establishment holds the verified originals under access control.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderCForm(data: CFormData): Promise<Buffer> {
  return renderToBuffer(cformDocument(data) as React.ReactElement<DocumentProps>);
}
