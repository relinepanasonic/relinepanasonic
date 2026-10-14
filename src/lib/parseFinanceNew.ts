// Parser for Shopee's NEW "Laporan Penghasilan" (Income) layout (late 2026).
//
// Workbook sheets: "Summary", "Seller Fee", "Penghasilan". The "Penghasilan"
// sheet has TWO header rows (group, column name) and, per order, one "Order"
// row followed by one "Sku" row per product. The Sku rows carry the Shopee
// product id ("ID Produk" — the same id SPOS uses as Kode Produk) and each
// product's OWN share of every cost; they add up exactly to the order row
// (verified on a real export: every cell, every order). Costs are signed
// (negative), like the old layout.
//
// Cost identity (verified): sales + promotion_cost + refund + delivery_cost +
// affiliate_cost + marketplace_fee + misc + tax == net_income.
import { toNum } from "./parse";
import type { FinanceRow } from "./parseFinance";

export interface FinanceItemRow {
  order_no: string;
  kode_produk: string | null;
  nama_produk: string | null;
  order_date: string | null;
  release_date: string | null;
  sales: number;            // Harga Produk
  refund: number;
  promotion_cost: number;   // vouchers, coin cashback, Shopee product discount
  delivery_cost: number;    // all shipping lines, net
  platform_fee: number;     // Biaya Administrasi + Biaya Proses Pesanan
  xtra_fee: number;         // Biaya Gratis Ongkir XTRA (all size categories)
  service_fee: number;      // Biaya Transaksi + Biaya Layanan Promo XTRA(+)
  campaign_fee: number;     // Biaya Kampanye
  affiliate_cost: number;   // Biaya Komisi AMS
  misc: number;             // Biaya Isi Saldo Otomatis
  other_fee: number;        // Premi + FBS Fee
  tax: number;              // PPh 22 ("Pajak")
  tax_base: number;         // Dasar Pengenaan Pajak
  tax_base_exvat: number;   // Dasar Pengenaan Pajak (Tidak Termasuk PPN)
  net_income: number;       // Total Penghasilan
}

export interface FinanceNewOrder extends FinanceRow {
  tax: number;
  tax_base: number;
  tax_base_exvat: number;
}

export interface FinanceNewParsed {
  username: string | null;
  periodeStart: string | null;
  periodeEnd: string | null;
  orders: FinanceNewOrder[];
  items: FinanceItemRow[];
}

const cell = (row: unknown[], i: number): string => String(row?.[i] ?? "").trim();

function asISODate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// True when the workbook is the new layout (and not the old "Income" sheet).
export function isNewFinanceLayout(sheetNames: string[]): boolean {
  const lc = sheetNames.map((n) => n.toLowerCase());
  return lc.includes("penghasilan") && !lc.includes("income");
}

