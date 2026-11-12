const DAY_MS = 86_400_000;

/** Add whole days to a `YYYY-MM-DD` date (UTC, so no DST or timezone effects). */
export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO date: ${isoDate}`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}
