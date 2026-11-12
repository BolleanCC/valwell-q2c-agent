import type { Finding, FrictionCode } from "@valwell/domain";
import type { JobContext } from "../adapters/sources.js";
import type { AlignmentTable } from "../nodes/align.js";

/** A finding before the pipeline assigns its id, route and review status. */
export type FindingDraft = Omit<Finding, "id" | "route" | "status">;

/**
 * A pure function from one job's context and alignment to findings for one
 * friction code. Adding a friction = one detector (plus its injector).
 */
export interface Detector {
  readonly code: FrictionCode;
  detect(ctx: JobContext, table: AlignmentTable): FindingDraft[];
}
