import {
  Document, Page, View, Text, StyleSheet, Svg, Rect, Path, Circle,
  Line as SvgLine, Polyline, Font,
} from "@react-pdf/renderer";
import { Fragment } from "react";
import { MONTH_LIST } from "@/lib/parse";

// =====================================================================
// Panasonic BOD report — landscape 16:9 slide deck.
//
// Page is a fixed 960x540pt (exactly 16:9, the PowerPoint widescreen
// size). Every block has an explicit height out of the BODY_H budget so
// content can never reflow past the margin onto a phantom second page.
// (wrap={false} would ALSO prevent that, but it makes react-pdf shrink
// the page down to its content height, silently breaking the 16:9 ratio.)
//
// Fonts are the PDF base-14 only (Helvetica / Times-Roman), so nothing
// is fetched at render time on serverless. That also means the glyph set
// is WinAnsi: the reference deck's up/down triangles are NOT available
// and would render as tofu, so deltas use ASCII "+"/"-" instead.
// =====================================================================

// react-pdf hyphenates long words by default, which breaks product codes
// like "CS/CU-YN18AKJ" mid-token. Return the word unsplit.
Font.registerHyphenationCallback((w) => [w]);

/* ---------------- palette (from the reference deck) ---------------- */
const NAVY = "#172c54";
const NAVY_DEEP = "#122344";
const GOLD = "#c9a227";
const GOLD_SOFT = "#d8b551";
const BG = "#f4f6fa";
const WHITE = "#ffffff";
const INK = "#1c2434";
const MUTED = "#6b7688";
const BORDER = "#e2e6ee";
const GREEN = "#1f9254";
const RED = "#c0392b";
const GREY = "#94a3b8";

/* ---------------- page geometry ---------------- */
const PAGE_W = 960;
const PAGE_H = 540;
// Object form + an explicit height in the page style: with the array form
// react-pdf auto-shrinks each page down to its content height, which
// silently breaks the 16:9 ratio (pages came out 960x296, 960x499, ...).
const PAGE_SIZE = { width: PAGE_W, height: PAGE_H };
const PAD = 38;
const CONTENT_W = PAGE_W - PAD * 2;          // 884
const HEADER_H = 52;                          // section no. + title + rule
const FOOTER_H = 18;
const BODY_H = PAGE_H - PAD * 2 - HEADER_H - FOOTER_H; // 394
const COL2 = (CONTENT_W - 14) / 2;            // 435
const COL3 = (CONTENT_W - 28) / 3;            // 285.33

/* ---------------- types ---------------- */
export type Kpis = { sales: number; gmv: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null };
export type MonthPoint = { year: number | null; month: string; sales: number };
export type CostRoasPoint = { year: number | null; month: string; cost: number; roas: number | null };
export type Dealer = {
  store_name: string; city: string; sales: number; traffic: number; in_cart: number;
  ad_cost: number; roas: number | null;
};
export type Summary = {
  kpis: Kpis;
  monthly_sales: MonthPoint[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  cost_roas: CostRoasPoint[];
  dealers: Dealer[];
};
export type BaselineVsActive = {
  baseline: { stores: number; sales: number; ad_cost: number };
  active: { store_months: number; sales: number; ad_cost: number };
};
export type Scope = { year: string; quarter: string; month: string; week: string; city: string; dealer: string };

/* ---------------- formatting ---------------- */
const idn = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
export const rp = (n: number | null | undefined) => "Rp" + idn(n || 0);
export const rpShort = (n: number | null | undefined) => {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e12) return "Rp" + (v / 1e12).toFixed(1).replace(".", ",") + "T";
  if (a >= 1e9) return "Rp" + (v / 1e9).toFixed(2).replace(".", ",") + "M";
  if (a >= 1e6) return "Rp" + (v / 1e6).toFixed(0) + "jt";
  if (a >= 1e3) return "Rp" + (v / 1e3).toFixed(0) + "rb";
  return "Rp" + Math.round(v);
};
const cnt = (n: number | null | undefined) => idn(n || 0);
const roasFmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1).replace(".", ",") + "x");
const pct = (n: number) => n.toFixed(1).replace(".", ",") + "%";
const mult = (n: number) => n.toFixed(1).replace(".", ",") + "x";
// Base-14 fonts have no ▲/▼ glyph — ASCII markers keep spacing intact.
const deltaStr = (p: number | null) => (p == null ? "—" : (p >= 0 ? "+" : "-") + pct(Math.abs(p)) + " MoM");
const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || "");

