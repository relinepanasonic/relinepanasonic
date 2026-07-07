"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { MONTH_LIST } from "@/lib/parse";

export const dynamic = "force-dynamic";

type Fee = {
  id: string; category: string; sub_category: string | null; jenis_product: string | null;
  platform: string; jenis_toko: string | null;
  platform_fee_pct: number; biaya_proses_pesanan_rp: number; biaya_layanan_mall_pct: number;
  kategori_kirim: string | null;
  min_gratis_ongkir_biasa_pct: number; max_gratis_ongkir_biasa_rp: number;
  min_gratis_ongkir_khusus_pct: number; max_gratis_ongkir_khusus_rp: number;
  min_promo_xtra_pct: number; max_promo_xtra_pct: number;
  spaylater_xtra_3mo_pct: number; spaylater_xtra_6mo_pct: number;
  updated_by: string | null; updated_month: string | null;
};
type NumericField = Exclude<keyof Fee,
  "id" | "category" | "sub_category" | "jenis_product" | "platform" | "jenis_toko" | "kategori_kirim" | "updated_by" | "updated_month">;
type EditLog = { id: string; edited_by: string; edited_month: string } & Record<NumericField, number | null>;

const NUMERIC_FIELDS: { key: NumericField; label: string; unit: "%" | "Rp" }[] = [
  { key: "platform_fee_pct", label: "Platform Fee", unit: "%" },
  { key: "biaya_proses_pesanan_rp", label: "Biaya Proses Pesanan", unit: "Rp" },
  { key: "biaya_layanan_mall_pct", label: "Biaya Layanan Mall", unit: "%" },
  { key: "min_gratis_ongkir_biasa_pct", label: "Min Gratis Ongkir (Uk Biasa)", unit: "%" },
  { key: "max_gratis_ongkir_biasa_rp", label: "Max Gratis Ongkir (Uk Biasa)", unit: "Rp" },
  { key: "min_gratis_ongkir_khusus_pct", label: "Min Gratis Ongkir (Uk Khusus)", unit: "%" },
  { key: "max_gratis_ongkir_khusus_rp", label: "Max Gratis Ongkir (Uk Khusus)", unit: "Rp" },
  { key: "min_promo_xtra_pct", label: "Min Promo Xtra | XBP", unit: "%" },
  { key: "max_promo_xtra_pct", label: "Max Promo Xtra | XBP", unit: "%" },
  { key: "spaylater_xtra_3mo_pct", label: "Shopee Paylater Xtra 3 bln", unit: "%" },
  { key: "spaylater_xtra_6mo_pct", label: "Shopee Paylater Xtra 6 bln", unit: "%" },
];

const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

function currentMonthLabel(): string {
  const d = new Date();
  return `${MONTH_LIST[d.getMonth()]} ${d.getFullYear()}`;
}

