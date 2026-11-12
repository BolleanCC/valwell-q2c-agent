import type { FrictionCode, Route } from "@valwell/domain";
import type { FindingDraft } from "../detectors/types.js";

export interface RoutingRule {
  /** Route to AUTO_FIX when confidence is at least this; omit to never auto-fix. */
  autoFixAt?: number;
  /** Route used otherwise. */
  otherwise: Exclude<Route, "AUTO_FIX">;
}

export type RoutingPolicy = Record<FrictionCode, RoutingRule>;

/**
 * Default policy: price corrections backed by a contract are safe to apply
 * automatically when confidence is high; scope changes need the customer's
 * approval, so they block the invoice line until a change order exists.
 */
export const DEFAULT_POLICY: RoutingPolicy = {
  A1: { autoFixAt: 0.95, otherwise: "REVIEW" },
  A3: { autoFixAt: 0.9, otherwise: "REVIEW" },
  B1: { otherwise: "BLOCK" },
};

export function routeFinding(
  finding: Pick<FindingDraft, "frictionCode" | "confidence">,
  policy: RoutingPolicy = DEFAULT_POLICY,
): Route {
  const rule = policy[finding.frictionCode];
  if (rule.autoFixAt !== undefined && finding.confidence >= rule.autoFixAt) return "AUTO_FIX";
  return rule.otherwise;
}
