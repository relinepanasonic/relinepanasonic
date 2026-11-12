// The week of an upload, as the Monday the ERP expects ("week": "2026-11-02"). Same rules as the performance data (Supabase Migration/82):
//   - a dated week (the upload's start date) belongs to the Monday of that date; a Sunday start belongs to the NEXT day (Sunday-start weeks move one day forward)
//   - a week with only a label ("Week 3" of a month, no date): Week 1 = the first Monday of the month, then +7 days per week
// null = no usable week (Month Awal / baseline, or nothing picked): the ERP then uses the last full week.

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const isodow = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;   // Monday = 1 ... Sunday = 7

export function weekMondayOfDate(date: string | null | undefined): string | null {
  if (!date || !ISO.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const dt = utc(y, m - 1, d);
  if (Number.isNaN(dt.getTime()) || iso(dt) !== date) return null;
  const dow = isodow(dt);
  return iso(utc(y, m - 1, d + (dow === 7 ? 1 : 1 - dow)));
}

export function weekMondayOfLabel(year: number | string | null | undefined, month: string | null | undefined, week: string | null | undefined): string | null {
  const y = Number(year), mi = MONTHS.indexOf(month || "");
  const n = Number(String(week ?? "").replace(/\D/g, ""));
  if (!Number.isInteger(y) || y < 2000 || mi < 0 || !Number.isInteger(n) || n < 1) return null;
  const first = utc(y, mi, 1);
  return iso(utc(y, mi, 1 + ((8 - isodow(first)) % 7) + 7 * (n - 1)));
}

// the start date of the upload when it has one, else its label
export function reportWeek(x: { tanggal?: string | null; year?: number | string | null; month?: string | null; week?: string | null }): string | null {
  return weekMondayOfDate(x.tanggal) ?? weekMondayOfLabel(x.year, x.month, x.week);
}
