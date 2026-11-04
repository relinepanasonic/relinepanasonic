"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ProductCatalog";
import { CALC_HEADER, lineKeyOf, parseCalcXls } from "@/lib/calcXls";

export const dynamic = "force-dynamic";

type Fee = {
  id: string; category: string; sub_category: string | null; jenis_product: string | null;
  platform: string; jenis_toko: string | null; kategori_kirim: string | null;
  platform_fee_pct: number; biaya_proses_pesanan_rp: number; biaya_layanan_mall_pct: number;
  min_gratis_ongkir_biasa_pct: number; max_gratis_ongkir_biasa_rp: number;
  min_gratis_ongkir_khusus_pct: number; max_gratis_ongkir_khusus_rp: number;
  min_promo_xtra_pct: number; max_promo_xtra_rp: number;
  spaylater_xtra_3mo_pct: number; spaylater_xtra_6mo_pct: number; pajak_pct: number;
};

type CalcRow = {
  id: string; item_product: string | null; prod_id: string | null; product_line: string | null;
  modal_produk_rp: number; harga_jual_rp: number;
  fee_id: string | null; target_roas: number;
  berat_kg: number; ukuran_cm3: number;
  gratis_ongkir_on: boolean; promo_xtra_on: boolean;
  paylater_3mo_on: boolean; paylater_6mo_on: boolean;
  biaya_lain_rp: number; store_name: string | null;
  fee_category: string | null; fee_sub_category: string | null; fee_jenis_product: string | null; fee_platform: string | null; fee_jenis_toko: string | null;
};

// the products of the Catalog in force (Price Research > Product Catalog): the one list of products, shared with Price Guard
type CatalogItem = { prod_id: string; product_name: string; srp_no: string | null; harga_beli: number | null; harga_srp: number | null };
type FeeSel = { category: string; sub_category: string; jenis_product: string; platform: string; jenis_toko: string };
const FEE_FIELDS: (keyof FeeSel)[] = ["category", "sub_category", "jenis_product", "platform", "jenis_toko"];
const emptySel: FeeSel = { category: "", sub_category: "", jenis_product: "", platform: "", jenis_toko: "" };

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

// The five fee values a line carries (stored on the line itself: a line can have Platform and Jenis Toko before it has a fee row)
function keysOf(r: CalcRow): FeeSel {
  return { category: r.fee_category ?? "", sub_category: r.fee_sub_category ?? "", jenis_product: r.fee_jenis_product ?? "", platform: r.fee_platform ?? "", jenis_toko: r.fee_jenis_toko ?? "" };
}
function keysPatch(v: FeeSel): Partial<CalcRow> {
  return { fee_category: v.category || null, fee_sub_category: v.sub_category || null, fee_jenis_product: v.jenis_product || null, fee_platform: v.platform || null, fee_jenis_toko: v.jenis_toko || null };
}
// the values of a line with the picked ones replaced; the rest stay as the line has them
function mergeFee(line: CalcRow, choice: FeeSel): FeeSel {
  const m = { ...keysOf(line) };
  for (const k of FEE_FIELDS) if (choice[k]) m[k] = choice[k];
  return m;
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
// Pajak of a line: the fee row's Pajak, or the standard 0.5% when the line has no fee row yet
const PAJAK_DEFAULT_PCT = 0.5;
const pajakPctOf = (fee: Fee | null) => (fee ? fee.pajak_pct ?? 0 : PAJAK_DEFAULT_PCT);

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

  // Pajak: a percent of the selling price (0.50% on the marketplace fee sheet)
  // a line without a fee row yet still pays the standard Pajak
  const pajakRp = (pajakPctOf(fee) / 100) * hargaJual;

  const biayaAds = input.targetRoas > 0 ? hargaJual / input.targetRoas : 0;
  const pctAds = hargaJual > 0 ? (biayaAds / hargaJual) * 100 : 0;

  const totalBiaya = platformFeeRp + biayaProsesRp + biayaLayananRp + biayaOngkir
    + promoXtraRp + paylater3moRp + paylater6moRp + pajakRp + biayaAds + input.biayaLain;
  const profit = hargaJual - input.modalProduk - totalBiaya;
  const hargaMarkupPct = input.modalProduk > 0 ? (hargaJual / input.modalProduk - 1) * 100 : null;
  const marginPct = hargaJual > 0 ? (profit / hargaJual) * 100 : null;

  return { platformFeeRp, biayaProsesRp, biayaLayananRp, isKhusus, biayaOngkir, promoXtraRp,
    paylater3moRp, paylater6moRp, pajakRp, biayaAds, pctAds, totalBiaya, profit, hargaMarkupPct, marginPct };
}

