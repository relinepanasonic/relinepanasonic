import { describe, expect, it } from "vitest";
import { parseAdGroupMatrix } from "./parseAdGroup";

// Header order of Shopee's "Semua Data Grup Iklan": the per-conversion costs come BEFORE "Biaya".
const HEAD = ["Urutan", "Nama Iklan/Produk", "Status", "Jenis Iklan", "Kode Produk", "Dilihat", "Jumlah Klik", "Konversi", "Konversi Langsung",
  "Biaya per Konversi", "Biaya per Konversi Langsung", "Produk Terjual", "Terjual Langsung", "Omzet Penjualan", "Penjualan Langsung (GMV Langsung)",
  "Biaya", "Efektifitas Iklan", "Efektivitas Langsung"];

describe("parseAdGroupMatrix", () => {
  it("takes the ad spend from the 'Biaya' column, not from 'Biaya per Konversi'", () => {
    const m = [
      ["Grup Iklan - Shopee"], ["Periode", "01/09/2026 - 30/09/2026"], [],
      HEAD,
      [1, "Grup Hero", "Berjalan", "Iklan Produk", "-", 160534, 8015, 391, 334, "5337.56", "6248.46", 1358, 1093, 32949831, 28359851, 2086985, "15.79", "13.59"],
      [2, "lis kaca wajik pintu PVC", "-", "Iklan Produk", "13257838375", 1135, 8, 2, 2, "240.84", "240.84", 2, 2, 30000, 30000, 482, "62.28", "62.28"],
    ];
    const p = parseAdGroupMatrix(m);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ level: "group", item_name: "Grup Hero", biaya: 2086985, konversi: 391, konversi_langsung: 334 });
    expect(p.rows[1]).toMatchObject({ level: "product", kode_produk: "13257838375", biaya: 482 });
    expect(p.periodeStart).toBe("2026-09-01");
  });

  it("falls back to a cost-like column that is not a per-conversion figure", () => {
    const head = ["Nama Produk", "Kode Produk", "Biaya per Konversi", "Ad Cost"];
    const p = parseAdGroupMatrix([head, ["Produk A", "123", "99", "5000"]]);
    expect(p.rows[0].biaya).toBe(5000);
  });
});
