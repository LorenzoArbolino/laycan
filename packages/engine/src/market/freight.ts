/**
 * Bottom-up voyage economics (the Baltic indices are licensed, so rates are rebuilt from
 * time-charter-equivalent earnings, distance, speed, bunkers, port and canal costs).
 *
 *   rate ($/t) = [TCE × (laden + ballast + port days) + bunkers + port costs + canal fees] / cargo t
 *
 * The charterer additionally pays war-risk premiums for chokepoints in war states.
 */
import { productBblPerTonne, type ProductId } from "../core/units";
import { MODEL, type RouteMult } from "../params/model";
import {
  CHOKEPOINT_INFO,
  ROUTES,
  VESSELS,
  routeById,
  type ChokeState,
  type ChokepointId,
  type RouteDef,
  type RouteVariant,
  type VesselClass,
} from "../world/world";

export interface FreightInputs {
  tce: Record<VesselClass, number>;
  brent: number;
  choke: Record<ChokepointId, ChokeState>;
  routeMult: RouteMult;
}

export interface VoyageQuote {
  routeId: string;
  via: RouteVariant["via"];
  feasible: boolean;
  blockedBy: ChokepointId[];
  cls: VesselClass;
  cargoTonnes: number;
  distanceNm: number;
  ladenDays: number;
  ballastDays: number;
  portDays: number;
  tce: number;
  vlsfo: number;
  hire: number;
  bunkers: number;
  portCosts: number;
  canalFees: number;
  /** owner's freight: what a voyage charter costs */
  freightUsd: number;
  ratePerTonne: number;
  /** charterer's account, on top of freight */
  warRiskUsd: number;
  /** probability of a security incident on this voyage */
  incidentProb: number;
  /** all-in charterer cost per tonne */
  allInPerTonne: number;
}

export function vlsfoPrice(brent: number): number {
  return MODEL.freight.bunkerPerBrent.value * brent;
}

export function quoteVariant(route: RouteDef, variant: RouteVariant, f: FreightInputs): VoyageQuote {
  const v = VESSELS[route.cls];
  const speed = v.speedKnots.value;
  const seaLaden = variant.distanceNm / (speed * 24);
  let delay = 0;
  let warRisk = 0;
  let noIncident = 1;
  const blocked: ChokepointId[] = [];
  let canal = 0;
  for (const c of variant.chokepoints) {
    const info = CHOKEPOINT_INFO[c];
    const st = f.choke[c];
    if (st === "closed") blocked.push(c);
    delay += info.delayDays[st].value;
    warRisk += (info.warRiskPctHull[st].value / 100) * v.hullValueUsd.value;
    noIncident *= 1 - info.incidentProb[st].value;
    if (info.transitFeeUsd) canal += info.transitFeeUsd[route.cls].value * 1.7; // laden + cheaper ballast transit
  }
  const ballast = seaLaden * MODEL.freight.ballastFraction.value;
  const portDays = 2 * MODEL.freight.portDays.value;
  const ladenDays = seaLaden + delay;
  const mult = f.routeMult[route.id]?.value ?? 1;
  const tce = f.tce[route.cls] * mult;
  const vlsfo = vlsfoPrice(f.brent);
  const hire = tce * (ladenDays + ballast + portDays);
  const bunkers = (seaLaden + ballast) * v.seaConsumptionTpd.value * vlsfo + (portDays + delay) * v.portConsumptionTpd.value * vlsfo;
  const portCosts = 2 * v.portCostPerCallUsd.value;
  const freightUsd = hire + bunkers + portCosts + canal;
  const tonnes = v.cargoTonnes.value;
  return {
    routeId: route.id,
    via: variant.via,
    feasible: blocked.length === 0,
    blockedBy: blocked,
    cls: route.cls,
    cargoTonnes: tonnes,
    distanceNm: variant.distanceNm,
    ladenDays,
    ballastDays: ballast,
    portDays,
    tce,
    vlsfo,
    hire,
    bunkers,
    portCosts,
    canalFees: canal,
    freightUsd,
    ratePerTonne: freightUsd / tonnes,
    warRiskUsd: warRisk,
    incidentProb: 1 - noIncident,
    allInPerTonne: (freightUsd + warRisk) / tonnes,
  };
}

export function quoteRoute(routeId: string, f: FreightInputs): VoyageQuote[] {
  const r = routeById(routeId);
  return r.variants.map((v) => quoteVariant(r, v, f));
}

/** Cheapest feasible variant, or the cheapest overall (flagged infeasible) if all are blocked. */
export function bestQuote(routeId: string, f: FreightInputs): VoyageQuote {
  const qs = quoteRoute(routeId, f);
  const feasible = qs.filter((q) => q.feasible);
  const pool = feasible.length ? feasible : qs;
  return pool.reduce((a, b) => (b.allInPerTonne < a.allInPerTonne ? b : a));
}

export function perBbl(q: VoyageQuote, p: ProductId): number {
  return q.allInPerTonne / productBblPerTonne(p);
}

export function allRouteQuotes(f: FreightInputs): VoyageQuote[] {
  return ROUTES.map((r) => bestQuote(r.id, f));
}
