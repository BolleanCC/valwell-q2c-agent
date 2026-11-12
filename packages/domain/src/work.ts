import { z } from "zod";
import { Money } from "./money.js";
import {
  ChangeOrderId,
  CustomerId,
  IsoDate,
  ItemCode,
  JobId,
  LineKind,
  Quantity,
  WorkOrderId,
  WorkOrderLineId,
} from "./primitives.js";

/** A valve received into the shop for remanufacturing. */
export const Job = z.object({
  id: JobId,
  customerId: CustomerId,
  valveModel: z.string().min(1),
  valveSerial: z.string().min(1),
  poNumber: z.string().min(1),
  receivedDate: IsoDate,
  /** Date the work was performed; decides which price-book version applies. */
  serviceDate: IsoDate,
});
export type Job = z.infer<typeof Job>;

const lineBase = {
  id: WorkOrderLineId,
  itemCode: ItemCode,
  description: z.string().min(1),
};

/** Hours worked, priced later from the price book. */
export const LabourLine = z.object({ ...lineBase, kind: z.literal("LABOUR"), hours: Quantity });
/** Part consumed, with its actual unit cost (basis for cost-plus billing). */
export const PartLine = z.object({
  ...lineBase,
  kind: z.literal("PART"),
  qty: Quantity,
  unitCost: Money.refine((m) => m >= 0, "unitCost must not be negative"),
});
/** Fixed-price service performed, e.g. teardown & inspection or hydro test. */
export const ServiceLine = z.object({ ...lineBase, kind: z.literal("SERVICE"), qty: Quantity });

export const WorkOrderLine = z.discriminatedUnion("kind", [LabourLine, PartLine, ServiceLine]);
export type WorkOrderLine = z.infer<typeof WorkOrderLine>;

/** Billable quantity of a work-order line: hours for labour, units otherwise. */
export function workOrderLineQty(line: WorkOrderLine): number {
  return line.kind === "LABOUR" ? line.hours : line.qty;
}

export const TdiFinding = z.object({
  component: z.string().min(1),
  condition: z.string().min(1),
  /** Item codes the inspector recommends replacing or performing. */
  recommendedItemCodes: z.array(ItemCode),
});
export type TdiFinding = z.infer<typeof TdiFinding>;

export const HydroTest = z.object({
  result: z.enum(["PASS", "FAIL"]),
  testPressurePsi: z.int().positive(),
});
export type HydroTest = z.infer<typeof HydroTest>;

/** The shop's record of what was actually done on a job. */
export const WorkOrder = z
  .object({
    id: WorkOrderId,
    jobId: JobId,
    lines: z.array(WorkOrderLine).min(1),
    tdiFindings: z.array(TdiFinding),
    hydroTest: HydroTest.nullable(),
  })
  .refine((w) => new Set(w.lines.map((l) => l.id)).size === w.lines.length, {
    message: "work order line ids must be unique",
    path: ["lines"],
  });
export type WorkOrder = z.infer<typeof WorkOrder>;

export const ChangeOrderStatus = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type ChangeOrderStatus = z.infer<typeof ChangeOrderStatus>;

export const ChangeOrderLine = z.object({
  itemCode: ItemCode,
  description: z.string().min(1),
  kind: LineKind,
  qty: Quantity,
});
export type ChangeOrderLine = z.infer<typeof ChangeOrderLine>;

/** A customer amendment to scope. Only APPROVED change orders make extra work billable. */
export const ChangeOrder = z
  .object({
    id: ChangeOrderId,
    jobId: JobId,
    status: ChangeOrderStatus,
    approver: z.string().min(1).nullable(),
    approvedDate: IsoDate.nullable(),
    reason: z.string().min(1),
    lines: z.array(ChangeOrderLine).min(1),
  })
  .refine((c) => (c.status === "APPROVED") === (c.approver !== null && c.approvedDate !== null), {
    message: "approver and approvedDate are required exactly when status is APPROVED",
    path: ["status"],
  });
export type ChangeOrder = z.infer<typeof ChangeOrder>;
