// The PDF of a Price Research result: Prof Toko Online header, executive summary, analytics, then the full price table.
import { colLabels, diffPct, oursOf, verdict, type ResultData, type ResultMeta, type Verdict } from "./scrapeResult";
import { summarize, type Summary } from "./scrapeSummary";

const NAVY: [number, number, number] = [11, 26, 51];
const GOLD: [number, number, number] = [201, 154, 46];
const MUTED: [number, number, number] = [85, 98, 122];
const RED: [number, number, number] = [200, 40, 40];
const GREEN: [number, number, number] = [20, 120, 60];
const GRID: [number, number, number] = [213, 219, 230];
const PAGE_W = 842, PAGE_H = 595, M = 32;

const rp = (n: number | null | undefined) => (n == null ? "" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const pct = (d: number | null | undefined) => (d == null ? "-" : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`);

// the logo with its grey background made white (the file is a flat picture)
async function loadLogo(): Promise<string | null> {
  try {
    const blob = await (await fetch("/prof-toko-logo.jpg")).blob();
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext("2d"); if (!cx) return null;
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, cv.width, cv.height), d = px.data, [br, bg, bb] = [d[0], d[1], d[2]];
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - br) < 9 && Math.abs(d[i + 1] - bg) < 9 && Math.abs(d[i + 2] - bb) < 9) { d[i] = d[i + 1] = d[i + 2] = 255; }
    cx.putImageData(px, 0, 0);
    return cv.toDataURL("image/png");
  } catch { return null; }
}

type Doc = import("jspdf").jsPDF;
const lastY = (doc: Doc) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;

// horizontal bars: label | bar | value. `max` is the full bar width.
function bars(doc: Doc, x: number, y: number, w: number, items: { label: string; v: number; text: string; color: [number, number, number] }[], max: number) {
  const labelW = 120, valW = 60, barW = w - labelW - valW, h = 13;
  items.forEach((it, i) => {
    const yy = y + i * (h + 6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...NAVY);
    doc.text(doc.splitTextToSize(it.label, labelW - 6)[0], x, yy + 9);
    doc.setFillColor(238, 241, 247); doc.rect(x + labelW, yy, barW, h, "F");
    const bw = max > 0 ? Math.max(it.v > 0 ? 2 : 0, (Math.abs(it.v) / max) * barW) : 0;
    doc.setFillColor(...it.color); doc.rect(x + labelW, yy, bw, h, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY); doc.text(it.text, x + labelW + barW + 6, yy + 9);
  });
  return y + items.length * (h + 6);
}

export async function downloadScrapePdf(data: ResultData, meta: ResultMeta, fileStamp: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const logo = await loadLogo();
  const s: Summary = summarize(data);
  const labels = colLabels(data.columns);

  // ── header ──
  if (logo) doc.addImage(logo, "PNG", M, 20, 52, 52);
  const tx = logo ? M + 62 : M;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...GOLD); doc.text("PROF TOKO ONLINE", tx, 34);
  doc.setFontSize(22); doc.setTextColor(...NAVY); doc.text("Price Guard Project", tx, 56);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text(`${meta.title}${meta.by ? ` · Price Research by ${meta.by}` : ""}`, tx, 70);
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(M, 80, PAGE_W - M, 80);

  // ── KPI tiles ──
  const tiles: [string, string, string][] = [
    ["Tokens used", String(s.tokens), "1 token = 1 connection"],
    ["Products", String(s.products), `${s.links} links researched`],
    ["Prices compared", String(s.compared), s.broken || s.noPrice ? `${s.broken} broken link · ${s.noPrice} no price` : "all links read"],
    ["Cheaper than us", s.compared ? `${Math.round((s.cheaper / s.compared) * 100)}%` : "-", `${s.cheaper} of ${s.compared} prices`],
    ["Avg price below ours", pct(s.avgDown), "only where cheaper"],
  ];
  const tw = (PAGE_W - 2 * M - 4 * 10) / 5;
  tiles.forEach(([a, b, c], i) => {
    const x = M + i * (tw + 10);
    doc.setFillColor(243, 246, 251); doc.setDrawColor(...GRID); doc.setLineWidth(0.5); doc.roundedRect(x, 92, tw, 54, 4, 4, "FD");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(a, x + 10, 106);
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...(i === 3 || i === 4 ? RED : NAVY)); doc.text(b, x + 10, 128);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(c, x + 10, 140);
  });

  // ── executive summary text ──
  let y = 166;
  const heading = (t: string) => {
    if (y > PAGE_H - 120) { doc.addPage(); y = 40; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...NAVY); doc.text(t, M, y); y += 8;
  };
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...NAVY); doc.text("Executive summary", M, y); y += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...NAVY);
  for (const line of s.insights.slice(0, 5)) {
    const parts = doc.splitTextToSize(line, PAGE_W - 2 * M - 14);
    doc.setFillColor(...GOLD); doc.circle(M + 3, y - 3, 1.8, "F");
    doc.text(parts, M + 12, y); y += parts.length * 11 + 3;
  }
  y += 8;

  const tableBase = { margin: { left: M, right: M }, theme: "grid" as const, styles: { fontSize: 8, cellPadding: 3, textColor: NAVY, lineColor: GRID, lineWidth: 0.3, valign: "middle" as const },
    headStyles: { fillColor: [232, 237, 246] as [number, number, number], textColor: NAVY, fontStyle: "bold" as const } };

  // 1 · most dumping store
  heading("1. Which store dumps the price the most");
  autoTable(doc, { ...tableBase, startY: y + 4,
    head: [["#", "Connection", "Platform", "Products sold", "Compared", "Cheaper than us", "Avg price below ours", "Avg vs our price (all)"]],
    body: s.stores.map((x, i) => [x.cheaper ? String(i + 1) : "-", x.label, x.platform || "", `${x.sold} (${Math.round(x.coverage * 100)}%)`, String(x.compared), String(x.cheaper), pct(x.avgDown), pct(x.avgAll)]),
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right", fontStyle: "bold" }, 7: { halign: "right" } },
    didParseCell: (h) => { if (h.section === "body" && h.row.index === 0 && s.dumping) { h.cell.styles.fillColor = [253, 235, 235]; h.cell.styles.textColor = RED; } },
  });
  y = lastY(doc) + 18;

  // 2 · worst product per category
  heading("2. Worst product per category");
  autoTable(doc, { ...tableBase, startY: y + 4,
    head: [["Category", "Products", "Prices below ours", "Worst product", "Our price", "Lowest competitor", "Store", "Gap"]],
    body: s.types.map((t) => [t.type, String(t.products), `${t.cheaper} of ${t.compared}`, t.worst ? `${t.worst.prod_id}\n${t.worst.product_name}` : "No price below ours", t.worst ? rp(t.worst.ours) : "", t.worst ? rp(t.worst.price) : "", t.worst?.store || "", t.worst ? pct(t.worst.pct) : ""]),
    columnStyles: { 3: { cellWidth: 200 }, 4: { halign: "right" }, 5: { halign: "right" }, 7: { halign: "right", fontStyle: "bold", textColor: RED } },
  });
  y = lastY(doc) + 18;

  // 3 · our price change to SRP
  heading("3. Our SRP vs the Avg Market Price");
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text(s.needChange ? `${s.needChange} of ${s.products} products have an Avg Market Price below our SRP; moving to it means ${pct(s.avgChange)} on average. The 15 biggest changes:` : "The Avg Market Price is not below our SRP on any product: no change needed.", M, y + 12);
  if (s.needChange) {
    autoTable(doc, { ...tableBase, startY: y + 18,
      head: [["Prod ID", "Product Name", "Category", "Our SRP", "Avg Market Price", "Lowest Market Price", "Change (Rp)", "Change (%)", "Lowest at"]],
      body: s.market.slice(0, 15).map((c) => [c.prod_id, c.product_name, c.type, rp(c.ours), rp(c.avg), rp(c.low), rp(c.rp), pct(c.pct), c.lowStore]),
      columnStyles: { 1: { cellWidth: 190 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right", fontStyle: "bold", textColor: RED } },
    });
    y = lastY(doc) + 18;
  } else y += 30;

  // ── analytics ──
  doc.addPage(); y = 40;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...NAVY); doc.text("Analytics", M, y); y += 20;
  const half = (PAGE_W - 2 * M - 30) / 2;
  const row = (t: string, x: number, yy: number) => { doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...NAVY); doc.text(t, x, yy); };

  row("Result of all research links", M, y);
  const mix: [string, number, [number, number, number]][] = [["Cheaper than us", s.cheaper, RED], ["Same as us", s.same, [120, 130, 150]], ["More expensive than us", s.pricier, GREEN], ["Not sold", s.notSold, [190, 197, 210]], ["Broken link", s.broken, [230, 120, 60]], ["No price found", s.noPrice + s.pending, [230, 175, 60]]];
  const total = mix.reduce((a, b) => a + b[1], 0) || 1;
  const endMix = bars(doc, M, y + 10, half, mix.map(([label, v, color]) => ({ label, v, color, text: `${v} (${Math.round((v / total) * 100)}%)` })), Math.max(...mix.map((m) => m[1]), 1));

  row("Average price below ours, per connection", M + half + 30, y);
  const st = s.stores.filter((x) => x.avgDown != null);
  const endSt = st.length ? bars(doc, M + half + 30, y + 10, half, st.slice(0, 8).map((x) => ({ label: x.label, v: x.avgDown!, color: RED, text: pct(x.avgDown) })), Math.max(...st.map((x) => Math.abs(x.avgDown!)), 1)) : y + 10;
  if (!st.length) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text("No competitor is below our price.", M + half + 30, y + 22); }

  y = Math.max(endMix, endSt) + 26;
  row("Share of prices below ours, per category", M, y);
  const ty = s.types.filter((t) => t.compared > 0);
  const endTy = bars(doc, M, y + 10, half, ty.slice(0, 10).map((t) => ({ label: t.type, v: t.cheaper / t.compared, color: t.cheaper / t.compared > 0.5 ? RED : [201, 154, 46], text: `${Math.round((t.cheaper / t.compared) * 100)}% (${t.cheaper}/${t.compared})` })), 1);

  row("Coverage: our products sold by each connection", M + half + 30, y);
  const endCo = bars(doc, M + half + 30, y + 10, half, s.stores.slice(0, 10).map((x) => ({ label: x.label, v: x.coverage, color: NAVY, text: `${Math.round(x.coverage * 100)}%` })), 1);

  y = Math.max(endTy, endCo) + 22;
  row("Reading", M, y); y += 12;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  for (const l of s.insights.slice(5)) { const p = doc.splitTextToSize(`• ${l}`, PAGE_W - 2 * M); doc.text(p, M, y); y += p.length * 11; }
  const note = doc.splitTextToSize("A price below our price is red (the competitor is cheaper); above it is green. Gap = competitor price / our price - 1. Average price below ours only counts the prices that are cheaper than ours. Tokens: 1 token is used per connection researched.", PAGE_W - 2 * M);
  doc.text(note, M, y + 4);

  // ── the full price table ──
  doc.addPage();
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...NAVY); doc.text("All prices", M, 40);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text("Red: the competitor is cheaper than our price · Green: more expensive than our price", M, 54);

  const verdicts: Verdict[][] = [];
  const body = data.rows.map((r) => {
    const ours = oursOf(r, data.columns);
    const line: string[] = [r.prod_id, r.product_name, ours.length === 0 ? "" : ours.map((x) => (ours.length > 1 ? `${rp(x.v)} ${x.platform || ""}` : rp(x.v))).join("\n")];
    const vs: Verdict[] = [];
    for (const c of data.columns) {
      const cell = r.cells[c.id], v = verdict(cell);
      vs.push(v);
      if (v === "none") line.push("-");
      else if (v === "broken") line.push("broken link");
      else if (v === "noprice") line.push("no price found");
      else if (v === "pending") line.push("...");
      else { const d = diffPct(cell!.price!, cell!.ours); line.push(`${rp(cell!.price)}${d == null ? "" : `\n${pct(d)}`}`); }
    }
    verdicts.push(vs);
    return line;
  });
  const n = data.columns.length;
  const storeW = n > 0 ? Math.max(58, Math.min(90, Math.floor((PAGE_W - 64 - 60 - 170 - 70) / n))) : 80;
  autoTable(doc, {
    startY: 62, margin: { left: M, right: M }, theme: "grid",
    styles: { fontSize: n > 5 ? 6.5 : 7.5, cellPadding: 3, textColor: NAVY, lineColor: GRID, lineWidth: 0.3, valign: "middle" },
    headStyles: { fillColor: [232, 237, 246], textColor: NAVY, fontStyle: "bold" },
    head: [["Prod ID", "Product Name", "Our Price", ...data.columns.map((c) => labels.get(c.id)!)]],
    body,
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 170 }, 2: { halign: "right", cellWidth: 62 }, ...Object.fromEntries(data.columns.map((_, i) => [3 + i, { halign: "right", cellWidth: storeW }])) },
    didParseCell: (h) => {
      if (h.section === "head" && h.column.index >= 2) h.cell.styles.halign = "right";
      if (h.section !== "body" || h.column.index < 3) return;
      const v = verdicts[h.row.index]?.[h.column.index - 3];
      if (v === "cheaper") { h.cell.styles.textColor = RED; h.cell.styles.fillColor = [253, 235, 235]; }
      else if (v === "pricier") { h.cell.styles.textColor = GREEN; h.cell.styles.fillColor = [231, 247, 237]; }
      else if (v === "none" || v === "pending") h.cell.styles.textColor = [150, 160, 180];
      else if (v === "broken") h.cell.styles.textColor = [200, 100, 30];
      else if (v === "noprice") h.cell.styles.textColor = [170, 125, 20];
    },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(122, 134, 156);
    doc.text(`Prof Toko Online · Price Guard Project · ${meta.title}`, M, PAGE_H - 15);
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - 15, { align: "right" });
  }
  doc.save(`price-guard-${fileStamp}.pdf`);
}
