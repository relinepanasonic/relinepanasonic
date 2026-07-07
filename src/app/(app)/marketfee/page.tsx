"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { MONTH_LIST } from "@/lib/parse";

export const dynamic = "force-dynamic";

type Fee = {
  id: string; category: string; sub_category: string | null; jenis_product: string | null;
  platform: string; jenis_toko: string | null;
  platform_fee_pct: number; komisi_dinamic_pct: number;
  updated_by: string | null; updated_month: string | null;
};
type EditLog = { id: string; edited_by: string; edited_month: string; platform_fee_pct: number | null; komisi_dinamic_pct: number | null };

function currentMonthLabel(): string {
  const d = new Date();
  return `${MONTH_LIST[d.getMonth()]} ${d.getFullYear()}`;
}

export default function MarketFeePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [myName, setMyName] = useState("");
  const [rows, setRows] = useState<Fee[]>([]);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [historyFor, setHistoryFor] = useState<Fee | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setRows([]); return; }
    const { data } = await supabase.from("market_fees").select("*").eq("client_id", cid).order("category").order("sub_category");
    setRows((data as Fee[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, display_name, email, client_id").eq("id", user.id).single();
      const role = profile?.role;
      setCanEdit(role === "superadmin" || role === "client_admin");
      setMyName(profile?.display_name || profile?.email?.split("@")[0] || "Admin");

      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = profile?.client_id || (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      reload(cid);
    })();
  }, [supabase, reload]);

  async function saveFee(fee: Fee, platform_fee_pct: number, komisi_dinamic_pct: number) {
    const month = currentMonthLabel();
    const { error } = await supabase.from("market_fees").update({
      platform_fee_pct, komisi_dinamic_pct, updated_by: myName, updated_month: month,
    }).eq("id", fee.id);
    if (error) { alert(error.message); return; }
    await supabase.from("market_fee_edits").insert({
      fee_id: fee.id, edited_by: myName, edited_month: month, platform_fee_pct, komisi_dinamic_pct,
    });
    reload(clientId);
  }

  async function addFee(row: Omit<Fee, "id" | "updated_by" | "updated_month">) {
    const { error } = await supabase.from("market_fees").insert({
      client_id: clientId,
      ...row,
      sub_category: row.sub_category?.trim() || null,
      jenis_product: row.jenis_product?.trim() || null,
      jenis_toko: row.jenis_toko?.trim() || null,
    });
    if (error) { alert(error.message); return; }
    setShowAdd(false);
    reload(clientId);
  }

  async function delFee(id: string) {
    if (!confirm("Delete this fee entry?")) return;
    await supabase.from("market_fees").delete().eq("id", id);
    reload(clientId);
  }

  async function openHistory(fee: Fee) {
    setHistoryFor(fee);
  }

  const platforms = useMemo(() => Array.from(new Set(rows.map((r) => r.platform).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (platformFilter && r.platform !== platformFilter) return false;
      if (!q) return true;
      return [r.category, r.sub_category, r.jenis_product, r.platform, r.jenis_toko]
        .filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, search, platformFilter]);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div>
          <h3 style={{ margin: 0 }}>Market Place Fee</h3>
          <div className="hint">Platform fee per category — Platform Fee % and Komisi Dinamic / Gratis Ongkir % are editable{canEdit ? "" : " (admin only)"}.</div>
        </div>
        {canEdit && <button className="btn-gold" onClick={() => setShowAdd(true)}>+ Add Fee</button>}
      </div>

      <div className="filterbar" style={{ marginTop: 14, marginBottom: 4 }}>
        <div className="fld" style={{ minWidth: 260 }}>
          <label>Search</label>
          <input type="text" placeholder="Category / Sub Category / Product / Jenis Toko"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={inputStyle} />
        </div>
        <div className="fld">
          <label>Platform</label>
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
            <option value="">All Platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="tbl-wrap" style={{ marginTop: 14 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Category</th><th>Sub Category</th><th>Jenis Product</th><th>Platform</th><th>Jenis Toko</th>
              <th className="num">Platform Fee</th><th className="num">Komisi Dinamic / Gratis Ongkir</th>
              <th>Last Edited</th>{canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <FeeRow key={r.id} fee={r} canEdit={canEdit} onSave={saveFee} onDelete={delFee} onHistory={openHistory} />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 8 : 7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                {rows.length ? "No fees match these filters" : "No fee entries yet"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddFeeModal onAdd={addFee} onClose={() => setShowAdd(false)} />}
      {historyFor && <HistoryModal fee={historyFor} supabase={supabase} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function FeeRow({ fee, canEdit, onSave, onDelete, onHistory }: {
  fee: Fee; canEdit: boolean;
  onSave: (fee: Fee, platformFee: number, komisi: number) => void;
  onDelete: (id: string) => void;
  onHistory: (fee: Fee) => void;
}) {
  const [platformFee, setPlatformFee] = useState(String(fee.platform_fee_pct));
  const [komisi, setKomisi] = useState(String(fee.komisi_dinamic_pct));

  function commit() {
    const pf = Number(platformFee) || 0;
    const kd = Number(komisi) || 0;
    if (pf === fee.platform_fee_pct && kd === fee.komisi_dinamic_pct) return;
    onSave(fee, pf, kd);
  }

  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{fee.category}</td>
      <td>{fee.sub_category || "—"}</td>
      <td style={{ maxWidth: 260, fontSize: 12 }}>{fee.jenis_product || "—"}</td>
      <td>{fee.platform}</td>
      <td>{fee.jenis_toko || "—"}</td>
      <td className="num">
        {canEdit ? (
          <PctInput value={platformFee} onChange={setPlatformFee} onBlur={commit} />
        ) : `${fee.platform_fee_pct}%`}
      </td>
      <td className="num">
        {canEdit ? (
          <PctInput value={komisi} onChange={setKomisi} onBlur={commit} />
        ) : `${fee.komisi_dinamic_pct}%`}
      </td>
      <td style={{ fontSize: 11.5, color: "var(--muted)" }}>
        {fee.updated_by ? (
          <button onClick={() => onHistory(fee)} style={linkBtnStyle}>{fee.updated_by} · {fee.updated_month}</button>
        ) : "—"}
      </td>
      {canEdit && <td><button onClick={() => onDelete(fee.id)} style={delBtnStyle}>Delete</button></td>}
    </tr>
  );
}

function PctInput({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
      <input type="number" step="0.01" value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={{ width: 70, textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 13 }} />
      <span style={{ color: "var(--muted)" }}>%</span>
    </span>
  );
}

function AddFeeModal({ onAdd, onClose }: {
  onAdd: (row: Omit<Fee, "id" | "updated_by" | "updated_month">) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState({ category: "", sub_category: "", jenis_product: "", platform: "", jenis_toko: "", platform_fee_pct: 0, komisi_dinamic_pct: 0 });
  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px" }}>Add Market Place Fee</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ModalField label="Category"><input style={inputStyle} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></ModalField>
          <ModalField label="Sub Category"><input style={inputStyle} value={f.sub_category} onChange={(e) => setF({ ...f, sub_category: e.target.value })} /></ModalField>
          <ModalField label="Jenis Product" full><input style={inputStyle} value={f.jenis_product} onChange={(e) => setF({ ...f, jenis_product: e.target.value })} /></ModalField>
          <ModalField label="Platform"><input style={inputStyle} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /></ModalField>
          <ModalField label="Jenis Toko"><input style={inputStyle} value={f.jenis_toko} onChange={(e) => setF({ ...f, jenis_toko: e.target.value })} /></ModalField>
          <ModalField label="Platform Fee %"><input type="number" step="0.01" style={inputStyle} value={f.platform_fee_pct} onChange={(e) => setF({ ...f, platform_fee_pct: Number(e.target.value) })} /></ModalField>
          <ModalField label="Komisi Dinamic %"><input type="number" step="0.01" style={inputStyle} value={f.komisi_dinamic_pct} onChange={(e) => setF({ ...f, komisi_dinamic_pct: Number(e.target.value) })} /></ModalField>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-gold" disabled={!f.category || !f.platform} onClick={() => onAdd(f)}>Add</button>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function HistoryModal({ fee, supabase, onClose }: { fee: Fee; supabase: ReturnType<typeof createClient>; onClose: () => void }) {
  const [rows, setRows] = useState<EditLog[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("market_fee_edits").select("*").eq("fee_id", fee.id).order("created_at", { ascending: false });
      setRows((data as EditLog[]) || []);
    })();
  }, [fee.id, supabase]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Edit History — {fee.category}{fee.sub_category ? ` · ${fee.sub_category}` : ""}</h3>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        {rows === null ? <div style={{ color: "var(--muted)" }}>Loading…</div> : (
          <div className="tbl-wrap" style={{ maxHeight: 360 }}>
            <table className="tbl">
              <thead><tr><th>Month</th><th>Edited By</th><th className="num">Platform Fee</th><th className="num">Komisi Dinamic</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.edited_month}</td>
                    <td>{r.edited_by}</td>
                    <td className="num">{r.platform_fee_pct}%</td>
                    <td className="num">{r.komisi_dinamic_pct}%</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No edits yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%", boxSizing: "border-box" };
const linkBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11.5, padding: 0, textDecoration: "underline dotted" };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const dialog: React.CSSProperties = { width: "min(96vw,640px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