function pctDelta(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
const MONTH_SHORT: Record<string, string> = {
  Januari: "Jan", Februari: "Feb", Febuari: "Feb", Maret: "Mar", April: "Apr", Mei: "Mei", Juni: "Jun",
  Juli: "Jul", Agustus: "Agu", September: "Sep", Oktober: "Okt", November: "Nov", Desember: "Des",
};
const monthKey = (y: number | null, m: string) => (y ?? 0) * 12 + Math.max(0, MONTH_LIST.indexOf(m));

export function prevMonth(year: number, month: string): { year: number; month: string } {
  const i = MONTH_LIST.indexOf(month);
  if (i < 0) return { year, month };
  return i === 0 ? { year: year - 1, month: MONTH_LIST[11] } : { year, month: MONTH_LIST[i - 1] };
}
export function lastN<T extends { year: number | null; month: string }>(pts: T[], n: number, upTo?: { year: number; month: string }): T[] {
  const cap = upTo ? monthKey(upTo.year, upTo.month) : Infinity;
  return [...(pts || [])]
    .filter((p) => p.month && !/awal/i.test(p.month) && monthKey(p.year, p.month) <= cap)
    .sort((a, b) => monthKey(a.year, a.month) - monthKey(b.year, b.month))
    .slice(-n);
}

/* ---------------- styles ---------------- */
const s = StyleSheet.create({
  page: { width: PAGE_W, height: PAGE_H, backgroundColor: BG, paddingTop: PAD, paddingBottom: PAD, paddingHorizontal: PAD, fontFamily: "Helvetica", color: INK },
  secNo: { fontFamily: "Times-Bold", fontSize: 13, color: GOLD, marginRight: 9 },
  secTitle: { fontFamily: "Times-Bold", fontSize: 21, color: NAVY },
  rule: { height: 1, backgroundColor: BORDER, marginTop: 11 },
  card: { backgroundColor: WHITE, borderRadius: 7, borderWidth: 1, borderColor: BORDER, padding: 12 },
  cardTitle: { fontFamily: "Times-Bold", fontSize: 12.5, color: NAVY },
  cardSub: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  label: { fontSize: 7, color: MUTED, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  footer: { position: "absolute", left: PAD, right: PAD, bottom: 16, flexDirection: "row", justifyContent: "space-between" },
  footTxt: { fontSize: 7, color: MUTED },
  th: { fontSize: 7, color: MUTED, fontFamily: "Helvetica-Bold", letterSpacing: 0.4 },
  td: { fontSize: 8.5, color: INK },
});

/* ---------------- chart primitives (plain SVG, no browser) ---------------- */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function BarsSvg({ data, w, h, highlightLast = true }: { data: { label: string; value: number }[]; w: number; h: number; highlightLast?: boolean }) {
  if (!data.length) return <Empty w={w} h={h} />;
  const padL = 46, padR = 8, padT = 16, padB = 18;
  const cw = w - padL - padR, ch = h - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const gap = Math.min(14, cw / (data.length * 4));
  const bw = (cw - gap * (data.length - 1)) / data.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Svg width={w} height={h}>
      {ticks.map((t, i) => (
        <Fragment key={i}>
          <SvgLine x1={padL} y1={padT + ch - t * ch} x2={w - padR} y2={padT + ch - t * ch} stroke={i === 0 ? "#cfd6e2" : "#eef1f6"} strokeWidth={1} />
          <Text x={padL - 5} y={padT + ch - t * ch + 3} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "end" } as never}>{rpShort(max * t)}</Text>
        </Fragment>
      ))}
      {data.map((d, i) => {
        const bh = Math.max((d.value / max) * ch, 1);
        const x = padL + i * (bw + gap);
        const y = padT + ch - bh;
        const on = highlightLast && i === data.length - 1;
        return (
          <Fragment key={i}>
            <Rect x={x} y={y} width={bw} height={bh} fill={on ? GOLD : NAVY} rx={2} />
            <Text x={x + bw / 2} y={y - 4} style={{ fontSize: 7, fill: on ? GOLD : NAVY, textAnchor: "middle", fontFamily: "Helvetica-Bold" } as never}>
              {rpShort(d.value).replace("Rp", "")}
            </Text>
            <Text x={x + bw / 2} y={padT + ch + 11} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "middle" } as never}>{d.label}</Text>
          </Fragment>
        );
      })}
    </Svg>
  );
}

function CostRoasSvg({ data, w, h }: { data: { label: string; cost: number; roas: number | null }[]; w: number; h: number }) {
  if (!data.length) return <Empty w={w} h={h} />;
  const padL = 40, padR = 34, padT = 16, padB = 18;
  const cw = w - padL - padR, ch = h - padT - padB;
  const maxC = niceMax(Math.max(...data.map((d) => d.cost), 1));
  const maxR = niceMax(Math.max(...data.map((d) => d.roas ?? 0), 1));
  const gap = Math.min(14, cw / (data.length * 4));
  const bw = (cw - gap * (data.length - 1)) / data.length;
  const cx = (i: number) => padL + i * (bw + gap) + bw / 2;
  const ry = (v: number) => padT + ch - (v / maxR) * ch;
  const pts = data.filter((d) => d.roas != null).map((d, i) => `${cx(data.indexOf(d))},${ry(d.roas as number)}`).join(" ");
  return (
    <Svg width={w} height={h}>
      {[0, 0.5, 1].map((t, i) => (
        <Fragment key={i}>
          <SvgLine x1={padL} y1={padT + ch - t * ch} x2={w - padR} y2={padT + ch - t * ch} stroke={i === 0 ? "#cfd6e2" : "#eef1f6"} strokeWidth={1} />
          <Text x={padL - 5} y={padT + ch - t * ch + 3} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "end" } as never}>{rpShort(maxC * t).replace("Rp", "")}</Text>
          <Text x={w - padR + 5} y={padT + ch - t * ch + 3} style={{ fontSize: 6.5, fill: GOLD, textAnchor: "start" } as never}>{(maxR * t).toFixed(0)}x</Text>
        </Fragment>
      ))}
      {data.map((d, i) => {
        const bh = Math.max((d.cost / maxC) * ch, 1);
        return (
          <Fragment key={i}>
            <Rect x={padL + i * (bw + gap)} y={padT + ch - bh} width={bw} height={bh} fill={NAVY} rx={2} />
            <Text x={cx(i)} y={padT + ch + 11} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "middle" } as never}>{d.label}</Text>
          </Fragment>
        );
      })}
      {pts.split(" ").length > 1 && <Polyline points={pts} fill="none" stroke={GOLD} strokeWidth={1.6} />}
      {data.map((d, i) => d.roas == null ? null : (
        <Circle key={i} cx={cx(i)} cy={ry(d.roas)} r={2.4} fill={GOLD} />
      ))}
    </Svg>
  );
}

