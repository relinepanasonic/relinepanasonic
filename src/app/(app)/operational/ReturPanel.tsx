"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import Loader from "@/components/Loader";
import type { createClient } from "@/lib/supabase/client";

// Demographic > Retur: the orders that did NOT complete normally, one sub page per Shopee export.
// Every row is joined (by No. Pesanan) to the Order Completed and Earning data, so you can see whether the order was ever
// completed and whether any money was released for it.
type Supabase = ReturnType<typeof createClient>;
type Kind = "cancel" | "failed" | "return";
type Sel = { year: string; month: string; week: string; city: string; store: string };
type Row = {
  ref_no: string | null; order_no: string; store_name: string | null; event_at: string | null; order_created_at: string | null;
  status: string | null; reason: string | null; product_name: string | null; variant_name: string | null;
  qty: number | null; amount: number | null; total_payment: number | null; payment_method: string | null; shipping_option: string | null;
  tracking_no: string | null; buyer_username: string | null; city: string | null; province: string | null;
  extra: Record<string, string | number | null>;
  product_id: string | null; line_sales: number | null; line_refund: number | null; line_net: number | null; harga_beli: number | null;
  payout: string; payout_qty: number | null;
  completed: boolean; completed_at: string | null; earning: boolean; release_date: string | null; earning_sales: number | null; earning_net: number | null;
};

const rp = (n: number | null | undefined) => n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID");
const cell: React.CSSProperties = { padding: "7px 10px", fontSize: 12.5, whiteSpace: "nowrap" };
const wrapCell: React.CSSProperties = { padding: "7px 10px", fontSize: 12.5, width: 260, minWidth: 220, maxWidth: 300, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.35, verticalAlign: "top" };
const mono: React.CSSProperties = { ...cell, fontFamily: "monospace", fontSize: 12 };

// "Dibatalkan oleh Pembeli. Alasan: Perlu mengubah Voucher" -> who + why
function cancelWho(reason: string | null): { by: string; why: string } {
  const r = reason || "";
  const by = /pembeli/i.test(r.split("Alasan")[0]) ? "Buyer" : /sistem/i.test(r) ? "Shopee (auto)" : /penjual/i.test(r.split("Alasan")[0]) ? "Seller" : "—";
  const i = r.indexOf("Alasan:");
  return { by, why: i >= 0 ? r.slice(i + 7).trim() : r };
}

// Who won a return? Shopee decides: "Dana Dikembalikan ke Pembeli" = buyer refunded (Lose);
// "Dana Dicairkan ke Penjual" = the money is released to the seller (Win);
// "Pengembalian ... Dibatalkan" = the return was cancelled / withdrawn, the sale stands (seller keeps it).
type Result = "win" | "lose" | "kept" | "open";
function resultOf(status: string | null): Result {
  const s = (status || "").toLowerCase();
  if (s.includes("dikembalikan ke pembeli")) return "lose";
  if (s.includes("dicairkan ke penjual")) return "win";
  if (s.includes("dibatalkan")) return "kept";
  return "open";
}
const RESULT_STYLE: Record<Result, { label: string; color: string }> = {
  win: { label: "Win", color: "#86efac" }, kept: { label: "Return cancelled", color: "#86efac" },
  lose: { label: "Lose", color: "#f87171" }, open: { label: "In process", color: "#fbbf24" },
};
// how far a cancelled / failed order got: shipped time, only a tracking number (booked, never handed over), or nothing
function shippingStage(r: { tracking_no: string | null; extra: Record<string, string | number | null> }): string {
  if (r.extra?.shipped_at) return "Shipped";
  return r.tracking_no ? "Resi booked, not shipped" : "Never shipped";
}

// The returns that really cost something: per order + product + variant, cancelled requests do not count; the units are the
// largest open request (several requests can cover the same units). Earning decides whether money was refunded; no Earning line yet = waiting.
type ProductAgg = { key: string; product_id: string | null; name: string; variant: string; orders: Set<string>; qty: number; goodsQty: number; refundOnlyQty: number; waitingQty: number; refundMoney: number; harga: number | null; cost: number };
function byProduct(rows: Row[]): ProductAgg[] {
  const lines = new Map<string, Row[]>();
  for (const r of rows) {
    if (resultOf(r.status) === "kept") continue;
    const k = [r.order_no, r.product_name, r.variant_name].join("|");
    (lines.get(k) || lines.set(k, []).get(k)!).push(r);
  }
  const out = new Map<string, ProductAgg>();
  for (const rs of lines.values()) {
    const f = rs[0];
    const qty = Math.max(...rs.map((x) => x.qty || 0));
    const goods = rs.some((x) => /barang dan dana/i.test(String(x.extra?.solution || "")));
    const k = [f.product_id || "", f.product_name, f.variant_name || ""].join("|");
    const a = out.get(k) || { key: k, product_id: f.product_id, name: f.product_name || "—", variant: f.variant_name || "", orders: new Set<string>(), qty: 0, goodsQty: 0, refundOnlyQty: 0, waitingQty: 0, refundMoney: 0, harga: f.harga_beli, cost: 0 };
    a.orders.add(f.order_no);
    if (f.line_refund == null) a.waitingQty += qty;
    else if (f.line_refund < 0) {
      a.qty += qty; a.refundMoney += -f.line_refund;
      if (goods) { a.goodsQty += qty; a.cost += qty * (f.harga_beli || 0); } else a.refundOnlyQty += qty;
    }
    out.set(k, a);
  }
  return [...out.values()].filter((a) => a.qty > 0 || a.waitingQty > 0).sort((a, b) => b.refundMoney - a.refundMoney);
}

