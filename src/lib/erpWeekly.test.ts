import { describe, expect, it } from "vitest";
import { reportWeek, weekMondayOfDate, weekMondayOfLabel } from "./erpWeekly";

describe("the Monday of an upload week", () => {
  it("a dated week belongs to the Monday of its date; a Sunday start moves one day forward", () => {
    expect(weekMondayOfDate("2026-11-02")).toBe("2026-11-02");   // Monday
    expect(weekMondayOfDate("2026-11-04")).toBe("2026-11-02");   // Wednesday
    expect(weekMondayOfDate("2026-11-08")).toBe("2026-11-09");   // Sunday -> next Monday
    expect(weekMondayOfDate("2026-12-31")).toBe("2026-12-28");
    expect(weekMondayOfDate("2026-02-30")).toBeNull();
    expect(weekMondayOfDate("")).toBeNull();
    expect(weekMondayOfDate(null)).toBeNull();
  });
  it("a label week: Week 1 = the first Monday of the month, then +7 days", () => {
    expect(weekMondayOfLabel(2026, "November", "Week 1")).toBe("2026-11-02");
    expect(weekMondayOfLabel(2026, "November", "Week 2")).toBe("2026-11-09");
    expect(weekMondayOfLabel("2026", "Oktober", "Week 3")).toBe("2026-10-19");
    expect(weekMondayOfLabel(2026, "Februari", "Week 1")).toBe("2026-02-02");
    expect(weekMondayOfLabel(2026, "Juni", "Week 1")).toBe("2026-06-01");   // the 1st is a Monday
    expect(weekMondayOfLabel(2026, "Month Awal", "Month Awal")).toBeNull();
    expect(weekMondayOfLabel(2026, "November", "")).toBeNull();
    expect(weekMondayOfLabel(null, "November", "Week 1")).toBeNull();
  });
  it("the date wins over the label", () => {
    expect(reportWeek({ tanggal: "2026-11-09", year: 2026, month: "November", week: "Week 1" })).toBe("2026-11-09");
    expect(reportWeek({ tanggal: "", year: 2026, month: "November", week: "Week 1" })).toBe("2026-11-02");
    expect(reportWeek({ year: 2026, month: "Month Awal", week: "Month Awal" })).toBeNull();
  });
});