function FunnelSvg({ rows, w, h }: { rows: { label: string; value: number; note?: string }[]; w: number; h: number }) {
  if (!rows.length || !rows[0].value) return <Empty w={w} h={h} />;
  const padL = 58, padR = 8;
  const barH = 15, gap = (h - rows.length * barH) / (rows.length + 1);
  const cw = w - padL - padR - 130;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Svg width={w} height={h}>
      {rows.map((r, i) => {
        const y = gap + i * (barH + gap);
        const bw = Math.max((r.value / max) * cw, 2);
        return (
          <Fragment key={i}>
            <Text x={padL - 6} y={y + barH / 2 + 3} style={{ fontSize: 7, fill: MUTED, textAnchor: "end" } as never}>{r.label}</Text>
            <Rect x={padL} y={y} width={bw} height={barH} fill={i === rows.length - 1 ? GOLD : NAVY} rx={2} />
            <Text x={padL + bw + 6} y={y + barH / 2 + 3} style={{ fontSize: 7.5, fill: INK, fontFamily: "Helvetica-Bold" } as never}>{cnt(r.value)}</Text>
            {r.note && (
              <Text x={padL + bw + 6 + String(cnt(r.value)).length * 4.6 + 8} y={y + barH / 2 + 3} style={{ fontSize: 6.5, fill: MUTED } as never}>{r.note}</Text>
            )}
          </Fragment>
        );
      })}
    </Svg>
  );
}

// Donut drawn from two arc paths; a 100%/0% split degenerates as an arc,
// so those render as plain rings instead.
function DonutSvg({ share, w, h }: { share: number; w: number; h: number }) {
  const cxp = w / 2, cyp = h / 2;
  const R = Math.min(w, h) / 2 - 4, r = R * 0.62;
  const frac = Math.max(0, Math.min(1, share));
  const ring = (color: string) => (
    <Fragment>
      <Circle cx={cxp} cy={cyp} r={(R + r) / 2} fill="none" stroke={color} strokeWidth={R - r} />
    </Fragment>
  );
  let body: React.ReactNode;
  if (frac >= 0.999) body = ring(GOLD);
  else if (frac <= 0.001) body = ring("#d7dce6");
  else {
    const a = frac * Math.PI * 2 - Math.PI / 2;
    const st = -Math.PI / 2;
    const p = (rad: number, ang: number) => `${(cxp + rad * Math.cos(ang)).toFixed(2)},${(cyp + rad * Math.sin(ang)).toFixed(2)}`;
    const large = frac > 0.5 ? 1 : 0;
    body = (
      <Fragment>
        {/* full grey ring underneath, gold wedge for Panasonic's share on top */}
        <Circle cx={cxp} cy={cyp} r={(R + r) / 2} fill="none" stroke="#d7dce6" strokeWidth={R - r} />
        <Path
          d={`M ${p(R, st)} A ${R} ${R} 0 ${large} 1 ${p(R, a)} L ${p(r, a)} A ${r} ${r} 0 ${large} 0 ${p(r, st)} Z`}
          fill={GOLD}
        />
      </Fragment>
    );
  }
  return (
    <Svg width={w} height={h}>
      {body}
      <Text x={cxp} y={cyp + 2} style={{ fontSize: 17, fill: NAVY, textAnchor: "middle", fontFamily: "Times-Bold" } as never}>{pct(frac * 100)}</Text>
      <Text x={cxp} y={cyp + 14} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "middle" } as never}>Panasonic</Text>
    </Svg>
  );
}

function Empty({ w, h }: { w: number; h: number }) {
  return (
    <Svg width={w} height={h}>
      <Text x={w / 2} y={h / 2} style={{ fontSize: 8, fill: MUTED, textAnchor: "middle" } as never}>Data tidak tersedia untuk filter ini</Text>
    </Svg>
  );
}

/* ---------------- shared blocks ---------------- */
function Header({ no, title }: { no: string; title: string }) {
  return (
    <View style={{ height: HEADER_H }}>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text style={s.secNo}>{no}</Text>
        <Text style={s.secTitle}>{title}</Text>
      </View>
      <View style={s.rule} />
    </View>
  );
}
function Footer({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footTxt}>{left}</Text>
      <Text style={s.footTxt}>{right}</Text>
    </View>
  );
}
function KpiCard({ label, value, sub, delta, hero, width, height }: {
  label: string; value: string; sub?: string; delta?: number | null; hero?: boolean; width: number; height: number;
}) {
  const fg = hero ? WHITE : NAVY;
  const dcol = delta == null ? MUTED : delta >= 0 ? (hero ? "#7ee2a8" : GREEN) : (hero ? "#ff9c8f" : RED);
  return (
    <View style={{
      width, height, borderRadius: 7, padding: 12, justifyContent: "flex-start",
      backgroundColor: hero ? NAVY : WHITE, borderWidth: 1, borderColor: hero ? NAVY : BORDER,
    }}>
      <View style={{ width: 42, height: 3.5, backgroundColor: hero ? GOLD_SOFT : GOLD, borderRadius: 2, marginBottom: 9 }} />
      <Text style={[s.label, { color: hero ? GOLD_SOFT : MUTED }]}>{label}</Text>
      <Text style={{ fontFamily: "Times-Bold", fontSize: 19, color: fg, marginTop: 5 }}>{value}</Text>
      {!!sub && <Text style={{ fontSize: 7.5, color: hero ? "#c3cee3" : MUTED, marginTop: 4 }}>{clip(sub, 42)}</Text>}
      <View style={{ flexGrow: 1 }} />
      <Text style={{ fontSize: 8, color: dcol, fontFamily: "Helvetica-Bold" }}>{deltaStr(delta ?? null)}</Text>
    </View>
  );
}

