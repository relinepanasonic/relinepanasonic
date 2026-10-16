"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";

// FinanceDashboard pulls in recharts; loaded on demand instead of bundled
// into every page load.
const FinanceDashboard = dynamicImport(() => import("./FinanceDashboard"), { ssr: false, loading: () => <Loader center /> });

// Earning sub pages (one bar, inside the dashboard): Dashboard | Detail Product Profit | Withdraw Detail |
// Not Paid Order | Not Connected. Harga Beli (purchase prices) lives in the Payout page.
// Finance upload lives on the /upload page.
export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [refreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
    })();
  }, [supabase]);

  return <FinanceDashboard clientId={clientId} refreshKey={refreshKey} />;
}
