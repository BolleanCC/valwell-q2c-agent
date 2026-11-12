import { FaultLabel, type FrictionCode, type InvoiceLine, multiplyQty } from "@valwell/domain";
import type { z } from "zod";
import type { JobBundle } from "./job.js";
import type { ReferenceData } from "./reference.js";
import type { Rng } from "./rng.js";

/** What an injector may read and mutate for one job. */
export interface InjectionContext {
  rng: Rng;
  ref: ReferenceData;
  /** A private copy of the job; injectors mutate it in place. */
  bundle: JobBundle;
  /** Invoice line ids already faulted, so one line never carries two labels. */
  touched: Set<string>;
}

/** The fields an injector reports; the framework adds id, jobId, invoiceId and the code. */
export type InjectedFault = Pick<
  z.input<typeof FaultLabel>,
  "invoiceLineId" | "workOrderLineId" | "description" | "amountImpact"
>;

/**
 * Injects one kind of friction into a correct job. Returns null when the job
 * offers nothing to fault (e.g. no part lines). Adding a friction = one injector.
 */
export interface Injector {
  readonly code: FrictionCode;
  inject(ctx: InjectionContext): InjectedFault | null;
}

/** Probability per job that each friction is injected. */
export type InjectionRates = Partial<Record<FrictionCode, number>>;

export const DEFAULT_RATES: InjectionRates = { A1: 0.25, A3: 0.2, B1: 0.2 };

export interface InjectionResult {
  bundles: JobBundle[];
  labels: FaultLabel[];
}

/**
 * Run every injector over every job. Each injector draws its chance for every
 * job whether or not it fires, so adding a job never shifts later draws.
 * Input bundles are not modified.
 */
export function injectFaults(
  rng: Rng,
  ref: ReferenceData,
  bundles: readonly JobBundle[],
  injectors: readonly Injector[],
  rates: InjectionRates = DEFAULT_RATES,
): InjectionResult {
  const labels: FaultLabel[] = [];
  const out = bundles.map((original) => {
    const ctx: InjectionContext = {
      rng,
      ref,
      bundle: structuredClone(original),
      touched: new Set(),
    };
    for (const injector of injectors) {
      if (!rng.chance(rates[injector.code] ?? 0)) continue;
      const fault = injector.inject(ctx);
      if (!fault) continue;
      if (fault.invoiceLineId) ctx.touched.add(fault.invoiceLineId);
      labels.push(
        FaultLabel.parse({
          ...fault,
          id: `FL-${String(labels.length + 1).padStart(4, "0")}`,
          jobId: ctx.bundle.job.id,
          invoiceId: ctx.bundle.invoice.id,
          frictionCode: injector.code,
        }),
      );
    }
    return ctx.bundle;
  });
  return { bundles: out, labels };
}

/** Invoice lines of the given kinds that no earlier injector has touched. */
export function untouchedLines(ctx: InjectionContext, kinds: InvoiceLine["kind"][]): InvoiceLine[] {
  return ctx.bundle.invoice.lines.filter((l) => kinds.includes(l.kind) && !ctx.touched.has(l.id));
}

/** Set a new unit price on an invoice line and re-extend its amount. Returns the amount delta. */
export function repriceLine(line: InvoiceLine, unitPrice: InvoiceLine["unitPrice"]): number {
  const before = line.amount;
  line.unitPrice = unitPrice;
  line.amount = multiplyQty(unitPrice, line.qty);
  return line.amount - before;
}