/* ---------------- narrative ---------------- */
function buildNarrative(cur: Kpis, prev: Kpis | null, periodLabel: string, scopeLabel: string): string {
  const dSales = pctDelta(cur.sales, prev?.sales);
  const dAds = pctDelta(cur.ad_cost, prev?.ad_cost);
  const share = cur.gmv > 0 ? (cur.sales / cur.gmv) * 100 : null;
  const parts: string[] = [];
  parts.push(`Pada ${periodLabel}, penjualan Panasonic di ${scopeLabel} mencapai ${rp(cur.sales)}${dSales != null ? ` — ${dSales >= 0 ? "naik" : "turun"} ${pct(Math.abs(dSales))} dibanding periode sebelumnya` : ""}.`);
  if (dAds != null && dSales != null) {
    parts.push(dAds < 0 && dSales > 0
      ? `Pertumbuhan ini efisien: biaya iklan justru turun ${pct(Math.abs(dAds))} menjadi ${rp(cur.ad_cost)}, sehingga ROAS berada di ${roasFmt(cur.roas)}.`
      : `Biaya iklan ${dAds >= 0 ? "naik" : "turun"} ${pct(Math.abs(dAds))} menjadi ${rp(cur.ad_cost)}, dengan ROAS ${roasFmt(cur.roas)}.`);
  } else {
    parts.push(`Biaya iklan tercatat ${rp(cur.ad_cost)} dengan ROAS ${roasFmt(cur.roas)}.`);
  }
  const atc = cur.traffic > 0 ? (cur.in_cart / cur.traffic) * 100 : 0;
  parts.push(`Funnel mencatat ${cnt(cur.traffic)} kunjungan produk dan ${cnt(cur.in_cart)} tambah-ke-keranjang (rasio ${pct(atc)}).`);
  if (share != null) parts.push(`Panasonic menyumbang ${pct(share)} dari total penjualan toko dealer (${rp(cur.gmv)}).`);
  return parts.join(" ");
}

