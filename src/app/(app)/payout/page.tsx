"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import EarningPanel from "./EarningPanel";
import PayoutDetailPanel from "./PayoutDetailPanel";

export const dynamic = "force-dynamic";

// Payout (Super Admin + Admin):
//   1. Earning        — daily earnings per dealer with a check box per day;
//                       "Proceed Payment" saves the ticked days as a payout.
//   2. Payout Detail  — the SKUs of a payout (qty x Modal) + CSV for the ERP.
const TABS = [
  { v: "earning", l: "Earning" },
  { v: "detail", l: "Payout Detail" },
] as const;

export default function Page() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("earning");
  const [batchId, setBatchId] = useState<string | null>(null);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map((x) => (
          <button key={x.v} onClick={() => setTab(x.v)} style={tabBtn(tab === x.v)}>{x.l}</button>
        ))}
      </div>
      {tab === "earning" && (
        <EarningPanel supabase={supabase} onProceeded={(id) => { setBatchId(id); setTab("detail"); }} onOpenPayout={(id) => { setBatchId(id); setTab("detail"); }} />
      )}
      {tab === "detail" && (
        <PayoutDetailPanel supabase={supabase} batchId={batchId} onSelect={setBatchId} onBack={() => setTab("earning")} />
      )}
    </>
  );
}

const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
  border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
