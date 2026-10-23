"use client";

import { Fragment, useEffect, useState } from "react";
import { fmtDateTime } from "@/lib/dates";
import type { createClient } from "@/lib/supabase/client";

// "Where is this No. Pesanan?" — one box for the Demographic and Earning pages. Type part of an order number (5+ characters)
// and see every stage it reached: Order Shipped, Order Completed, Cancel / Failed Delivery / Return Refund, Earning.
type Supabase = ReturnType<typeof createClient>;
type Exc = { kind: "cancel" | "failed" | "return"; ref_no: string | null; at: string | null; status: string | null; reason: string | null; product: string | null; qty: number | null; amount: number | null; store: string | null };
type Hit = {
  order_no: string;
  completed: { at: string | null; store: string | null; status: string | null; units: number; returned: number; total: number | null; buyer: string | null } | null;
  shipped: { at: string | null; store: string | null; status: string | null; units: number; total: number | null } | null;
  exceptions: Exc[];
  earning: { release_date: string | null; store: string | null; sales: number; net_income: number; lines: number } | null;
};
const KIND_LABEL = { cancel: "Order Cancel", failed: "Failed Delivery", return: "Return Refund" } as const;
const rp = (n: number | null | undefined) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

export default function OrderLookup({ supabase, clientId, store, t }: { supabase: Supabase; clientId: string; store?: string; t: (k: string) => string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!clientId || term.length < 5) return;
    const h = setTimeout(async () => {
      setBusy(true);
      const { data } = await supabase.rpc("order_lookup", { p_client_id: clientId, p_q: term, p_store: store || null });
      setHits((data as Hit[]) || []); setBusy(false);
    }, 350);
    return () => clearTimeout(h);
  }, [supabase, clientId, store, q]);

  const shown = q.trim().length >= 5 ? hits : null;   // fewer than 5 characters: show nothing
  const stage = (label: string, on: boolean, detail: React.ReactNode) => (
    <div style={{ flex: "1 1 190px", minWidth: 170, padding: "8px 12px", borderRadius: 10, border: `1px solid ${on ? "rgba(201,162,39,.45)" : "var(--line)"}`, background: on ? "rgba(201,162,39,.07)" : "rgba(10,22,40,.4)" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: on ? "#e8edf8" : "var(--muted)" }}>{on ? detail : "—"}</div>
    </div>
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="fld" style={{ maxWidth: 360 }}>
        <label>{t("Find No. Pesanan")}</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Type at least 5 characters of the order number")} style={{ fontFamily: "monospace" }} />
      </div>
      {busy && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>…</div>}
      {shown && !busy && (
        <div className="panel" style={{ margin: "10px 0 0", padding: 14 }}>
          {shown.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("No order found with that number.")}</div>}
          {shown.map((h) => (
            <div key={h.order_no} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--gold)", marginBottom: 8 }}>{h.order_no}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {stage(t("Order Shipped"), !!h.shipped, h.shipped && <>{fmtDateTime(h.shipped.at)} · {h.shipped.units} pcs · {h.shipped.store}</>)}
                {stage(t("Order Completed"), !!h.completed, h.completed && <>{fmtDateTime(h.completed.at)} · {h.completed.units} pcs{h.completed.returned ? ` · ${h.completed.returned} returned` : ""} · {h.completed.store}</>)}
                {stage(t("Earning"), !!h.earning, h.earning && <>{t("Released")} {h.earning.release_date} · {rp(h.earning.net_income)} · {h.earning.store}</>)}
                {h.exceptions.map((e, i) => (
                  <Fragment key={i}>
                    {stage(t(KIND_LABEL[e.kind]), true,
                      <>{fmtDateTime(e.at)} · {e.status}{e.ref_no ? ` · ${e.ref_no}` : ""}{e.amount ? ` · ${rp(e.amount)}` : ""}{e.reason ? <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 2 }}>{e.reason}</div> : null}</>)}
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
