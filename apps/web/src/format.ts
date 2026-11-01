export const money = (x: number, digits = 2): string => {
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
