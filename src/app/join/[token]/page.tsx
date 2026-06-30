"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Invite = { owner_name: string; store_name: string | null; role: string; username?: string | null };

const ROLE_LABEL: Record<string, string> = {
  superadmin:     "Superadmin",
  pic_panasonic:  "PIC Panasonic",
  branch_manager: "Dealer Owner",
  client_admin:   "Admin",
  store_user:     "Store",
  advertiser:     "Advertiser",
};

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [invite, setInvite]     = useState<Invite | null>(null);
  const [loadErr, setLoadErr]   = useState("");
  const [form, setForm]         = useState({ email: "", username: "", phone: "", password: "", confirm: "" });
  const [usernameLocked, setUsernameLocked] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [err,  setErr]          = useState("");
  const [done, setDone]         = useState(false);

  useEffect(() => {
    fetch(`/api/join?token=${token}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setLoadErr(j.error); return; }
        const inv = j.invite as Invite;
        setInvite(inv);
        if (inv.username) { setForm((f) => ({ ...f, username: inv.username! })); setUsernameLocked(true); }
      })
      .catch(() => setLoadErr("Failed to load invite"));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (form.password !== form.confirm) { setErr("Passwords do not match"); return; }
    if (form.password.length < 6)       { setErr("Password must be at least 6 characters"); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(form.username)) { setErr("Username: letters, numbers, _ . - only"); return; }
    setBusy(true);
    const res = await fetch("/api/join", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email: form.email, username: form.username, phone: form.phone, password: form.password }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error || "Registration failed"); setBusy(false); return; }

    // Auto sign-in
    const supabase = createClient();
    await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    setDone(true);
    setTimeout(() => router.replace("/"), 1800);
  }

  const field: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 10,
    border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)",
    color: "#e8edf8", fontSize: 13, outline: "none",
  };

  function EyeBtn({ show, toggle }: { show: boolean; toggle: () => void }) {
    return (
      <button type="button" tabIndex={-1} onClick={toggle}
        style={{ position:"absolute", right:11, top:"50%", transform:"translateY(-50%)",
                 background:"none", border:"none", cursor:"pointer", color:"#7b8db0", padding:0, lineHeight:1 }}>
        {show ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #1a3461 100%)" }}>

      <div style={{ width: "100%", maxWidth: 420, background: "rgba(15,32,64,0.9)",
        border: "1px solid rgba(201,162,39,0.15)", borderRadius: 20, padding: 32,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>

        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <img src="/logo.jpg" alt="Reline" style={{ width: 80, height: 80, objectFit: "contain" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: "#e8edf8" }}>Reline</div>
            <div style={{ fontSize: 12, color: "#7b8db0", marginTop: 2 }}>Create your account</div>
          </div>
        </div>

        <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(201,162,39,0.3),transparent)", marginBottom: 20 }} />

        {!invite && !loadErr && (
          <div style={{ textAlign: "center", color: "#7b8db0", padding: "20px 0" }}>Loading…</div>
        )}

        {loadErr && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "14px 16px", color: "#fca5a5", textAlign: "center" }}>
            {loadErr}
          </div>
        )}

        {done && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ color: "#e8edf8", fontWeight: 600, marginBottom: 6 }}>Account created!</div>
            <div style={{ color: "#7b8db0", fontSize: 13 }}>Redirecting to dashboard…</div>
          </div>
        )}

        {invite && !done && (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
            {/* Pre-filled invite info */}
            <div style={{ background: "rgba(201,162,39,0.06)", border: "1px solid rgba(201,162,39,0.15)", borderRadius: 10, padding: "10px 14px", display: "grid", gap: 4 }}>
              {[
                ["Name",  invite.owner_name],
                ...(invite.store_name ? [["Store", invite.store_name]] : []),
                ["Role",  ROLE_LABEL[invite.role] || invite.role],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", gap: 8, fontSize: 13 }}>
                  <span style={{ color: "#7b8db0", minWidth: 44 }}>{l}:</span>
                  <span style={{ color: "#e8edf8", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            <Field label="Email">
              <input required type="email" autoComplete="email" placeholder="your@email.com"
                style={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={usernameLocked ? "Username (pre-set by admin)" : "Username"}>
              <input required type="text" autoComplete="username" placeholder="e.g. yunita_owner"
                style={{ ...field, ...(usernameLocked ? { opacity: 0.75 } : {}) }}
                readOnly={usernameLocked}
                value={form.username} onChange={(e) => !usernameLocked && setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Phone (optional)">
              <input type="tel" placeholder="08xxxxxxxxxx"
                style={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Password">
              <div style={{ position: "relative" }}>
                <input required type={showPass ? "text" : "password"} autoComplete="new-password"
                  placeholder="min 6 characters" style={{ ...field, paddingRight: 40 }}
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <EyeBtn show={showPass} toggle={() => setShowPass((v) => !v)} />
              </div>
            </Field>
            <Field label="Confirm Password">
              <div style={{ position: "relative" }}>
                <input required type={showConf ? "text" : "password"} autoComplete="new-password"
                  placeholder="repeat password" style={{ ...field, paddingRight: 40 }}
                  value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
                <EyeBtn show={showConf} toggle={() => setShowConf((v) => !v)} />
              </div>
            </Field>

            {err && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "10px 14px", color: "#fca5a5", fontSize: 13 }}>
                {err}
              </div>
            )}

            <button type="submit" disabled={busy}
              style={{ background: busy ? "rgba(201,162,39,0.5)" : "linear-gradient(135deg,#c9a227,#e8c84a)", color: "#0a1628", fontWeight: 700, fontSize: 14, border: "none", borderRadius: 10, padding: "11px 0", cursor: busy ? "default" : "pointer", boxShadow: busy ? "none" : "0 4px 20px rgba(201,162,39,0.3)", marginTop: 4 }}>
              {busy ? "Creating account…" : "Create Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7b8db0", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
