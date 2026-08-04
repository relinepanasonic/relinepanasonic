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
  id: string; item_product: string | null; product_line: string | null;
  modal_produk_rp: number; harga_jual_rp: number;
  fee_id: string | null; target_roas: number;
  berat_kg: number; ukuran_cm3: number;
  gratis_ongkir_on: boolean; promo_xtra_on: boolean;
  paylater_3mo_on: boolean; paylater_6mo_on: boolean;
  biaya_lain_rp: number;
};

type FeeSel = { category: string; sub_category: string; jenis_product: string; platform: string; jenis_toko: string };
const FEE_FIELDS: (keyof FeeSel)[] = ["category", "sub_category", "jenis_product", "platform", "jenis_toko"];
const emptySel: FeeSel = { category: "", sub_category: "", jenis_product: "", platform: "", jenis_toko: "" };

function selFromFee(f: Fee | null): FeeSel {
  if (!f) return emptySel;
  return { category: f.category, sub_category: f.sub_category ?? "", jenis_product: f.jenis_product ?? "", platform: f.platform, jenis_toko: f.jenis_toko ?? "" };
}
// Every dropdown filters against the OTHER four current selections (any
// pick order works, not just left-to-right), and if narrowing the field
// down leaves exactly one possible value, auto-fill it -- otherwise
// picking all 5 by hand on a 2,837-row fee table is a lot of clicking.
function optionsFor(field: keyof FeeSel, sel: FeeSel, fees: Fee[]): string[] {
  const others = FEE_FIELDS.filter((k) => k !== field);
  const vals = new Set<string>();
  for (const f of fees) {
    const rec: Record<keyof FeeSel, string> = {
      category: f.category, sub_category: f.sub_category ?? "", jenis_product: f.jenis_product ?? "",
      platform: f.platform, jenis_toko: f.jenis_toko ?? "",
    };
    if (others.every((k) => !sel[k] || rec[k] === sel[k])) {
      if (rec[field]) vals.add(rec[field]);
    }
  }
  return Array.from(vals).sort();
}
function refineSel(sel: FeeSel, fees: Fee[]): FeeSel {
  let cur = { ...sel };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const field of FEE_FIELDS) {
      const opts = optionsFor(field, cur, fees);
      if (cur[field] && !opts.includes(cur[field])) { cur = { ...cur, [field]: "" }; changed = true; }
      else if (!cur[field] && opts.length === 1) { cur = { ...cur, [field]: opts[0] }; changed = true; }
    }
    if (!changed) break;
  }
  return cur;
}
function resolveFee(sel: FeeSel, fees: Fee[]): Fee | null {
  if (FEE_FIELDS.some((k) => !sel[k])) return null;
  return fees.find((f) =>
    f.category === sel.category && (f.sub_category ?? "") === sel.sub_category
    && (f.jenis_product ?? "") === sel.jenis_product && f.platform === sel.platform
    && (f.jenis_toko ?? "") === sel.jenis_toko) ?? null;
}

function formatRp(n: number): string { return Math.round(n || 0).toLocaleString("id-ID"); }
function parseRp(s: string): number { return Number(s.replace(/[^\d-]/g, "")) || 0; }

