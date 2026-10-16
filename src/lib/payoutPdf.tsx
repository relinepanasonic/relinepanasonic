import { Document, Page, View, Text, StyleSheet, Font } from "@react-pdf/renderer";
import path from "path";
import {
  summarize, dateOrDash, SUMMARY_HEAD, DETAIL_HEAD,
  type PayoutBatch, type PayoutLine,
} from "@/lib/payoutExport";

// Payout PDF: landscape A4, page 1 = Summary (per product), then the Detail pages (per order line).
// Same bundled font as the BOD report so nothing is fetched at render time.
const FONT_DIR = path.join(process.cwd(), "src", "lib", "fonts");
Font.register({ family: "NotoSansJP", src: path.join(FONT_DIR, "NotoSansJP-Regular.ttf") });
Font.register({ family: "NotoSansJP-Bold", src: path.join(FONT_DIR, "NotoSansJP-Bold.ttf") });
Font.registerHyphenationCallback((w) => [w]); // never split order numbers / product codes

const INK = "#0b1a33", LINE = "#d5dbe6", HEAD_BG = "#e8edf6";
const s = StyleSheet.create({
  page: { paddingHorizontal: 32, paddingTop: 30, paddingBottom: 36, fontFamily: "NotoSansJP", fontSize: 8.5, color: INK },
  title: { fontFamily: "NotoSansJP-Bold", fontSize: 15, marginBottom: 2 },
  sub: { fontSize: 8.5, color: "#55627a", marginBottom: 10 },
  head: { flexDirection: "row", backgroundColor: HEAD_BG, borderBottomWidth: 1, borderBottomColor: INK, paddingVertical: 4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3 },
  total: { flexDirection: "row", borderTopWidth: 1, borderTopColor: INK, paddingVertical: 4, marginTop: 1 },
  b: { fontFamily: "NotoSansJP-Bold" },
  cell: { paddingHorizontal: 4 },
  num: { textAlign: "right" },
  foot: { position: "absolute", bottom: 16, left: 32, right: 32, fontSize: 7.5, color: "#7a869c", flexDirection: "row", justifyContent: "space-between" },
});

const rp = (n: number) => Math.round(Number(n) || 0).toLocaleString("id-ID");

function Table({ head, widths, align, rows, total }: {
  head: readonly string[]; widths: number[]; align: ("l" | "r")[]; rows: string[][]; total?: string[];
}) {
  const cell = (v: string, i: number, bold = false) => (
    <Text key={i} style={[s.cell, { width: `${widths[i]}%` }, align[i] === "r" ? s.num : {}, bold ? s.b : {}]}>{v}</Text>
  );
  return (
    <View>
      <View style={s.head} fixed>{head.map((h, i) => cell(h, i, true))}</View>
      {rows.map((r, ri) => <View key={ri} style={s.row} wrap={false}>{r.map((v, i) => cell(v, i))}</View>)}
      {total && <View style={s.total} wrap={false}>{total.map((v, i) => cell(v, i, true))}</View>}
    </View>
  );
}

export function PayoutDocument({ batch, lines }: { batch: PayoutBatch; lines: PayoutLine[] }) {
  const sum = summarize(lines);
  const created = dateOrDash(batch.created_at.slice(0, 10));
  const subtitle = `${batch.store_name}${batch.dealer_city ? " · " + batch.dealer_city : ""} · ${created}`;
  const footer = (
    <View style={s.foot} fixed>
      <Text>{batch.payout_no} · {batch.store_name}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
  return (
    <Document title={`Payout ${batch.payout_no ?? ""}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.title}>Payout {batch.payout_no} — Summary</Text>
        <Text style={s.sub}>{subtitle}</Text>
        <Table
          head={SUMMARY_HEAD} widths={[16, 48, 8, 12, 16]} align={["l", "l", "r", "r", "r"]}
          rows={sum.map((r) => [r.product_id || "—", r.product_name, rp(r.qty), rp(r.harga_beli), rp(r.total)])}
          total={["", "TOTAL", rp(sum.reduce((a, r) => a + r.qty, 0)), "", rp(sum.reduce((a, r) => a + r.total, 0))]}
        />
        {footer}
      </Page>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.title}>Payout {batch.payout_no} — Detail</Text>
        <Text style={s.sub}>{subtitle}</Text>
        <Table
          head={DETAIL_HEAD} widths={[15, 8, 9, 11, 33, 5, 9, 10]} align={["l", "l", "l", "l", "l", "r", "r", "r"]}
          rows={lines.map((l) => [l.order_no, dateOrDash(l.shipped_at), dateOrDash(l.withdraw_at), l.product_id || "—",
            l.product_name || "—", rp(l.qty), rp(l.harga_beli), rp(l.total)])}
          total={["", "", "", "", "TOTAL", rp(lines.reduce((a, l) => a + Number(l.qty), 0)), "", rp(lines.reduce((a, l) => a + Number(l.total), 0))]}
        />
        {footer}
      </Page>
    </Document>
  );
}
