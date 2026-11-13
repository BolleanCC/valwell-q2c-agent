import type { Route } from "@valwell/domain";

/**
 * The business condition a detector established for a finding. Routing
 * depends only on this, never on a numeric confidence.
 */
export type RouteBasis =
  /** Billed price equals a superseded price-book version; one version is effective. */
  | "SUPERSEDED_PRICE_VERSION"
  /** One version is effective, but the billed price matches no version: cause unconfirmed. */
  | "UNEXPLAINED_PRICE"
  /** Invoice and work-order costs agree; the cap price follows from the contract rule. */
  | "VERIFIED_COST_OVER_CAP"
  /** Work not covered by the effective quote revision or an approved change order. */
  | "NO_APPROVED_SCOPE";

export interface RoutingRule {
  route: Route;
  reason: string;
}

export type RoutingPolicy = Record<RouteBasis, RoutingRule>;

/**
 * Default policy. A correction is applied without a human only when the
 * evidence fully determines the right amount and explains the error. Extra
 * scope always blocks: only the customer can approve it.
 */
export const DEFAULT_POLICY: RoutingPolicy = {
  SUPERSEDED_PRICE_VERSION: {
    route: "AUTO_FIX",
    reason:
      "billed at a superseded price-book version; exactly one version is effective on the service date",
  },
  UNEXPLAINED_PRICE: {
    route: "REVIEW",
    reason:
      "the effective price is unambiguous, but the billed price matches no version, so a human confirms the correction",
  },
  VERIFIED_COST_OVER_CAP: {
    route: "AUTO_FIX",
    reason: "invoice and work-order costs agree, so the cap price follows from the contract rule",
  },
  NO_APPROVED_SCOPE: {
    route: "BLOCK",
    reason:
      "no effective quote line or approved change order covers this work; only the customer can approve it",
  },
};

export function routeFinding(
  basis: RouteBasis,
  policy: RoutingPolicy = DEFAULT_POLICY,
): RoutingRule {
  return policy[basis];
}