// Mirrors the source sheet's math, confirmed with the user rather than
// guessed: Total Biaya bundles every marketplace fee PLUS ad spend (so
// Profit already nets out ads); the seller types Harga Jual directly and
// a target ROAS, and Biaya Ads/% Ads are derived from ROAS (Biaya Ads =
// Harga Jual / ROAS); Gratis Ongkir is min(pct% x Harga Jual, Rp cap),
// and for Shopee specifically the pct/cap pair switches from the
// "biasa" tier to the "khusus" tier once the product is over 5kg or
// 20,000 cm3 (Tiktok has no such tier split, it always uses the one
// pct/cap pair on the fee row).
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
  const hargaMarkupPct = input.modalProduk > 0 ? (hargaJual / input.modalProduk - 1) * 100 : null;
  const marginPct = hargaJual > 0 ? (profit / hargaJual) * 100 : null;

  return { platformFeeRp, biayaProsesRp, biayaLayananRp, isKhusus, biayaOngkir, promoXtraRp,
    paylater3moRp, paylater6moRp, biayaAds, pctAds, totalBiaya, profit, hargaMarkupPct, marginPct };
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
        .calc-sel{background:rgba(10,22,40,.5);border:1px solid rgba(201,162,39,.25);border-radius:6px;padding:4px 6px;color:var(--text);font-size:12px;max-width:150px}
      `}</style>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <span className="mode-tab on">Massive Calculator</span>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0 }}>Massive Calculator</h3>
            <div className="hint">{rows.length.toLocaleString("id-ID")} product rows · pick Category/Sub Category/Jenis Product/Platform/Jenis Toko to link a fee row, fill in price and weight, Total Biaya / Profit update live.</div>
          </div>
          <button className="btn-gold" disabled={adding || !clientId} onClick={addRow}>{adding ? "Adding…" : "+ Add Product"}</button>
        </div>

        <div className="tbl-wrap" style={{ marginTop: 14, height: "calc(100vh - 260px)", minHeight: 320, overflowX: "auto", overflowY: "auto" }}>
          <table className="tbl calc-tbl" style={{ width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={stickyTh}>No</th>
                <th style={stickyTh}>Item Product</th>
                <th style={stickyTh}>Category</th>
                <th className="num" style={stickyTh}>Modal Produk</th>
                <th className="num" style={stickyTh}>Harga Jual (Rp)</th>
                <th className="num" style={stickyTh}>Harga Jual (%)</th>
                <th className="num" style={stickyTh}>Total Biaya</th>
                <th className="num" style={stickyTh}>Profit</th>
                <th style={stickyTh}>Platform</th>
                <th style={stickyTh}>Jenis Toko</th>
                <th style={stickyTh}>Category (Fee)</th>
                <th style={stickyTh}>Sub Category</th>
                <th style={stickyTh}>Jenis Product</th>
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
                <CalcRowLine key={r.id} no={i + 1} row={r} fee={r.fee_id ? feesById.get(r.fee_id) ?? null : null} fees={fees}
                  onSave={saveRow} onDelete={deleteRow} />
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={32} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No product rows yet — click “+ Add Product” to start.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={32} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CalcRowLine({ no, row, fee, fees, onSave, onDelete }: {
  no: number; row: CalcRow; fee: Fee | null; fees: Fee[];
  onSave: (id: string, patch: Partial<CalcRow>) => void;
  onDelete: (id: string) => void;
}) {
  const [v, setV] = useState(() => ({
    item_product: row.item_product || "",
    product_line: row.product_line || "",
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
  const [sel, setSel] = useState<FeeSel>(() => selFromFee(fee));

  const parsed = {
    item_product: v.item_product,
    product_line: v.product_line,
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
    || parsed.product_line !== (row.product_line || "")
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
      item_product: row.item_product || "", product_line: row.product_line || "",
      modal_produk_rp: formatRp(row.modal_produk_rp), harga_jual_rp: formatRp(row.harga_jual_rp),
      target_roas: String(row.target_roas || ""), berat_kg: String(row.berat_kg || ""), ukuran_cm3: String(row.ukuran_cm3 || ""),
      biaya_lain_rp: formatRp(row.biaya_lain_rp), gratis_ongkir_on: row.gratis_ongkir_on, promo_xtra_on: row.promo_xtra_on,
      paylater_3mo_on: row.paylater_3mo_on, paylater_6mo_on: row.paylater_6mo_on,
    });
  }

  function pick(field: keyof FeeSel, value: string) {
    const next = refineSel({ ...sel, [field]: value }, fees);
    setSel(next);
    const match = resolveFee(next, fees);
    if ((match?.id ?? null) !== row.fee_id) onSave(row.id, { fee_id: match?.id ?? null });
  }
  function clearFee() {
    setSel(emptySel);
    if (row.fee_id) onSave(row.id, { fee_id: null });
  }

  const feeSelect = (field: keyof FeeSel) => {
    const opts = optionsFor(field, sel, fees);
    const value = sel[field];
    const list = value && !opts.includes(value) ? [value, ...opts] : opts;
    return (
      <select className="calc-sel" value={value} onChange={(e) => pick(field, e.target.value)}>
        <option value="">— pick —</option>
        {list.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  };

  const txt = (val: string, onChange: (s: string) => void, width: number) => (
    <input type="text" value={val} onChange={(e) => onChange(e.target.value)}
      style={{ width, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5, textAlign: "right" }} />
  );

  return (
    <tr style={dirty ? { background: "rgba(201,162,39,.06)" } : undefined}>
      <td>{no}</td>
      <td>
        <input type="text" value={v.item_product} onChange={(e) => setV((s) => ({ ...s, item_product: e.target.value }))}
          placeholder="Product name" style={{ width: 150, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 }} />
      </td>
      <td>
        <input type="text" value={v.product_line} onChange={(e) => setV((s) => ({ ...s, product_line: e.target.value }))}
          placeholder="e.g. RAC" style={{ width: 70, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 }} />
      </td>
      <td className="num">Rp {txt(v.modal_produk_rp, (s) => setV((st) => ({ ...st, modal_produk_rp: formatRp(parseRp(s)) })), 90)}</td>
      <td className="num">Rp {txt(v.harga_jual_rp, (s) => setV((st) => ({ ...st, harga_jual_rp: formatRp(parseRp(s)) })), 90)}</td>
      <td className="num calc-ro">{calc.hargaMarkupPct === null ? "—" : `${calc.hargaMarkupPct.toFixed(1)}%`}</td>
      <td className="num" style={{ fontWeight: 700 }}>Rp {formatRp(calc.totalBiaya)}</td>
      <td className="num" style={{ fontWeight: 700, color: calc.profit >= 0 ? "var(--gold)" : "#ff9a9a" }}>
        Rp {formatRp(calc.profit)}<div style={{ fontSize: 11, fontWeight: 400 }}>{calc.marginPct === null ? "—" : `${calc.marginPct.toFixed(1)}%`}</div>
      </td>
      <td>{feeSelect("platform")}</td>
      <td>{feeSelect("jenis_toko")}</td>
      <td>{feeSelect("category")}</td>
      <td>{feeSelect("sub_category")}</td>
      <td>{feeSelect("jenis_product")}
        {fee && <button onClick={clearFee} className="btn-ghost" style={{ padding: "1px 6px", fontSize: 10, marginLeft: 4 }}>✕</button>}
      </td>
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

const stickyTh: React.CSSProperties = { position: "sticky", top: 0, zIndex: 1 };
const saveBtnStyle: React.CSSProperties = { background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", border: "none", color: "var(--navy-deep)", borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
