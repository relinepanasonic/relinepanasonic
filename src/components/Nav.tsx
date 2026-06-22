"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Nav({ role }: { role?: string }) {
  const router = useRouter();
  const path = usePathname();
  const canUpload = role === "superadmin" || role === "client_admin";

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const navLink = (href: string, label: string) => {
    const active = path === href;
    return (
      <Link
        href={href}
        className="relative px-3 py-1.5 text-sm font-medium rounded-lg transition-all"
        style={{
          color: active ? "#c9a227" : "#94a3b8",
          background: active ? "rgba(201,162,39,0.1)" : "transparent",
        }}
      >
        {label}
        {active && (
          <span style={{
            position: "absolute", bottom: -1, left: "50%", transform: "translateX(-50%)",
            width: 16, height: 2, borderRadius: 1,
            background: "linear-gradient(90deg, #c9a227, #e8c84a)",
          }} />
        )}
      </Link>
    );
  };

  return (
    <header style={{
      background: "rgba(10,22,40,0.95)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      position: "sticky", top: 0, zIndex: 50,
    }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "linear-gradient(135deg, #1a3461, #0a1628)",
            border: "1.5px solid rgba(201,162,39,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="rgba(201,162,39,0.2)" stroke="#c9a227" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-bold tracking-wide" style={{ color: "#e8edf8" }}>
            ProfTokoOnline
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {navLink("/", "Dashboard")}
          {canUpload && navLink("/upload", "Upload")}
        </nav>

        {/* Sign out */}
        <button
          onClick={signOut}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
          style={{
            color: "#7b8db0",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#c9a227";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(201,162,39,0.3)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#7b8db0";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.07)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
          Sign Out
        </button>
      </div>
    </header>
  );
}
