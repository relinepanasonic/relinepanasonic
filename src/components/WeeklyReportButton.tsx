"use client";
import { useState } from "react";
import { createPortal } from "react-dom";

// "Send weekly report to client group (Oli)": preview first (image, week, group, caption in a confirm dialog), then Send.
// Both steps call OUR route /api/wa-weekly, which calls the ERP on the server (the key never reaches the browser).
// No automatic retry: every click is one request; "Send again" is the admin's deliberate second click and repeats the call with resend: true.

type Preview = { client?: string; label?: string; week?: { from: string; to: string }; group?: string; caption?: string; imageUrl?: string };
type Answer = Preview & { ok?: boolean; sent?: boolean; detail?: unknown; error?: string; message?: string; sentAt?: string };
type Action = "preview" | "send";

const NO_GROUP_TEXT = "This client has no WhatsApp group yet. Link it in the ERP (Optimizing > Clients)";
const JKT = "Asia/Jakarta";
const fmtDay = (d?: string) => { if (!d) return "—"; const t = new Date(d + "T00:00:00Z"); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const fmtWhen = (v: string | Date) => { const t = new Date(v); return Number.isNaN(t.getTime()) ? String(v) : t.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: JKT }) + " WIB"; };

export default function WeeklyReportButton({ store, week, compact = false }: { store: string; week?: string | null; compact?: boolean }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [noGroup, setNoGroup] = useState(false);
  const [dialog, setDialog] = useState<null | { mode: "preview" | "already"; data: Preview; sentAt?: string; resend: boolean; last: Action }>(null);
  const [err, setErr] = useState("");                    // shown inside the dialog while it is open, else next to the button
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [imgBad, setImgBad] = useState(false);

  async function call(action: Action, resend: boolean): Promise<{ status: number; a: Answer }> {
    const res = await fetch("/api/wa-weekly", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, ...(week ? { week } : {}), action, resend }),
    });
    const a = (await res.json().catch(() => ({}))) as Answer;
    return { status: res.status, a };
  }

  async function run(action: Action, resend: boolean, current?: Preview) {
    if (busy) return;                                   // one request at a time: a double click is not a second send
    setBusy(action); setErr("");
    try {
      const { status, a } = await call(action, resend);
      if (status === 409 && a.error === "no_group") { setNoGroup(true); setDialog(null); return; }
      if (status === 409 && a.error === "already_sent") { setDialog({ mode: "already", data: current || {}, sentAt: a.sentAt, resend: true, last: action }); return; }
      if (status === 200 && a.ok && action === "preview") { setImgBad(false); setDialog({ mode: "preview", data: a, resend, last: "preview" }); return; }
      if (status === 200 && a.ok && action === "send") { setSentAt(new Date()); setDialog(null); return; }
      setErr(a.message || (a.error === "no_data" ? "No numbers for this dealer and week yet. Upload first." : `Could not complete (${a.error || status}).`));
    } catch {
      setErr("The request failed. Check your connection; if you were sending, check WhatsApp before pressing Send again.");
    } finally { setBusy(null); }
  }

  const close = () => { if (!busy) { setDialog(null); setErr(""); } };
  const pad = compact ? "6px 12px" : "10px 22px";

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button className="btn-gold" disabled={!!busy || noGroup || !store} onClick={() => run("preview", false)} style={{ padding: pad, fontSize: compact ? 12 : undefined, whiteSpace: "nowrap" }}
        title="Send weekly report to client group (Oli)">
        {busy === "preview" ? "Preparing…" : compact ? "Send to group (Oli)" : "Send weekly report to client group (Oli)"}
      </button>
      {noGroup && <div style={{ fontSize: 12, color: "#fbbf24", maxWidth: 300 }}>{NO_GROUP_TEXT}</div>}
      {sentAt && !dialog && <div style={{ fontSize: 12, color: "#4ade80" }}>✓ Sent {fmtWhen(sentAt)}</div>}
      {err && !dialog && <div style={{ fontSize: 12, color: "#f87171", maxWidth: 300 }}>{err}</div>}

      {dialog && typeof document !== "undefined" && createPortal(
        <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(2,6,16,.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "4vh 12px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(13,26,54,.98)", border: "1px solid rgba(201,162,39,.28)", borderRadius: 18, padding: 22, width: "min(640px, 100%)", boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
            {dialog.mode === "already" ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Already sent</div>
                <div style={{ fontSize: 14, color: "var(--text-2)" }}>Already sent on <b style={{ color: "#fff" }}>{dialog.sentAt ? fmtWhen(dialog.sentAt) : "an earlier date"}</b>{store ? <> for <b style={{ color: "#fff" }}>{store}</b></> : null}.</div>
                {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                  <button className="btn-ghost" disabled={!!busy} onClick={close}>Close</button>
                  <button className="btn-gold" disabled={!!busy} onClick={() => run(dialog.last, true, dialog.data)} style={{ padding: "10px 22px" }}>{busy ? "Working…" : "Send again"}</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>Send weekly report to client group</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Check the report, then press Send. Nothing is sent before that.</div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 13.5, marginBottom: 12 }}>
                  <span style={{ color: "var(--muted)" }}>Store</span><b style={{ color: "#fff" }}>{dialog.data.label || store}</b>
                  {dialog.data.client && <><span style={{ color: "var(--muted)" }}>Client</span><span style={{ color: "var(--text-2)" }}>{dialog.data.client}</span></>}
                  <span style={{ color: "var(--muted)" }}>Week</span><b style={{ color: "#fff" }}>{fmtDay(dialog.data.week?.from)} – {fmtDay(dialog.data.week?.to)}</b>
                  <span style={{ color: "var(--muted)" }}>WhatsApp group</span><b style={{ color: "var(--gold)" }}>{dialog.data.group || "—"}</b>
                </div>
                {dialog.data.imageUrl && !imgBad && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={dialog.data.imageUrl} alt="Weekly report" onError={() => setImgBad(true)} style={{ display: "block", maxWidth: "100%", maxHeight: "52vh", margin: "0 auto 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.2)", background: "#fff" }} />
                )}
                {imgBad && <div style={{ fontSize: 12.5, color: "#fbbf24", marginBottom: 12 }}>The preview image could not be loaded (its link is valid for 1 hour). Close this and press the button again.</div>}
                {dialog.data.caption && (
                  <div style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "pre-wrap", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "10px 12px", maxHeight: 160, overflowY: "auto" }}>{dialog.data.caption}</div>
                )}
                {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button className="btn-ghost" disabled={!!busy} onClick={close}>Cancel</button>
                  <button className="btn-gold" disabled={!!busy || imgBad} onClick={() => run("send", dialog.resend, dialog.data)} style={{ padding: "10px 26px" }}>{busy === "send" ? "Sending…" : "Send"}</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
