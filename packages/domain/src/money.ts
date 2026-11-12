/**
 * Money as integer cents.
 *
 * All monetary arithmetic in this repo goes through these helpers. Values are
 * whole cents stored in a branded `number`, so a plain number cannot be passed
 * where Money is expected by accident. No floating-point arithmetic is ever
 * applied to amounts: fractional factors (quantities, markups) are applied
 * with BigInt integer math and rounded in exactly one place, `roundDiv`.
 */

declare const moneyBrand: unique symbol;

/** An amount in integer cents (CAD). */
export type Money = number & { readonly [moneyBrand]: true };

const DOLLARS_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;
const QTY_PATTERN = /^(\d+)(?:\.(\d{1,3}))?$/;
const QTY_SCALE = 1000n;
const BPS_SCALE = 10_000n;

/** Wrap an integer number of cents. Throws if it is not a safe integer. */
export function fromCents(cents: number): Money {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Money must be a safe integer number of cents, got ${cents}`);
  }
  return cents as Money;
}

/**
 * Parse a dollar amount with at most two decimal places, e.g. "1234.5" or
 * 19.99. Parsing is done on the decimal string, never via `* 100`, so there is
 * no binary floating-point error. More than two decimals is rejected rather
 * than silently rounded.
 */
export function fromDollars(dollars: string | number): Money {
  const text = typeof dollars === "number" ? String(dollars) : dollars.trim();
  const match = DOLLARS_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`Invalid dollar amount: "${text}"`);
  }
  const [, sign, whole = "0", fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return fromCents(sign ? -cents : cents);
}

/** Sum any number of amounts. `add()` is zero. */
export function add(...amounts: Money[]): Money {
  return fromCents(amounts.reduce<number>((sum, m) => sum + m, 0));
}

/**
 * Unit price × quantity. Quantity may be fractional (e.g. 1.5 labour hours)
 * with up to three decimals; the result is rounded half away from zero.
 */
export function multiplyQty(unitPrice: Money, qty: number): Money {
  const match = QTY_PATTERN.exec(String(qty));
  if (!match) {
    throw new RangeError(`Quantity must be non-negative with ≤ 3 decimals, got ${qty}`);
  }
  const [, whole = "0", fraction = ""] = match;
  const milliQty = BigInt(whole) * QTY_SCALE + BigInt(fraction.padEnd(3, "0"));
  return roundDiv(BigInt(unitPrice) * milliQty, QTY_SCALE);
}

/**
 * Apply a markup in basis points (1000 bps = 10%) to a cost:
 * cost × (1 + bps / 10 000), rounded half away from zero.
 */
export function applyMarkupBps(cost: Money, bps: number): Money {
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new RangeError(`Markup must be a non-negative integer of basis points, got ${bps}`);
  }
  return roundDiv(BigInt(cost) * (BPS_SCALE + BigInt(bps)), BPS_SCALE);
}

/** Format for display, e.g. `$1,234.56` or `-$0.05`. */
export function format(amount: Money): string {
  const abs = Math.abs(amount);
  const dollars = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  return `${amount < 0 ? "-" : ""}$${dollars}.${cents}`;
}

/**
 * The single rounding point for Money: integer division of `numerator` by a
 * positive `denominator`, rounding half away from zero (commercial rounding).
 */
function roundDiv(numerator: bigint, denominator: bigint): Money {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return fromCents(Number(negative ? -rounded : rounded));
}
