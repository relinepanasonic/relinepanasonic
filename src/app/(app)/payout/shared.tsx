"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

export type Supabase = ReturnType<typeof createClient>;
export const rp = (n: number | null | undefined) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
export const num = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString("id-ID");

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

export type Vendor = { id: string; name: string; stores: string[] };
export type VendorStore = { store_name: string; city: string | null; vendor_id: string | null };

// Vendors (Core List): one vendor has many stores, one store has one vendor. Payout and Harga Beli work per vendor.
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

export function VendorBar({ v, children }: { v: ReturnType<typeof useVendors>; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
      <div className="fld" style={{ minWidth: 240 }}>
        <label>Vendor</label>
        <select value={v.vendorId} onChange={(e) => v.setVendorId(e.target.value)}>
          <option value="">{v.vendors === null ? "Loading…" : v.vendors.length ? "Select vendor…" : "No vendors yet"}</option>
          {(v.vendors || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      {v.vendor && (
        <div style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 10, maxWidth: 360 }}>
          {v.vendor.stores.length
            ? <>Stores: <b style={{ color: "#cdd9f0" }}>{v.vendor.stores.join(", ")}</b></>
            : <span style={{ color: "#fbbf24" }}>No store yet — add its stores in Core List.</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function NoVendors() {
  return (
    <div style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>
      No vendors yet. Create a vendor and link its stores in <b style={{ color: "#cdd9f0" }}>Core List → Vendors</b>.
    </div>
  );
}

export const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
  border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
