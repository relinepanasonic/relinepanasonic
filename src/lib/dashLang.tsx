"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Shared ID/EN/JP layer for the Dashboard page + its lazy-loaded charts
// (DashboardCharts.tsx, BaselineChart.tsx) and the BOD PDF (bodReportPdf.tsx).
// A flat string table (not deeply nested) so adding a key never needs a type
// change beyond the DashKey union below — en/jp are typechecked against id's
// keys via `satisfies`, so a missing translation is a compile error.
export type Lang = "id" | "en" | "jp";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "id", label: "ID" }, { code: "en", label: "EN" }, { code: "jp", label: "JP" },
];

const STORAGE_KEY = "reline_dash_lang";
export function getStoredLang(): Lang {
  if (typeof window === "undefined") return "id";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "en" || v === "jp" || v === "id" ? v : "id";
}
export function setStoredLang(l: Lang) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
}
// Shared across every component on the page (page.tsx owns the source of
// truth via its own useState; this hook is for the sub-components loaded
// separately, e.g. BaselineChart/DashboardCharts read it from a prop instead
// — see the `lang` prop on those). Exposed for completeness / potential
// future standalone consumers.
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(getStoredLang);
  useEffect(() => { setStoredLang(lang); }, [lang]);
  return [lang, setLang];
}

// The ID/EN/JP switcher itself lives in the sidebar (layout.tsx, so it's on
// every page, not re-packed into the Dashboard's filter bar), but the
// Dashboard page and its charts need to read the current value too. A
// context (provided once around the whole app shell in layout.tsx) keeps
// both in sync without prop-drilling across a layout/page boundary.
const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void } | null>(null);
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("id");
  useEffect(() => { setLangState(getStoredLang()); }, []);
  function setLang(l: Lang) { setLangState(l); setStoredLang(l); }
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}
export function useLangContext(): { lang: Lang; setLang: (l: Lang) => void } {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLangContext must be used inside <LangProvider>");
  return ctx;
}