export function parseFinanceNewWorkbook(penghasilan: unknown[][], summary: unknown[][]): FinanceNewParsed {
  // Summary sheet: "Username (Penjual)", "Dari", "ke" as label/value pairs
  const pick = (label: string) => {
    const row = summary.find((r) => String(r?.[0] ?? "").trim().toLowerCase() === label.toLowerCase());
    return row ? String(row[1] ?? "").trim() : "";
  };
  const username = pick("Username (Penjual)") || null;
  const periodeStart = asISODate(pick("Dari"));
  const periodeEnd = asISODate(pick("ke"));

  let headerIdx = -1;
  for (let i = 0; i < Math.min(penghasilan.length, 10); i++) {
    const cells = (penghasilan[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (cells.includes("no. pesanan") && cells.includes("lihat berdasarkan")) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return { username, periodeStart, periodeEnd, orders: [], items: [] };

  const headers = (penghasilan[headerIdx] || []).map((h) => String(h ?? "").trim());
  const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cKind = idx("Lihat berdasarkan"), cOrderNo = idx("No. Pesanan"), cPid = idx("ID Produk"), cPname = idx("Nama Produk");
  const cOrderDate = idx("Waktu Pesanan Dibuat"), cRelease = idx("Tanggal Dana Dilepaskan");
  const cBuyer = idx("Username (Pembeli)"), cPayment = idx("Metode pembayaran pembeli");
  const cJasa = idx("Jasa Kirim"), cKurir = idx("Nama Kurir");
  const cTaxBase = idx("Dasar Pengenaan Pajak"), cTaxBaseEx = idx("Dasar Pengenaan Pajak (Tidak Termasuk PPN)");

  const byNames = (names: string[]) => names.map(idx).filter((c) => c >= 0);
  const byPrefix = (test: (h: string) => boolean) => headers.map((h, i) => (test(h) ? i : -1)).filter((i) => i >= 0);
  const g = {
    sales:     byNames(["Harga Produk"]),
    refund:    byNames(["Jumlah Pengembalian Dana ke Pembeli"]),
    promo:     byNames(["Voucher disponsor oleh Penjual", "Cashback Koin disponsori Penjual", "Diskon Produk dari Shopee",
                        "Voucher co-fund disponsor oleh Penjual", "Cashback Koin Co-fund disponsori Penjual"]),
    delivery:  byNames(["Ongkir Dibayar Pembeli", "Ongkos Kirim yang Dibayarkan ke Jasa Kirim", "Potongan Ongkos Kirim dari Jasa Kirim",
                        "Gratis Ongkir dari Shopee", "Ongkos Kirim Pengembalian Barang", "Return to Seller Fee", "Pengembalian Biaya Kirim"]),
    platform:  byNames(["Biaya Administrasi", "Biaya Proses Pesanan"]),
    xtra:      byPrefix((h) => h.startsWith("Biaya Gratis Ongkir XTRA")),
    service:   byPrefix((h) => h === "Biaya Transaksi" || h.startsWith("Biaya Layanan Promo XTRA")),
    campaign:  byNames(["Biaya Kampanye"]),
    affiliate: byNames(["Biaya Komisi AMS"]),
    misc:      byNames(["Biaya Isi Saldo Otomatis (dari Penghasilan)"]),
    other:     byNames(["Premi", "FBS Fee"]),
    tax:       byNames(["PPh 22"]),
    net:       byNames(["Total Penghasilan"]),
  };
  const add = (r: unknown[], cols: number[]) => cols.reduce((a, c) => a + (toNum(r[c]) ?? 0), 0);
  const one = (r: unknown[], c: number) => (c >= 0 ? toNum(r[c]) ?? 0 : 0);

  const orders: FinanceNewOrder[] = [];
  const items: FinanceItemRow[] = [];
  for (let i = headerIdx + 1; i < penghasilan.length; i++) {
    const r = penghasilan[i] || [];
    const orderNo = cell(r, cOrderNo);
    if (!orderNo) continue;
    const kind = cell(r, cKind).toLowerCase();
    const sales = add(r, g.sales);
    const promo = add(r, g.promo), delivery = add(r, g.delivery);
    const platform = add(r, g.platform), xtra = add(r, g.xtra), service = add(r, g.service);
    const campaign = add(r, g.campaign), other = add(r, g.other);

    if (kind === "order") {
      orders.push({
        order_no: orderNo,
        buyer_username: cBuyer >= 0 ? cell(r, cBuyer) || null : null,
        payment_method: cPayment >= 0 ? cell(r, cPayment) || null : null,
        order_date: cOrderDate >= 0 ? asISODate(r[cOrderDate]) : null,
        release_date: cRelease >= 0 ? asISODate(r[cRelease]) : null,
        sales,
        promotion_cost: promo,
        refund: add(r, g.refund),
        delivery_cost: delivery,
        affiliate_cost: add(r, g.affiliate),
        marketplace_fee: platform + xtra + service + campaign + other,
        misc: add(r, g.misc),
        net_income: add(r, g.net),
        jasa_kirim: cJasa >= 0 ? cell(r, cJasa) || null : null,
        nama_kurir: cKurir >= 0 ? cell(r, cKurir) || null : null,
        raw: {},
        tax: add(r, g.tax),
        tax_base: one(r, cTaxBase),
        tax_base_exvat: one(r, cTaxBaseEx),
      });
    } else if (kind === "sku") {
      items.push({
        order_no: orderNo,
        kode_produk: cPid >= 0 ? cell(r, cPid) || null : null,
        nama_produk: cPname >= 0 ? cell(r, cPname) || null : null,
        order_date: cOrderDate >= 0 ? asISODate(r[cOrderDate]) : null,
        release_date: cRelease >= 0 ? asISODate(r[cRelease]) : null,
        sales,
        refund: add(r, g.refund),
        promotion_cost: promo,
        delivery_cost: delivery,
        platform_fee: platform,
        xtra_fee: xtra,
        service_fee: service,
        campaign_fee: campaign,
        affiliate_cost: add(r, g.affiliate),
        misc: add(r, g.misc),
        other_fee: other,
        tax: add(r, g.tax),
        tax_base: one(r, cTaxBase),
        tax_base_exvat: one(r, cTaxBaseEx),
        net_income: add(r, g.net),
      });
    }
  }
  return { username, periodeStart, periodeEnd, orders, items };
}
