/**
 * Payslip PDF — 21 T-19 (FR-7/16, AC-8/14). Rendered post-finalize and stored in
 * access-controlled, encrypted object storage (the same envelope as ID scans);
 * the DB row keeps only `payslipObjectKey`, never the bytes.
 *
 * PII discipline (compliance.md): a payslip shows the staff name and a MASKED
 * bank tail only — never the full account number, never Aadhaar/PAN in full.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

export type PayslipData = {
  propertyName: string;
  month: string;
  staffName: string;
  /** Already masked by the caller (maskTail) — never the raw account. */
  bankAccountMasked: string | null;
  paidDays: number | null;
  lopDays: number | null;
  basePaise: number;
  bonusPaise: number;
  overtimePaise: number;
  deductionPaise: number;
  advancePaise: number;
  netPaise: number;
};

const rupees = (p: number): string =>
  `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10 },
  title: { fontSize: 14, marginBottom: 2 },
  sub: { fontSize: 9, color: "#555", marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottom: 0.5, borderColor: "#ddd" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, marginTop: 6, borderTop: 1.5, borderColor: "#333" },
  label: { color: "#333" },
  strong: { fontWeight: "bold" },
});

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.ReactElement {
  const style = strong ? styles.total : styles.row;
  const text = strong ? styles.strong : styles.label;
  return (
    <View style={style}>
      <Text style={text}>{label}</Text>
      <Text style={text}>{value}</Text>
    </View>
  );
}

export function payslipDocument(data: PayslipData): React.ReactElement {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Payslip — {data.staffName}</Text>
        <Text style={styles.sub}>
          {data.propertyName} · {data.month}
          {data.bankAccountMasked ? ` · A/C ${data.bankAccountMasked}` : ""}
          {data.paidDays != null ? ` · Paid days ${data.paidDays}` : ""}
          {data.lopDays != null ? ` · LOP ${data.lopDays}` : ""}
        </Text>
        <Line label="Basic (pro-rated)" value={rupees(data.basePaise)} />
        <Line label="Bonus" value={rupees(data.bonusPaise)} />
        <Line label="Overtime" value={rupees(data.overtimePaise)} />
        <Line label="Deductions" value={`- ${rupees(data.deductionPaise)}`} />
        <Line label="Advance recovered" value={`- ${rupees(data.advancePaise)}`} />
        <Line label="Net pay" value={rupees(data.netPaise)} strong />
      </Page>
    </Document>
  );
}

export async function renderPayslip(data: PayslipData): Promise<Buffer> {
  return renderToBuffer(payslipDocument(data) as React.ReactElement<DocumentProps>);
}