/* ==================================================================== */
export function BodReportDocument(props: {
  scopeLabel: string;
  periodLabel: string;
  generatedAt: string;
  scope: Scope;
  current: Summary;
  previous: Summary | null;
  trend: MonthPoint[];
  costRoasTrend: CostRoasPoint[];
  bva: BaselineVsActive | null;
}) {
  const { scopeLabel, periodLabel, generatedAt, current, previous, trend, costRoasTrend, bva } = props;
  const k = current.kpis, pk = previous?.kpis ?? null;

  const panaSales = current.brand_share.find((b) => (b.brand || "").toLowerCase() === "panasonic")?.sales ?? 0;
  const otherSales = current.brand_share.filter((b) => (b.brand || "").toLowerCase() !== "panasonic").reduce((a, b) => a + b.sales, 0);
  const shareFrac = panaSales + otherSales > 0 ? panaSales / (panaSales + otherSales) : 0;
  const atcRate = k.traffic > 0 ? (k.in_cart / k.traffic) * 100 : 0;

  const dealers = [...(current.dealers || [])].sort((a, b) => b.sales - a.sales);
  const products = (current.top_products || []).slice(0, 10);
  const prodTotal = products.reduce((a, p) => a + p.sales, 0) || 1;

  const footL = "Reline · Panasonic E-Commerce Dealer Program";
  const footR = "Sumber: dashboard Reline (SPOS · Performa · Ads) · ROAS = Penjualan Panasonic ÷ Biaya Iklan";

  return (
    <Document title={`Laporan BOD Panasonic — ${scopeLabel} — ${periodLabel}`}>
      {/* ============ COVER ============ */}
      <Page size={PAGE_SIZE} style={{ width: PAGE_W, height: PAGE_H, fontFamily: "Helvetica", backgroundColor: NAVY }}>
        <View style={{ position: "absolute", top: 0, right: 0, width: 190, height: PAGE_H, backgroundColor: NAVY_DEEP }} />
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 10, backgroundColor: GOLD }} />
        <View style={{ paddingHorizontal: 64, paddingTop: 54 }}>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 22, color: WHITE }}>Reline</Text>
          <Text style={{ fontSize: 7.5, color: GOLD_SOFT, letterSpacing: 2.2, marginTop: 3, fontFamily: "Helvetica-Bold" }}>
            PANASONIC E-COMMERCE PERFORMANCE
          </Text>
        </View>
        <View style={{ paddingHorizontal: 64, marginTop: 108 }}>
          <Text style={{ fontSize: 10, color: GOLD, letterSpacing: 1.5, fontFamily: "Helvetica-Bold" }}>LAPORAN PERFORMA — BOARD OF DIRECTORS</Text>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 42, color: WHITE, marginTop: 14 }}>{clip(scopeLabel, 36)}</Text>
          <Text style={{ fontSize: 13, color: "#c3cee3", marginTop: 12 }}>
            {periodLabel}   ·   Fokus Brand: Panasonic
          </Text>
        </View>
        <View style={{ position: "absolute", left: 64, bottom: 62 }}>
          <View style={{ width: 420, height: 1, backgroundColor: GOLD, opacity: 0.65, marginBottom: 13 }} />
          <Text style={{ fontSize: 9.5, color: "#c3cee3" }}>Disiapkan untuk:  Panasonic — Board of Directors</Text>
          <Text style={{ fontSize: 9.5, color: "#c3cee3", marginTop: 5 }}>Kanal:  Shopee   ·   Program Dealer E-Commerce</Text>
          <Text style={{ fontSize: 8, color: MUTED, marginTop: 9 }}>Dibuat {generatedAt}</Text>
        </View>
      </Page>

      {/* ============ 01 RINGKASAN EKSEKUTIF ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="01" title="Ringkasan Eksekutif" />
        <View style={{ height: 82, backgroundColor: NAVY, borderRadius: 8, padding: 13, marginBottom: 13 }}>
          <Text style={{ fontSize: 7.5, color: GOLD_SOFT, fontFamily: "Helvetica-Bold", letterSpacing: 1 }}>RINGKASAN</Text>
          <Text style={{ fontSize: 9, color: "#e6ebf5", marginTop: 6, lineHeight: 1.5 }}>
            {clip(buildNarrative(k, pk, periodLabel, scopeLabel), 460)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 14, marginBottom: 12 }}>
          <KpiCard width={COL3} height={132} hero label="PENJUALAN PANASONIC · SIAP DIKIRIM" value={rp(k.sales)} sub="SPOS · parent row" delta={pctDelta(k.sales, pk?.sales)} />
          <KpiCard width={COL3} height={132} label="TRAFIK PRODUK" value={cnt(k.traffic)} sub="Pengunjung produk" delta={pctDelta(k.traffic, pk?.traffic)} />
          <KpiCard width={COL3} height={132} label="TAMBAH KE KERANJANG" value={cnt(k.in_cart)} sub={`Rasio ATC ${pct(atcRate)}`} delta={pctDelta(k.in_cart, pk?.in_cart)} />
        </View>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <KpiCard width={COL3} height={132} label="BIAYA IKLAN" value={rp(k.ad_cost)} sub="Panasonic · Ads" delta={pctDelta(k.ad_cost, pk?.ad_cost)} />
          <KpiCard width={COL3} height={132} hero label="ROAS · SALES ÷ BIAYA" value={roasFmt(k.roas)} sub={`Dari ${rp(k.ad_cost)} belanja iklan`} delta={pctDelta(k.roas ?? 0, pk?.roas ?? null)} />
          <KpiCard width={COL3} height={132} label="TOTAL TOKO · SEMUA BRAND" value={rp(k.gmv)} sub={`Pangsa Panasonic: ${pct(shareFrac * 100)}`} delta={pctDelta(k.gmv, pk?.gmv)} />
        </View>
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 02 DAMPAK PROGRAM RELINE ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="02" title="Dampak Program Reline — Sebelum vs Sesudah" />
        <ImpactBody bva={bva} />
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 03 TREN & KOMPOSISI ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="03" title="Tren & Komposisi" />
        <View style={{ flexDirection: "row", gap: 14, marginBottom: 12 }}>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>Performa Penjualan Panasonic</Text>
            <Text style={s.cardSub}>Penjualan siap dikirim · {trend.length} periode terakhir</Text>
            <View style={{ marginTop: 6 }}>
              <BarsSvg w={COL2 - 24} h={132} data={trend.map((t) => ({ label: `${MONTH_SHORT[t.month] || clip(t.month, 3)}`, value: t.sales }))} />
            </View>
          </View>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>Biaya Iklan & ROAS</Text>
            <Text style={s.cardSub}>Biaya vs efisiensi · {costRoasTrend.length} periode terakhir</Text>
            <View style={{ marginTop: 6 }}>
              <CostRoasSvg w={COL2 - 24} h={132} data={costRoasTrend.map((c) => ({ label: `${MONTH_SHORT[c.month] || clip(c.month, 3)}`, cost: c.cost, roas: c.roas }))} />
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>Funnel Konversi</Text>
            <Text style={s.cardSub}>Trafik → keranjang · {periodLabel}</Text>
            <View style={{ marginTop: 6 }}>
              <FunnelSvg w={COL2 - 24} h={132} rows={[
                { label: "Trafik", value: k.traffic },
                { label: "Keranjang", value: k.in_cart, note: `(${pct(atcRate)} dari trafik)` },
              ]} />
            </View>
          </View>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>Pangsa Toko</Text>
            <Text style={s.cardSub}>Panasonic vs brand lain (pendapatan)</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <DonutSvg share={shareFrac} w={COL2 - 160} h={128} />
              <View style={{ marginLeft: 10 }}>
                <Legend color={GOLD} text={`Panasonic — ${rpShort(panaSales)}`} />
                <Legend color="#d7dce6" text={`Brand lain — ${rpShort(otherSales)}`} />
              </View>
            </View>
          </View>
        </View>
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 04 PERFORMA DEALER ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="04" title={`Performa Dealer — ${dealers.length} dealer`} />
        <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: NAVY }}>
          <Text style={[s.th, { width: 26 }]}>#</Text>
          <Text style={[s.th, { flex: 3 }]}>DEALER</Text>
          <Text style={[s.th, { flex: 1.7 }]}>KOTA</Text>
          <Text style={[s.th, { flex: 1.5, textAlign: "right" }]}>PENJUALAN</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>TRAFIK</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>KERANJANG</Text>
          <Text style={[s.th, { flex: 1.3, textAlign: "right" }]}>BIAYA IKLAN</Text>
          <Text style={[s.th, { flex: 0.9, textAlign: "right" }]}>ROAS</Text>
        </View>
        {dealers.slice(0, 11).map((d, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", height: 27, backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
            <Text style={{ width: 26, fontFamily: "Times-Bold", fontSize: 10, color: GOLD }}>{i + 1}</Text>
            <Text style={[s.td, { flex: 3 }]}>{clip(d.store_name, 34)}</Text>
            <Text style={[s.td, { flex: 1.7, color: MUTED }]}>{clip(d.city || "—", 20)}</Text>
            <Text style={[s.td, { flex: 1.5, textAlign: "right", fontFamily: "Helvetica-Bold", color: NAVY }]}>{rp(d.sales)}</Text>
            <Text style={[s.td, { flex: 1.2, textAlign: "right", color: MUTED }]}>{cnt(d.traffic)}</Text>
            <Text style={[s.td, { flex: 1.2, textAlign: "right", color: MUTED }]}>{cnt(d.in_cart)}</Text>
            <Text style={[s.td, { flex: 1.3, textAlign: "right", color: MUTED }]}>{rp(d.ad_cost)}</Text>
            <Text style={[s.td, { flex: 0.9, textAlign: "right", fontFamily: "Helvetica-Bold", color: d.roas != null && d.roas >= 3 ? GREEN : INK }]}>{roasFmt(d.roas)}</Text>
          </View>
        ))}
        {!dealers.length && <Text style={{ fontSize: 9, color: MUTED, marginTop: 14 }}>Tidak ada data dealer untuk filter ini.</Text>}
        {dealers.length > 11 && (
          <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 8, fontStyle: "italic" }}>
            Menampilkan 11 dealer teratas dari {dealers.length}. Total penjualan seluruh dealer: {rp(dealers.reduce((a, x) => a + x.sales, 0))}.
          </Text>
        )}
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 05 PRODUK TERLARIS ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="05" title={`10 Produk Terlaris — ${periodLabel}`} />
        <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: NAVY }}>
          <Text style={[s.th, { width: 30 }]}>#</Text>
          <Text style={[s.th, { flex: 6 }]}>PRODUK</Text>
          <Text style={[s.th, { flex: 1.6, textAlign: "right" }]}>PENJUALAN</Text>
          <Text style={[s.th, { flex: 1, textAlign: "right" }]}>% PANA.</Text>
        </View>
        {products.map((p, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", height: 29, backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
            <Text style={{ width: 30, fontFamily: "Times-Bold", fontSize: 11, color: GOLD }}>{i + 1}</Text>
            <Text style={[s.td, { flex: 6 }]}>{clip(p.name, 78)}</Text>
            <Text style={[s.td, { flex: 1.6, textAlign: "right", fontFamily: "Helvetica-Bold", color: NAVY }]}>{rp(p.sales)}</Text>
            <Text style={[s.td, { flex: 1, textAlign: "right", color: MUTED }]}>{pct((p.sales / prodTotal) * 100)}</Text>
          </View>
        ))}
        {!products.length && <Text style={{ fontSize: 9, color: MUTED, marginTop: 14 }}>Tidak ada data produk untuk filter ini.</Text>}
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 06 MAKNA & LANGKAH SELANJUTNYA ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="06" title="Makna & Langkah Selanjutnya" />
        <Insights k={k} pk={pk} atcRate={atcRate} shareFrac={shareFrac} dealers={dealers} />
        <Footer left={footL} right={footR} />
      </Page>
    </Document>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 7 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, marginRight: 6 }} />
      <Text style={{ fontSize: 8, color: INK }}>{clip(text, 26)}</Text>
    </View>
  );
}

/* ---------------- 02 body ---------------- */
function ImpactBody({ bva }: { bva: BaselineVsActive | null }) {
  if (!bva || !bva.baseline.stores) {
    return (
      <View style={[s.card, { height: 160, justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ fontSize: 11, color: NAVY, fontFamily: "Times-Bold" }}>Data baseline (&quot;Month Awal&quot;) belum tersedia</Text>
        <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 6, textAlign: "center" }}>
          Perbandingan sebelum-vs-sesudah membutuhkan data &quot;Month Awal&quot; untuk cakupan yang dipilih.
        </Text>
      </View>
    );
  }
  const { baseline, active } = bva;
  // Baseline is a ONE-OFF snapshot per store; Active spans many
  // store-months. Comparing raw totals would be apples-to-oranges, so
  // both sides are normalised to a per-store-month average — the same
  // basis the dashboard's Baseline vs Active panel uses.
  const bSales = baseline.sales / baseline.stores;
  const aSales = active.store_months ? active.sales / active.store_months : 0;
  const bAds = baseline.ad_cost / baseline.stores;
  const aAds = active.store_months ? active.ad_cost / active.store_months : 0;
  const bRoas = baseline.ad_cost > 0 ? baseline.sales / baseline.ad_cost : null;
  const aRoas = active.ad_cost > 0 ? active.sales / active.ad_cost : null;
  const salesX = bSales > 0 ? aSales / bSales : null;
  const adsX = bAds > 0 ? aAds / bAds : null;
  // Pre-project there was effectively no managed ads programme, so a
  // baseline ROAS computed off a near-zero denominator is an artifact,
  // not a comparable ratio. Say so rather than printing a huge number.
  const adsThin = baseline.ad_cost < baseline.sales * 0.001;

  const rows: { metric: string; before: string; after: string; change: string }[] = [
    { metric: "Penjualan Panasonic / toko / bulan", before: rp(bSales), after: rp(aSales), change: salesX != null ? `${mult(salesX)}` : "—" },
    { metric: "Biaya iklan / toko / bulan", before: rp(bAds), after: rp(aAds), change: adsX != null ? `${mult(adsX)}` : "—" },
    { metric: "ROAS (total periode)", before: adsThin ? "tanpa iklan terkelola" : roasFmt(bRoas), after: roasFmt(aRoas), change: adsThin ? "program baru" : "—" },
    { metric: "Cakupan data", before: `${baseline.stores} toko (Month Awal)`, after: `${active.store_months} toko-bulan aktif`, change: "—" },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 14 }}>
        <BigStat width={COL3} x={salesX} title="Penjualan Panasonic" before={rp(bSales)} after={rp(aSales)} />
        <BigStat width={COL3} x={adsX} title="Biaya Iklan (investasi)" before={rp(bAds)} after={rp(aAds)} />
        <View style={{ width: COL3, height: 116, backgroundColor: NAVY, borderRadius: 7, padding: 13, justifyContent: "center" }}>
          <Text style={[s.label, { color: GOLD_SOFT }]}>ROAS PROGRAM AKTIF</Text>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 27, color: WHITE, marginTop: 4 }}>{roasFmt(aRoas)}</Text>
          <Text style={{ fontSize: 7.5, color: "#c3cee3", marginTop: 5 }}>
            {adsThin ? "Sebelumnya tidak ada iklan terkelola" : `Sebelumnya ${roasFmt(bRoas)}`}
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 7 }}>
        RINCIAN SEBELUM — SESUDAH   (rata-rata per toko per bulan)
      </Text>
      <View style={{ flexDirection: "row", paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: NAVY }}>
        <Text style={[s.th, { flex: 3 }]}>METRIK</Text>
        <Text style={[s.th, { flex: 2, textAlign: "right" }]}>SEBELUM</Text>
        <Text style={[s.th, { flex: 2, textAlign: "right" }]}>SESUDAH</Text>
        <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>PERUBAHAN</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", height: 25, alignItems: "center", backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
          <Text style={[s.td, { flex: 3 }]}>{r.metric}</Text>
          <Text style={[s.td, { flex: 2, textAlign: "right", color: MUTED }]}>{r.before}</Text>
          <Text style={[s.td, { flex: 2, textAlign: "right", fontFamily: "Helvetica-Bold", color: NAVY }]}>{r.after}</Text>
          <Text style={[s.td, { flex: 1.2, textAlign: "right", fontFamily: "Helvetica-Bold", color: GREEN }]}>{r.change}</Text>
        </View>
      ))}
      <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 9, lineHeight: 1.45 }}>
        Catatan: &quot;Sebelum&quot; adalah snapshot Month Awal (pra-program) dari {baseline.stores} toko; &quot;Sesudah&quot; adalah rata-rata per toko per bulan
        selama {active.store_months} toko-bulan aktif. Keduanya dinormalkan ke basis per-toko-per-bulan agar sebanding.
        {adsThin ? " Sebelum program, belanja iklan hampir nol sehingga ROAS pra-program bukan rasio yang bermakna untuk dibandingkan." : ""}
      </Text>
    </View>
  );
}

