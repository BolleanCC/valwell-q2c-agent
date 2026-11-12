import { describe, expect, it } from "vitest";
import { addDays } from "./dates.js";

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2025-12-30", 3)).toBe("2026-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("rejects an invalid date", () => {
    expect(() => addDays("not-a-date", 1)).toThrow(RangeError);
  });
});
