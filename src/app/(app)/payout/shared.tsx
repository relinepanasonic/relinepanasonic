"use client";

import { useEffect, useMemo, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

export type Supabase = ReturnType<typeof createClient>;
export const rp = (n: number | null | undefined) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
export const num = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString("id-ID");

// Download one saved payout as a file (the server builds it: /api/payout/export).
export function downloadPayout(batchId: string, format: "xlsx" | "pdf") {
  const a = document.createElement("a");
  a.href = `/api/payout/export?batch=${encodeURIComponent(batchId)}&format=${format}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Link = { city: string | null; store_name: string };

// City -> Dealer choice shared by the Payout sub pages. The dealer list is the Core List (master data) plus the
// dealers already known from the finance filters; a one-dealer city picks its dealer automatically.
export function useScope(supabase: Supabase, clientId: string) {
  const [links, setLinks] = useState<Link[]>([]);
  const [city, setCityState] = useState("");
  const [store, setStore] = useState("");

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: m } = await supabase.from("master_data").select("value,city").eq("kind", "store").eq("client_id", clientId).order("value");
      const merged: Link[] = ((m as { value: string; city: string | null }[]) || []).map((x) => ({ city: x.city, store_name: x.value }));
      const { data: f } = await supabase.rpc("finance_filters");
      const seen = new Set(merged.map((x) => x.store_name));
      for (const x of ((f as { stores?: { store_name: string; city: string | null }[] })?.stores || [])) {
        if (!seen.has(x.store_name)) merged.push({ city: x.city, store_name: x.store_name });
      }
      setLinks(merged);
    })();
  }, [supabase, clientId]);

  const cities = useMemo(() => Array.from(new Set(links.map((l) => l.city).filter(Boolean) as string[])).sort(), [links]);
  const stores = useMemo(() => Array.from(new Set(links.filter((l) => !city || l.city === city).map((l) => l.store_name))).sort(), [links, city]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!store && stores.length === 1) setStore(stores[0]);
  }, [stores, store]);

  const setCity = (c: string) => { setCityState(c); setStore(""); };
  const cityOfStore = links.find((l) => l.store_name === store)?.city ?? (city || null);
  return { cities, stores, city, store, setCity, setStore, cityOfStore };
}

export function ScopeBar({ scope, children }: { scope: ReturnType<typeof useScope>; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
      <div className="fld" style={{ minWidth: 190 }}>
        <label>City</label>
        <select value={scope.city} onChange={(e) => scope.setCity(e.target.value)}>
          <option value="">All cities</option>
          {scope.cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="fld" style={{ minWidth: 220 }}>
        <label>Dealer</label>
        <select value={scope.store} onChange={(e) => scope.setStore(e.target.value)}>
          <option value="">{scope.stores.length ? "Select dealer…" : "No dealers"}</option>
          {scope.stores.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {children}
    </div>
  );
}

export const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
  border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
