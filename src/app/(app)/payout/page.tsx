"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import NotPaidPanel from "./NotPaidPanel";
import PaidPanel from "./PaidPanel";
import DetailPanel from "./DetailPanel";
import { tabBtn } from "./shared";

export const dynamic = "force-dynamic";

// Harga Beli is the purchase price per product — the same list as Earning's Modal Product (product_costs).
const HargaBeli = dynamicImport(() => import("../finance/ModalProduct"), { ssr: false });

// Payout (Super Admin + Admin): pay the vendor for the goods of completed orders.
//   Not Paid       — completed lines not paid yet; tick them, "Pay to Vendor" -> XLS + PDF.
//   Paid           — the saved payouts.
//   Detail Payout  — one payout, Summary / Detail.
//   Harga Beli     — purchase price per product.
const TABS = [
  { v: "notpaid", l: "Not Paid" },
  { v: "paid", l: "Paid" },
  { v: "detail", l: "Detail Payout" },
  { v: "price", l: "Harga Beli" },
] as const;

export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("notpaid");
  const [batchId, setBatchId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
    })();
  }, [supabase]);

  const open = (id: string) => { setBatchId(id); setTab("detail"); };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map((x) => (
          <button key={x.v} onClick={() => setTab(x.v)} style={tabBtn(tab === x.v)}>{x.l}</button>
        ))}
      </div>
      {tab === "notpaid" && <NotPaidPanel supabase={supabase} clientId={clientId} onPaid={open} />}
      {tab === "paid" && <PaidPanel supabase={supabase} clientId={clientId} onOpen={open} />}
      {tab === "detail" && <DetailPanel supabase={supabase} clientId={clientId} batchId={batchId} onSelect={setBatchId} />}
      {tab === "price" && <HargaBeli clientId={clientId} />}
    </>
  );
}
