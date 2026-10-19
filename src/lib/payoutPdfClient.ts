import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  summarize, dateOrDash, exportFileName, payoutInfoRows, ppnOf, SUMMARY_HEAD, DETAIL_HEAD,
  type PayoutBatch, type PayoutLine,
} from "@/lib/payoutExport";

// Payout PDF, built in the browser: landscape A4, page 1 = Summary (per product), then the Detail pages (per order line).
// (jsPDF + autoTable handle thousands of rows in about a second; a server-side render of 1,500 lines timed out.)
const rp = (n: number) => Math.round(Number(n) || 0).toLocaleString("id-ID");

export function buildPayoutPdf(batch: PayoutBatch, lines: PayoutLine[]): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const sum = summarize(lines);
  const info = payoutInfoRows(batch);
  const sub = `${info[1][1]} · ${info[2][1]} · ${info[3][1]}`;
  const head = { fillColor: [232, 237, 246] as [number, number, number], textColor: [11, 26, 51] as [number, number, number], fontStyle: "bold" as const };
  const base = { fontSize: 8, cellPadding: 3, textColor: [11, 26, 51] as [number, number, number], lineColor: [213, 219, 230] as [number, number, number], lineWidth: 0.3 };

  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(`Payout ${batch.payout_no ?? ""} — Summary`, 32, 36);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(85, 98, 122);
  doc.text(sub, 32, 50);
  autoTable(doc, {
    startY: 60, margin: { left: 32, right: 32 }, theme: "grid", headStyles: head, styles: base,
    head: [[...SUMMARY_HEAD]],
    body: sum.map((r) => [r.product_id || "—", r.product_name, r.variant_id, r.variant_name, rp(r.qty), rp(r.harga_beli), rp(ppnOf(r.total)), rp(r.total)]),
    foot: [["", "TOTAL", "", "", rp(sum.reduce((a, r) => a + r.qty, 0)), "", rp(sum.reduce((a, r) => a + ppnOf(r.total), 0)), rp(sum.reduce((a, r) => a + r.total, 0))]],
    footStyles: { ...head }, showFoot: "lastPage",
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });

  doc.addPage();
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(11, 26, 51);
  doc.text(`Payout ${batch.payout_no ?? ""} — Detail`, 32, 36);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(85, 98, 122);
  doc.text(sub, 32, 50);
  autoTable(doc, {
    startY: 60, margin: { left: 32, right: 32 }, theme: "grid", headStyles: head, styles: { ...base, fontSize: 7 },
    head: [[...DETAIL_HEAD]],
    body: lines.map((l) => [l.order_no, l.store_name ?? "", dateOrDash(l.shipped_at), dateOrDash(l.withdraw_at), l.product_id || "—",
      l.product_name || "—", l.variant_id || "-", l.variant_name || "-", rp(l.qty), rp(l.harga_beli), rp(ppnOf(l.total)), rp(l.total)]),
    foot: [["", "", "", "", "", "TOTAL", "", "", rp(lines.reduce((a, l) => a + Number(l.qty), 0)), "", rp(lines.reduce((a, l) => a + ppnOf(l.total), 0)), rp(lines.reduce((a, l) => a + Number(l.total), 0))]],
    footStyles: { ...head }, showFoot: "lastPage",
    columnStyles: { 8: { halign: "right" }, 9: { halign: "right" }, 10: { halign: "right" }, 11: { halign: "right" } },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(122, 134, 156);
    doc.text(`${batch.payout_no ?? ""} · ${batch.vendor_name ?? batch.store_name}`, 32, 580);
    doc.text(`${i} / ${pages}`, 842 - 32, 580, { align: "right" });
  }
  return doc;
}

export function downloadPayoutPdf(batch: PayoutBatch, lines: PayoutLine[]) {
  buildPayoutPdf(batch, lines).save(exportFileName(batch, "pdf"));
}
