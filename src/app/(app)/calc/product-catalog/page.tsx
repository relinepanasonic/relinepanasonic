"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CatalogTab } from "@/components/ProductCatalog";

export const dynamic = "force-dynamic";

// Price Calculator > Product Catalog: the SRP log and the products of each SRP (see components/ProductCatalog.tsx).
export default function ProductCatalogPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: cs }, { data: p }] = await Promise.all([
        supabase.from("clients").select("id").order("created_at").limit(1),
        supabase.from("profiles").select("role").eq("id", user.id).single(),
      ]);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
      setIsAdmin(["superadmin", "client_admin"].includes((p as { role?: string } | null)?.role || ""));
    })();
  }, [supabase]);

  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <Link href="/calc" className="mode-tab">Perhitungan Harga</Link>
        <Link href="/calc/price-research" className="mode-tab">Price Research</Link>
        <span className="mode-tab on">Product Catalog</span>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>
      <div className="panel">
        <h3 style={{ margin: 0 }}>Product Catalog</h3>
        <div className="hint" style={{ marginBottom: 12 }}>Products with their Harga Beli (what we pay the dealer) and Harga SRP. Press <b>New Harga Beli</b> when we buy from the dealer at a new price.</div>
        {clientId && <CatalogTab supabase={supabase} clientId={clientId} isAdmin={isAdmin} tick={tick} onChanged={() => setTick((t) => t + 1)} />}
      </div>
    </>
  );
}