export default function ReturPanel({ supabase, clientId, sel, refreshKey, t }: { supabase: Supabase; clientId: string; sel: Sel; refreshKey: number; t: (k: string) => string }) {
  const [kind, setKind] = useState<Kind>("cancel");
  const [q, setQ] = useState("");
  const [rawRows, setRows] = useState<Row[] | null>(null);
  const [res, setRes] = useState<"" | Result>("");
  const [view, setView] = useState<"lines" | "product">("lines");

  const load = useCallback(async () => {
    if (!clientId || !sel.store) { setRows([]); return; }
    setRows(null);
    const { data } = await supabase.rpc("retur_list", {
      p_client_id: clientId, p_kind: kind, p_year: sel.year ? Number(sel.year) : null, p_month: sel.month || null, p_week: sel.week || null,
      p_city: sel.city || null, p_store: sel.store, p_q: q.trim() || null,
    });
    setRows((data as Row[]) || []);
  }, [supabase, clientId, kind, sel, q]);
  useEffect(() => {
    const h = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [load, q, refreshKey]);

  const all = rawRows || [];
  const rows = rawRows && kind === "return" && res ? all.filter((r) => resultOf(r.status) === res) : rawRows;
  const orders = new Set((rows || []).map((r) => r.order_no)).size;
  const total = (rows || []).reduce((a, r) => a + (r.amount || 0), 0);
  const nOf = (x: Result) => new Set(all.filter((r) => resultOf(r.status) === x).map((r) => r.ref_no || r.order_no)).size;
  const noDone = new Set((rows || []).filter((r) => !r.completed).map((r) => r.order_no)).size;
  const noEarn = new Set((rows || []).filter((r) => !r.earning).map((r) => r.order_no)).size;

  const tab = (k: Kind, label: string) => (
    <button key={k} onClick={() => setKind(k)} style={{
      padding: "8px 18px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 700,
      border: kind === k ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
      background: kind === k ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)", color: kind === k ? "var(--navy-deep)" : "#e8edf8",
    }}>{label}</button>
  );

  const doneCells = (r: Row) => (
    <>
      <td style={cell}>{r.completed ? <span style={{ color: "var(--gold)" }}>{t("Completed")} {fmtDate(r.completed_at)}</span> : <span style={{ color: "#fbbf24" }}>{t("Not completed")}</span>}</td>
      <td style={cell}>{r.earning ? <span style={{ color: "var(--gold)" }}>{t("Released")} {fmtDate(r.release_date)} · {rp(r.earning_net)}</span> : <span style={{ color: "var(--muted)" }}>{t("No earning")}</span>}</td>
    </>
  );
  const doneHead = <><th>{t("Order Completed")}</th><th>{t("Earning")}</th></>;
  const e = (r: Row, k: string) => (r.extra || {})[k] ?? null;

  return (
    <div className="panel">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {tab("cancel", t("Order Cancel"))}{tab("failed", t("Failed Delivery"))}{tab("return", t("Return Refund"))}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="fld" style={{ minWidth: 260 }}>
          <label>{t("No. Pesanan")}</label>
          <input value={q} onChange={(e2) => setQ(e2.target.value)} placeholder={kind === "return" ? t("Order or return number") : t("Order number")} style={{ fontFamily: "monospace" }} />
        </div>
        {kind === "return" && (
          <div style={{ display: "flex", gap: 6, paddingBottom: 2 }}>
            {([["lines", "Return lines"], ["product", "By product / variant"]] as const).map(([v, l]) => (
              <button key={v} className="btn-ghost" onClick={() => setView(v)} style={view === v ? { borderColor: "var(--gold)", color: "var(--gold)" } : undefined}>{t(l)}</button>
            ))}
          </div>
        )}
        {kind === "return" && view === "lines" && (
          <div className="fld" style={{ minWidth: 200 }}>
            <label>{t("Win / Lose")}</label>
            <select value={res} onChange={(e2) => setRes(e2.target.value as "" | Result)}>
              <option value="">{t("All")} ({new Set(all.map((r) => r.ref_no || r.order_no)).size})</option>
              <option value="win">{t("Win")} ({nOf("win")})</option>
              <option value="kept">{t("Return cancelled")} ({nOf("kept")})</option>
              <option value="lose">{t("Lose")} ({nOf("lose")})</option>
              <option value="open">{t("In process")} ({nOf("open")})</option>
            </select>
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 10 }}>
          <b style={{ color: "#e8edf8" }}>{orders}</b> {t("orders")} · <b style={{ color: "#e8edf8" }}>{(rows || []).length}</b> {t("rows")}
          {kind !== "failed" && <> · {kind === "return" ? t("Refund") : t("Subtotal")} <b style={{ color: "var(--gold)" }}>{rp(total)}</b></>}
          {" · "}<b style={{ color: "#fbbf24" }}>{noDone}</b> {t("never completed")} · <b style={{ color: "#fbbf24" }}>{noEarn}</b> {t("without earning")}
        </div>
      </div>

      {rows === null ? <Loader center /> : kind === "return" && view === "product" ? <ProductView rows={all} t={t} /> : (
        <div className="tbl-wrap">
          <table className="tbl day-tbl">
            <thead>
              {kind === "cancel" && <tr><th>{t("Order Created")}</th><th>{t("No. Pesanan")}</th><th>{t("Product")}</th><th>{t("Variant")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Subtotal")}</th><th>{t("Cancelled by")}</th><th>{t("Reason")}</th><th>{t("Payment")}</th><th>{t("Reached shipping")}</th>{doneHead}</tr>}
              {kind === "failed" && <tr><th>{t("Order Created")}</th><th>{t("No. Pesanan")}</th><th>{t("Product")}</th><th>{t("Variant")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Subtotal")}</th><th>{t("Delivery status")}</th><th>{t("Reached shipping")}</th><th>{t("Shipping")}</th><th>{t("Tracking")}</th><th>{t("Claim")}</th><th className="num">{t("Compensation")}</th>{doneHead}</tr>}
              {kind === "return" && <tr><th>{t("Requested")}</th><th>{t("No. Return")}</th><th>{t("No. Pesanan")}</th><th>{t("Product")}</th><th>{t("Product ID")}</th><th>{t("Variant")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Refund")}</th><th>{t("Type")}</th><th>{t("Status")}</th><th>{t("Win / Lose")}</th><th>{t("Reason")}</th><th className="num">{t("Fund release")}</th><th>{t("Refund done")}</th><th>{t("Goods")}</th>{doneHead}<th className="num">{t("Earning · Sales")}</th><th className="num">{t("Earning · Refund")}</th><th className="num">{t("Earning · Net")}</th><th className="num">{t("Harga Beli")}</th><th>{t("Payout")}</th></tr>}
            </thead>
            <tbody>
              {rows.map((r, i) => kind === "cancel" ? (
                <tr key={i}>
                  <td style={cell}>{fmtDateTime(r.order_created_at)}</td><td style={mono}>{r.order_no}</td><td style={wrapCell}>{r.product_name}</td><td style={cell}>{r.variant_name || "—"}</td>
                  <td className="num">{r.qty}</td><td className="num">{rp(r.amount)}</td>
                  <td style={cell}>{cancelWho(r.reason).by}</td><td style={wrapCell}>{cancelWho(r.reason).why}</td><td style={cell}>{r.payment_method || "—"}</td><td style={cell}>{shippingStage(r)}</td>
                  {doneCells(r)}
                </tr>
              ) : kind === "failed" ? (
                <tr key={i}>
                  <td style={cell}>{fmtDateTime(r.order_created_at)}</td><td style={mono}>{r.order_no}</td><td style={wrapCell}>{r.product_name}</td><td style={cell}>{r.variant_name || "—"}</td>
                  <td className="num">{r.qty}</td><td className="num">{rp(r.amount)}</td>
                  <td style={cell}>{r.status || "—"}</td><td style={cell}>{shippingStage(r)}</td><td style={cell}>{r.shipping_option || "—"}</td><td style={mono}>{r.tracking_no || "—"}</td>
                  <td style={cell}>{(e(r, "claim_status") as string) || "—"}</td><td className="num">{rp(e(r, "compensation") as number | null)}</td>
                  {doneCells(r)}
                </tr>
              ) : (
                <tr key={i}>
                  <td style={cell}>{fmtDateTime(r.event_at)}</td><td style={mono}>{r.ref_no}</td><td style={mono}>{r.order_no}</td><td style={wrapCell}>{r.product_name}</td><td style={mono}>{r.product_id || "—"}</td><td style={cell}>{r.variant_name || "—"}</td>
                  <td className="num">{r.qty}</td><td className="num">{rp(r.amount)}</td>
                  <td style={cell}>{(e(r, "return_type") as string) || "—"}</td><td style={wrapCell}>{r.status || "—"}</td>
                  <td style={cell}><b style={{ color: RESULT_STYLE[resultOf(r.status)].color }}>{t(RESULT_STYLE[resultOf(r.status)].label)}</b></td>
                  <td style={wrapCell}>{r.reason || "—"}</td>
                  <td className="num" style={{ color: ((e(r, "fund_release") as number) || 0) < 0 ? "#f87171" : undefined }}>{rp(e(r, "fund_release") as number | null)}</td>
                  <td style={cell}>{e(r, "refund_done_at") ? fmtDateTime(e(r, "refund_done_at") as string) : "—"}</td><td style={cell}>{(e(r, "goods_status") as string) || "—"}</td>
                  {doneCells(r)}
                  <td className="num">{rp(r.line_sales)}</td><td className="num" style={{ color: (r.line_refund || 0) < 0 ? "#f87171" : undefined }}>{rp(r.line_refund)}</td><td className="num">{rp(r.line_net)}</td>
                  <td className="num">{r.harga_beli == null ? <span style={{ color: "#fbbf24" }}>{t("no price")}</span> : rp(r.harga_beli)}</td>
                  <td style={cell}>{payoutText(r, t)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={22} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("No rows. Upload the file in Upload → Retur, or change the filters.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function payoutText(r: Row, t: (k: string) => string): React.ReactNode {
  if (r.payout === "none") return <span style={{ color: "var(--muted)" }}>{t("Not in payout (order not completed)")}</span>;
  if (r.payout === "open") return <span style={{ color: "var(--gold)" }}>{t("In Not Paid")} · {r.payout_qty ?? 0} {t("pcs after returns")}</span>;
  return <span style={{ color: "var(--gold)" }}>{t("Paid")} {r.payout}</span>;
}

// Which product / variant came back, how many, how much Earning refunded, and the vendor price of the goods that physically came back.
function ProductView({ rows, t }: { rows: Row[]; t: (k: string) => string }) {
  const list = byProduct(rows);
  const tot = list.reduce((a, x) => ({ qty: a.qty + x.qty, goods: a.goods + x.goodsQty, money: a.money + x.refundMoney, cost: a.cost + x.cost }), { qty: 0, goods: 0, money: 0, cost: 0 });
  return (
    <>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
        {t("Counted: returns that Earning really refunded. A cancelled return is ignored; two requests for the same units count once. Goods back = return type Barang dan Dana; Refund only = the buyer kept the goods.")}
      </div>
      <div className="tbl-wrap">
        <table className="tbl day-tbl">
          <thead><tr>
            <th>{t("Product ID")}</th><th>{t("Product")}</th><th>{t("Variant")}</th><th className="num">{t("Orders")}</th><th className="num">{t("Qty returned")}</th>
            <th className="num">{t("Goods back")}</th><th className="num">{t("Refund only")}</th><th className="num">{t("Waiting for Earning")}</th>
            <th className="num">{t("Refunded by Earning")}</th><th className="num">{t("Harga Beli")}</th><th className="num">{t("Vendor cost of goods back")}</th>
          </tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.key}>
                <td style={mono}>{a.product_id || "—"}</td><td style={wrapCell}>{a.name}</td><td style={cell}>{a.variant || "—"}</td>
                <td className="num">{a.orders.size}</td><td className="num"><b>{a.qty}</b></td>
                <td className="num">{a.goodsQty}</td><td className="num">{a.refundOnlyQty}</td><td className="num" style={{ color: a.waitingQty ? "#fbbf24" : undefined }}>{a.waitingQty || "—"}</td>
                <td className="num" style={{ color: "#f87171" }}>{rp(a.refundMoney)}</td>
                <td className="num">{a.harga == null ? <span style={{ color: "#fbbf24" }}>{t("no price")}</span> : rp(a.harga)}</td><td className="num">{rp(a.cost)}</td>
              </tr>
            ))}
            {list.length > 0 && (
              <tr style={{ fontWeight: 800, borderTop: "2px solid rgba(201,162,39,.4)" }}>
                <td colSpan={4}>{t("TOTAL")}</td><td className="num">{tot.qty}</td><td className="num">{tot.goods}</td><td colSpan={2}></td>
                <td className="num" style={{ color: "#f87171" }}>{rp(tot.money)}</td><td></td><td className="num">{rp(tot.cost)}</td>
              </tr>
            )}
            {list.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("No refunded returns yet.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
