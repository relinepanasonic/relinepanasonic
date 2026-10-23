"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

export type Supabase = ReturnType<typeof createClient>;
export const rp = (n: number | null | undefined) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
export const num = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString("id-ID");

// "Partial": only some of the ordered units are paid (the rest was returned / refunded)
export function PartialBadge({ ordered, qty, title }: { ordered: number | null | undefined; qty: number; title?: string }) {
  if (ordered == null || !(Number(ordered) > Number(qty))) return null;
  return (
    <span title={title || `Only ${num(qty)} of ${num(ordered)} ordered units are paid — the rest was returned or refunded`}
      style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: ".03em", whiteSpace: "nowrap",
        color: "#fbbf24", background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.45)" }}>
      PARTIAL {num(qty)}/{num(ordered)}
    </span>
  );
}

// What Shopee paid for this product line (Earning): paid | partial | refunded | waiting
export function EarnChip({ status }: { status: string | null | undefined }) {
  const m: Record<string, { t: string; c: string }> = {
    paid: { t: "Paid by Shopee", c: "#86efac" }, partial: { t: "Partly refunded", c: "#fbbf24" },
    refunded: { t: "Refunded", c: "#f87171" }, waiting: { t: "Waiting for Earning", c: "#8fa3c7" },
  };
  const x = m[status || "waiting"] || m.waiting;
  return <span style={{ color: x.c, fontSize: 12, whiteSpace: "nowrap" }}>{x.t}</span>;
}

// Download one saved payout as an XLSX (the server builds it: /api/payout/export). The PDF is built in the browser
// (lib/payoutPdfClient.ts): a long payout is too slow for a serverless function.
export function downloadPayout(batchId: string, format: "xlsx") {
  const a = document.createElement("a");
  a.href = `/api/payout/export?batch=${encodeURIComponent(batchId)}&format=${format}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// The files kept with a payout: the transfer proof, the receipt, and the tax documents of buying from the vendor.
export type FileKind = "proof" | "receipt" | "faktur" | "bukpot";
export const FILE_LABEL: Record<FileKind, string> = { proof: "Transfer proof", receipt: "Receipt", faktur: "Faktur Pajak", bukpot: "Bukti Potong" };
export type FileNames = { proof_name?: string | null; receipt_name?: string | null; faktur_name?: string | null; bukpot_name?: string | null };
export const fileNameOf = (b: FileNames, kind: FileKind) => ({ proof: b.proof_name, receipt: b.receipt_name, faktur: b.faktur_name, bukpot: b.bukpot_name })[kind] || null;

// upload straight to storage with a one-time link made by the server (no request size limit), then record it
export async function uploadPayoutFile(supabase: Supabase, batchId: string, kind: FileKind, file: File, target: "payout" | "price" = "payout"): Promise<string> {
  const sign = await fetch("/api/payout/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", batch: batchId, kind, filename: file.name, target }) });
  const sj = await sign.json();
  if (!sign.ok) throw new Error(sj.error || "Could not prepare the upload");
  const up = await supabase.storage.from("payout-files").uploadToSignedUrl(sj.path, sj.token, file);
  if (up.error) throw new Error(up.error.message);
  const commit = await fetch("/api/payout/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit", batch: batchId, kind, path: sj.path, name: file.name, target }) });
  const cj = await commit.json();
  if (!commit.ok) throw new Error(cj.error || "Could not save the file");
  return cj.status as string;
}
export async function removePayoutFile(batchId: string, kind: FileKind, target: "payout" | "price" = "payout") {
  const r = await fetch("/api/payout/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", batch: batchId, kind, target }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not remove");
}

// one file cell: the file name (opens the file) with a remove button, or an upload button
export function FileCell({ batchId, kind, name, busy, onUpload, onRemove, target = "payout", label }: {
  batchId: string; kind: FileKind; name: string | null; busy: boolean; onUpload: (f: File) => void; onRemove: () => void;
  target?: "payout" | "price"; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  if (name) {
    return (
      <>
        <a href={`/api/payout/file?batch=${batchId}&kind=${kind}${target === "price" ? "&target=price" : ""}`} target="_blank" rel="noreferrer" title={name} style={{ color: "#e8edf8", textDecoration: "underline", display: "inline-block", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{name}</a>{" "}
        <button onClick={onRemove} title="Remove" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
      </>
    );
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); if (ref.current) ref.current.value = ""; }} />
      <button className="btn-ghost" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : `⬆ ${label || FILE_LABEL[kind]}`}</button>
    </>
  );
}

export type Vendor = { id: string; name: string; stores: string[] };
export type VendorStore = { store_name: string; city: string | null; vendor_id: string | null };

// Vendors (Connector): one vendor has many stores, one store has one vendor. Payout and Harga Beli work per vendor.
export function useVendors(supabase: Supabase, clientId: string) {
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [stores, setStores] = useState<VendorStore[]>([]);
  const [vendorId, setVendorId] = useState("");

  const reload = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase.rpc("vendor_list", { p_client_id: clientId });
    const d = (data as { vendors: Vendor[]; stores: VendorStore[] } | null) || { vendors: [], stores: [] };
    setVendors(d.vendors || []); setStores(d.stores || []);
  }, [supabase, clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    // a single vendor is picked for you
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!vendorId && vendors && vendors.length === 1) setVendorId(vendors[0].id);
  }, [vendors, vendorId]);

  const vendor = useMemo(() => vendors?.find((v) => v.id === vendorId) || null, [vendors, vendorId]);
  return { vendors, stores, vendorId, setVendorId, vendor, reload };
}

export function VendorBar({ v, children, showStores = true }: { v: ReturnType<typeof useVendors>; children?: React.ReactNode; showStores?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
      <div className="fld" style={{ minWidth: 240 }}>
        <label>Vendor</label>
        <select value={v.vendorId} onChange={(e) => v.setVendorId(e.target.value)}>
          <option value="">{v.vendors === null ? "Loading…" : v.vendors.length ? "Select vendor…" : "No vendors yet"}</option>
          {(v.vendors || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      {v.vendor && (showStores || !v.vendor.stores.length) && (
        <div style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 10, maxWidth: 360 }}>
          {v.vendor.stores.length
            ? <>Stores: <b style={{ color: "#cdd9f0" }}>{v.vendor.stores.join(", ")}</b></>
            : <span style={{ color: "#fbbf24" }}>No store yet — add its stores in Connector.</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function NoVendors() {
  return (
    <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>
      No vendors yet. Create a vendor and link its stores in <b style={{ color: "#cdd9f0" }}>Connector</b>.
    </div>
  );
}

export const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
  border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
