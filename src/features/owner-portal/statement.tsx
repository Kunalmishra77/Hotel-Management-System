/**
 * 27 owner-portal — owner payout statement PDF (FR-14). Rendered on demand from
 * the snapshotted OwnerPayout figures (never recomputed). Money formatted to ₹.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

export type StatementData = {
  propertyName: string;
  period: string; // yyyy-MM
  grossRevenuePaise: number;
  expensePaise: number;
  managementFeeBps: number;
  managementFeePaise: number;
  netPayablePaise: number;
  status: string;
  paymentRef: string | null;
  generatedAt: string;
};

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  title: { fontSize: 16, marginBottom: 2 },
  sub: { fontSize: 9, color: "#555", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottom: 0.5, borderColor: "#ddd" },
  label: { color: "#333" },
  value: { color: "#111" },
  net: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, marginTop: 6, borderTop: 1, borderColor: "#333" },
  netLabel: { fontSize: 13, fontWeight: "bold" },
  netValue: { fontSize: 13, fontWeight: "bold" },
  note: { fontSize: 8, color: "#777", marginTop: 20 },
});

function Line({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function statementDocument(data: StatementData): React.ReactElement {
  const feePct = (data.managementFeeBps / 100).toFixed(data.managementFeeBps % 100 === 0 ? 0 : 2);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Owner Payout Statement</Text>
        <Text style={styles.sub}>
          {data.propertyName} · Period {data.period} · Status {data.status}
          {data.paymentRef ? ` · Ref ${data.paymentRef}` : ""}
        </Text>

        <Line label="Revenue (tax-excluded)" value={inr(data.grossRevenuePaise)} />
        <Line label="Operating expenses" value={`− ${inr(data.expensePaise)}`} />
        <Line label={`Management fee (${feePct}% of revenue)`} value={`− ${inr(data.managementFeePaise)}`} />

        <View style={styles.net}>
          <Text style={styles.netLabel}>Net payable to owner</Text>
          <Text style={styles.netValue}>{inr(data.netPayablePaise)}</Text>
        </View>

        <Text style={styles.note}>
          Generated {data.generatedAt}. Figures are the immutable snapshot recorded for this period under the
          management-fee agreement (Net = Revenue − Operating Expenses − Management Fee). A negative net is a
          shortfall carried by the owner.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderStatement(data: StatementData): Promise<Buffer> {
  return renderToBuffer(statementDocument(data) as React.ReactElement<DocumentProps>);
}
