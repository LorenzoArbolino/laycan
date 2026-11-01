/**
 * Units. The engine works internally in US dollars per barrel ($/bbl) and barrels (bbl).
 * Tonnes and gallons only appear at the edges (cargo sizes, futures quotes), converted
 * through each grade's density rather than fixed constants.
 */

export const LITRES_PER_BBL = 158.987294928;
export const GAL_PER_BBL = 42;

export type ProductId = "gasoline" | "diesel" | "jet";
export const PRODUCTS: readonly ProductId[] = ["gasoline", "diesel", "jet"] as const;

export interface Grade {
  id: string;
  product: ProductId;
  name: string;
  /** density at 15 °C, kg/L */
  density: number;
  spec: string;
}

/**
 * Representative densities, mid-points of the spec ranges:
 *  - EN 590 diesel 0.820-0.845 kg/L; US ULSD typically ~0.84-0.85 -> 0.845 (also ICE Gasoil's 7.45 bbl/t basis)
 *  - Jet A-1 (DEF STAN 91-091 / ASTM D1655) 0.775-0.840 -> 0.800
 *  - Gasoline (Eurobob / RBOB-type) ~0.72-0.775 -> 0.745
 */
export const GRADES: Record<ProductId, Grade> = {
  gasoline: { id: "gasoline-e10-base", product: "gasoline", name: "Gasoline (Eurobob/RBOB-type)", density: 0.745, spec: "EN 228 / ASTM D4814 blendstock" },
  diesel: { id: "diesel-10ppm", product: "diesel", name: "ULSD / EN 590 10 ppm", density: 0.845, spec: "EN 590 10 ppm S; US ULSD 15 ppm S" },
  jet: { id: "jet-a1", product: "jet", name: "Jet A-1", density: 0.8, spec: "DEF STAN 91-091 / ASTM D1655" },
};

/** Barrels per metric tonne for a density in kg/L. */
export function bblPerTonne(density: number): number {
  return 1000 / (density * LITRES_PER_BBL);
}

export function productBblPerTonne(p: ProductId): number {
  return bblPerTonne(GRADES[p].density);
}

export function tonnesToBbl(tonnes: number, p: ProductId): number {
  return tonnes * productBblPerTonne(p);
}

export function bblToTonnes(bbl: number, p: ProductId): number {
  return bbl / productBblPerTonne(p);
}

export function perGalToPerBbl(x: number): number {
  return x * GAL_PER_BBL;
}
export function perBblToPerGal(x: number): number {
  return x / GAL_PER_BBL;
}
/** $/t -> $/bbl for a product */
export function perTonneToPerBbl(x: number, p: ProductId): number {
  return x / productBblPerTonne(p);
}
export function perBblToPerTonne(x: number, p: ProductId): number {
  return x * productBblPerTonne(p);
}

export function fmtMoney(x: number): string {
  const s = Math.abs(x) >= 1e6 ? `${(x / 1e6).toFixed(2)}m` : Math.abs(x) >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : x.toFixed(0);
  return `$${s}`;
}
