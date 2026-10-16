"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";

// FinanceDashboard pulls in recharts; loaded on demand instead of bundled
// into every page load.
const FinanceDashboard = dynamicImport(() => import("./FinanceDashboard"), { ssr: false, loading: () => <Loader center /> });
const HargaBeli = dynamicImport(() => import("../payout/HargaBeli"), { ssr: false });

// Earning sub pages (one bar): Dashboard | Detail Product Profit | Withdraw Detail | Not Paid Order | Not Connected,
// plus Harga Beli for Super Admin, Admin and Dealer Owner (purchase price per dealer, with history).
// Finance upload lives on the /upload page.
const MANAGE_ROLES = ["superadmin", "client_admin", "branch_manager"];

export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
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

  return (
    <FinanceDashboard
      clientId={clientId} refreshKey={refreshKey}
      extraSections={canManage ? [{ key: "harga", label: "Harga Beli", node: <HargaBeli clientId={clientId} /> }] : []}
    />
  );
}
