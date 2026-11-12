import { describe, expect, it } from "vitest";
import { latestRevisions, Quote, QuoteLine } from "./quote.js";

const line = {
  id: "Q-0001-R1-L1",
  itemCode: "TDI-FEE",
  description: "Teardown & inspection, 3in gate valve",
  kind: "SERVICE",
  qty: 1,
  unitPrice: 85000,
};

const quote = {
  id: "Q-0001",
  revision: 1,
  jobId: "JOB-0001",
  customerId: "CUST-001",
  stage: "TDI",
  priceBookVersion: 2,
  issuedDate: "2026-03-02",
  lines: [line],
};

describe("QuoteLine", () => {
  it("parses a valid line", () => {
    expect(QuoteLine.parse(line)).toEqual(line);
  });

  it("rejects zero quantity and fractional cents", () => {
    expect(QuoteLine.safeParse({ ...line, qty: 0 }).success).toBe(false);
    expect(QuoteLine.safeParse({ ...line, unitPrice: 850.5 }).success).toBe(false);
  });
});

describe("Quote", () => {
  it("parses TDI and REPAIR stages", () => {
    expect(Quote.parse(quote).stage).toBe("TDI");
    expect(Quote.parse({ ...quote, stage: "REPAIR" }).stage).toBe("REPAIR");
  });

  it("rejects an unknown stage, revision 0 and an empty quote", () => {
    expect(Quote.safeParse({ ...quote, stage: "FIELD" }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, revision: 0 }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, lines: [] }).success).toBe(false);
  });

  it("rejects duplicate line ids", () => {
    expect(Quote.safeParse({ ...quote, lines: [line, line] }).success).toBe(false);
  });
});

describe("latestRevisions", () => {
  it("keeps only the highest revision per quote id", () => {
    const r1 = Quote.parse(quote);
    const r2 = Quote.parse({ ...quote, revision: 2 });
    const other = Quote.parse({ ...quote, id: "Q-0002", stage: "REPAIR" });
    const latest = latestRevisions([r2, r1, other]);
    expect(latest.map((q) => `${q.id}@${q.revision}`).sort()).toEqual(["Q-0001@2", "Q-0002@1"]);
  });
});
