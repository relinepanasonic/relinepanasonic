"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { CALC_EXAMPLE, CALC_HEADER } from "@/lib/calcTemplate";

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
  id: string; item_product: string | null; prod_id: string | null; product_line: string | null;
  modal_produk_rp: number; harga_jual_rp: number;
  fee_id: string | null; target_roas: number;
  berat_kg: number; ukuran_cm3: number;
  gratis_ongkir_on: boolean; promo_xtra_on: boolean;
  paylater_3mo_on: boolean; paylater_6mo_on: boolean;
  biaya_lain_rp: number;
};

// the Product Catalog (Price Research > Product Catalog): the one list of products, shared with Price Guard
type CatalogItem = { prod_id: string; product_name: string; srp_id: string | null; price_srp: number | null };
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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [lowest, setLowest] = useState<Map<string, number>>(new Map());   // Prod ID -> the lowest competitor price (Price Guard)

  const feesById = useMemo(() => new Map(fees.map((f) => [f.id, f])), [fees]);
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.prod_id, c])), [catalog]);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setRows([]); setFees([]); setLoading(false); return; }
    setLoading(true);
    const [f, r, cat, guard] = await Promise.all([
      fetchAll<Fee>(supabase, "market_fees", cid, "category"),
      fetchAll<CalcRow>(supabase, "massive_calc_rows", cid, "created_at"),
      supabase.from("pr_srp_products").select("prod_id, product_name, srp_id, price_srp").eq("client_id", cid).order("product_name"),
      supabase.rpc("price_guard", { p_client_id: cid }),
    ]);
    setFees(f);
    setRows(r);
    setCatalog((cat.data as CatalogItem[]) || []);
    const m = new Map<string, number>();
    for (const g of ((guard.data as { prod_id: string; stores: { ok: boolean | null; price_sell: number | null }[] }[]) || [])) {
      const prices = g.stores.filter((x) => x.ok && x.price_sell).map((x) => x.price_sell as number);
      if (prices.length) m.set(g.prod_id, Math.min(...prices));
    }
    setLowest(m);
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

  // The flat XLS: empty template (one example row) or an export of the lines on the screen. Same columns as the import, so an export can be edited and imported back.
  async function downloadXls(withRows: boolean) {
    const XLSX = await import("xlsx");
    const body: (string | number)[][] = withRows
      ? rows.map((r, i) => {
          const f = r.fee_id ? feesById.get(r.fee_id) : null;
          return [i + 1, r.prod_id || "", catalogById.get(r.prod_id || "")?.product_name || r.item_product || "", r.modal_produk_rp, r.harga_jual_rp, f?.platform || "", f?.jenis_toko || "", f?.category || "", f?.sub_category || "",
            f?.jenis_product || "", r.target_roas, r.berat_kg, r.ukuran_cm3, r.gratis_ongkir_on ? "Yes" : "No", r.promo_xtra_on ? "Yes" : "No", r.paylater_3mo_on ? "Yes" : "No", r.paylater_6mo_on ? "Yes" : "No", r.biaya_lain_rp];
        })
      : [CALC_EXAMPLE as (string | number)[]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[...CALC_HEADER], ...body]);
    ws["!cols"] = CALC_HEADER.map((h) => ({ wch: h === "Product Name" ? 38 : Math.max(12, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, "Massive Calculator");
    const feeSheet = XLSX.utils.aoa_to_sheet([["Platform", "Jenis Toko", "Category", "Sub Category", "Jenis Product"], ...fees.map((f) => [f.platform, f.jenis_toko || "", f.category, f.sub_category || "", f.jenis_product || ""])]);
    feeSheet["!cols"] = [18, 18, 28, 28, 28].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, feeSheet, "Fee options");
    const guide = XLSX.utils.aoa_to_sheet([
      ["How to fill"], [""],
      ["Prod ID", "Required. Must be a Prod ID of the Product Catalog (Price Research > Product Catalog). The product name is read from the catalog."],
      ["Modal Produk", "Cost price in Rp."],
      ["Harga Jual", "Selling price in Rp. Leave EMPTY to use the SRP of the catalog."],
      ["Platform / Jenis Toko / Category / Sub Category / Jenis Product", "Copy the five values of ONE row of the sheet Fee options. They link the line to its marketplace fee row."],
      ["Gratis Ongkir / Promo Xtra / Paylater 3 Bln / Paylater 6 Bln", "Yes or No."],
      ["Importing again", "A line is identified by Prod ID + Platform + Jenis Toko: importing it again updates the line instead of adding a duplicate."],
    ]);
    guide["!cols"] = [{ wch: 52 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, guide, "Guide");
    XLSX.writeFile(wb, withRows ? "massive-calculator-export.xlsx" : "massive-calculator-template.xlsx");
  }

  async function addRow() {
    if (!clientId) return;
    setAdding(true);
    const { error } = await supabase.from("massive_calc_rows").insert({ client_id: clientId, created_by: myName });
    setAdding(false);
    if (error) { alert(error.message); return; }
    reload(clientId);
  }

  async function uploadBulk(file: File) {
    setUploading(true);
    setUploadMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/calc/bulk-import", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) { setUploadMsg(`✗ ${j.error}`); return; }
      const sk = (j.skipped as { row: number; reason: string }[] | undefined) || [];
      setUploadMsg(`✓ ${j.imported.toLocaleString("id-ID")} added${j.updated ? ` · ${j.updated} updated` : ""} (${j.matched} linked to a fee, ${j.unmatched} need the fee columns picked)${sk.length ? ` · ${sk.length} skipped: ${sk.slice(0, 3).map((x) => `row ${x.row}: ${x.reason}`).join("; ")}${sk.length > 3 ? "…" : ""}` : ""}`);
      reload(clientId);
    } finally {
      setUploading(false);
    }
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
        <Link href="/calc/price-research" className="mode-tab">Price Research</Link>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0 }}>Massive Calculator</h3>
            <div className="hint">{rows.length.toLocaleString("id-ID")} product rows · pick Category/Sub Category/Jenis Product/Platform/Jenis Toko to link a fee row, fill in price and weight, Total Biaya / Profit update live.</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn-ghost" onClick={() => downloadXls(false)} disabled={!clientId}>⬇ Template XLS</button>
            <button className="btn-ghost" onClick={() => downloadXls(true)} disabled={!clientId || !rows.length}>⬇ Export XLS</button>
            <label className="btn-ghost" style={{ cursor: uploading || !clientId ? "not-allowed" : "pointer", opacity: uploading || !clientId ? .6 : 1 }}>
              {uploading ? "Importing…" : "Import XLS"}
              <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} disabled={uploading || !clientId}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBulk(f); e.target.value = ""; }} />
            </label>
            <button className="btn-gold" disabled={adding || !clientId} onClick={addRow}>{adding ? "Adding…" : "+ Add Product"}</button>
          </div>
        </div>
        {uploadMsg && (
          <div style={{ marginBottom: 10, fontSize: 13, color: uploadMsg.startsWith("✓") ? "var(--gold)" : "#f87171" }}>{uploadMsg}</div>
        )}

        <div className="tbl-wrap" style={{ marginTop: 14, height: "calc(100vh - 260px)", minHeight: 320, overflowX: "auto", overflowY: "auto" }}>
          <table className="tbl calc-tbl" style={{ width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={stickyTh}>No</th>
                <th style={stickyTh}>Product Name</th>
                <th style={stickyTh}>Product ID</th>
                <th style={stickyTh}>SRP ID</th>
                <th className="num" style={stickyTh}>Price SRP</th>
                <th className="num" style={stickyTh}>Lowest Competitor</th>
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
                <th className="num" style={stickyTh}>Nett Profit</th>
                <th style={stickyTh}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <CalcRowLine key={r.id} no={i + 1} row={r} fee={r.fee_id ? feesById.get(r.fee_id) ?? null : null} fees={fees}
                  catalog={catalog} catalogById={catalogById} lowest={lowest} onSave={saveRow} onDelete={deleteRow} />
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={37} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No product rows yet — click “+ Add Product”, or fill the XLS template and Import it.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={37} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CalcRowLine({ no, row, fee, fees, catalog, catalogById, lowest, onSave, onDelete }: {
  no: number; row: CalcRow; fee: Fee | null; fees: Fee[];
  catalog: CatalogItem[]; catalogById: Map<string, CatalogItem>; lowest: Map<string, number>;
  onSave: (id: string, patch: Partial<CalcRow>) => void;
  onDelete: (id: string) => void;
}) {
  const [v, setV] = useState(() => ({
    item_product: row.item_product || "",
    prod_id: row.prod_id || "",
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
    prod_id: v.prod_id || null,
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
    || parsed.prod_id !== (row.prod_id || null)
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

  const cat = v.prod_id ? catalogById.get(v.prod_id) ?? null : null;
  const low = v.prod_id ? lowest.get(v.prod_id) ?? null : null;
  // picking a catalog product fills the name, the Prod ID and (as the starting point) Harga Jual = its SRP
  function pickProduct(prodId: string) {
    const c = prodId ? catalogById.get(prodId) : null;
    setV((st) => ({ ...st, prod_id: prodId, item_product: c ? c.product_name : st.item_product, harga_jual_rp: c && c.price_srp != null ? formatRp(c.price_srp) : st.harga_jual_rp }));
  }

  function save() { onSave(row.id, parsed); }
  function reset() {
    setV({
      item_product: row.item_product || "", prod_id: row.prod_id || "", product_line: row.product_line || "",
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

  const yesNo = (val: boolean, onChange: (v: boolean) => void) => (
    <select value={val ? "Yes" : "No"} onChange={(e) => onChange(e.target.value === "Yes")}
      style={{
        width: 62, textAlign: "center", textAlignLast: "center", borderRadius: 6, padding: "4px 6px", fontSize: 12.5, fontWeight: 700,
        background: val ? "rgba(74,222,128,.12)" : "rgba(255,90,90,.12)",
        border: `1px solid ${val ? "rgba(74,222,128,.4)" : "rgba(255,90,90,.4)"}`,
        color: val ? "#4ade80" : "#ff9a9a",
      }}>
      <option value="Yes" style={{ color: "#4ade80", background: "var(--navy-deep, #0d1a36)" }}>Yes</option>
      <option value="No" style={{ color: "#ff9a9a", background: "var(--navy-deep, #0d1a36)" }}>No</option>
    </select>
  );

  return (
    <tr style={dirty ? { background: "rgba(201,162,39,.06)" } : undefined}>
      <td>{no}</td>
      <td>
        <select className="calc-sel" value={v.prod_id} onChange={(e) => pickProduct(e.target.value)} style={{ width: 230, maxWidth: 230 }} title="The product comes from the Product Catalog">
          <option value="">{v.item_product ? `${v.item_product} (not in catalog)` : "— pick product —"}</option>
          {catalog.map((c) => <option key={c.prod_id} value={c.prod_id}>{c.product_name}</option>)}
        </select>
      </td>
      <td className="calc-ro" style={{ fontFamily: "monospace" }}>{cat?.prod_id || "—"}</td>
      <td className="calc-ro" style={{ fontFamily: "monospace" }}>{cat?.srp_id || "—"}</td>
      <td className="num" style={{ fontWeight: 600 }}>{cat?.price_srp != null ? `Rp ${formatRp(cat.price_srp)}` : "—"}
        {cat?.price_srp != null && parsed.harga_jual_rp !== cat.price_srp && <div><button onClick={() => setV((s) => ({ ...s, harga_jual_rp: formatRp(cat.price_srp as number) }))} className="btn-ghost" style={{ padding: "0 6px", fontSize: 10 }} title="Use the SRP as Harga Jual">= SRP</button></div>}
      </td>
      <td className="num calc-ro">{low != null ? `Rp ${formatRp(low)}` : "—"}{low != null && parsed.harga_jual_rp > 0 && <div style={{ fontSize: 11, color: parsed.harga_jual_rp > low ? "#ff9a9a" : "#4ade80" }}>{parsed.harga_jual_rp > low ? "+" : ""}{((parsed.harga_jual_rp / low - 1) * 100).toFixed(1)}% vs ours</div>}</td>
      <td>
        <input type="text" value={v.product_line} onChange={(e) => setV((s) => ({ ...s, product_line: e.target.value }))}
          placeholder="e.g. RAC" style={{ width: 70, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 }} />
      </td>
      <td className="num">Rp {txt(v.modal_produk_rp, (s) => setV((st) => ({ ...st, modal_produk_rp: formatRp(parseRp(s)) })), 90)}</td>
      <td className="num">Rp {txt(v.harga_jual_rp, (s) => setV((st) => ({ ...st, harga_jual_rp: formatRp(parseRp(s)) })), 90)}</td>
      <td className="num calc-ro">{calc.hargaMarkupPct === null ? "—" : `${calc.hargaMarkupPct.toFixed(1)}%`}</td>
      <td className="num" style={{ fontWeight: 700 }}>Rp {formatRp(calc.totalBiaya)}</td>
      <td className="num" style={{ fontWeight: 700, color: calc.profit >= 0 ? "#4ade80" : "#ff9a9a" }}>
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
      <td style={{ textAlign: "center" }}>
        {yesNo(v.gratis_ongkir_on, (val) => setV((s) => ({ ...s, gratis_ongkir_on: val })))}
        <div>{calc.isKhusus ? <span className="calc-ro">khusus</span> : <span className="calc-ro">biasa</span>}</div>
      </td>
      <td className="num">{txt(v.berat_kg, (s) => setV((st) => ({ ...st, berat_kg: s.replace(/[^\d.]/g, "") })), 55)}</td>
      <td className="num">{txt(v.ukuran_cm3, (s) => setV((st) => ({ ...st, ukuran_cm3: s.replace(/[^\d.]/g, "") })), 70)}</td>
      <td className="num calc-ro">Rp {formatRp(calc.biayaOngkir)}</td>
      <td style={{ textAlign: "center" }}>{yesNo(v.promo_xtra_on, (val) => setV((s) => ({ ...s, promo_xtra_on: val })))}</td>
      <td className="num calc-ro">Rp {formatRp(calc.promoXtraRp)}</td>
      <td style={{ textAlign: "center" }}>{yesNo(v.paylater_3mo_on, (val) => setV((s) => ({ ...s, paylater_3mo_on: val })))}</td>
      <td className="num calc-ro">Rp {formatRp(calc.paylater3moRp)}</td>
      <td style={{ textAlign: "center" }}>{yesNo(v.paylater_6mo_on, (val) => setV((s) => ({ ...s, paylater_6mo_on: val })))}</td>
      <td className="num calc-ro">Rp {formatRp(calc.paylater6moRp)}</td>
      <td className="num">Rp {txt(v.biaya_lain_rp, (s) => setV((st) => ({ ...st, biaya_lain_rp: formatRp(parseRp(s)) })), 80)}</td>
      <td className="num" style={{ fontWeight: 700, color: calc.profit >= 0 ? "#4ade80" : "#ff9a9a" }}>
        Rp {formatRp(calc.profit)}<div style={{ fontSize: 11, fontWeight: 400 }}>{calc.marginPct === null ? "—" : `${calc.marginPct.toFixed(1)}%`}</div>
      </td>
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