async function fetchAllFees(supabase: ReturnType<typeof createClient>, clientId: string): Promise<Fee[]> {
  const PAGE = 1000;
  let from = 0;
  let all: Fee[] = [];
  for (;;) {
    const { data, error } = await supabase.from("market_fees").select("*").eq("client_id", clientId)
      .order("category").order("sub_category").range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    all = all.concat(data as Fee[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function MarketFeePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [myName, setMyName] = useState("");
  const [rows, setRows] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [detailFor, setDetailFor] = useState<Fee | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setRows(await fetchAllFees(supabase, cid));
    setLoading(false);
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

  async function saveFee(fee: Fee, patch: Partial<Record<NumericField, number>>) {
    const month = currentMonthLabel();
    const { error } = await supabase.from("market_fees").update({
      ...patch, updated_by: myName, updated_month: month,
    }).eq("id", fee.id);
    if (error) { alert(error.message); return; }

    const merged = { ...fee, ...patch };
    const logEntry: Record<string, unknown> = { fee_id: fee.id, edited_by: myName, edited_month: month };
    for (const f of NUMERIC_FIELDS) logEntry[f.key] = merged[f.key];
    await supabase.from("market_fee_edits").insert(logEntry);

    reload(clientId);
    setDetailFor(null);
  }

  async function addFee(row: Omit<Fee, "id" | "updated_by" | "updated_month">) {
    const { error } = await supabase.from("market_fees").insert({
      client_id: clientId,
      ...row,
      sub_category: row.sub_category?.trim() || null,
      jenis_product: row.jenis_product?.trim() || null,
      jenis_toko: row.jenis_toko?.trim() || null,
      kategori_kirim: row.kategori_kirim?.trim() || null,
    });
    if (error) { alert(error.message); return; }
    setShowAdd(false);
    reload(clientId);
  }

  async function delFee(id: string) {
    if (!confirm("Delete this fee entry?")) return;
    await supabase.from("market_fees").delete().eq("id", id);
    setDetailFor(null);
    reload(clientId);
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
          <div className="hint">
            {rows.length.toLocaleString("id-ID")} entries · every fee number is editable{canEdit ? "" : " (admin only)"} — click a row to view/edit.
          </div>
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

      <div className="tbl-wrap" style={{ marginTop: 14, maxHeight: 560 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Category</th><th>Sub Category</th><th>Jenis Product</th><th>Platform</th><th>Jenis Toko</th>
              <th className="num">Platform Fee</th><th>Kategori Kirim</th><th>Last Edited</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setDetailFor(r)}>
                <td style={{ fontWeight: 600 }}>{r.category}</td>
                <td>{r.sub_category || "—"}</td>
                <td style={{ maxWidth: 260, fontSize: 12 }}>{r.jenis_product || "—"}</td>
                <td>{r.platform}</td>
                <td>{r.jenis_toko || "—"}</td>
                <td className="num">{r.platform_fee_pct}%</td>
                <td>{r.kategori_kirim || "—"}</td>
                <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.updated_by ? `${r.updated_by} · ${r.updated_month}` : "—"}</td>
                <td><span style={{ color: "var(--gold)", fontSize: 12 }}>{canEdit ? "Edit ›" : "View ›"}</span></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                {rows.length ? "No fees match these filters" : "No fee entries yet"}
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddFeeModal onAdd={addFee} onClose={() => setShowAdd(false)} />}
      {detailFor && (
        <DetailModal fee={detailFor} canEdit={canEdit} supabase={supabase}
          onSave={saveFee} onDelete={delFee} onClose={() => setDetailFor(null)} />
      )}
    </div>
  );
}

function DetailModal({ fee, canEdit, supabase, onSave, onDelete, onClose }: {
  fee: Fee; canEdit: boolean; supabase: ReturnType<typeof createClient>;
  onSave: (fee: Fee, patch: Partial<Record<NumericField, number>>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [values, setValues] = useState<Record<NumericField, string>>(() => {
    const v = {} as Record<NumericField, string>;
    for (const f of NUMERIC_FIELDS) v[f.key] = String(fee[f.key]);
    return v;
  });
  const [history, setHistory] = useState<EditLog[] | null>(null);

  useEffect(() => {
    if (tab !== "history") return;
    (async () => {
      const { data } = await supabase.from("market_fee_edits").select("*").eq("fee_id", fee.id).order("created_at", { ascending: false });
      setHistory((data as EditLog[]) || []);
    })();
  }, [tab, fee.id, supabase]);

  function commit() {
    const patch: Partial<Record<NumericField, number>> = {};
    for (const f of NUMERIC_FIELDS) patch[f.key] = Number(values[f.key]) || 0;
    onSave(fee, patch);
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0 }}>{fee.category}{fee.sub_category ? ` · ${fee.sub_category}` : ""}</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{fee.platform} · {fee.jenis_toko || "—"}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        {fee.jenis_product && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{fee.jenis_product}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 14, borderBottom: "1px solid var(--line)" }}>
          <TabBtn active={tab === "edit"} onClick={() => setTab("edit")}>{canEdit ? "Edit Numbers" : "Numbers"}</TabBtn>
          <TabBtn active={tab === "history"} onClick={() => setTab("history")}>Edit History</TabBtn>
        </div>

        {tab === "edit" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {NUMERIC_FIELDS.map((f) => (
                <div className="fld" key={f.key}>
                  <label>{f.label}</label>
                  {canEdit ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {f.unit === "Rp" && <span style={{ color: "var(--muted)" }}>Rp</span>}
                      <input type="number" step="0.01" value={values[f.key]}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        style={{ ...inputStyle, textAlign: "right" }} />
                      {f.unit === "%" && <span style={{ color: "var(--muted)" }}>%</span>}
                    </span>
                  ) : (
                    <div style={{ padding: "8px 10px" }}>{f.unit === "Rp" ? rpFull(fee[f.key]) : `${fee[f.key]}%`}</div>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 20 }}>
                <button onClick={() => onDelete(fee.id)} style={delBtnStyle}>Delete Entry</button>
                <button className="btn-gold" onClick={commit}>Save</button>
              </div>
            )}
          </>
        ) : (
          history === null ? <div style={{ color: "var(--muted)" }}>Loading…</div> : (
            <div className="tbl-wrap" style={{ maxHeight: 360 }}>
              <table className="tbl">
                <thead><tr><th>Month</th><th>Edited By</th><th className="num">Platform Fee</th><th className="num">Biaya Proses</th></tr></thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id}>
                      <td>{r.edited_month}</td>
                      <td>{r.edited_by}</td>
                      <td className="num">{r.platform_fee_pct}%</td>
                      <td className="num">{rpFull(r.biaya_proses_pesanan_rp || 0)}</td>
                    </tr>
                  ))}
                  {history.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No edits yet</td></tr>}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", borderBottom: `2px solid ${active ? "var(--gold)" : "transparent"}`,
      color: active ? "var(--gold)" : "var(--muted)", fontWeight: 700, fontSize: 13, padding: "8px 4px", cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

function AddFeeModal({ onAdd, onClose }: {
  onAdd: (row: Omit<Fee, "id" | "updated_by" | "updated_month">) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    category: "", sub_category: "", jenis_product: "", platform: "Shopee", jenis_toko: "", kategori_kirim: "",
    platform_fee_pct: 0, biaya_proses_pesanan_rp: 0, biaya_layanan_mall_pct: 0,
    min_gratis_ongkir_biasa_pct: 0, max_gratis_ongkir_biasa_rp: 0,
    min_gratis_ongkir_khusus_pct: 0, max_gratis_ongkir_khusus_rp: 0,
    min_promo_xtra_pct: 0, max_promo_xtra_pct: 0,
    spaylater_xtra_3mo_pct: 0, spaylater_xtra_6mo_pct: 0,
  });
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
          <ModalField label="Kategori Kirim"><input style={inputStyle} value={f.kategori_kirim} onChange={(e) => setF({ ...f, kategori_kirim: e.target.value })} /></ModalField>
          {NUMERIC_FIELDS.map((nf) => (
            <ModalField label={nf.label} key={nf.key}>
              <input type="number" step="0.01" style={inputStyle} value={f[nf.key]} onChange={(e) => setF({ ...f, [nf.key]: Number(e.target.value) })} />
            </ModalField>
          ))}
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

const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%", boxSizing: "border-box" };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "8px 16px", cursor: "pointer", fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const dialog: React.CSSProperties = { width: "min(96vw,720px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