function BigStat({ width, x, title, before, after }: { width: number; x: number | null; title: string; before: string; after: string }) {
  return (
    <View style={[s.card, { width, height: 116, justifyContent: "center" }]}>
      <Text style={{ fontFamily: "Times-Bold", fontSize: 27, color: x != null && x >= 1 ? GREEN : NAVY }}>{x != null ? mult(x) : "—"}</Text>
      <Text style={{ fontSize: 9, color: NAVY, fontFamily: "Helvetica-Bold", marginTop: 4 }}>{title}</Text>
      <Text style={{ fontSize: 8, color: MUTED, marginTop: 4 }}>{clip(before, 18)}  →  {clip(after, 18)}</Text>
    </View>
  );
}

/* ---------------- 06 body ---------------- */
function Insights({ k, pk, atcRate, shareFrac, dealers }: {
  k: Kpis; pk: Kpis | null; atcRate: number; shareFrac: number; dealers: Dealer[];
}) {
  const dSales = pctDelta(k.sales, pk?.sales);
  const dAds = pctDelta(k.ad_cost, pk?.ad_cost);
  const dGmv = pctDelta(k.gmv, pk?.gmv);
  const weak = dealers.filter((d) => d.roas != null && d.roas < 1).length;

  const cards: { tone: "win" | "insight" | "watch"; label: string; title: string; body: string }[] = [];

  if (dSales != null && dAds != null && dSales > 0 && dAds < 0) {
    cards.push({ tone: "win", label: "MENANG", title: "Sales naik, biaya turun", body: `Penjualan naik ${pct(dSales)} sementara biaya iklan turun ${pct(Math.abs(dAds))}. Permintaan makin organik dan anggaran iklan bekerja lebih efisien — ROAS di ${roasFmt(k.roas)}.` });
  } else if (dSales != null && dSales > 0) {
    cards.push({ tone: "win", label: "MENANG", title: "Penjualan tumbuh", body: `Penjualan Panasonic naik ${pct(dSales)} menjadi ${rp(k.sales)} dengan ROAS ${roasFmt(k.roas)}.` });
  } else {
    cards.push({ tone: "watch", label: "PERHATIAN", title: "Penjualan belum tumbuh", body: `Penjualan Panasonic ${rp(k.sales)}${dSales != null ? ` (${pct(dSales)} vs periode sebelumnya)` : ""}. Perlu penelusuran pemicu di level dealer dan SKU.` });
  }

  cards.push(atcRate >= 5
    ? { tone: "insight", label: "INSIGHT", title: "Funnel atas sehat", body: `Rasio tambah-ke-keranjang ${pct(atcRate)} dari ${cnt(k.traffic)} kunjungan. Minat menguat sebelum tahap checkout.` }
    : { tone: "watch", label: "PERHATIAN", title: "Funnel atas tipis", body: `Rasio tambah-ke-keranjang hanya ${pct(atcRate)} dari ${cnt(k.traffic)} kunjungan — kualitas trafik atau relevansi listing perlu dicek.` });

  cards.push(dGmv != null && dSales != null && dGmv > dSales
    ? { tone: "watch", label: "PERHATIAN", title: "Pangsa turun meski tumbuh", body: `Total toko dealer tumbuh lebih cepat (${pct(dGmv)}) dari Panasonic (${pct(dSales)}), sehingga pangsa Panasonic di ${pct(shareFrac * 100)}. Brand lain tumbuh lebih besar — perlu dicek pemicunya.` }
    : { tone: "insight", label: "INSIGHT", title: `Pangsa Panasonic ${pct(shareFrac * 100)}`, body: `Panasonic menyumbang ${pct(shareFrac * 100)} dari total penjualan toko dealer (${rp(k.gmv)}) pada periode ini.` });

  cards.push(weak > 0
    ? { tone: "watch", label: "PERHATIAN", title: `${weak} dealer dengan ROAS di bawah 1x`, body: `Dari ${dealers.length} dealer, ${weak} membelanjakan iklan lebih besar dari penjualan Panasonic yang dihasilkan. Prioritaskan pendampingan di dealer ini.` }
    : { tone: "win", label: "MENANG", title: "Semua dealer ROAS di atas 1x", body: `Seluruh ${dealers.length} dealer menghasilkan penjualan Panasonic melebihi belanja iklannya pada periode ini.` });

  const toneColor = { win: GREEN, insight: GOLD, watch: RED } as const;

  const actions = [
    "Jaga efisiensi — pertahankan / scale anggaran iklan pada dealer & SKU yang terbukti selama ROAS di atas target.",
    `Tutup jeda keranjang — aktifkan voucher checkout & follow-up chat pada ${cnt(k.in_cart)} keranjang periode ini.`,
    "Dorong mix premium — tonjolkan model Inverter & seri premium untuk menaikkan nilai pesanan rata-rata.",
    weak > 0 ? `Dampingi ${weak} dealer ber-ROAS rendah — audit struktur iklan dan harga sebelum menambah anggaran.` : "Replikasi pola dealer terbaik ke dealer lain di kota yang sama.",
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 12 }}>
        {cards.slice(0, 2).map((c, i) => <InsightCard key={i} {...c} color={toneColor[c.tone]} />)}
      </View>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 14 }}>
        {cards.slice(2, 4).map((c, i) => <InsightCard key={i} {...c} color={toneColor[c.tone]} />)}
      </View>
      <View style={{ backgroundColor: NAVY, borderRadius: 8, padding: 13, height: 112 }}>
        <Text style={{ fontSize: 7.5, color: GOLD_SOFT, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 7 }}>REKOMENDASI AKSI — PERIODE BERIKUTNYA</Text>
        {actions.map((a, i) => (
          <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
            <Text style={{ width: 15, fontSize: 8, color: GOLD, fontFamily: "Helvetica-Bold" }}>{i + 1}.</Text>
            <Text style={{ flex: 1, fontSize: 8, color: "#e6ebf5", lineHeight: 1.35 }}>{clip(a, 150)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function InsightCard({ label, title, body, color }: { label: string; title: string; body: string; color: string }) {
  return (
    <View style={{ width: COL2, height: 104, backgroundColor: WHITE, borderRadius: 7, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 4, borderLeftColor: color, padding: 11 }}>
      <Text style={{ fontSize: 7, color, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 }}>{label}</Text>
      <Text style={{ fontFamily: "Times-Bold", fontSize: 12.5, color: NAVY, marginTop: 5 }}>{clip(title, 40)}</Text>
      <Text style={{ fontSize: 8, color: MUTED, marginTop: 5, lineHeight: 1.4 }}>{clip(body, 190)}</Text>
    </View>
  );
}

export { GREY };
