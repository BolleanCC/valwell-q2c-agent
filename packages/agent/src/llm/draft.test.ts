import { InvoiceLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import {
  amountsFromHeldLine,
  type EvidenceSource,
  renderChangeOrderRequest,
  validateDraft,
} from "./draft.js";

const available = new Map<string, EvidenceSource>([
  ["F-0001", "FINDING"],
  ["WO-D4-L5", "WORK_ORDER_LINE"],
  ["WO-D4-N1", "TECHNICIAN_NOTE"],
]);

const good = {
  workSummary: "The valve stem was replaced during the repair.",
  businessReason: "The stem was found bent beyond tolerance and the gate would not seat.",
  evidenceIds: ["F-0001", "WO-D4-L5", "WO-D4-N1"],
  missingInformation: [],
  customerRequestText:
    "During the repair we found the valve stem bent and replaced it. Please review this change order.",
};

const validate = (raw: unknown) => validateDraft(raw, available, "WO-D4-L5");
const problemsOf = (raw: unknown) => {
  const r = validate(raw);
  return r.status === "INVALID_OUTPUT" ? r.problems : [];
};

describe("validateDraft", () => {
  it("accepts a draft whose evidence came from tool results", () => {
    expect(validate(good)).toEqual({ status: "DRAFTED", content: good });
  });

  it("rejects output that does not match the schema", () => {
    expect(problemsOf({ ...good, customerRequestText: undefined })).toEqual([
      "customerRequestText: Invalid input: expected string, received undefined",
    ]);
    expect(problemsOf({ ...good, unitPrice: 440 })[0]).toContain("Unrecognized key");
  });

  it("rejects evidence ids no tool returned, and a draft that ignores the held line", () => {
    expect(problemsOf({ ...good, evidenceIds: ["WO-D4-N1", "WO-D9-L1"] })).toEqual([
      "evidence not returned by any tool in this run: WO-D9-L1",
      "the held work-order line WO-D4-L5 is not cited",
    ]);
  });

  it("rejects claims of approval or payment and any money in the text", () => {
    expect(problemsOf({ ...good, workSummary: "Customer approved the stem." })).toEqual([
      "text claims approval, submission, payment or release",
    ]);
    expect(problemsOf({ ...good, customerRequestText: "The stem costs $440.00." })).toEqual([
      "text contains a monetary amount; amounts come from deterministic code",
    ]);
  });

  it("rejects a business reason that no technician note or TDI finding supports", () => {
    expect(problemsOf({ ...good, evidenceIds: ["F-0001", "WO-D4-L5"] })).toEqual([
      "business reason does not cite a technician note or TDI finding",
    ]);
  });

  it("reports insufficient evidence when the reason is missing but declared as missing", () => {
    const noReason = {
      ...good,
      businessReason: null,
      evidenceIds: ["F-0001", "WO-D4-L5"],
      missingInformation: ["Why the stem was replaced"],
    };
    expect(validate(noReason)).toMatchObject({ status: "INSUFFICIENT_EVIDENCE" });
    expect(problemsOf({ ...noReason, missingInformation: [] })).toEqual([
      "no business reason and no missing information reported",
    ]);
  });
});

describe("renderChangeOrderRequest", () => {
  it("inserts the authoritative amounts from the held line, not from the model", () => {
    const held = InvoiceLine.parse({
      id: "INV-D4-L5",
      itemCode: "PART-STEM",
      description: "Valve stem",
      kind: "PART",
      qty: 1,
      unitPrice: 44_000,
      amount: 44_000,
      unitCost: 40_000,
    });
    const lines = renderChangeOrderRequest(good, amountsFromHeldLine(held, "WO-D4-L5"));
    expect(lines[0]).toContain("DRAFT for human review (not sent, not approved by the customer)");
    expect(lines).toContain(
      "Amount (from the held invoice line, deterministic): 1 × $440.00 = $440.00",
    );
    expect(lines).toContain("Evidence: F-0001, WO-D4-L5, WO-D4-N1");
  });
});
