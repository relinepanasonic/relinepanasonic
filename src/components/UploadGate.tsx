"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/financeI18n";

// Wraps a page's content and blurs it behind an "Upload the Data First" CTA
// until at least one row exists in the given table for the caller's scope
// (RLS already limits the read to what their role may see, so this one cheap
// check works for every role). Finance Detail gates on finance_rows,
// Operational Performance on order_rows — uploading only SPOS / Performa /
// Ads must NOT unblur them.
export default function UploadGate({ children, table }: { children: React.ReactNode; table: "finance_rows" | "order_rows" }) {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [hasData, setHasData] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from(table).select("client_id").limit(1);
      setHasData(!!data && data.length > 0);
    })();
  }, [supabase, table]);

  // Blur until data is positively confirmed, so there is never an unblurred
  // flash while the query is still running.
  if (hasData !== true) {
    return (
      <div style={{ position: "relative" }}>
        <div style={{ filter: "blur(6px)", pointerEvents: "none", userSelect: "none" }} aria-hidden>
          {children}
        </div>
        <div style={{ position: "absolute", inset: 0, background: "rgba(6,12,24,.6)", borderRadius: 16, zIndex: 5 }}>
          <div style={{ position: "sticky", top: 90, display: "flex", justifyContent: "center", padding: "40px 20px" }}>
            <div style={{ textAlign: "center", padding: 28, maxWidth: 340 }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>⬆️</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 16, lineHeight: 1.4 }}>
                {t("Upload the Data First in Upload Page to open the Features")}
              </div>
              <Link href="/upload" className="btn-gold" style={{ display: "inline-block", padding: "10px 26px", borderRadius: 10, textDecoration: "none", fontWeight: 700 }}>
                {t("Go to Upload Page")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
