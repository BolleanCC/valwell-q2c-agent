import {
  applyMarkupBps,
  ChangeOrder,
  type CustomerRules,
  fromDollars,
  Invoice,
  type InvoiceLine,
  Job,
  type Money,
  multiplyQty,
  type PriceBookItem,
  Quote,
  type QuoteLine,
  WorkOrder,
  type WorkOrderLine,
} from "@valwell/domain";
import type { z } from "zod";
import { type CatalogueEntry, LABOUR, PARTS, SERVICES, VALVE_MODELS } from "./catalogue.js";
import { addDays } from "./dates.js";
import type { ReferenceData } from "./reference.js";
import type { Rng } from "./rng.js";

/** Everything the four source systems know about one job. */
export interface JobBundle {
  job: Job;
  quotes: Quote[];
  workOrder: WorkOrder;
  changeOrders: ChangeOrder[];
  invoice: Invoice;
}

const FIRST_RECEIVED = "2025-07-01";
const CONDITIONS = ["Pitted", "Eroded", "Scored", "Worn beyond tolerance", "Cracked"];
const APPROVERS = ["J. Okafor", "M. Tremblay", "S. Nguyen", "R. Desjardins"];
const [TDI_FEE, HYDRO_TEST] = SERVICES;
const [LAB_TECH, LAB_MACH] = LABOUR;

/** Price-book entry in force on `date`. The generator's own lookup, independent of the agent. */
export function priceOn(
  book: readonly PriceBookItem[],
  customerId: string,
  itemCode: string,
  date: string,
) {
  const item = book.find(
    (p) =>
      p.customerId === customerId &&
      p.itemCode === itemCode &&
      p.effectiveFrom <= date &&
      (p.effectiveTo === null || date < p.effectiveTo),
  );
  if (!item) throw new Error(`No price for ${customerId}/${itemCode} on ${date}`);
  return item;
}

interface Planned {
  entry: CatalogueEntry;
  qty: number;
  unitCost?: Money;
  changeOrderId?: string;
}

// Builders produce schema *inputs* (plain strings); `parse` validates and brands them.
type QuoteLineInput = z.input<typeof QuoteLine>;
type WorkOrderLineInput = z.input<typeof WorkOrderLine>;
type InvoiceLineInput = z.input<typeof InvoiceLine>;

/** Draw a whole-dollar amount from a catalogue entry's range. */
function drawDollars(rng: Rng, entry: CatalogueEntry): Money {
  return fromDollars(rng.int(entry.dollarRange[0], entry.dollarRange[1]));
}

