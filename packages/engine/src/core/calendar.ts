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

export function dayOfYear(epochDay: number): number {
  const d = new Date(epochDay * MS_PER_DAY);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.round((epochDay * MS_PER_DAY - start) / MS_PER_DAY) + 1;
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
