/**
 * Simulation calendar. Day 0 is the scenario start date. Markets quote on weekdays only;
 * exchange holidays are ignored (a stated simplification).
 */

export interface SimDate {
  /** days since 1970-01-01 (UTC) */
  epochDay: number;
}

const MS_PER_DAY = 86_400_000;

export function parseDate(iso: string): number {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round(t / MS_PER_DAY);
}

export function isoDate(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(epochDay: number): number {
  return (((epochDay + 4) % 7) + 7) % 7;
}

export function isBusinessDay(epochDay: number): boolean {
  const w = weekday(epochDay);
  return w !== 0 && w !== 6;
}

/** Civil year of an epoch day (integer arithmetic; proleptic Gregorian). */
function civilYear(epochDay: number): number {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  return yoe + era * 400 + (mp >= 10 ? 1 : 0);
}

/** Epoch day of 1 January of a year. */
function jan1(y: number): number {
  const yy = y - 1;
  return 365 * (y - 1970) + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 477;
}

/** 1 = 1 January. */
export function dayOfYear(epochDay: number): number {
  return epochDay - jan1(civilYear(epochDay)) + 1;
}

export function ymd(epochDay: number): { y: number; m: number; d: number } {
  const dt = new Date(epochDay * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function fromYmd(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Last business day of a month. */
export function lastBusinessDay(y: number, m: number): number {
  let day = fromYmd(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
  while (!isBusinessDay(day)) day--;
  return day;
}

/** n business days before a given day. */
export function businessDaysBefore(day: number, n: number): number {
  let d = day;
  let k = 0;
  while (k < n) {
    d--;
    if (isBusinessDay(d)) k++;
  }
  return d;
}

export function addMonths(y: number, m: number, k: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + k;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export const MONTH_CODES = "FGHJKMNQUVXZ";
