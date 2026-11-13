import type { Finding, FrictionCode } from "@valwell/domain";
import type { JobContext } from "../adapters/sources.js";
import type { Alignment } from "../nodes/align.js";
import type { RouteBasis } from "../nodes/route.js";

/**
 * A finding before the pipeline assigns its id, route and review status. The
 * detector states the business basis the route is decided from.
 */
export type FindingDraft = Omit<Finding, "id" | "route" | "routeReason" | "status"> & {
  basis: RouteBasis;
};

/**
 * A pure function from one job's context and alignment to findings for one
 * friction code. Detectors only judge lines the alignment resolved; anything
 * unresolved is already a review issue. Adding a friction = one detector
 * (plus its injector).
 */
export interface Detector {
  readonly code: FrictionCode;
  detect(ctx: JobContext, alignment: Alignment): FindingDraft[];
}