async function fetchAll<T>(supabase: ReturnType<typeof createClient>, table: string, clientId: string, order: string, srpId?: string, listId?: string): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  let all: T[] = [];
  for (;;) {
    let q = supabase.from(table).select("*").eq("client_id", clientId);
    if (srpId) q = q.eq("srp_id", srpId);
    if (listId) q = q.eq("list_id", listId);
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
  const [lowest, setLowest] = useState<Map<string, number>>(new Map());   // Prod ID -> the lowest competitor price (Price Guard)
  const [log, setLog] = useState<SrpLog[] | null>(null);
  const [srp, setSrp] = useState<OpenSrp | null>(null);
  const [srpItems, setSrpItems] = useState<CatalogItem[]>([]);            // the products and prices of the Catalog the open SRP was made from
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());   // ticked lines (mass edit / mass duplicate)
  const [platformFilter, setPlatformFilter] = useState("");
  const [tokoFilter, setTokoFilter] = useState("");
  const [typeQuery, setTypeQuery] = useState("");              // product type typed by the user: AC, TV, Mesin Cuci …
  const [massOpen, setMassOpen] = useState<"edit" | "dup" | null>(null);
  const [rev, setRev] = useState(0);                                     // bumped after an import so every line shows the imported values
  const pending = useRef(new Map<string, Partial<CalcRow>>());
  const feesRef = useRef<Fee[]>([]);
  useEffect(() => { feesRef.current = fees; }, [fees]);

  const feesById = useMemo(() => new Map(fees.map((f) => [f.id, f])), [fees]);
  const platformOf = useCallback((r: CalcRow) => r.fee_platform || "", []);
  const tokoOf = useCallback((r: CalcRow) => r.fee_jenis_toko || "", []);
  const platformOptions = useMemo(() => Array.from(new Set(rows.map(platformOf).filter(Boolean))).sort(), [rows, platformOf]);
  const tokoOptions = useMemo(() => Array.from(new Set(rows.filter((r) => !platformFilter || platformFilter === "__none" || platformOf(r) === platformFilter).map(tokoOf).filter(Boolean))).sort(), [rows, platformFilter, platformOf, tokoOf]);
  const visible = useMemo(() => {
    const words = typeQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return rows.filter((r) => {
      if (platformFilter && (platformFilter === "__none" ? !!platformOf(r) : platformOf(r) !== platformFilter)) return false;
      if (tokoFilter && tokoOf(r) !== tokoFilter) return false;
      if (!words.length) return true;
      // the type is typed as a word (AC, TV, Mesin Cuci): a short word must be a whole word of the product ("AC" is not "Black"), a longer one may start a word
      const text = `${r.item_product || ""} ${r.prod_id || ""} ${r.product_line || ""}`.toLowerCase();
      return words.every((w) => new RegExp(`(^|[^a-z0-9])${w}${w.length <= 3 ? "([^a-z0-9]|$)" : ""}`).test(text));
    });
  }, [rows, platformFilter, tokoFilter, typeQuery, platformOf, tokoOf]);
  const toggleOne = useCallback((id: string) => setSelected((st) => { const n = new Set(st); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const [sort, setSort] = useState<{ k: string; dir: "asc" | "desc" } | null>(null);
  const catByProd = useMemo(() => new Map(srpItems.map((c) => [c.prod_id, c])), [srpItems]);
  // the value a column sorts by, for one line (the calculated ones are worked out the same way as on the line)
  const sortValue = useCallback((r: CalcRow, k: string): number | string | null => {
    const fee = r.fee_id ? feesById.get(r.fee_id) ?? null : null;
    const cat = catByProd.get(r.prod_id || "") ?? null;
    const c = computeCalc({ hargaJual: r.harga_jual_rp, modalProduk: r.modal_produk_rp, targetRoas: r.target_roas, beratKg: r.berat_kg, ukuranCm3: r.ukuran_cm3,
      gratisOngkirOn: r.gratis_ongkir_on, promoXtraOn: r.promo_xtra_on, paylater3moOn: r.paylater_3mo_on, paylater6moOn: r.paylater_6mo_on, biayaLain: r.biaya_lain_rp }, fee);
    const yn = (b: boolean) => (b ? 1 : 0);
    switch (k) {
      case "no": return rows.indexOf(r);
      case "platform": return r.fee_platform || "";
      case "toko": return r.fee_jenis_toko || "";
      case "prod": return r.prod_id || "";
      case "name": return r.item_product || "";
      case "catalog": return cat?.srp_no ?? "";
      case "beli": return cat?.harga_beli ?? null;
      case "jualcat": return cat?.harga_srp ?? null;
      case "lowest": return lowest.get(r.prod_id || "") ?? null;
      case "line": return r.product_line || "";
      case "modal": return r.modal_produk_rp;
      case "jual": return r.harga_jual_rp;
      case "markup": return c.hargaMarkupPct;
      case "biaya": return c.totalBiaya;
      case "profit": return c.profit;
      case "fcat": return r.fee_category || "";
      case "fsub": return r.fee_sub_category || "";
      case "fjenis": return r.fee_jenis_product || "";
      case "roas": return r.target_roas;
      case "pctads": return c.pctAds;
      case "biayaads": return c.biayaAds;
      case "pfpct": return fee?.platform_fee_pct ?? 0;
      case "pfrp": return c.platformFeeRp;
      case "proses": return c.biayaProsesRp;
      case "mallpct": return fee?.biaya_layanan_mall_pct ?? 0;
      case "mallrp": return c.biayaLayananRp;
      case "ongkir": return yn(r.gratis_ongkir_on);
      case "berat": return r.berat_kg;
      case "uk": return r.ukuran_cm3;
      case "ongkirrp": return c.biayaOngkir;
      case "promo": return yn(r.promo_xtra_on);
      case "promorp": return c.promoXtraRp;
      case "p3": return yn(r.paylater_3mo_on);
      case "p3rp": return c.paylater3moRp;
      case "p6": return yn(r.paylater_6mo_on);
      case "p6rp": return c.paylater6moRp;
      case "pajakpct": return pajakPctOf(fee);
      case "pajakrp": return c.pajakRp;
      case "lain": return r.biaya_lain_rp;
      case "nett": return c.profit;
      default: return null;
    }
  }, [feesById, catByProd, lowest, rows]);
  const shown = useMemo(() => {
    if (!sort) return visible;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const x = sortValue(a, sort.k), y = sortValue(b, sort.k);
      if (x === null || x === "") return y === null || y === "" ? 0 : 1;   // empty values always go last
      if (y === null || y === "") return -1;
      return typeof x === "number" && typeof y === "number" ? sign * (x - y) : sign * String(x).localeCompare(String(y));
    });
  }, [visible, sort, sortValue]);
  // click: ascending, then descending, then back to the order of the lines
  const toggleSort = (k: string) => setSort((st) => (!st || st.k !== k ? { k, dir: "asc" } : st.dir === "asc" ? { k, dir: "desc" } : null));

  const loadLog = useCallback(async (cid: string) => {
    const { data } = await supabase.rpc("calc_srp_log", { p_client_id: cid });
    setLog((data as SrpLog[]) || []);
  }, [supabase]);

  const loadBase = useCallback(async (cid: string) => {
    // the fees of the Marketplace Fee version in force (lines made with an older version keep their own fee rows: see ensureFees)
    const { data: feeList } = await supabase.rpc("market_fee_active", { p_client_id: cid });
    const [f, cat, guard] = await Promise.all([
      feeList ? fetchAll<Fee>(supabase, "market_fees", cid, "category", undefined, feeList as string) : Promise.resolve([] as Fee[]),
      supabase.rpc("pr_srp_catalog", { p_client_id: cid }),
      supabase.rpc("price_guard", { p_client_id: cid }),
    ]);
    setFees(f);
    setCatalogAll((cat.data as CatalogItem[]) || []);
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
    const r = await fetchAll<CalcRow>(supabase, "massive_calc_rows", clientId, "created_at", srpId);
    setRows(r);
    // a line keeps the fee row it was calculated with, even when that row belongs to an older Marketplace Fee version
    const have = new Set(feesRef.current.map((f) => f.id));
    const missing = [...new Set(r.map((x) => x.fee_id).filter((id): id is string => !!id && !have.has(id)))];
    for (let i = 0; i < missing.length; i += 100) {
      const { data } = await supabase.from("market_fees").select("*").in("id", missing.slice(i, i + 100));
      if (data?.length) setFees((cur) => [...cur, ...(data as Fee[]).filter((d) => !cur.some((c) => c.id === d.id))]);
    }
  }, [supabase, clientId]);

  async function openSrp(id: string) {
    setLoading(true); setMsg(null); pending.current.clear(); setDirtyCount(0); setSelected(new Set()); setPlatformFilter(""); setTokoFilter(""); setTypeQuery("");
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
  async function createSrp(listId: string): Promise<string> {
    if (!clientId) return "";
    setBusy(true);
    const { data, error } = await supabase.rpc("calc_srp_create", { p_client_id: clientId, p_list_id: listId });
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

  // Export XLS: every line of this SRP with all the cells you can edit (same columns as Import XLS), so the SRP can be edited in Excel
  async function exportXls() {
    if (!srp) return;
    const XLSX = await import("xlsx");
    const yn = (b: boolean) => (b ? "Yes" : "No");
    const body = rows.map((r, i) => {
      const f = r.fee_id ? feesById.get(r.fee_id) ?? null : null;
      const c = computeCalc({ hargaJual: r.harga_jual_rp, modalProduk: r.modal_produk_rp, targetRoas: r.target_roas, beratKg: r.berat_kg, ukuranCm3: r.ukuran_cm3,
        gratisOngkirOn: r.gratis_ongkir_on, promoXtraOn: r.promo_xtra_on, paylater3moOn: r.paylater_3mo_on, paylater6moOn: r.paylater_6mo_on, biayaLain: r.biaya_lain_rp }, f);
      return [i + 1, r.prod_id || "", r.item_product || "", Math.round(r.modal_produk_rp), Math.round(r.harga_jual_rp), r.fee_platform || "", r.fee_jenis_toko || "", r.fee_category || "",
        r.fee_sub_category || "", r.fee_jenis_product || "", r.product_line || "", r.target_roas, r.berat_kg, r.ukuran_cm3, yn(r.gratis_ongkir_on), yn(r.promo_xtra_on),
        yn(r.paylater_3mo_on), yn(r.paylater_6mo_on), Math.round(r.biaya_lain_rp), pajakPctOf(f), Math.round(c.pajakRp), Math.round(c.totalBiaya), Math.round(c.profit)];
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[...CALC_HEADER], ...body]);
    ws["!cols"] = CALC_HEADER.map((h) => ({ wch: h === "Product Name" ? 40 : Math.max(12, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, "Perhitungan Harga");
    const feeSheet = XLSX.utils.aoa_to_sheet([["Platform", "Jenis Toko", "Category", "Sub Category", "Jenis Product"], ...fees.map((f) => [f.platform, f.jenis_toko || "", f.category, f.sub_category || "", f.jenis_product || ""])]);
    feeSheet["!cols"] = [18, 18, 28, 28, 28].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, feeSheet, "Fee options");
    const guide = XLSX.utils.aoa_to_sheet([
      ["How to fill"], [""],
      ["Prod ID", "Required. A line is identified by Prod ID + Platform + Jenis Toko: importing a known line UPDATES it, a new one is ADDED to this SRP."],
      ["Empty cell", "On a known line an empty cell leaves that value as it is."],
      ["Modal Produk / Harga Jual", "Rp. On a NEW line, empty = the Harga Beli / Harga Jual of the Catalog."],
      ["Platform / Jenis Toko / Category / Sub Category / Jenis Product", "Copy the five values of ONE row of the sheet Fee options. They link the line to its Marketplace Fee row."],
      ["Gratis Ongkir / Promo Xtra / Paylater 3 Bln / Paylater 6 Bln", "Yes or No."],
      ["Pajak % / Pajak Rp / Total Biaya / Profit", "Only for reading: the Pajak % comes from the linked fee row; they are worked out again on the screen."],
    ]);
    guide["!cols"] = [{ wch: 52 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, guide, "Guide");
    XLSX.writeFile(wb, `${srp.srp_no}-perhitungan-harga.xlsx`);
  }

  async function importXls(file: File) {
    if (!srp) return;
    if (dirtyCount && !confirm(`${dirtyCount} line${dirtyCount === 1 ? " has" : "s have"} changes that are not saved. The import replaces them. Continue?`)) return;
    setBusy(true); setMsg(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
      const parsed = parseCalcXls(matrix);
      if (parsed.error) { setMsg({ ok: false, text: parsed.error }); return; }
      const byKey = new Map(rows.map((r) => [lineKeyOf(r.prod_id || "", r.fee_platform, r.fee_jenis_toko), r]));
      const catById = new Map(srpItems.map((c) => [c.prod_id, c]));
      const updates: [string, Partial<CalcRow>][] = []; const inserts: Record<string, unknown>[] = [];
      let incomplete = 0;
      for (const x of parsed.rows) {
        let ex = byKey.get(lineKeyOf(x.prod_id, x.platform, x.toko));
        if (!ex) { const free = rows.filter((r) => r.prod_id === x.prod_id && !r.fee_id && !r.fee_platform); if (free.length === 1) ex = free[0]; }
        const merged: FeeSel = { ...(ex ? keysOf(ex) : emptySel) };
        for (const k of FEE_FIELDS) if (x.fee?.[k]) merged[k] = x.fee[k] as string;
        const hit = resolveFee(merged, fees);
        if (!hit && FEE_FIELDS.some((k) => merged[k])) incomplete++;
        const patch: Partial<CalcRow> = {};
        if (x.item_product !== undefined) patch.item_product = x.item_product;
        if (x.modal_produk_rp !== undefined) patch.modal_produk_rp = x.modal_produk_rp;
        if (x.harga_jual_rp !== undefined) patch.harga_jual_rp = x.harga_jual_rp;
        if (x.product_line !== undefined) patch.product_line = x.product_line;
        if (x.target_roas !== undefined) patch.target_roas = x.target_roas;
        if (x.berat_kg !== undefined) patch.berat_kg = x.berat_kg;
        if (x.ukuran_cm3 !== undefined) patch.ukuran_cm3 = x.ukuran_cm3;
        if (x.gratis_ongkir_on !== undefined) patch.gratis_ongkir_on = x.gratis_ongkir_on;
        if (x.promo_xtra_on !== undefined) patch.promo_xtra_on = x.promo_xtra_on;
        if (x.paylater_3mo_on !== undefined) patch.paylater_3mo_on = x.paylater_3mo_on;
        if (x.paylater_6mo_on !== undefined) patch.paylater_6mo_on = x.paylater_6mo_on;
        if (x.biaya_lain_rp !== undefined) patch.biaya_lain_rp = x.biaya_lain_rp;
        if (x.fee) Object.assign(patch, keysPatch(merged), { fee_id: hit?.id ?? null });
        if (ex) {
          if (Object.keys(patch).length) updates.push([ex.id, patch]);
          byKey.delete(lineKeyOf(ex.prod_id || "", ex.fee_platform, ex.fee_jenis_toko));
          continue;
        }
        const c = catById.get(x.prod_id);
        const rest: Partial<CalcRow> = { ...patch };
        delete rest.item_product; delete rest.modal_produk_rp; delete rest.harga_jual_rp;
        inserts.push({
          client_id: clientId, srp_id: srp.id, prod_id: x.prod_id, item_product: x.item_product ?? c?.product_name ?? "",
          modal_produk_rp: x.modal_produk_rp ?? c?.harga_beli ?? 0, harga_jual_rp: x.harga_jual_rp ?? c?.harga_srp ?? 0,
          ...keysPatch(merged), fee_id: hit?.id ?? null, ...rest,
        });
      }
      const results = await Promise.all(updates.map(([id, p]) => supabase.from("massive_calc_rows").update(p).eq("id", id)));
      const bad = results.find((r) => r.error)?.error;
      if (bad) { setMsg({ ok: false, text: bad.message }); return; }
      if (inserts.length) {
        const { error } = await supabase.from("massive_calc_rows").insert(inserts);
        if (error) { setMsg({ ok: false, text: error.message }); return; }
      }
      pending.current.clear(); setDirtyCount(0);
      await reloadRows(srp.id); setRev((n) => n + 1);
      const sk = parsed.skipped;
      setMsg({ ok: true, text: `Imported: ${updates.length} updated, ${inserts.length} added${incomplete ? ` · ${incomplete} line${incomplete === 1 ? " has" : "s have"} Platform / Jenis Toko saved but no fee row yet (Category, Sub Category and Jenis Product must match the sheet Fee options)` : ""}${sk.length ? ` · ${sk.length} skipped: ${sk.slice(0, 3).map((x) => `row ${x.row}: ${x.reason}`).join("; ")}${sk.length > 3 ? "…" : ""}` : ""}. Press Save when you are done.` });
    } finally { setBusy(false); }
  }

  // Edit selected: the same values on every ticked line. The fee values picked change on each line on its own; a line keeps the ones not picked.
  async function massEdit(patch: Partial<CalcRow>, choice: FeeSel | null): Promise<string> {
    if (!srp || !selectedRows.length) return "";
    if (dirtyCount && !confirm(`${dirtyCount} line${dirtyCount === 1 ? " has" : "s have"} changes that are not saved. The mass edit replaces them. Continue?`)) return "cancel";
    setBusy(true);
    try {
      let incomplete = 0;
      const jobs = selectedRows.map((r): [string, Partial<CalcRow>] => {
        if (!choice) return [r.id, patch];
        const m = mergeFee(r, choice);
        const hit = resolveFee(m, fees);
        if (!hit && FEE_FIELDS.some((k) => m[k])) incomplete++;
        return [r.id, { ...patch, ...keysPatch(m), fee_id: hit?.id ?? null }];
      });
      for (let i = 0; i < jobs.length; i += 20) {
        const res = await Promise.all(jobs.slice(i, i + 20).map(([id, p]) => supabase.from("massive_calc_rows").update(p).eq("id", id)));
        const bad = res.find((x) => x.error)?.error;
        if (bad) return bad.message;
      }
      pending.current.clear(); setDirtyCount(0);
      await reloadRows(srp.id); setRev((n) => n + 1);
      setMassOpen(null);
      const n = selectedRows.length;
      setMsg({ ok: true, text: `${n} line${n === 1 ? "" : "s"} edited.${incomplete ? ` ${incomplete} line${incomplete === 1 ? " has" : "s have"} Platform / Jenis Toko saved but no fee row yet: add Category, Sub Category and Jenis Product to link ${incomplete === 1 ? "it" : "them"}.` : ""} Press Save when you are done.` });
      return "";
    } finally { setBusy(false); }
  }

  // Duplicate selected: a copy of every ticked line; the copies can take other fee values (for example another platform)
  async function massDuplicate(choice: FeeSel | null): Promise<string> {
    if (!srp || !selectedRows.length) return "";
    setBusy(true);
    try {
      let incomplete = 0;
      const copies = selectedRows.map((r) => {
        const m = choice ? mergeFee(r, choice) : keysOf(r);
        const hit = resolveFee(m, fees);
        if (!hit && FEE_FIELDS.some((k) => m[k])) incomplete++;
        return {
          client_id: clientId, srp_id: srp.id, prod_id: r.prod_id, item_product: r.item_product, product_line: r.product_line,
          modal_produk_rp: r.modal_produk_rp, harga_jual_rp: r.harga_jual_rp, ...keysPatch(m), fee_id: hit?.id ?? null,
          target_roas: r.target_roas, berat_kg: r.berat_kg, ukuran_cm3: r.ukuran_cm3,
          gratis_ongkir_on: r.gratis_ongkir_on, promo_xtra_on: r.promo_xtra_on, paylater_3mo_on: r.paylater_3mo_on, paylater_6mo_on: r.paylater_6mo_on, biaya_lain_rp: r.biaya_lain_rp,
        };
      });
      for (let i = 0; i < copies.length; i += 100) {
        const { error } = await supabase.from("massive_calc_rows").insert(copies.slice(i, i + 100));
        if (error) return error.message;
      }
      await reloadRows(srp.id);
      setMassOpen(null); setSelected(new Set());
      setMsg({ ok: true, text: `${copies.length} line${copies.length === 1 ? "" : "s"} duplicated.${incomplete ? ` ${incomplete} cop${incomplete === 1 ? "y has" : "ies have"} Platform / Jenis Toko but no fee row yet.` : ""}` });
      return "";
    } finally { setBusy(false); }
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
              <button className="btn-ghost" onClick={exportXls} disabled={!rows.length}>⬇ Export XLS</button>
              <label className="btn-ghost" style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? .6 : 1 }}>
                Import XLS
                <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importXls(f); e.target.value = ""; }} />
              </label>
              <button className="btn-ghost" onClick={deleteSrp} style={{ color: "#f87171" }}>Delete SRP</button>
              <button className="btn-gold" disabled={busy} onClick={saveAll} style={{ padding: "10px 26px" }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
          {msg && <div style={{ color: msg.ok ? "var(--gold)" : "#f87171", fontSize: 13, marginTop: 8 }}>{msg.ok ? "✓" : "✗"} {msg.text}</div>}

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <div className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <label style={{ margin: 0 }}>Platform</label>
              <select value={platformFilter} onChange={(e) => { setPlatformFilter(e.target.value); setTokoFilter(""); }}>
                <option value="">All Platforms</option>
                {platformOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                <option value="__none">No platform yet</option>
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <label style={{ margin: 0 }}>Jenis Toko</label>
              <select value={tokoFilter} onChange={(e) => setTokoFilter(e.target.value)}>
                <option value="">All</option>
                {tokoOptions.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <label style={{ margin: 0 }}>Product</label>
              <input value={typeQuery} onChange={(e) => setTypeQuery(e.target.value)} placeholder="type AC, TV, Mesin Cuci…" style={{ minWidth: 220 }} />
              {typeQuery && <button className="btn-ghost" onClick={() => setTypeQuery("")} style={{ padding: "4px 10px" }}>✕</button>}
            </div>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{visible.length} of {rows.length} lines · {selectedRows.length} ticked</span>
            <button className="btn-ghost" disabled={!selectedRows.length || busy} onClick={() => setMassOpen("edit")}>✎ Edit selected</button>
            <button className="btn-ghost" disabled={!selectedRows.length || busy} onClick={() => setMassOpen("dup")}>⧉ Duplicate selected</button>
            {selectedRows.length > 0 && <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear ticks</button>}
          </div>
          <div className="tbl-wrap" style={{ marginTop: 10, height: "calc(100vh - 340px)", minHeight: 320, overflowX: "auto", overflowY: "auto" }}>
            <table className="tbl calc-tbl" style={{ width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={stickyTh}><input type="checkbox" title="Tick all the lines shown"
                    checked={visible.length > 0 && visible.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected((st) => { const n = new Set(st); visible.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} /></th>
                  <SortTh style={stickyTh} k="no" label="No" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="platform" label="Platform" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="toko" label="Jenis Toko" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="prod" label="Product ID" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="name" label="Product Name" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="catalog" label="Catalog ID" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="beli" label="Harga Beli" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="jualcat" label="Harga Jual (Catalog)" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="lowest" label="Lowest Competitor" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="line" label="Category" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="modal" label="Modal Produk" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="jual" label="Harga Jual (Rp)" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="markup" label="Harga Jual (%)" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="biaya" label="Total Biaya" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="profit" label="Profit" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="fcat" label="Category (Fee)" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="fsub" label="Sub Category" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="fjenis" label="Jenis Product" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="roas" label="Target ROAS" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="pctads" label="% Ads" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="biayaads" label="Biaya Ads" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="pfpct" label="Platform Fee %" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="pfrp" label="Platform Fee Rp" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="proses" label="Biaya Proses Pesanan" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="mallpct" label="Biaya Layanan Mall %" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="mallrp" label="Biaya Layanan Mall Rp" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="ongkir" label="Gratis Ongkir" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="berat" label="Berat (kg)" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="uk" label="Uk PxLxT (cm³)" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="ongkirrp" label="Biaya Ongkir" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="promo" label="Promo Xtra" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="promorp" label="Promo Xtra Rp" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="p3" label="Paylater 3 Bln" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="p3rp" label="Paylater 3mo Rp" sort={sort} onSort={toggleSort} />
                  <SortTh style={stickyTh} k="p6" label="Paylater 6 Bln" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="p6rp" label="Paylater 6mo Rp" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="pajakpct" label="Pajak %" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="pajakrp" label="Pajak Rp" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="lain" label="Biaya Lain" sort={sort} onSort={toggleSort} />
                  <SortTh className="num" style={stickyTh} k="nett" label="Nett Profit" sort={sort} onSort={toggleSort} />
                  <th style={stickyTh}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <CalcRowLine key={`${r.id}-${rev}`} no={i + 1} selected={selected.has(r.id)} onToggle={toggleOne} row={r} fee={r.fee_id ? feesById.get(r.fee_id) ?? null : null} fees={fees}
                    catalog={srpItems} lowest={lowest}
                    onSave={saveRow} onDelete={deleteRow} onPending={onPending} />
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={43} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>This SRP has no lines.</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={43} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {massOpen === "edit" && <MassEditModal fees={fees} count={selectedRows.length} busy={busy} onClose={() => setMassOpen(null)} onApply={massEdit} />}
      {massOpen === "dup" && <MassDuplicateModal fees={fees} count={selectedRows.length} busy={busy} onClose={() => setMassOpen(null)} onApply={massDuplicate} />}
      {picking && <CatalogPicker supabase={supabase} clientId={clientId} busy={busy} onClose={() => setPicking(false)} onAdd={createSrp} />}
    </>
  );
}

function CalcRowLine({ no, row, fee, fees, catalog, lowest, selected, onToggle, onSave, onDelete, onPending }: {
  no: number; row: CalcRow; fee: Fee | null; fees: Fee[];
  catalog: CatalogItem[]; lowest: Map<string, number>;
  onPending: (id: string, patch: Partial<CalcRow> | null) => void;
  onSave: (id: string, patch: Partial<CalcRow>) => void;
  onDelete: (id: string) => void;
  selected: boolean; onToggle: (id: string) => void;
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
  const [sel, setSel] = useState<FeeSel>(() => keysOf(row));

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
    || parsed.modal_produk_rp !== Math.round(row.modal_produk_rp)
    || parsed.harga_jual_rp !== Math.round(row.harga_jual_rp)
    || parsed.target_roas !== row.target_roas
    || parsed.berat_kg !== row.berat_kg
    || parsed.ukuran_cm3 !== row.ukuran_cm3
    || parsed.biaya_lain_rp !== Math.round(row.biaya_lain_rp)
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
  const cat = v.prod_id ? catalogById.get(v.prod_id) ?? null : null;
  const low = v.prod_id ? lowest.get(v.prod_id) ?? null : null;
  // picking a catalog product fills the name, the Prod ID, Modal Produk = its Harga Beli and (as the starting point) Harga Jual = its Harga Jual
  function pickProduct(prodId: string) {
    const c = prodId ? catalogById.get(prodId) : null;
    setV((st) => ({ ...st, prod_id: prodId, item_product: c ? c.product_name : st.item_product, modal_produk_rp: c && c.harga_beli != null ? formatRp(c.harga_beli) : st.modal_produk_rp, harga_jual_rp: c && c.harga_srp != null ? formatRp(c.harga_srp) : st.harga_jual_rp }));
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
    onSave(row.id, { ...keysPatch(next), fee_id: match?.id ?? null });
  }
  function clearFee() {
    setSel(emptySel);
    onSave(row.id, { ...keysPatch(emptySel), fee_id: null });
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
      <td><input type="checkbox" checked={selected} onChange={() => onToggle(row.id)} /></td>
      <td>{no}</td>
      <td>{feeSelect("platform")}</td>
      <td>{feeSelect("jenis_toko")}</td>
      <td className="calc-ro" style={{ fontFamily: "monospace" }}>{cat?.prod_id || "—"}</td>
      <td>
        <select className="calc-sel" value={v.prod_id} onChange={(e) => pickProduct(e.target.value)} style={{ width: 230, maxWidth: 230 }} title="The product comes from the Product Catalog">
          <option value="">{v.item_product ? `${v.item_product} (not in catalog)` : "— pick product —"}</option>
          {catalog.map((c) => <option key={c.prod_id} value={c.prod_id}>{c.product_name}</option>)}
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
      <td>{feeSelect("category")}</td>
      <td>{feeSelect("sub_category")}</td>
      <td>{feeSelect("jenis_product")}
        {FEE_FIELDS.some((k) => sel[k]) && <button onClick={clearFee} className="btn-ghost" style={{ padding: "1px 6px", fontSize: 10, marginLeft: 4 }}>✕</button>}
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
      <td className="num calc-ro">{pajakPctOf(fee)}%</td>
      <td className="num calc-ro">Rp {formatRp(calc.pajakRp)}</td>
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
function CatalogPicker({ supabase, clientId, busy, onClose, onAdd }: {
  supabase: ReturnType<typeof createClient>; clientId: string;
  busy: boolean; onClose: () => void; onAdd: (listId: string) => Promise<string>;
}) {
  const [logs, setLogs] = useState<CatalogLog[] | null>(null);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("pr_srp_lists_log", { p_client_id: clientId });
      const l = (data as CatalogLog[]) || [];
      setLogs(l); setPick(l.find((x) => x.in_force)?.id || l[0]?.id || "");
    })();
  }, [supabase, clientId]);
  const chosen = logs?.find((x) => x.id === pick) ?? null;
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
                <tr key={l.id} onClick={() => setPick(l.id)} style={{ cursor: "pointer" }}>
                  <td><input type="radio" checked={pick === l.id} onChange={() => setPick(l.id)} /></td>
                  <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{l.srp_no}</td>
                  <td>{l.vendor_name || <span style={{ color: "var(--muted)" }}>Default</span>}</td>
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
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-gold" disabled={!chosen || busy} style={{ padding: "10px 24px" }}
          onClick={async () => { setErr(""); const m = await onAdd(pick); if (m) setErr(m); }}>
          {busy ? "Creating…" : chosen ? `Create SRP from ${chosen.srp_no} (${chosen.total_sku} products)` : "Create"}
        </button>
      </div>
    </Modal>
  );
}

const FEE_LABEL: Record<keyof FeeSel, string> = { category: "Category", sub_category: "Sub Category", jenis_product: "Jenis Product", platform: "Platform", jenis_toko: "Jenis Toko" };

// the five fee values, narrowing each other (like the dropdowns of a line); "blank" is what an untouched one reads
function FeePicker({ fees, value, onChange, blank, free }: { fees: Fee[]; value: FeeSel; onChange: (v: FeeSel) => void; blank: string; free?: boolean }) {
  const order: (keyof FeeSel)[] = ["platform", "jenis_toko", "category", "sub_category", "jenis_product"];   // the marketplace first, then the product category
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {order.map((field) => (
        <div className="fld" key={field} style={field === "jenis_product" ? { gridColumn: "1 / -1" } : undefined}><label>{FEE_LABEL[field]}</label>
          <select value={value[field]} onChange={(e) => onChange(free ? { ...value, [field]: e.target.value } : refineSel({ ...value, [field]: e.target.value }, fees))}>
            <option value="">{blank}</option>
            {optionsFor(field, value, fees).map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
      ))}
    </div>
  );
}

type Tri = "" | "Yes" | "No";
const triSelect = (label: string, v: Tri, set: (x: Tri) => void) => (
  <div className="fld"><label>{label}</label>
    <select value={v} onChange={(e) => set(e.target.value as Tri)}><option value="">— keep —</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
);

function MassEditModal({ fees, count, busy, onClose, onApply }: { fees: Fee[]; count: number; busy: boolean; onClose: () => void; onApply: (patch: Partial<CalcRow>, choice: FeeSel | null) => Promise<string> }) {
  const [sel, setSel] = useState<FeeSel>(emptySel);
  const [f, setF] = useState({ product_line: "", target_roas: "", berat_kg: "", ukuran_cm3: "", biaya_lain_rp: "", modal_produk_rp: "", harga_jual_rp: "" });
  const [t, setT] = useState<{ ongkir: Tri; promo: Tri; p3: Tri; p6: Tri }>({ ongkir: "", promo: "", p3: "", p6: "" });
  const [err, setErr] = useState("");
  const choice = FEE_FIELDS.some((k) => sel[k]) ? sel : null;
  const num = (x: string) => (x.trim() === "" ? undefined : parseRp(x));
  async function apply() {
    setErr("");
    const patch: Partial<CalcRow> = {};
    if (f.product_line.trim()) patch.product_line = f.product_line.trim();
    const n = (k: "target_roas" | "berat_kg" | "ukuran_cm3") => { const v = f[k].trim() === "" ? undefined : Number(f[k].replace(",", ".")); if (v !== undefined && Number.isFinite(v)) patch[k] = v; };
    n("target_roas"); n("berat_kg"); n("ukuran_cm3");
    const r = (k: "biaya_lain_rp" | "modal_produk_rp" | "harga_jual_rp") => { const v = num(f[k]); if (v !== undefined && Number.isFinite(v)) patch[k] = v; };
    r("biaya_lain_rp"); r("modal_produk_rp"); r("harga_jual_rp");
    if (t.ongkir) patch.gratis_ongkir_on = t.ongkir === "Yes";
    if (t.promo) patch.promo_xtra_on = t.promo === "Yes";
    if (t.p3) patch.paylater_3mo_on = t.p3 === "Yes";
    if (t.p6) patch.paylater_6mo_on = t.p6 === "Yes";
    if (!Object.keys(patch).length && !choice) { setErr("Nothing to change: fill at least one field."); return; }
    const m = await onApply(patch, choice);
    if (m && m !== "cancel") setErr(m);
  }
  const inp = (k: keyof typeof f, label: string, ph = "") => (
    <div className="fld"><label>{label}</label><input value={f[k]} placeholder={ph || "keep"} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <Modal onClose={onClose} width={760}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>Edit {count} selected line{count === 1 ? "" : "s"}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>The same change on every ticked line. A field left on <b>keep</b> / empty is not touched.</div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Marketplace fee row</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Pick only what changes (for example just the Platform). Each line keeps its other fee values, and gets the fee row that matches the result.</div>
      <FeePicker fees={fees} value={sel} onChange={setSel} blank="— keep —" free />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 14 }}>
        {inp("modal_produk_rp", "Modal Produk (Rp)")}{inp("harga_jual_rp", "Harga Jual (Rp)")}{inp("target_roas", "Target ROAS")}{inp("product_line", "Product Line")}
        {inp("berat_kg", "Berat (kg)")}{inp("ukuran_cm3", "Uk PxLxT (cm³)")}{inp("biaya_lain_rp", "Biaya Lain (Rp)")}<div />
        {triSelect("Gratis Ongkir", t.ongkir, (x) => setT({ ...t, ongkir: x }))}{triSelect("Promo Xtra", t.promo, (x) => setT({ ...t, promo: x }))}
        {triSelect("Paylater 3 Bln", t.p3, (x) => setT({ ...t, p3: x }))}{triSelect("Paylater 6 Bln", t.p6, (x) => setT({ ...t, p6: x }))}
      </div>
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-gold" disabled={busy} onClick={apply} style={{ padding: "10px 24px" }}>{busy ? "Applying…" : `Apply to ${count} line${count === 1 ? "" : "s"}`}</button>
      </div>
    </Modal>
  );
}

function MassDuplicateModal({ fees, count, busy, onClose, onApply }: { fees: Fee[]; count: number; busy: boolean; onClose: () => void; onApply: (choice: FeeSel | null) => Promise<string> }) {
  const [sel, setSel] = useState<FeeSel>(emptySel);
  const [err, setErr] = useState("");
  async function apply() {
    setErr("");
    const m = await onApply(FEE_FIELDS.some((k) => sel[k]) ? sel : null);
    if (m) setErr(m);
  }
  return (
    <Modal onClose={onClose} width={680}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>Duplicate {count} selected line{count === 1 ? "" : "s"}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>Each ticked line is copied with all its values. To make the copies for another marketplace, pick only what changes (for example the Platform and Jenis Toko of Tiktok); each copy keeps its other fee values and gets the matching fee row.</div>
      <FeePicker fees={fees} value={sel} onChange={setSel} blank="— same as the line —" free />
      {err && <div style={{ color: "#f87171", fontSize: 13, marginTop: 10 }}>✗ {err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-gold" disabled={busy} onClick={apply} style={{ padding: "10px 24px" }}>{busy ? "Duplicating…" : `Duplicate ${count} line${count === 1 ? "" : "s"}`}</button>
      </div>
    </Modal>
  );
}

// A column header that sorts the lines: an arrow shows the direction of the sort on that column
function SortTh({ label, k, sort, onSort, className, style }: {
  label: string; k: string; sort: { k: string; dir: "asc" | "desc" } | null; onSort: (k: string) => void;
  className?: string; style?: React.CSSProperties;
}) {
  const active = sort?.k === k;
  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={className} title="Sort" onClick={() => onSort(k)} style={{ ...style, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: className === "num" ? "flex-end" : "flex-start", width: "100%" }}>
        {label}
        <Icon size={12} style={{ opacity: active ? 1 : 0.4, flexShrink: 0 }} />
      </span>
    </th>
  );
}