// {name}-style placeholders, substituted manually (no templating dependency).
export function tf(str: string, vars: Record<string, string | number>): string {
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const id = {
  // Filter bar
  f_year: "Tahun", f_quarter: "Kuartal", f_month: "Bulan", f_week: "Minggu", f_city: "Kota", f_dealer: "Dealer",
  f_allYears: "Semua Tahun", f_allQuarters: "Semua Kuartal", f_allMonths: "Semua Bulan", f_allWeeks: "Semua Minggu",
  f_allCities: "Semua Kota", f_allDealers: "Semua Dealer",
  f_reset: "Reset", f_loading: "Memuat data…",
  f_report: "Laporan", f_buildingReport: "Membuat Laporan",
  f_reportTooltip: "Unduh laporan PDF 16:9 sesuai filter yang dipilih",
  f_buildingNote: "Menyusun 7 halaman PDF (16:9) dari filter yang dipilih — mohon tunggu sebentar.",
  f_reportFailed: "Gagal membuat laporan.",

  // KPIs
  k_panasonicSales: "Penjualan Panasonic", k_panasonicSalesSub: "SPOS · Siap Dikirim",
  k_totalGmv: "Total GMV", k_totalGmvSub: "Performa Toko",
  k_panaTraffic: "Trafik Panasonic", k_panaInCart: "Pana Masuk Keranjang", k_cartRate: "rasio keranjang",
  k_adsCost: "Biaya Iklan", k_roas: "ROAS",

  // Panels
  p_monthlySalesTitle: "Penjualan Bulanan Panasonic", p_monthlySalesHint: "Penjualan Siap Dikirim per bulan · SPOS",
  p_topProductsTitle: "10 Produk Terlaris", p_topProductsHint: "Penjualan · hanya baris induk",
  p_brandShareTitle: "Pangsa Penjualan per Brand", p_brandShareHint: "Panasonic vs Lainnya · SPOS",
  p_costRoasTitle: "Biaya Iklan Bulanan vs ROAS", p_costRoasHint: "Batang = biaya · garis = ROAS",
  p_trafficTrendTitle: "Trafik vs Tambah ke Keranjang", p_trafficTrendHint: "Tren funnel per bulan",
  p_storeMonthlyTitle: "Penjualan Toko per Bulan", p_storeMonthlyHint: "GMV semua brand · Performa",
  p_productFunnelTitle: "Funnel Produk", p_productFunnelHint: "Panasonic · SPOS · Tayang → Klik → Masuk Keranjang → Penjualan",
  p_salesByCategoryTitle: "Penjualan per Kategori", p_salesByCategoryHint: "SPOS · jenis produk",
  p_categoryShareTitle: "Pangsa Kategori (%)", p_categoryShareHint: "Komposisi penjualan per kategori",

  // Dealer table
  t_title: "Detail Data per Dealer",
  t_sortedBy: "Diurutkan berdasarkan {key} ({dir})", t_sortHint: "Diurutkan berdasarkan penjualan · klik kolom untuk mengurutkan",
  t_dealer: "Dealer", t_trend: "Tren", t_city: "Kota", t_sales: "Penjualan", t_traffic: "Trafik",
  t_inCart: "Keranjang", t_cartRate: "Rasio Keranjang", t_adsCost: "Biaya Iklan", t_roas: "ROAS", t_noData: "Belum ada data",

  // Charts (DashboardCharts.tsx)
  c_noData: "Belum ada data", c_sales: "Penjualan", c_cost: "Biaya", c_roas: "ROAS", c_traffic: "Trafik", c_inCart: "Keranjang", c_adsSpend: "Belanja Iklan",
  c_funnelImpression: "Tayang", c_funnelClick: "Klik", c_funnelInCart: "Masuk Keranjang", c_funnelSales: "Penjualan",
  c_funnelPartialNote: "Bentuk funnel disembunyikan — sebagian tahap belum punya data, sehingga proporsinya tidak bermakna. Tayang & Klik dibaca dari kolom template SPOS terbaru (Jumlah Produk Dilihat / Produk Diklik); akan terisi seiring file SPOS diunggah ulang.",
  c_funnelNonMonotonicNote: "Tahap berikutnya lebih besar dari tahap sebelumnya. Periode yang diunggah dengan template SPOS lama tidak punya kolom tayang/klik asli — kolom itu memakai Halaman Produk Dilihat (page view) dan Klik Pencarian (klik pencarian saja), yang menghitung klik lebih rendah dari sebenarnya.",

  // BaselineChart.tsx
  b_title: "Performa Baseline vs Aktif",
  b_loading: "Memuat…",
  b_noBaseline: 'Belum ada data baseline "Month Awal" untuk {scope}.',
  b_noDataMonth: "Belum ada data {month} untuk {scope}.",
  b_noDataYear: "Belum ada data penjualan untuk {scope}.",
  b_avgPerMonth: "rata-rata / bulan",
  b_monthlySalesTitle: "Penjualan Bulanan {label}", b_avgMonthlySalesTitle: "Rata-rata Penjualan Bulanan {label}",
  b_adsRoasTitle: "Belanja Iklan & ROAS {label}", b_avgAdsRoasTitle: "Rata-rata Belanja Iklan & ROAS {label}",
  b_hintSuffixSales: "{suffix} · SPOS · Aktif = {tag}", b_hintSuffixAds: "{suffix} · Iklan · Aktif = {tag}",
  b_panasonic: "Panasonic", b_allBrand: "Semua Brand", b_everyBrand: "Semua brand di toko",
  b_baseline: "Baseline", b_active: "Aktif", b_activeAvg: "Aktif (rata-rata)",
  b_marketShareTitle: "Pangsa Pasar Panasonic (Baseline vs Aktif)",
  b_marketShareHint: "Panasonic ÷ total penjualan toko (semua brand) · SPOS",
  b_otherBrands: "Brand Lain",
  b_categoryShareTitle: "Pangsa Kategori (Baseline vs Aktif)",
  b_categoryShareHint: "Komposisi penjualan per kategori — semua brand · SPOS",
  b_scopeMonthHint: 'Snapshot pra-proyek ("Month Awal", total {stores} toko{storesPlural}) vs {month}.',
  b_scopeAvgHint: 'Snapshot pra-proyek ("Month Awal", total {stores} toko{storesPlural}) vs rata-rata dari {months} bulan{monthsPlural} data — total se-kota, bukan per toko. Pilih Bulan tertentu di filter atas untuk melihat angka riil bulan itu, bukan rata-rata.',
  b_thinAdsWarning: "Belanja iklan Baseline hanya {amount} total (mendekati nol — belum ada program iklan sebelum proyek), sehingga ROAS Baseline ({baseRoas}) adalah artefak dari penyebut yang mendekati nol, bukan rasio yang bermakna untuk dibandingkan dengan Aktif ({activeRoas}).",
};

const en = {
  f_year: "Year", f_quarter: "Quarter", f_month: "Month", f_week: "Week", f_city: "City", f_dealer: "Dealer",
  f_allYears: "All Years", f_allQuarters: "All Quarters", f_allMonths: "All Months", f_allWeeks: "All Weeks",
  f_allCities: "All Cities", f_allDealers: "All Dealers",
  f_reset: "Reset", f_loading: "Loading data…",
  f_report: "Report", f_buildingReport: "Building Report",
  f_reportTooltip: "Download a 16:9 PDF report for the selected filters",
  f_buildingNote: "Building a 7-page 16:9 PDF from the selected filters — please wait a moment.",
  f_reportFailed: "Failed to build the report.",

  k_panasonicSales: "Panasonic Sales", k_panasonicSalesSub: "SPOS · Ready to Ship",
  k_totalGmv: "Total GMV", k_totalGmvSub: "Store Performance",
  k_panaTraffic: "Pana Traffic", k_panaInCart: "Pana In-Cart", k_cartRate: "cart rate",
  k_adsCost: "Ads Cost", k_roas: "ROAS",

  p_monthlySalesTitle: "Panasonic Monthly Sales", p_monthlySalesHint: "Ready-to-ship sales per month · SPOS",
  p_topProductsTitle: "Top 10 Best-Selling Products", p_topProductsHint: "Sales · parent rows only",
  p_brandShareTitle: "Brand Share of Sales", p_brandShareHint: "Panasonic vs Other · SPOS",
  p_costRoasTitle: "Monthly Ads Cost vs ROAS", p_costRoasHint: "Columns = cost · line = ROAS",
  p_trafficTrendTitle: "Traffic vs Add-to-Cart", p_trafficTrendHint: "Funnel trend per month",
  p_storeMonthlyTitle: "Store Sales by Month", p_storeMonthlyHint: "All brands GMV · Store Performance",
  p_productFunnelTitle: "Product Funnel", p_productFunnelHint: "Panasonic · SPOS · Impression → Click → In Cart → Sales",
  p_salesByCategoryTitle: "Sales by Category", p_salesByCategoryHint: "SPOS · product type",
  p_categoryShareTitle: "Category Share (%)", p_categoryShareHint: "Sales mix by category",

  t_title: "Dealer Detail",
  t_sortedBy: "Sorted by {key} ({dir})", t_sortHint: "Sorted by sales · click a column to sort",
  t_dealer: "Dealer", t_trend: "Trend", t_city: "City", t_sales: "Sales", t_traffic: "Traffic",
  t_inCart: "In-Cart", t_cartRate: "Cart Rate", t_adsCost: "Ads Cost", t_roas: "ROAS", t_noData: "No data yet",

  c_noData: "No data yet", c_sales: "Sales", c_cost: "Cost", c_roas: "ROAS", c_traffic: "Traffic", c_inCart: "In-Cart", c_adsSpend: "Ads Spend",
  c_funnelImpression: "Impression", c_funnelClick: "Click", c_funnelInCart: "In Cart", c_funnelSales: "Sales",
  c_funnelPartialNote: "Funnel shape hidden — some stages have no data yet, so the proportions would be meaningless. Impression & Click are read from the newer SPOS template columns (Product Page Views / Product Clicks); they fill in as SPOS files are re-uploaded.",
  c_funnelNonMonotonicNote: "A later stage exceeds an earlier one. Periods uploaded with the older SPOS template have no true impression/click columns — those fall back to page views and search-only clicks, which undercounts real clicks.",

  b_title: "Baseline vs Active Performance",
  b_loading: "Loading…",
  b_noBaseline: 'No "Starting Month" baseline data for {scope}.',
  b_noDataMonth: "No data for {month} yet for {scope}.",
  b_noDataYear: "No sales data yet for {scope}.",
  b_avgPerMonth: "avg / month",
  b_monthlySalesTitle: "{label} Monthly Sales", b_avgMonthlySalesTitle: "{label} Avg Monthly Sales",
  b_adsRoasTitle: "{label} Ads Spend & ROAS", b_avgAdsRoasTitle: "{label} Avg Ads Spend & ROAS",
  b_hintSuffixSales: "{suffix} · SPOS · Active = {tag}", b_hintSuffixAds: "{suffix} · Ads · Active = {tag}",
  b_panasonic: "Panasonic", b_allBrand: "All Brand", b_everyBrand: "Every brand in the store",
  b_baseline: "Baseline", b_active: "Active", b_activeAvg: "Active (avg)",
  b_marketShareTitle: "Panasonic Market Share (Baseline vs Active)",
  b_marketShareHint: "Panasonic ÷ total store sales (all brands) · SPOS",
  b_otherBrands: "Other Brands",
  b_categoryShareTitle: "Category Share (Baseline vs Active)",
  b_categoryShareHint: "Sales mix by category — all brands · SPOS",
  b_scopeMonthHint: 'Pre-project snapshot ("Starting Month", {stores} store{storesPlural} total) vs {month}.',
  b_scopeAvgHint: 'Pre-project snapshot ("Starting Month", {stores} store{storesPlural} total) vs the average across {months} month{monthsPlural} of data — city-wide totals, not per store. Pick a specific Month in the filter above to see that month\'s real numbers instead of an average.',
  b_thinAdsWarning: "Baseline ad spend is only {amount} total (near zero — no ads program pre-project), so Baseline ROAS ({baseRoas}) is a near-zero-denominator artifact, not a meaningful ratio to compare against Active ({activeRoas}).",
} satisfies Record<keyof typeof id, string>;

const jp = {
  f_year: "年", f_quarter: "四半期", f_month: "月", f_week: "週", f_city: "都市", f_dealer: "販売店",
  f_allYears: "すべての年", f_allQuarters: "すべての四半期", f_allMonths: "すべての月", f_allWeeks: "すべての週",
  f_allCities: "すべての都市", f_allDealers: "すべての販売店",
  f_reset: "リセット", f_loading: "データを読み込み中…",
  f_report: "レポート", f_buildingReport: "レポート作成中",
  f_reportTooltip: "選択したフィルターでPDFレポート（16:9）をダウンロード",
  f_buildingNote: "選択したフィルターから7ページのPDF（16:9）を作成しています。しばらくお待ちください。",
  f_reportFailed: "レポートの作成に失敗しました。",

  k_panasonicSales: "パナソニック売上", k_panasonicSalesSub: "SPOS・出荷準備完了",
  k_totalGmv: "総GMV", k_totalGmvSub: "店舗実績",
  k_panaTraffic: "パナソニック トラフィック", k_panaInCart: "パナソニック カート追加", k_cartRate: "カート率",
  k_adsCost: "広告費", k_roas: "ROAS",

  p_monthlySalesTitle: "パナソニック月間売上", p_monthlySalesHint: "月ごとの出荷準備完了売上・SPOS",
  p_topProductsTitle: "売上トップ10製品", p_topProductsHint: "売上・親行のみ",
  p_brandShareTitle: "ブランド別売上シェア", p_brandShareHint: "パナソニック vs その他・SPOS",
  p_costRoasTitle: "月間広告費とROAS", p_costRoasHint: "棒グラフ＝費用・折れ線＝ROAS",
  p_trafficTrendTitle: "トラフィックとカート追加", p_trafficTrendHint: "月ごとのファネル推移",
  p_storeMonthlyTitle: "店舗別月間売上", p_storeMonthlyHint: "全ブランドGMV・店舗実績",
  p_productFunnelTitle: "商品ファネル", p_productFunnelHint: "パナソニック・SPOS・表示 → クリック → カート追加 → 購入",
  p_salesByCategoryTitle: "カテゴリー別売上", p_salesByCategoryHint: "SPOS・製品タイプ",
  p_categoryShareTitle: "カテゴリーシェア（%）", p_categoryShareHint: "カテゴリー別売上構成",

  t_title: "販売店別詳細データ",
  t_sortedBy: "{key}で並べ替え（{dir}）", t_sortHint: "売上で並べ替え中・列をクリックして並べ替え",
  t_dealer: "販売店", t_trend: "推移", t_city: "都市", t_sales: "売上", t_traffic: "トラフィック",
  t_inCart: "カート追加", t_cartRate: "カート率", t_adsCost: "広告費", t_roas: "ROAS", t_noData: "データがありません",

  c_noData: "データがありません", c_sales: "売上", c_cost: "費用", c_roas: "ROAS", c_traffic: "トラフィック", c_inCart: "カート追加", c_adsSpend: "広告費",
  c_funnelImpression: "表示回数", c_funnelClick: "クリック", c_funnelInCart: "カート追加", c_funnelSales: "購入",
  c_funnelPartialNote: "一部の段階にまだデータがなく、割合が意味を持たないためファネル図を非表示にしています。表示回数とクリックは新しいSPOSテンプレートの列（商品閲覧数／商品クリック数）から取得しており、SPOSファイルが再アップロードされるたびに反映されます。",
  c_funnelNonMonotonicNote: "後の段階の数値が前の段階を上回っています。旧SPOSテンプレートでアップロードされた期間には正式な表示回数／クリック列がなく、ページ閲覧数と検索クリックのみで代用しているため、実際のクリック数より少なく計上されます。",

  b_title: "ベースライン vs アクティブ実績",
  b_loading: "読み込み中…",
  b_noBaseline: "{scope}の「開始月」ベースラインデータがありません。",
  b_noDataMonth: "{scope}の{month}のデータはまだありません。",
  b_noDataYear: "{scope}の売上データはまだありません。",
  b_avgPerMonth: "月平均",
  b_monthlySalesTitle: "{label}月間売上", b_avgMonthlySalesTitle: "{label}月平均売上",
  b_adsRoasTitle: "{label}広告費とROAS", b_avgAdsRoasTitle: "{label}月平均広告費とROAS",
  b_hintSuffixSales: "{suffix}・SPOS・アクティブ={tag}", b_hintSuffixAds: "{suffix}・広告・アクティブ={tag}",
  b_panasonic: "パナソニック", b_allBrand: "全ブランド", b_everyBrand: "店舗内の全ブランド",
  b_baseline: "ベースライン", b_active: "アクティブ", b_activeAvg: "アクティブ（平均）",
  b_marketShareTitle: "パナソニック市場シェア（ベースライン vs アクティブ）",
  b_marketShareHint: "パナソニック ÷ 店舗総売上（全ブランド）・SPOS",
  b_otherBrands: "他ブランド",
  b_categoryShareTitle: "カテゴリーシェア（ベースライン vs アクティブ）",
  b_categoryShareHint: "カテゴリー別売上構成 — 全ブランド・SPOS",
  b_scopeMonthHint: "プロジェクト開始前スナプショット（「開始月」、対象{stores}店舗合計）と{month}の比較。",
  b_scopeAvgHint: "プロジェクト開始前スナプショット（「開始月」、対象{stores}店舗合計）と、データのある{months}か月間の平均値の比較 — 都市全体の合計であり、店舗ごとではありません。特定の月を上のフィルターで選択すると、平均ではなくその月の実数を確認できます。",
  b_thinAdsWarning: "ベースライン期間の広告費は合計{amount}とごくわずか（プロジェクト開始前は広告施策なし）であるため、ベースラインROAS（{baseRoas}）はほぼゼロの分母による見かけ上の数値であり、アクティブ（{activeRoas}）と比較する意味のある比率ではありません。",
} satisfies Record<keyof typeof id, string>;

export const DASH_T: Record<Lang, typeof id> = { id, en, jp };
export type DashKey = keyof typeof id;
