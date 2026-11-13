import { describe, expect, it } from "vitest";
import { ChangeOrder, Job, WorkOrder, WorkOrderLine, workOrderLineQty } from "./work.js";

const labour = {
  id: "WO-0001-L1",
  kind: "LABOUR",
  itemCode: "LAB-TECH",
  description: "Technician",
  hours: 6.5,
};
const part = {
  id: "WO-0001-L2",
  kind: "PART",
  itemCode: "PART-SEAT-3IN",
  description: "Seat ring",
  qty: 2,
  unitCost: 21000,
};
const service = {
  id: "WO-0001-L3",
  kind: "SERVICE",
  itemCode: "HYDRO-TEST",
  description: "Hydro test",
  qty: 1,
};

const workOrder = {
  id: "WO-0001",
  jobId: "JOB-0001",
  lines: [labour, part, service],
  tdiFindings: [
    { component: "Seat", condition: "Pitted", recommendedItemCodes: ["PART-SEAT-3IN"] },
  ],
  hydroTest: { result: "PASS", testPressurePsi: 5000 },
};

describe("Job", () => {
  it("parses a valid job and rejects a bad date", () => {
    const job = {
      id: "JOB-0001",
      customerId: "CUST-001",
      valveModel: "3in 5K gate valve",
      valveSerial: "GV-778812",
      poNumber: "PO-55120",
      receivedDate: "2026-03-01",
      serviceDate: "2026-03-09",
    };
    expect(Job.parse(job)).toEqual(job);
    expect(Job.safeParse({ ...job, serviceDate: "March 9" }).success).toBe(false);
  });
});

describe("WorkOrderLine", () => {
  it("discriminates by kind", () => {
    expect(WorkOrderLine.parse(part).kind).toBe("PART");
    expect(workOrderLineQty(WorkOrderLine.parse(labour))).toBe(6.5);
    expect(workOrderLineQty(WorkOrderLine.parse(part))).toBe(2);
  });

  it("requires a cost on parts and hours on labour", () => {
    const { unitCost: _cost, ...partWithoutCost } = part;
    expect(WorkOrderLine.safeParse(partWithoutCost).success).toBe(false);
    expect(WorkOrderLine.safeParse({ ...labour, hours: undefined, qty: 1 }).success).toBe(false);
    expect(WorkOrderLine.safeParse({ ...part, unitCost: -1 }).success).toBe(false);
  });
});

describe("WorkOrder", () => {
  it("parses findings and hydro test, which may be absent", () => {
    expect(WorkOrder.parse(workOrder).tdiFindings).toHaveLength(1);
    expect(WorkOrder.parse({ ...workOrder, hydroTest: null }).hydroTest).toBeNull();
  });

  it("accepts optional technician notes and leaves them absent by default", () => {
    expect(WorkOrder.parse(workOrder).technicianNotes).toBeUndefined();
    const note = {
      id: "WO-1-N1",
      workOrderLineId: null,
      author: "Tech",
      date: "2026-03-09",
      text: "Stem bent; replaced.",
    };
    expect(WorkOrder.parse({ ...workOrder, technicianNotes: [note] }).technicianNotes).toEqual([
      note,
    ]);
    expect(
      WorkOrder.safeParse({ ...workOrder, technicianNotes: [{ ...note, text: "" }] }).success,
    ).toBe(false);
  });

  it("rejects duplicate line ids and an unknown hydro result", () => {
    expect(WorkOrder.safeParse({ ...workOrder, lines: [part, part] }).success).toBe(false);
    const badHydro = { ...workOrder, hydroTest: { result: "LEAK", testPressurePsi: 5000 } };
    expect(WorkOrder.safeParse(badHydro).success).toBe(false);
  });
});

describe("ChangeOrder", () => {
  const co = {
    id: "CO-0001",
    jobId: "JOB-0001",
    status: "APPROVED",
    approver: "J. Okafor",
    approvedDate: "2026-03-05",
    reason: "Stem found bent at TDI",
    lines: [{ itemCode: "PART-STEM-3IN", description: "Stem", kind: "PART", qty: 1 }],
  };

  it("parses approved and pending change orders", () => {
    expect(ChangeOrder.parse(co).status).toBe("APPROVED");
    const pending = { ...co, status: "PENDING", approver: null, approvedDate: null };
    expect(ChangeOrder.parse(pending).status).toBe("PENDING");
  });

  it("requires an approver exactly when approved", () => {
    expect(ChangeOrder.safeParse({ ...co, approver: null }).success).toBe(false);
    expect(ChangeOrder.safeParse({ ...co, status: "PENDING" }).success).toBe(false);
  });
});