/** Build one fully consistent job: TDI quote → findings → repair quote → work order → invoice. */
export function generateJob(rng: Rng, ref: ReferenceData, index: number): JobBundle {
  const n = String(index + 1).padStart(4, "0");
  const customer = rng.pick(ref.customers);
  const rules = ref.rules.find((r) => r.customerId === customer.id) as CustomerRules;
  const valveModel = rng.pick(VALVE_MODELS);
  const receivedDate = addDays(FIRST_RECEIVED, rng.int(0, 364));
  const serviceDate = addDays(receivedDate, rng.int(5, 12));
  const job = Job.parse({
    id: `JOB-${n}`,
    customerId: customer.id,
    valveModel,
    valveSerial: `GV-${rng.int(100000, 999999)}`,
    poNumber: `PO-${rng.int(40000, 69999)}`,
    receivedDate,
    serviceDate,
  });
  const price = (code: string) => priceOn(ref.priceBook, customer.id, code, serviceDate);
  const markupBps = Math.max(0, rules.markupCapBps - rng.pick([0, 0, 200, 500]));

  // Findings at teardown decide which parts the repair quote replaces.
  const parts = rng.sample(PARTS, rng.int(1, 3));
  const tdiFindings = parts.map((p) => ({
    component: p.description,
    condition: rng.pick(CONDITIONS),
    recommendedItemCodes: [p.itemCode],
  }));
  const repairPlan: Planned[] = [
    { entry: LAB_TECH, qty: rng.int(8, 24) / 2 },
    ...(rng.chance(0.5) ? [{ entry: LAB_MACH, qty: rng.int(2, 8) / 2 }] : []),
    ...parts.map((p) => ({
      entry: p,
      qty: p.itemCode === "PART-SEAT" ? 2 : 1,
      unitCost: drawDollars(rng, p),
    })),
    { entry: HYDRO_TEST, qty: 1 },
  ];

  // Sometimes the repair uncovers more work, which the customer approves.
  const changeOrders: ChangeOrder[] = [];
  const coPlan: Planned[] = [];
  if (rng.chance(0.25)) {
    const extra = rng.pick(PARTS.filter((p) => !parts.includes(p)));
    const coId = `CO-${n}-1`;
    coPlan.push({
      entry: extra,
      qty: 1,
      unitCost: drawDollars(rng, extra),
      changeOrderId: coId,
    });
    changeOrders.push(
      ChangeOrder.parse({
        id: coId,
        jobId: job.id,
        status: "APPROVED",
        approver: rng.pick(APPROVERS),
        approvedDate: addDays(serviceDate, -1),
        reason: `${extra.description} found damaged during repair`,
        lines: [{ itemCode: extra.itemCode, description: extra.description, kind: "PART", qty: 1 }],
      }),
    );
  }

  const unitPriceOf = (p: Planned): Money =>
    p.unitCost === undefined
      ? price(p.entry.itemCode).unitPrice
      : applyMarkupBps(p.unitCost, markupBps);
  const quoteLine = (quoteId: string, p: Planned, i: number): QuoteLineInput => ({
    id: `${quoteId}-R1-L${i + 1}`,
    itemCode: p.entry.itemCode,
    description: p.entry.description,
    kind: p.entry.kind,
    qty: p.qty,
    unitPrice: unitPriceOf(p),
  });
  const priceBookVersion = price(TDI_FEE.itemCode).version;
  const tdiPlan: Planned[] = [{ entry: TDI_FEE, qty: 1 }];
  const tdiQuote = Quote.parse({
    id: `Q-${n}-TDI`,
    revision: 1,
    jobId: job.id,
    customerId: customer.id,
    stage: "TDI",
    priceBookVersion,
    issuedDate: addDays(receivedDate, 1),
    lines: tdiPlan.map((p, i) => quoteLine(`Q-${n}-TDI`, p, i)),
  });
  const repairQuote = Quote.parse({
    ...tdiQuote,
    id: `Q-${n}-REP`,
    stage: "REPAIR",
    issuedDate: addDays(receivedDate, 3),
    lines: repairPlan.map((p, i) => quoteLine(`Q-${n}-REP`, p, i)),
  });

  // What the shop actually did: quoted scope plus approved change-order scope.
  const performed: { plan: Planned; quoteLineId: string | undefined }[] = [
    ...tdiPlan.map((plan, i) => ({ plan, quoteLineId: tdiQuote.lines[i]?.id })),
    ...repairPlan.map((plan, i) => ({ plan, quoteLineId: repairQuote.lines[i]?.id })),
    ...coPlan.map((plan) => ({ plan, quoteLineId: undefined })),
  ];
  const woLines: WorkOrderLineInput[] = performed.map(({ plan: p }, i) => {
    const base = {
      id: `WO-${n}-L${i + 1}`,
      itemCode: p.entry.itemCode,
      description: p.entry.description,
    };
    if (p.entry.kind === "LABOUR") return { ...base, kind: "LABOUR", hours: p.qty };
    if (p.entry.kind === "PART")
      return { ...base, kind: "PART", qty: p.qty, unitCost: p.unitCost as Money };
    return { ...base, kind: "SERVICE", qty: p.qty };
  });
  const workOrder = WorkOrder.parse({
    id: `WO-${n}`,
    jobId: job.id,
    lines: woLines,
    tdiFindings,
    hydroTest: { result: "PASS", testPressurePsi: valveModel.includes("10K") ? 15000 : 7500 },
  });

  const invoiceLines: InvoiceLineInput[] = performed.map(({ plan: p, quoteLineId }, i) => {
    const unitPrice = unitPriceOf(p);
    const isPart = p.unitCost !== undefined;
    return {
      id: `INV-${n}-L${i + 1}`,
      itemCode: p.entry.itemCode,
      description: p.entry.description,
      kind: p.entry.kind,
      qty: p.qty,
      unitPrice,
      amount: multiplyQty(unitPrice, p.qty),
      ...(isPart ? { unitCost: p.unitCost } : {}),
      sourceRef: {
        ...(woLines[i] ? { workOrderLineId: woLines[i].id } : {}),
        ...(quoteLineId ? { quoteLineId } : {}),
        ...(isPart ? {} : { priceBookItemId: price(p.entry.itemCode).id }),
        ...(p.changeOrderId ? { changeOrderId: p.changeOrderId } : {}),
      },
    };
  });
  const invoice = Invoice.parse({
    id: `INV-${n}`,
    jobId: job.id,
    customerId: customer.id,
    poNumber: job.poNumber,
    invoiceDate: addDays(serviceDate, rng.int(2, 5)),
    serviceDate,
    lines: invoiceLines,
  });

  return { job, quotes: [tdiQuote, repairQuote], workOrder, changeOrders, invoice };
}
