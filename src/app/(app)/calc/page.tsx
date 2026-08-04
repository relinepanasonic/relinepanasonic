"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Fee = {
  id: string; category: string; sub_category: string | null; jenis_product: string | null;
  platform: string; jenis_toko: string | null; kategori_kirim: string | null;
  platform_fee_pct: number; biaya_proses_pesanan_rp: number; biaya_layanan_mall_pct: number;
  min_gratis_ongkir_biasa_pct: number; max_gratis_ongkir_biasa_rp: number;
  min_gratis_ongkir_khusus_pct: number; max_gratis_ongkir_khusus_rp: number;
  min_promo_xtra_pct: number; max_promo_xtra_rp: number;
  spaylater_xtra_3mo_pct: number; spaylater_xtra_6mo_pct: number;
};

type CalcRow = {
  id: string; item_product: string | null;
  modal_produk_rp: number; harga_jual_rp: number;
  fee_id: string | null; target_roas: number;
  berat_kg: number; ukuran_cm3: number;
  gratis_ongkir_on: boolean; promo_xtra_on: boolean;
  paylater_3mo_on: boolean; paylater_6mo_on: boolean;
  biaya_lain_rp: number;
};

function formatRp(n: number): string { return Math.round(n || 0).toLocaleString("id-ID"); }
function parseRp(s: string): number { return Number(s.replace(/[^\d-]/g, "")) || 0; }
function feeLabel(f: Fee): string {
  return [f.category, f.sub_category, f.jenis_product, f.platform, f.jenis_toko].filter(Boolean).join(" · ");
}

// Mirrors the source sheet's math, verified against the user's own
// explanation rather than guessed: Total Biaya bundles every marketplace
// fee PLUS ad spend (so Profit already nets out ads); the seller types a
// target ROAS and Biaya Ads/% Ads are derived from it, not the other way
// round; Gratis Ongkir is min(pct% x Harga Jual, Rp cap), and for Shopee
// specifically the pct/cap pair switches from the "biasa" tier to the
// "khusus" tier once the product is over 5kg or 20,000 cm3 (Tiktok has no
// such tier split, it always uses the one pct/cap pair on the fee row).
function computeCalc(input: {
  hargaJual: number; modalProduk: number; targetRoas: number;
  beratKg: number; ukuranCm3: number;
  gratisOngkirOn: boolean; promoXtraOn: boolean; paylater3moOn: boolean; paylater6moOn: boolean;
  biayaLain: number;
}, fee: Fee | null) {
  const hargaJual = input.hargaJual;
  const platformFeeRp = ((fee?.platform_fee_pct ?? 0) / 100) * hargaJual;
  const biayaProsesRp = fee?.biaya_proses_pesanan_rp ?? 0;
  const biayaLayananRp = ((fee?.biaya_layanan_mall_pct ?? 0) / 100) * hargaJual;

  const isShopee = (fee?.platform || "").toLowerCase().includes("shopee");
  const isKhusus = isShopee && (input.beratKg > 5 || input.ukuranCm3 > 20000);
  const ongkirPct = isKhusus ? (fee?.min_gratis_ongkir_khusus_pct ?? 0) : (fee?.min_gratis_ongkir_biasa_pct ?? 0);
  const ongkirMaxRp = isKhusus ? (fee?.max_gratis_ongkir_khusus_rp ?? 0) : (fee?.max_gratis_ongkir_biasa_rp ?? 0);
  const biayaOngkir = input.gratisOngkirOn ? Math.min((ongkirPct / 100) * hargaJual, ongkirMaxRp) : 0;

  const promoXtraRp = input.promoXtraOn
    ? Math.min(((fee?.min_promo_xtra_pct ?? 0) / 100) * hargaJual, fee?.max_promo_xtra_rp ?? 0) : 0;
  const paylater3moRp = input.paylater3moOn ? ((fee?.spaylater_xtra_3mo_pct ?? 0) / 100) * hargaJual : 0;
  const paylater6moRp = input.paylater6moOn ? ((fee?.spaylater_xtra_6mo_pct ?? 0) / 100) * hargaJual : 0;

  const biayaAds = input.targetRoas > 0 ? hargaJual / input.targetRoas : 0;
  const pctAds = hargaJual > 0 ? (biayaAds / hargaJual) * 100 : 0;

  const totalBiaya = platformFeeRp + biayaProsesRp + biayaLayananRp + biayaOngkir
    + promoXtraRp + paylater3moRp + paylater6moRp + biayaAds + input.biayaLain;
  const profit = hargaJual - input.modalProduk - totalBiaya;
  const marginPct = hargaJual > 0 ? (profit / hargaJual) * 100 : null;

  return { platformFeeRp, biayaProsesRp, biayaLayananRp, isKhusus, biayaOngkir, promoXtraRp,
    paylater3moRp, paylater6moRp, biayaAds, pctAds, totalBiaya, profit, marginPct };
}

