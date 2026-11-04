export const money = (x: number, digits = 2): string => {
  if (Math.abs(x) < 0.5) return "$0";
  const a = Math.abs(x);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(digits)}m` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0);
  return `${x < 0 ? "−" : ""}$${s}`;
};
export const signed = (x: number, digits = 2): string => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;
export const kbbl = (x: number): string => `${(x / 1000).toFixed(0)} kbbl`;
export const cls = (x: number): string => (x > 0.005 ? "pos" : x < -0.005 ? "neg" : "");
export const shortDate = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};
export const px = (x: number, digits = 2): string => (x < 0 ? "−" : "") + Math.abs(x).toFixed(digits);
export const range = (a: string, b: string): string => {
  const [da, ma] = a.split(" ");
  const [db, mb] = b.split(" ");
  return ma === mb ? `${da}–${db} ${mb}` : `${a} – ${b}`;
};
/** Short pricing label: "B/L ±2", "B/L +5", "Dec avg", "fixed". */
export const pricingLabel = (p: { kind: string; month?: { y: number; m: number } }): string =>
  p.kind === "bl5" ? "B/L ±2" : p.kind === "post5" ? "B/L +5" : p.kind === "month" && p.month ? `${new Date(Date.UTC(p.month.y, p.month.m - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} avg` : "fixed";
