/**
 * Test-only builder for a small, fully consistent JobContext (not exported
 * from the package). Customer CUST-T, 10 % markup cap, price-book cutover
 * 2026-01-01, service date 2026-03-10 (so v2 prices apply).
 */
import {
  ChangeOrder,
  CustomerRules,
  Invoice,
  Job,
  PriceBookItem,
  Quote,
  WorkOrder,
} from "@valwell/domain";
import type { JobContext } from "../adapters/sources.js";

const pb = (code: string, kind: string, version: number, price: number) =>
  PriceBookItem.parse({
    id: `PB-${code}-v${version}`,
    customerId: "CUST-T",
    itemCode: code,
    description: code,
    kind,
    unitPrice: price,
    version,
    effectiveFrom: version === 1 ? "2025-01-01" : "2026-01-01",
    effectiveTo: version === 1 ? "2026-01-01" : null,
  });

export function buildContext(): JobContext {
  const priceBook = [
    pb("TDI-FEE", "SERVICE", 1, 80_000),
    pb("TDI-FEE", "SERVICE", 2, 84_000),
    pb("LAB-TECH", "LABOUR", 1, 9_000),
    pb("LAB-TECH", "LABOUR", 2, 9_500),
    pb("LAB-WELD", "LABOUR", 1, 13_000),
    pb("LAB-WELD", "LABOUR", 2, 13_600),
  ];
  const job = Job.parse({
    id: "JOB-T",
    customerId: "CUST-T",
    valveModel: '3-1/16" 5K gate valve',
    valveSerial: "GV-1",
    poNumber: "PO-1",
    receivedDate: "2026-03-01",
    serviceDate: "2026-03-10",
  });
  const quotes = [
    Quote.parse({
      id: "Q-T-TDI",
      revision: 1,
      jobId: "JOB-T",
      customerId: "CUST-T",
      stage: "TDI",
      priceBookVersion: 2,
      issuedDate: "2026-03-02",
      lines: [
        {
          id: "QL-1",
          itemCode: "TDI-FEE",
          description: "TDI",
          kind: "SERVICE",
          qty: 1,
          unitPrice: 84_000,
        },
      ],
    }),
    Quote.parse({
      id: "Q-T-REP",
      revision: 1,
      jobId: "JOB-T",
      customerId: "CUST-T",
      stage: "REPAIR",
      priceBookVersion: 2,
      issuedDate: "2026-03-04",
      lines: [
        {
          id: "QL-2",
          itemCode: "LAB-TECH",
          description: "Tech",
          kind: "LABOUR",
          qty: 6,
          unitPrice: 9_500,
        },
        {
          id: "QL-3",
          itemCode: "PART-SEAT",
          description: "Seat",
          kind: "PART",
          qty: 2,
          unitPrice: 22_000,
        },
      ],
    }),
  ];
  const changeOrders = [
    ChangeOrder.parse({
      id: "CO-T-1",
      jobId: "JOB-T",
      status: "APPROVED",
      approver: "A. Approver",
      approvedDate: "2026-03-09",
      reason: "Stem bent",
      lines: [{ itemCode: "PART-STEM", description: "Stem", kind: "PART", qty: 1 }],
    }),
  ];
  const workOrder = WorkOrder.parse({
    id: "WO-T",
    jobId: "JOB-T",
    lines: [
      { id: "WL-1", kind: "SERVICE", itemCode: "TDI-FEE", description: "TDI", qty: 1 },
      { id: "WL-2", kind: "LABOUR", itemCode: "LAB-TECH", description: "Tech", hours: 6 },
      {
        id: "WL-3",
        kind: "PART",
        itemCode: "PART-SEAT",
        description: "Seat",
        qty: 2,
        unitCost: 20_000,
      },
      {
        id: "WL-4",
        kind: "PART",
        itemCode: "PART-STEM",
        description: "Stem",
        qty: 1,
        unitCost: 40_000,
      },
    ],
    tdiFindings: [],
    hydroTest: { result: "PASS", testPressurePsi: 7500 },
  });
  const line = (
    id: string,
    code: string,
    kind: string,
    qty: number,
    price: number,
    extra = {},
  ) => ({
    id,
    itemCode: code,
    description: code,
    kind,
    qty,
    unitPrice: price,
    amount: price * qty,
    ...extra,
  });
  const invoice = Invoice.parse({
    id: "INV-T",
    jobId: "JOB-T",
    customerId: "CUST-T",
    poNumber: "PO-1",
    invoiceDate: "2026-03-12",
    serviceDate: "2026-03-10",
    lines: [
      line("IL-1", "TDI-FEE", "SERVICE", 1, 84_000, { sourceRef: { workOrderLineId: "WL-1" } }),
      line("IL-2", "LAB-TECH", "LABOUR", 6, 9_500, { sourceRef: { workOrderLineId: "WL-2" } }),
      line("IL-3", "PART-SEAT", "PART", 2, 22_000, { unitCost: 20_000 }),
      line("IL-4", "PART-STEM", "PART", 1, 44_000, { unitCost: 40_000 }),
    ],
  });
  const rules = CustomerRules.parse({ id: "RULE-T", customerId: "CUST-T", markupCapBps: 1000 });
  return { job, quotes, changeOrders, workOrder, invoice, priceBook, rules };
}