async function fetchAll<T>(supabase: ReturnType<typeof createClient>, table: string, clientId: string, order: string): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  let all: T[] = [];
  for (;;) {
    const { data, error } = await supabase.from(table).select("*").eq("client_id", clientId)
      .order(order).range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function MassiveCalculatorPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [myName, setMyName] = useState("");
  const [fees, setFees] = useState<Fee[]>([]);
  const [rows, setRows] = useState<CalcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const feesById = useMemo(() => new Map(fees.map((f) => [f.id, f])), [fees]);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setRows([]); setFees([]); setLoading(false); return; }
    setLoading(true);
    const [f, r] = await Promise.all([
      fetchAll<Fee>(supabase, "market_fees", cid, "category"),
      fetchAll<CalcRow>(supabase, "massive_calc_rows", cid, "created_at"),
    ]);
    setFees(f);
    setRows(r);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("display_name, email, client_id").eq("id", user.id).single();
      setMyName(profile?.display_name || profile?.email?.split("@")[0] || "User");
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = profile?.client_id || (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      reload(cid);
    })();
  }, [supabase, reload]);

  async function addRow() {
    if (!clientId) return;
    setAdding(true);
    const { error } = await supabase.from("massive_calc_rows").insert({ client_id: clientId, created_by: myName });
    setAdding(false);
    if (error) { alert(error.message); return; }
    reload(clientId);
  }

  async function saveRow(id: string, patch: Partial<CalcRow>) {
    const { error } = await supabase.from("massive_calc_rows").update(patch).eq("id", id);
    if (error) { alert(error.message); return; }
    reload(clientId);
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this row?")) return;
    await supabase.from("massive_calc_rows").delete().eq("id", id);
    reload(clientId);
  }

  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
        .calc-tbl td, .calc-tbl th{white-space:nowrap}
        .calc-ro{color:var(--muted);font-size:12px}
      `}</style>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <span className="mode-tab on">Massive Calculator</span>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0 }}>Massive Calculator</h3>
            <div className="hint">{rows.length.toLocaleString("id-ID")} product rows · pick a product's fee row, fill in price and weight, Total Biaya / Profit update live.</div>
          </div>
          <button className="btn-gold" disabled={adding || !clientId} onClick={addRow}>{adding ? "Adding…" : "+ Add Product"}</button>
        </div>

        <div className="tbl-wrap" style={{ marginTop: 14, maxHeight: 640, overflowX: "auto", overflowY: "auto" }}>
          <table className="tbl calc-tbl" style={{ width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={stickyTh}>No</th>
                <th style={stickyTh}>Item Product</th>
                <th style={stickyTh}>Product / Fee Link</th>
                <th className="num" style={stickyTh}>Modal Produk</th>
                <th className="num" style={stickyTh}>Harga Jual</th>
                <th className="num" style={stickyTh}>Total Biaya</th>
                <th className="num" style={stickyTh}>Profit</th>
                <th className="num" style={stickyTh}>Margin %</th>
                <th className="num" style={stickyTh}>Target ROAS</th>
                <th className="num" style={stickyTh}>% Ads</th>
                <th className="num" style={stickyTh}>Biaya Ads</th>
                <th className="num" style={stickyTh}>Platform Fee %</th>
                <th className="num" style={stickyTh}>Platform Fee Rp</th>
                <th className="num" style={stickyTh}>Biaya Proses Pesanan</th>
                <th className="num" style={stickyTh}>Biaya Layanan Mall %</th>
                <th className="num" style={stickyTh}>Biaya Layanan Mall Rp</th>
                <th style={stickyTh}>Gratis Ongkir</th>
                <th className="num" style={stickyTh}>Berat (kg)</th>
                <th className="num" style={stickyTh}>Uk PxLxT (cm³)</th>
                <th className="num" style={stickyTh}>Biaya Ongkir</th>
                <th style={stickyTh}>Promo Xtra</th>
                <th className="num" style={stickyTh}>Promo Xtra Rp</th>
                <th style={stickyTh}>Paylater 3 Bln</th>
                <th className="num" style={stickyTh}>Paylater 3mo Rp</th>
                <th style={stickyTh}>Paylater 6 Bln</th>
                <th className="num" style={stickyTh}>Paylater 6mo Rp</th>
                <th className="num" style={stickyTh}>Biaya Lain</th>
                <th style={stickyTh}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <CalcRowLine key={r.id} no={i + 1} row={r} fee={r.fee_id ? feesById.get(r.fee_id) ?? null : null}
                  onSave={saveRow} onDelete={deleteRow} onPick={() => setPickerFor(r.id)} />
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={28} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No product rows yet — click “+ Add Product” to start.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={28} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pickerFor && (
          <FeePickerModal fees={fees}
            onPick={(fee) => { saveRow(pickerFor, { fee_id: fee.id }); setPickerFor(null); }}
            onClose={() => setPickerFor(null)} />
        )}
      </div>
    </>
  );
}

function CalcRowLine({ no, row, fee, onSave, onDelete, onPick }: {
  no: number; row: CalcRow; fee: Fee | null;
  onSave: (id: string, patch: Partial<CalcRow>) => void;
  onDelete: (id: string) => void;
  onPick: () => void;
}) {
  const [v, setV] = useState(() => ({
    item_product: row.item_product || "",
    modal_produk_rp: formatRp(row.modal_produk_rp),
    harga_jual_rp: formatRp(row.harga_jual_rp),
    target_roas: String(row.target_roas || ""),
    berat_kg: String(row.berat_kg || ""),
    ukuran_cm3: String(row.ukuran_cm3 || ""),
    biaya_lain_rp: formatRp(row.biaya_lain_rp),
    gratis_ongkir_on: row.gratis_ongkir_on,
    promo_xtra_on: row.promo_xtra_on,
    paylater_3mo_on: row.paylater_3mo_on,
    paylater_6mo_on: row.paylater_6mo_on,
  }));

  const parsed = {
    item_product: v.item_product,
    modal_produk_rp: parseRp(v.modal_produk_rp),
    harga_jual_rp: parseRp(v.harga_jual_rp),
    target_roas: Number(v.target_roas) || 0,
    berat_kg: Number(v.berat_kg) || 0,
    ukuran_cm3: Number(v.ukuran_cm3) || 0,
    biaya_lain_rp: parseRp(v.biaya_lain_rp),
    gratis_ongkir_on: v.gratis_ongkir_on,
    promo_xtra_on: v.promo_xtra_on,
    paylater_3mo_on: v.paylater_3mo_on,
    paylater_6mo_on: v.paylater_6mo_on,
  };
  const dirty = parsed.item_product !== (row.item_product || "")
    || parsed.modal_produk_rp !== row.modal_produk_rp
    || parsed.harga_jual_rp !== row.harga_jual_rp
    || parsed.target_roas !== row.target_roas
    || parsed.berat_kg !== row.berat_kg
    || parsed.ukuran_cm3 !== row.ukuran_cm3
    || parsed.biaya_lain_rp !== row.biaya_lain_rp
    || parsed.gratis_ongkir_on !== row.gratis_ongkir_on
    || parsed.promo_xtra_on !== row.promo_xtra_on
    || parsed.paylater_3mo_on !== row.paylater_3mo_on
    || parsed.paylater_6mo_on !== row.paylater_6mo_on;

  const calc = computeCalc({
    hargaJual: parsed.harga_jual_rp, modalProduk: parsed.modal_produk_rp, targetRoas: parsed.target_roas,
    beratKg: parsed.berat_kg, ukuranCm3: parsed.ukuran_cm3,
    gratisOngkirOn: parsed.gratis_ongkir_on, promoXtraOn: parsed.promo_xtra_on,
    paylater3moOn: parsed.paylater_3mo_on, paylater6moOn: parsed.paylater_6mo_on,
    biayaLain: parsed.biaya_lain_rp,
  }, fee);

  function save() { onSave(row.id, parsed); }
  function reset() {
    setV({
      item_product: row.item_product || "", modal_produk_rp: formatRp(row.modal_produk_rp), harga_jual_rp: formatRp(row.harga_jual_rp),
      target_roas: String(row.target_roas || ""), berat_kg: String(row.berat_kg || ""), ukuran_cm3: String(row.ukuran_cm3 || ""),
      biaya_lain_rp: formatRp(row.biaya_lain_rp), gratis_ongkir_on: row.gratis_ongkir_on, promo_xtra_on: row.promo_xtra_on,
      paylater_3mo_on: row.paylater_3mo_on, paylater_6mo_on: row.paylater_6mo_on,
    });
  }

  const txt = (val: string, onChange: (s: string) => void, width: number) => (
    <input type="text" value={val} onChange={(e) => onChange(e.target.value)}
      style={{ width, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5, textAlign: "right" }} />
  );

  return (
    <tr style={dirty ? { background: "rgba(201,162,39,.06)" } : undefined}>
      <td>{no}</td>
      <td>
        <input type="text" value={v.item_product} onChange={(e) => setV((s) => ({ ...s, item_product: e.target.value }))}
          placeholder="Product name" style={{ width: 160, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 }} />
      </td>
      <td style={{ maxWidth: 240, whiteSpace: "normal", fontSize: 12 }}>
        {fee ? <span title={feeLabel(fee)}>{feeLabel(fee)}</span> : <span className="calc-ro">— no fee linked —</span>}
        <div><button onClick={onPick} className="btn-ghost" style={{ padding: "2px 8px", fontSize: 11, marginTop: 4 }}>{fee ? "Change" : "Pick Product"}</button></div>
      </td>
      <td className="num">Rp {txt(v.modal_produk_rp, (s) => setV((st) => ({ ...st, modal_produk_rp: formatRp(parseRp(s)) })), 90)}</td>
      <td className="num">Rp {txt(v.harga_jual_rp, (s) => setV((st) => ({ ...st, harga_jual_rp: formatRp(parseRp(s)) })), 90)}</td>
      <td className="num" style={{ fontWeight: 700 }}>Rp {formatRp(calc.totalBiaya)}</td>
      <td className="num" style={{ fontWeight: 700, color: calc.profit >= 0 ? "var(--gold)" : "#ff9a9a" }}>Rp {formatRp(calc.profit)}</td>
      <td className="num calc-ro">{calc.marginPct === null ? "—" : `${calc.marginPct.toFixed(1)}%`}</td>
      <td className="num">{txt(v.target_roas, (s) => setV((st) => ({ ...st, target_roas: s.replace(/[^\d.]/g, "") })), 60)}</td>
      <td className="num calc-ro">{calc.pctAds.toFixed(1)}%</td>
      <td className="num calc-ro">Rp {formatRp(calc.biayaAds)}</td>
      <td className="num calc-ro">{fee ? `${fee.platform_fee_pct}%` : "—"}</td>
      <td className="num calc-ro">Rp {formatRp(calc.platformFeeRp)}</td>
      <td className="num calc-ro">Rp {formatRp(calc.biayaProsesRp)}</td>
      <td className="num calc-ro">{fee ? `${fee.biaya_layanan_mall_pct}%` : "—"}</td>
      <td className="num calc-ro">Rp {formatRp(calc.biayaLayananRp)}</td>
      <td><input type="checkbox" checked={v.gratis_ongkir_on} onChange={(e) => setV((s) => ({ ...s, gratis_ongkir_on: e.target.checked }))} /> {calc.isKhusus ? <span className="calc-ro">khusus</span> : <span className="calc-ro">biasa</span>}</td>
      <td className="num">{txt(v.berat_kg, (s) => setV((st) => ({ ...st, berat_kg: s.replace(/[^\d.]/g, "") })), 55)}</td>
      <td className="num">{txt(v.ukuran_cm3, (s) => setV((st) => ({ ...st, ukuran_cm3: s.replace(/[^\d.]/g, "") })), 70)}</td>
      <td className="num calc-ro">Rp {formatRp(calc.biayaOngkir)}</td>
      <td><input type="checkbox" checked={v.promo_xtra_on} onChange={(e) => setV((s) => ({ ...s, promo_xtra_on: e.target.checked }))} /></td>
      <td className="num calc-ro">Rp {formatRp(calc.promoXtraRp)}</td>
      <td><input type="checkbox" checked={v.paylater_3mo_on} onChange={(e) => setV((s) => ({ ...s, paylater_3mo_on: e.target.checked }))} /></td>
      <td className="num calc-ro">Rp {formatRp(calc.paylater3moRp)}</td>
      <td><input type="checkbox" checked={v.paylater_6mo_on} onChange={(e) => setV((s) => ({ ...s, paylater_6mo_on: e.target.checked }))} /></td>
      <td className="num calc-ro">Rp {formatRp(calc.paylater6moRp)}</td>
      <td className="num">Rp {txt(v.biaya_lain_rp, (s) => setV((st) => ({ ...st, biaya_lain_rp: formatRp(parseRp(s)) })), 80)}</td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          {dirty && <>
            <button onClick={save} style={saveBtnStyle}>Save</button>
            <button onClick={reset} className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>Cancel</button>
          </>}
          {!dirty && <button onClick={() => onDelete(row.id)} style={delBtnStyle}>Delete</button>}
        </div>
      </td>
    </tr>
  );
}

function FeePickerModal({ fees, onPick, onClose }: { fees: Fee[]; onPick: (fee: Fee) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return fees.filter((f) => feeLabel(f).toLowerCase().includes(query)).slice(0, 300);
  }, [fees, q]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Pick a Product / Fee Row</h3>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        <input type="text" autoFocus placeholder="Search category / sub category / product / platform / jenis toko…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
        <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid var(--card-border)", borderRadius: 10 }}>
          {q.trim().length < 2 && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Type at least 2 characters to search {fees.length.toLocaleString("id-ID")} fee entries.</div>}
          {q.trim().length >= 2 && matches.length === 0 && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No matches.</div>}
          {matches.map((f) => (
            <button key={f.id} onClick={() => onPick(f)} style={pickItemStyle}>
              <span style={{ fontWeight: 600 }}>{f.category}</span>
              <span className="calc-ro"> · {[f.sub_category, f.jenis_product, f.platform, f.jenis_toko].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {matches.length === 300 && <div style={{ padding: 10, color: "var(--muted)", fontSize: 12 }}>Showing first 300 matches — refine your search.</div>}
        </div>
      </div>
    </div>
  );
}

const stickyTh: React.CSSProperties = { position: "sticky", top: 0, zIndex: 1 };
const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%", boxSizing: "border-box" };
const saveBtnStyle: React.CSSProperties = { background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", border: "none", color: "var(--navy-deep)", borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const dialog: React.CSSProperties = { width: "min(96vw,640px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
const pickItemStyle: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid var(--line)", padding: "9px 12px", cursor: "pointer", color: "var(--text)", fontSize: 12.5 };
