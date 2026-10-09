"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useLang } from "@/lib/financeI18n";

export const dynamic = "force-dynamic";

// FinanceDashboard pulls in recharts; loaded on demand instead of bundled
// into every page load.
const FinanceDashboard = dynamicImport(() => import("./FinanceDashboard"), { ssr: false, loading: () => <Loader center /> });
const ModalProduct = dynamicImport(() => import("./ModalProduct"), { ssr: false });

const TABS = [
  { v: "dashboard", l: "Finance Dashboard" },
  { v: "modal", l: "Modal Product" },
] as const;
// Finance upload lives on the /upload page — this page is the dashboard plus
// cost entry. Modal Product (cost entry): Super Admin, Admin and Dealer Owner.
const MANAGE_ROLES = ["superadmin", "client_admin", "branch_manager"];

export default function Page() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("dashboard");
  const [refreshKey] = useState(0);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: cs }, { data: p }] = await Promise.all([
        supabase.from("clients").select("id").order("created_at").limit(1),
        user ? supabase.from("profiles").select("role").eq("id", user.id).single() : Promise.resolve({ data: null }),
      ]);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
      setCanManage(MANAGE_ROLES.includes((p as { role?: string } | null)?.role || ""));
    })();
  }, [supabase]);

  const tabs = canManage ? TABS : TABS.filter((x) => x.v === "dashboard");

  return (
    <>
        {canManage && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {tabs.map((x) => (
              <button key={x.v} onClick={() => setTab(x.v)} style={tabBtn(tab === x.v)}>{t(x.l)}</button>
            ))}
          </div>
        )}
        {tab === "dashboard" && <FinanceDashboard clientId={clientId} refreshKey={refreshKey} />}
        {canManage && tab === "modal" && <ModalProduct clientId={clientId} />}
    </>
  );
}

const tabBtn = (on: boolean): React.CSSProperties => ({
  padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
  border: on ? "1px solid var(--gold)" : "1px solid rgba(255,255,255,.1)",
  background: on ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
  color: on ? "var(--navy-deep)" : "#e8edf8",
});
