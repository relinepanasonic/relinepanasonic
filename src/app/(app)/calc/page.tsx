"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ProductCatalog";

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
  biaya_lain_rp: number; store_name: string | null;
};

// the products of the Catalog in force (Price Research > Product Catalog): the one list of products, shared with Price Guard
type CatalogItem = { prod_id: string; product_name: string; srp_no: string | null; harga_beli: number | null; harga_srp: number | null };
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

async function fetchAll<T>(supabase: ReturnType<typeof createClient>, table: string, clientId: string, order: string, srpId?: string): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  let all: T[] = [];
  for (;;) {
    let q = supabase.from(table).select("*").eq("client_id", clientId);
    if (srpId) q = q.eq("srp_id", srpId);
    const { data, error } = await q.order(order).range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

type SrpLog = { id: string; srp_no: string; catalog_no: string | null; vendor_name: string | null; created_at: string; created_by: string | null; total_sku: number };
type OpenSrp = { id: string; srp_no: string; list_id: string | null; catalog_no: string | null; vendor_name: string | null; created_at: string };
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function dmy(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v); if (Number.isNaN(d.getTime())) return "—";
  const j = new Date(d.getTime() + 7 * 3600_000);
  return `${String(j.getUTCDate()).padStart(2, "0")} ${MON[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
}

// Perhitungan Harga: the table of SRP Price Calculations (SRP ID | Catalog ID | Date Create | Total SKU | Created by). + Create New SRP picks a Catalog and
// opens the calculator with one line per product of it; Save keeps the changes and returns to the table.
export default function MassiveCalculatorPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [fees, setFees] = useState<Fee[]>([]);
  const [rows, setRows] = useState<CalcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [catalogAll, setCatalogAll] = useState<CatalogItem[]>([]);
  const [storeList, setStoreList] = useState<{ store_name: string; vendor_id: string | null }[]>([]);
  const [vendorNames, setVendorNames] = useState<Map<string, string>>(new Map());
  const [lowest, setLowest] = useState<Map<string, number>>(new Map());   // Prod ID -> the lowest competitor price (Price Guard)
  const [log, setLog] = useState<SrpLog[] | null>(null);
  const [srp, setSrp] = useState<OpenSrp | null>(null);
  const [srpItems, setSrpItems] = useState<CatalogItem[]>([]);            // the products and prices of the Catalog the open SRP was made from
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const pending = useRef(new Map<string, Partial<CalcRow>>());

  const feesById = useMemo(() => new Map(fees.map((f) => [f.id, f])), [fees]);
  const vendorOfStore = useMemo(() => new Map(storeList.map((x) => [x.store_name, x.vendor_id])), [storeList]);

  const loadLog = useCallback(async (cid: string) => {
    const { data } = await supabase.rpc("calc_srp_log", { p_client_id: cid });
    setLog((data as SrpLog[]) || []);
  }, [supabase]);

  const loadBase = useCallback(async (cid: string) => {
    const [f, cat, guard, vs, vn] = await Promise.all([
      fetchAll<Fee>(supabase, "market_fees", cid, "category"),
      supabase.rpc("pr_srp_catalog", { p_client_id: cid }),
      supabase.rpc("price_guard", { p_client_id: cid }),
      supabase.from("vendor_stores").select("store_name, vendor_id").eq("client_id", cid).order("store_name"),
      supabase.from("vendors").select("id, name").eq("client_id", cid),
    ]);
    setFees(f);
    setCatalogAll((cat.data as CatalogItem[]) || []);
    setStoreList((vs.data as { store_name: string; vendor_id: string | null }[]) || []);
    setVendorNames(new Map(((vn.data as { id: string; name: string }[]) || []).map((x) => [x.id, x.name])));
    const m = new Map<string, number>();
    for (const g of ((guard.data as { prod_id: string; stores: { ok: boolean | null; price_sell: number | null }[] }[]) || [])) {
      const prices = g.stores.filter((x) => x.ok && x.price_sell).map((x) => x.price_sell as number);
      if (prices.length) m.set(g.prod_id, Math.min(...prices));
    }
    setLowest(m);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("display_name, email, client_id").eq("id", user.id).single();
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = profile?.client_id || (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      if (!cid) { setLog([]); setLoading(false); return; }
      await Promise.all([loadLog(cid), loadBase(cid)]);
      setLoading(false);
    })();
  }, [supabase, loadLog, loadBase]);

  const reloadRows = useCallback(async (srpId: string) => {
    setRows(await fetchAll<CalcRow>(supabase, "massive_calc_rows", clientId, "created_at", srpId));
  }, [supabase, clientId]);

  async function openSrp(id: string) {
    setLoading(true); setMsg(null); pending.current.clear(); setDirtyCount(0);
    const { data: h } = await supabase.from("calc_srp").select("id, srp_no, list_id, created_at").eq("id", id).single();
    const head = h as { id: string; srp_no: string; list_id: string | null; created_at: string } | null;
    if (!head) { setLoading(false); return; }
    const fromLog = log?.find((x) => x.id === id);
    let items = catalogAll;
    if (head.list_id) {
      const { data: it } = await supabase.from("pr_srp_items").select("prod_id, product_name, harga_beli, harga_srp").eq("list_id", head.list_id).order("product_name");
      items = ((it as Omit<CatalogItem, "srp_no">[]) || []).map((x) => ({ ...x, srp_no: fromLog?.catalog_no ?? null }));
    }
    setSrpItems(items);
    await reloadRows(id);
    setSrp({ ...head, catalog_no: fromLog?.catalog_no ?? null, vendor_name: fromLog?.vendor_name ?? null });
    setLoading(false);
  }

  // Create New SRP: the chosen Catalog becomes the lines of a new SRP (Modal Produk = Harga Beli, Harga Jual = the one saved in the Catalog)
  async function createSrp(listId: string, store: string): Promise<string> {
    if (!clientId) return "";
    setBusy(true);
    const { data, error } = await supabase.rpc("calc_srp_create", { p_client_id: clientId, p_list_id: listId, p_store: store || null });
    setBusy(false);
    if (error) return error.message.replace(/^[A-Z_]+:\s*/, "");
    setPicking(false);
    await loadLog(clientId);
    await openSrp(data as string);
    return "";
  }

  const onPending = useCallback((id: string, patch: Partial<CalcRow> | null) => {
    if (patch) pending.current.set(id, patch); else pending.current.delete(id);
    setDirtyCount(pending.current.size);
  }, []);

  async function saveRow(id: string, patch: Partial<CalcRow>) {
    const { error } = await supabase.from("massive_calc_rows").update(patch).eq("id", id);
    if (error) { alert(error.message); return; }
    if (srp) reloadRows(srp.id);
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this row?")) return;
    await supabase.from("massive_calc_rows").delete().eq("id", id);
    if (srp) reloadRows(srp.id);
  }

  // Save: keeps every changed line of this SRP, then back to the SRP table
  async function saveAll() {
    if (!srp) return;
    setBusy(true);
    const results = await Promise.all([...pending.current.entries()].map(([id, patch]) => supabase.from("massive_calc_rows").update(patch).eq("id", id)));
    setBusy(false);
    const bad = results.find((r) => r.error);
    if (bad?.error) { alert(bad.error.message); return; }
    const n = results.length, no = srp.srp_no;
    pending.current.clear(); setDirtyCount(0);
    setSrp(null); setRows([]);
    await loadLog(clientId);
    setMsg({ ok: true, text: `${no} saved${n ? ` (${n} line${n === 1 ? "" : "s"} changed)` : ""}.` });
  }

  async function backToTable() {
    if (dirtyCount && !confirm(`${dirtyCount} line${dirtyCount === 1 ? " has" : "s have"} changes that are not saved. Go back without saving?`)) return;
    pending.current.clear(); setDirtyCount(0);
    setSrp(null); setRows([]);
    loadLog(clientId);
  }

  async function deleteSrp() {
    if (!srp || !confirm(`Delete ${srp.srp_no} with all its ${rows.length} lines?`)) return;
    const { error } = await supabase.from("calc_srp").delete().eq("id", srp.id);
    if (error) { alert(error.message); return; }
    pending.current.clear(); setDirtyCount(0);
    setSrp(null); setRows([]);
    await loadLog(clientId);
    setMsg({ ok: true, text: `${srp.srp_no} deleted.` });
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
        <span className="mode-tab on">Perhitungan Harga</span>
        <Link href="/calc/price-research" className="mode-tab">Price Research</Link>
        <Link href="/calc/product-catalog" className="mode-tab">Product Catalog</Link>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>

      {!srp ? (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>SRP Price Calculation</h3>
              <div className="hint">Every SRP is a saved price calculation made from one Catalog. Press <b>Create New SRP</b>, pick the Catalog, do the calculation, then Save.</div>
            </div>
            <button className="btn-gold" disabled={!clientId} onClick={() => setPicking(true)}>+ Create New SRP</button>
          </div>
          {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginBottom: 10 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}
          {log === null ? <div style={{ color: "var(--muted)", padding: 20 }}>Loading…</div> : (
            <div className="tbl-wrap" style={{ maxHeight: "66vh" }}>
              <table className="tbl day-tbl">
                <thead><tr><th>SRP ID</th><th>Catalog ID</th><th>Date Create</th><th className="num">Total SKU</th><th>Created by</th></tr></thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id} onClick={() => openSrp(r.id)} style={{ cursor: "pointer" }}>
                      <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{r.srp_no}</td>
                      <td><span style={{ fontFamily: "monospace" }}>{r.catalog_no || "—"}</span>{r.vendor_name && <span style={{ color: "var(--muted)", fontSize: 12 }}> · {r.vendor_name}</span>}</td>
                      <td>{dmy(r.created_at)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{r.total_sku}</td>
                      <td>{r.created_by || "—"}</td>
                    </tr>
                  ))}
                  {log.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No SRP yet — press + Create New SRP and pick a Catalog.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={backToTable}>← SRP table</button>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>{srp.srp_no}</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Catalog <b style={{ color: "var(--gold)", fontFamily: "monospace" }}>{srp.catalog_no || "—"}</b>{srp.vendor_name ? ` · ${srp.vendor_name}` : ""} · Created {dmy(srp.created_at)} · {rows.length} SKU</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {dirtyCount > 0 && <span style={{ color: "var(--gold)", fontSize: 12.5 }}>{dirtyCount} line{dirtyCount === 1 ? "" : "s"} changed</span>}
              <button className="btn-ghost" onClick={deleteSrp} style={{ color: "#f87171" }}>Delete SRP</button>
              <button className="btn-gold" disabled={busy} onClick={saveAll} style={{ padding: "10px 26px" }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
          <div className="hint">Pick Category/Sub Category/Jenis Product/Platform/Jenis Toko to link a fee row, fill in price and weight, Total Biaya / Profit update live. Press Save when you are done: it keeps all the changes and goes back to the SRP table.</div>

          <div className="tbl-wrap" style={{ marginTop: 14, height: "calc(100vh - 300px)", minHeight: 320, overflowX: "auto", overflowY: "auto" }}>
            <table className="tbl calc-tbl" style={{ width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={stickyTh}>No</th>
                  <th style={stickyTh}>Store</th>
                  <th style={stickyTh}>Vendor</th>
                  <th style={stickyTh}>Product ID</th>
                  <th style={stickyTh}>Product Name</th>
                  <th style={stickyTh}>Catalog ID</th>
                  <th className="num" style={stickyTh}>Harga Beli</th>
                  <th className="num" style={stickyTh}>Harga Jual (Catalog)</th>
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
                    catalog={srpItems} stores={storeList} vendorNames={vendorNames} vendorOfStore={vendorOfStore} lowest={lowest}
                    onSave={saveRow} onDelete={deleteRow} onPending={onPending} />
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={40} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>This SRP has no lines.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={40} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {picking && <CatalogPicker supabase={supabase} clientId={clientId} stores={storeList} vendorNames={vendorNames} busy={busy} onClose={() => setPicking(false)} onAdd={createSrp} />}
    </>
  );
}

function CalcRowLine({ no, row, fee, fees, catalog, stores, vendorNames, vendorOfStore, lowest, onSave, onDelete, onPending }: {
  no: number; row: CalcRow; fee: Fee | null; fees: Fee[];
  catalog: CatalogItem[]; stores: { store_name: string; vendor_id: string | null }[]; vendorNames: Map<string, string>;
  vendorOfStore: Map<string, string | null>; lowest: Map<string, number>;
  onPending: (id: string, patch: Partial<CalcRow> | null) => void;
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

  // the page's Save keeps every changed line: each line reports its unsaved values (null when it has none)
  const pkey = JSON.stringify(parsed);
  useEffect(() => { onPending(row.id, dirty ? JSON.parse(pkey) : null); }, [dirty, pkey, row.id, onPending]);

  const calc = computeCalc({
    hargaJual: parsed.harga_jual_rp, modalProduk: parsed.modal_produk_rp, targetRoas: parsed.target_roas,
    beratKg: parsed.berat_kg, ukuranCm3: parsed.ukuran_cm3,
    gratisOngkirOn: parsed.gratis_ongkir_on, promoXtraOn: parsed.promo_xtra_on,
    paylater3moOn: parsed.paylater_3mo_on, paylater6moOn: parsed.paylater_6mo_on,
    biayaLain: parsed.biaya_lain_rp,
  }, fee);

  const catalogById = new Map(catalog.map((c) => [c.prod_id, c]));
  const vendorName = row.store_name ? vendorNames.get(vendorOfStore.get(row.store_name) || "") || "" : "";
  const cat = v.prod_id ? catalogById.get(v.prod_id) ?? null : null;
  const low = v.prod_id ? lowest.get(v.prod_id) ?? null : null;
  // picking a catalog product fills the name, the Prod ID, Modal Produk = its Harga Beli and (as the starting point) Harga Jual = its Harga Jual
  function pickProduct(prodId: string) {
    const c = prodId ? catalogById.get(prodId) : null;
    setV((st) => ({ ...st, prod_id: prodId, item_product: c ? c.product_name : st.item_product, modal_produk_rp: c && c.harga_beli != null ? formatRp(c.harga_beli) : st.modal_produk_rp, harga_jual_rp: c && c.harga_srp != null ? formatRp(c.harga_srp) : st.harga_jual_rp }));
  }

  function changeStore(store: string) { onSave(row.id, { store_name: store || null }); }

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
        <select className="calc-sel" value={row.store_name || ""} onChange={(e) => changeStore(e.target.value)} style={{ width: 170, maxWidth: 170 }} title="The store decides the vendor, and the vendor decides the Harga Beli">
          <option value="">— no store —</option>
          {row.store_name && !stores.some((s) => s.store_name === row.store_name) && <option value={row.store_name}>{row.store_name}</option>}
          {stores.map((s) => <option key={s.store_name} value={s.store_name}>{s.store_name}</option>)}
        </select>
      </td>
      <td className="calc-ro">{vendorName || "—"}</td>
      <td className="calc-ro" style={{ fontFamily: "monospace" }}>{cat?.prod_id || "—"}</td>
      <td>
        <select className="calc-sel" value={v.prod_id} onChange={(e) => pickProduct(e.target.value)} style={{ width: 230, maxWidth: 230 }} title="The product comes from the Product Catalog">
          <option value="">{v.item_product ? `${v.item_product} (not in catalog)` : "— pick product —"}</option>
          {catalog.map((c) => <option key={c.prod_id} value={c.prod_id}>{c.prod_id} · {c.product_name}</option>)}
        </select>
      </td>
      <td className="calc-ro" style={{ fontFamily: "monospace" }}>{cat?.srp_no || "—"}</td>
      <td className="num" style={{ fontWeight: 600 }}>{cat?.harga_beli != null ? `Rp ${formatRp(cat.harga_beli)}` : "—"}
        {cat?.harga_beli != null && parsed.modal_produk_rp !== cat.harga_beli && <div><button onClick={() => setV((s) => ({ ...s, modal_produk_rp: formatRp(cat.harga_beli as number) }))} className="btn-ghost" style={{ padding: "0 6px", fontSize: 10 }} title="Use Harga Beli as Modal Produk">= Beli</button></div>}
      </td>
      <td className="num" style={{ fontWeight: 600 }}>{cat?.harga_srp != null ? `Rp ${formatRp(cat.harga_srp)}` : "—"}
        {cat?.harga_srp != null && parsed.harga_jual_rp !== cat.harga_srp && <div><button onClick={() => setV((s) => ({ ...s, harga_jual_rp: formatRp(cat.harga_srp as number) }))} className="btn-ghost" style={{ padding: "0 6px", fontSize: 10 }} title="Use the Harga Jual of the Catalog">= Catalog</button></div>}
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

// Modal listing the Catalogs (Product Catalog log): pick one, optionally the store the lines are for, and all its products are added.
type CatalogLog = { id: string; srp_no: string; active_from: string; total_sku: number; in_force: boolean; vendor_id: string | null; vendor_name: string | null };
function CatalogPicker({ supabase, clientId, stores, vendorNames, busy, onClose, onAdd }: {
  supabase: ReturnType<typeof createClient>; clientId: string; stores: { store_name: string; vendor_id: string | null }[]; vendorNames: Map<string, string>;
  busy: boolean; onClose: () => void; onAdd: (listId: string, store: string) => Promise<string>;
}) {
  const [logs, setLogs] = useState<CatalogLog[] | null>(null);
  const [pick, setPick] = useState("");
  const [store, setStore] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("pr_srp_lists_log", { p_client_id: clientId });
      const l = (data as CatalogLog[]) || [];
      setLogs(l); setPick(l.find((x) => x.in_force)?.id || l[0]?.id || "");
    })();
  }, [supabase, clientId]);
  const chosen = logs?.find((x) => x.id === pick) ?? null;
  const myStores = stores.filter((s) => !chosen?.vendor_id || s.vendor_id === chosen.vendor_id);
  const dmy = (d: string) => new Date(d + "T00:00:00+07:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <Modal onClose={onClose} width={760}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Create New SRP</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>Pick the Catalog this SRP is made from. All its products become lines, each with the Harga Beli as Modal Produk and the Harga Jual saved in that Catalog.</div>
      {logs === null ? <div style={{ color: "var(--muted)", padding: 20 }}>Loading…</div> : (
        <div className="tbl-wrap" style={{ maxHeight: "40vh" }}>
          <table className="tbl">
            <thead><tr><th style={{ width: 34 }}></th><th>Catalog ID</th><th>Vendor</th><th>Date Active</th><th className="num">Total SKU</th><th></th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} onClick={() => { setPick(l.id); setStore(""); }} style={{ cursor: "pointer" }}>
                  <td><input type="radio" checked={pick === l.id} onChange={() => { setPick(l.id); setStore(""); }} /></td>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{l.srp_no}</td>
                  <td>{l.vendor_name || <span style={{ color: "var(--muted)" }}>Default (all stores)</span>}</td>
                  <td>{dmy(l.active_from)}</td>
                  <td className="num">{l.total_sku}</td>
                  <td>{l.in_force && <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, border: "1px solid rgba(201,162,39,.5)", color: "var(--gold)" }}>In force</span>}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No Catalog yet. Make one in the Product Catalog page (+ New Harga Beli).</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <div className="fld" style={{ minWidth: 260 }}><label>Store (optional)</label>
          <select value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">— no store —</option>
            {myStores.map((s) => <option key={s.store_name} value={s.store_name}>{s.store_name}{s.vendor_id && vendorNames.get(s.vendor_id) ? ` · ${vendorNames.get(s.vendor_id)}` : ""}</option>)}
          </select></div>
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-gold" disabled={!chosen || busy} style={{ padding: "10px 24px" }}
          onClick={async () => { setErr(""); const m = await onAdd(pick, store); if (m) setErr(m); }}>
          {busy ? "Creating…" : chosen ? `Create SRP from ${chosen.srp_no} (${chosen.total_sku} products)` : "Create"}
        </button>
      </div>
    </Modal>
  );
}
