import { describe, expect, it } from "vitest";
import { isoDate, parseDate } from "../../src/core/calendar";
import { expiryDay, listedMonths } from "../../src/market/futures";

// Expiry dates checked against the exchanges' listed expiry ladders (Oct 2026)
describe("futures expiry rules", () => {
  it("NYMEX HO/RB: last business day of the month before delivery", () => {
    expect(isoDate(expiryDay("HO", 2026, 12))).toBe("2026-11-30");
    expect(isoDate(expiryDay("HO", 2026, 11))).toBe("2026-10-30");
    expect(isoDate(expiryDay("HO", 2027, 2))).toBe("2027-01-29");
    expect(isoDate(expiryDay("RB", 2027, 1))).toBe("2026-12-31");
  });
  it("ICE Gasoil: two business days before the 14th of the delivery month", () => {
    expect(isoDate(expiryDay("GO", 2026, 11))).toBe("2026-11-12");
    expect(isoDate(expiryDay("GO", 2026, 12))).toBe("2026-12-10");
    expect(isoDate(expiryDay("GO", 2027, 1))).toBe("2027-01-12");
    expect(isoDate(expiryDay("GO", 2027, 2))).toBe("2027-02-11");
  });
  it("ICE Brent: last business day of the second month before delivery", () => {
    expect(isoDate(expiryDay("BRN", 2027, 1))).toBe("2026-11-30");
    expect(isoDate(expiryDay("BRN", 2026, 12))).toBe("2026-10-30");
  });
  it("lists only contracts still trading", () => {
    const d = parseDate("2026-11-13");
    const go = listedMonths("GO", d);
    expect(go[0]!.code).toBe("GOZ26");
    expect(go.every((c) => c.expiry >= d)).toBe(true);
  });
});
