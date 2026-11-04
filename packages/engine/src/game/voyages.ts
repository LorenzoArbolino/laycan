/**
 * Voyages: chartering, loading (bill of lading), sailing, holds and reroutes around closed
 * chokepoints, diversions at sea, discharge. Every change of value is posted to a P&L bucket.
 */
import { offSpecDiscount } from "../blending/blend";
import type { Bucket, Cargo, Voyage } from "../book/types";
import { isoDate } from "../core/calendar";
import { Rng } from "../core/rng";
import { type ProductId, productBblPerTonne } from "../core/units";
import type { PortDisruption } from "../events/macro";
import { hubForward } from "../market/curve";
import { type VoyageQuote, vlsfoPrice } from "../market/freight";
import { HUB_PAIRS, chokepointsOn, insideGulf, nearestOnPath, pathLength, voyagePosition } from "../world/geo";
import { CHOKEPOINT_INFO, type ChokepointId, HUBS, type HubId, VESSELS, routeById } from "../world/world";
import type { Game, ActionResult } from "../game";
import { est } from "../params/param";
import { chooseQty, deliverPurchase, deliverSale, retroFix, windowFor } from "./settlement";

export const DIVERSION = {
  fee: est(25_000, "$", "owner's admin and agency costs of a diversion, order of magnitude"),
  detour: est(1.05, "x", "sea-path detour factor for the remaining leg after a diversion (approximation)"),
};

export interface DiversionOption {
  to: HubId;
  remainingDays: number;
  extraDays: number;
  costUsd: number;
  priceGainPerBbl: number;
  netPerBbl: number;
  feasible: boolean;
  blockedBy: string[];
  breaksSale?: string;
}

export function pickVariant(g: Game, routeId: string, via?: Voyage["via"]): VoyageQuote {
  const qs = g.quotes(routeId);
  if (via) {
    const q = qs.find((x) => x.via === via);
    if (q) return q;
  }
  const feas = qs.filter((q) => q.feasible);
  const pool = feas.length ? feas : qs;
  return pool.reduce((a, b) => (b.allInPerTonne < a.allInPerTonne ? b : a));
}

export function charter(g: Game, routeId: string, via: Voyage["via"] | undefined, laycanStart: number, product: ProductId, purchaseId?: string, saleId?: string): ActionResult {
  const r = routeById(routeId);
  const q = pickVariant(g, routeId, via);
  if (!q.feasible) return { ok: false, message: `${routeId} via ${q.via} is blocked (${q.blockedBy.join(", ")}).` };
  const start = Math.max(laycanStart, g.day + 3);
  const id = g.id("V");
  const kr = Rng.stream(g.state.seed, `voyage:${id}`);
  const draws = {
    arrivalOffset: kr.int(4),
    loadDelay: kr.bernoulli(0.15) ? 1 + kr.int(3) : 0,
    seaDelay: kr.bernoulli(0.2) ? 1 + kr.int(3) : 0,
    incident: kr.bernoulli(q.incidentProb),
    incidentDelay: 5 + kr.int(10),
    dischDelay: kr.bernoulli(0.15) ? 1 + kr.int(3) : 0,
    offSpec: kr.bernoulli(0.03),
    offSpecDiscount: 1.5 + 2.5 * kr.uniform(),
    outturnLoss: 0.0005 + 0.0035 * kr.uniform(),
  };
  const v: Voyage = {
    id,
    routeId,
    via: q.via,
    cls: r.cls,
    from: r.from,
    to: r.to,
    product,
    status: "fixed",
    laycan: [start, start + 4],
    fixedDay: g.day,
    arriveLoad: start + draws.arrivalOffset,
    sailDays: Math.ceil(q.ladenDays + draws.seaDelay + (draws.incident ? draws.incidentDelay : 0)),
    capacityTonnes: VESSELS[r.cls].cargoTonnes.value * 1.05,
    freightUsd: q.freightUsd,
    warRiskUsd: q.warRiskUsd,
    demurrageRate: Math.max(18_000, 0.9 * g.market.tce[r.cls]),
    laytimeHours: VESSELS[r.cls].laytimeHours.value,
    portHours: 0,
    heldDays: 0,
    draws,
    chokepoints: [...(r.variants.find((x) => x.via === q.via)?.chokepoints ?? [])],
    pathNm: q.distanceNm,
  };
  if (purchaseId) {
    const d = g.book.deals.find((x) => x.id === purchaseId);
    if (!d || d.side !== "buy" || d.incoterm !== "FOB" || d.hub !== r.from) return { ok: false, message: "Purchase must be FOB at the load port." };
    v.purchaseId = d.id;
    d.voyageId = id;
    v.laycan = [d.laycan[0], d.laycan[1]];
    v.arriveLoad = Math.max(g.day + 1, d.laycan[0] + Math.min(draws.arrivalOffset, d.laycan[1] - d.laycan[0]));
  }
  g.post("freight", () => {
    g.book.voyages.push(v);
    g.book.payables.freight += v.freightUsd + v.warRiskUsd;
  });
  if (saleId) g.act({ type: "assign", saleId, voyageId: id });
  else {
    const s = g.book.deals.find((d) => d.side === "sell" && d.status === "open" && !d.voyageId && d.hub === r.to && d.product === product && d.incoterm !== "FOB");
    if (s) {
      s.voyageId = id;
      v.saleId = s.id;
    }
  }
  const perT = (v.freightUsd + v.warRiskUsd) / VESSELS[r.cls].cargoTonnes.value;
  return {
    ok: true,
    message: `Fixed ${r.cls} on ${routeId} via ${q.via}: $${perT.toFixed(1)}/t all-in (${(perT / productBblPerTonne(product)).toFixed(2)} $/bbl), ETA load ${isoDate(v.arriveLoad)}.${v.saleId ? ` Will deliver sale ${v.saleId}.` : ""}`,
    id,
  };
}

export function progressVoyages(g: Game) {
  for (const v of g.book.voyages) {
    if (v.status === "done" || v.status === "cancelled") continue;
    let guard = 0;
    while (guard++ < 4 && stepVoyage(g, v)) {
      /* allow several state changes in one day */
    }
  }
}

export function portDisrupted(g: Game, hub: HubId): PortDisruption | undefined {
  return g.state.ports.find((p) => p.hub === hub && p.untilDay >= g.day);
}

export function chokeBlocked(g: Game, v: Voyage): boolean {
  const chokes = v.chokepoints ?? routeById(v.routeId).variants.find((x) => x.via === v.via)!.chokepoints;
  return chokes.some((c) => g.market.choke[c] === "closed");
}

/** Try to reroute around a closed chokepoint; returns true if rerouted. */
export function reroute(g: Game, v: Voyage): boolean {
  if (v.pathKey) return false; // diverted voyages have no alternative variant
  const qs = g.quotes(v.routeId);
  const cur = qs.find((q) => q.via === v.via)!;
  const alt = qs.filter((q) => q.feasible && q.via !== v.via).sort((a, b) => a.allInPerTonne - b.allInPerTonne)[0];
  if (!alt) return false;
  const extraDays = Math.max(0, Math.ceil(alt.ladenDays - cur.ladenDays));
  const extraCost = extraDays * (g.market.tce[v.cls] + VESSELS[v.cls].seaConsumptionTpd.value * alt.vlsfo);
  g.post("events", () => {
    g.book.cash -= extraCost;
  });
  v.via = alt.via;
  v.chokepoints = [...(routeById(v.routeId).variants.find((x) => x.via === alt.via)?.chokepoints ?? [])];
  v.pathNm = alt.distanceNm;
  v.sailDays += extraDays;
  if (v.arriveDisch !== undefined) setArrival(g, v, v.arriveDisch + extraDays);
  g.alert(`Voyage ${v.id} rerouted via ${alt.via}`, `A chokepoint on the planned route closed. +${extraDays} days, deviation cost ${(extraCost / 1e3).toFixed(0)}k.`, "warn");
  return true;
}

export function holdDay(g: Game, v: Voyage, why: string) {
  if (v.heldDays === 0) g.alert(`Voyage ${v.id} held`, why, "critical");
  v.heldDays++;
  g.post("events", () => {
    g.book.cash -= v.demurrageRate;
  });
}

export function stepVoyage(g: Game, v: Voyage): boolean {
  const day = g.day;
  switch (v.status) {
    case "fixed": {
      if (day < v.arriveLoad) return false;
      if (chokeBlocked(g, v) && !reroute(g, v)) {
        holdDay(g, v, `${routeById(v.routeId).id}: route blocked by a closed chokepoint. Waiting costs demurrage-equivalent hire daily.`);
        v.arriveLoad = day + 1;
        return false;
      }
      const dis = portDisrupted(g, v.from);
      if (dis) {
        v.portHours += 24;
        v.arriveLoad = day + 1;
        return false;
      }
      v.status = "loading";
      v.portHours += 36 + 24 * v.draws.loadDelay;
      v.blDay = day + 1 + v.draws.loadDelay;
      return true;
    }
    case "held": {
      v.status = "fixed";
      return true;
    }
    case "loading": {
      if (day < (v.blDay ?? day)) return false;
      billOfLading(g, v);
      return true;
    }
    case "sailing": {
      if (day < (v.arriveDisch ?? day)) {
        const passed = day - (v.blDay ?? day) > v.sailDays / 2;
        if (!passed && chokeBlocked(g, v) && !reroute(g, v)) {
          setArrival(g, v, (v.arriveDisch ?? day) + 1);
          holdDay(g, v, "A chokepoint ahead is closed and there is no alternative route. The cargo is stranded until it reopens.");
        }
        return false;
      }
      const dis = portDisrupted(g, v.to);
      v.status = "discharging";
      v.portHours += 36 + 24 * (v.draws.dischDelay + (dis ? dis.extraDays : 0));
      v.doneDay = day + 1 + v.draws.dischDelay + (dis ? dis.extraDays : 0);
      return true;
    }
    case "discharging": {
      if (day < (v.doneDay ?? day)) return false;
      discharge(g, v);
      return false;
    }
    default:
      return false;
  }
}

export function billOfLading(g: Game, v: Voyage) {
  const capBbl = v.capacityTonnes * productBblPerTonne(v.product ?? "diesel");
  let cargo: Cargo | undefined;
  if (v.purchaseId) {
    const d = g.book.deals.find((x) => x.id === v.purchaseId)!;
    if (d.status === "open") cargo = deliverPurchase(g, d, chooseQty(g, d, capBbl), "vessel", v.id);
  } else {
    const tank = g.book.cargoes.find((c) => c.where === "tank" && c.hub === v.from && (!v.product || c.product === v.product));
    if (tank) {
      const q = Math.min(tank.qty, capBbl);
      if (q >= tank.qty - 1) cargo = tank;
      else {
        tank.qty -= q;
        cargo = { ...tank, id: g.id("C"), qty: q };
        g.book.cargoes.push(cargo);
      }
    }
  }
  // Pay the freight (owner's freight is due on loading) — no P&L, the liability was booked at fixture
  g.post("freight", () => {
    g.book.cash -= v.freightUsd + v.warRiskUsd;
    g.book.payables.freight -= v.freightUsd + v.warRiskUsd;
  });
  if (!cargo) {
    v.status = "cancelled";
    g.alert(`Voyage ${v.id}: no cargo to load`, "The vessel sailed empty (dead freight). Charter cost is lost.", "critical");
    return;
  }
  cargo.where = "vessel";
  cargo.voyageId = v.id;
  v.cargoId = cargo.id;
  v.product = cargo.product;
  if (v.draws.offSpec) {
    const c = cargo;
    g.post("quality", () => {
      c.qualityDiscount += v.draws.offSpecDiscount;
    });
    g.alert(`Off-spec cargo on ${v.id}`, `Inspector finds the ${c.product} off-spec at load. Valued at a $${v.draws.offSpecDiscount.toFixed(2)}/bbl discount (blend-fix or claim).`);
  }
  // CIF sale linked to g voyage prices around the B/L date
  if (v.saleId) {
    const s = g.book.deals.find((x) => x.id === v.saleId);
    if (s && s.incoterm === "CIF" && s.status === "open" && (s.pricing.kind === "bl5" || s.pricing.kind === "post5")) {
      g.post("optionality", () => {
        s.window = windowFor(g, s, g.day);
        retroFix(g, s);
      });
    }
  }
  // The cargo now belongs to the destination market: the location spread is captured here.
  const c = cargo;
  g.post("regional", () => {
    c.hub = v.to;
    c.markDay = g.day + v.sailDays;
  });
  v.status = "sailing";
  v.arriveDisch = g.day + v.sailDays;
}

/** Move a voyage's arrival date; the cargo's forward mark moves with it. */
export function setArrival(g: Game, v: Voyage, day: number, bucket: Bucket = "events") {
  const c = g.book.cargoes.find((x) => x.id === v.cargoId);
  g.post(bucket, () => {
    v.arriveDisch = day;
    if (c && c.where === "vessel") c.markDay = day;
  });
}

export function discharge(g: Game, v: Voyage) {
  const c = g.book.cargoes.find((x) => x.id === v.cargoId);
  v.status = "done";
  if (!c) return;
  g.post("events", () => {
    c.qty *= 1 - v.draws.outturnLoss;
  });
  const overHours = Math.max(0, v.portHours - v.laytimeHours);
  if (overHours > 0) {
    const dem = (overHours / 24) * v.demurrageRate;
    g.post("events", () => {
      g.book.cash -= dem;
    });
    g.alert(`Demurrage on ${v.id}`, `${(overHours / 24).toFixed(1)} days over laytime at $${(v.demurrageRate / 1e3).toFixed(1)}k/day: ${(dem / 1e3).toFixed(0)}k.`);
  }
  let sale = v.saleId ? g.book.deals.find((x) => x.id === v.saleId && x.status === "open") : undefined;
  if (!sale) {
    sale = g.book.deals.find((d) => d.side === "sell" && d.status === "open" && !d.voyageId && d.hub === v.to && d.product === c.product && d.incoterm !== "FOB" && g.day <= d.laycan[1] + 5);
    if (sale) {
      sale.voyageId = v.id;
      v.saleId = sale.id;
    }
  }
  if (sale && sale.product === c.product) {
    const anchor = sale.incoterm === "CIF" ? v.blDay ?? g.day : g.day;
    deliverSale(g, sale, c, anchor);
  }
  if (g.book.cargoes.includes(c)) {
    // arrival was the mark date, so moving from the forward mark to spot changes nothing
    c.where = "tank";
    c.markDay = undefined;
    c.voyageId = undefined;
    c.sinceDay = g.day;
    g.alert(`Cargo ${c.id} into tank at ${v.to}`, `${(c.qty / 1000).toFixed(0)} kbbl ${c.product} stored. Leased tankage is used first; anything above it pays spot tankage (${g.spotStorageFee(v.to).toFixed(2)} $/bbl/month).`, "info");
  }
}

/**
 * Plans for re-routing a laden ship: from its current position, join the sea path from its
 * load port to the new hub at the nearest point (crossing open water to get there), then
 * follow that path. Distances scale the map geometry to the sea-route length.
 */
/** A diversion option with the geometry needed to execute it. */
export interface DiversionPlan {
  option: DiversionOption;
  path: [number, number][];
  remainingNm: number;
  chokepoints: ChokepointId[];
}

export function diversionPlans(g: Game, voyageId: string): DiversionPlan[] {
  const v = g.book.voyages.find((x) => x.id === voyageId);
  const c = v && g.book.cargoes.find((x) => x.id === v.cargoId);
  if (!v || !c || v.status !== "sailing") return [];
  const spec = VESSELS[v.cls];
  const perDay = spec.speedKnots.value * 24;
  const here = voyagePosition(v, g.day);
  const P = here.at;
  const remainingOld = Math.max(0, (v.pathNm ?? 0) * (1 - here.progress));
  const vlsfo = vlsfoPrice(g.market.brent);
  const out: DiversionPlan[] = [];
  for (const to of HUBS) {
    if (to === v.to) continue;
    const pair = HUB_PAIRS[`${v.from}>${to}`];
    if (!pair || to === v.from) continue;
    const nmPerDeg = pair.nm / Math.max(1e-6, pathLength(pair.path));
    const near = nearestOnPath(pair.path, P);
    const rest = pair.path.slice(near.index);
    const path: [number, number][] = [P, near.point, ...rest];
    const remaining = pair.nm - near.along * nmPerDeg + near.gap * 60 * DIVERSION.detour.value;
    const chokes: ChokepointId[] = chokepointsOn([near.point, ...rest]).filter((k) => k !== "hormuz");
    if (insideGulf(P) !== (to === "MEG")) chokes.push("hormuz");
    const newChokes = chokes.filter((k) => !(v.chokepoints ?? []).includes(k));
    const blockedBy = chokes.filter((k) => g.market.choke[k] === "closed");
    const extraDays = (remaining - remainingOld) / perDay;
    const warRisk = newChokes.reduce((s, k) => s + (CHOKEPOINT_INFO[k].warRiskPctHull[g.market.choke[k]].value / 100) * spec.hullValueUsd.value, 0);
    const cost = DIVERSION.fee.value + Math.max(0, extraDays) * (g.market.tce[v.cls] + spec.seaConsumptionTpd.value * vlsfo) + warRisk;
    // forward value at the new hub on the new arrival date vs the current mark
    const arrive = g.day + Math.max(1, Math.ceil(remaining / perDay));
    const priceGain = hubForward(g.market, to, c.product, arrive) - hubForward(g.market, v.to, c.product, c.markDay ?? g.day);
    out.push({
      option: {
        to,
        remainingDays: remaining / perDay,
        extraDays,
        costUsd: cost,
        priceGainPerBbl: priceGain,
        netPerBbl: priceGain - cost / c.qty,
        feasible: blockedBy.length === 0,
        blockedBy,
        breaksSale: v.saleId,
      },
      path,
      remainingNm: remaining,
      chokepoints: chokes,
    });
  }
  return out.sort((a, b) => b.option.netPerBbl - a.option.netPerBbl);
}

export function divert(g: Game, voyageId: string, to: HubId): ActionResult {
  const v = g.book.voyages.find((x) => x.id === voyageId);
  const plan = diversionPlans(g, voyageId).find((p) => p.option.to === to);
  if (!v || !plan) return { ok: false, message: "Only laden ships at sea can be diverted, to another hub." };
  const opt = plan.option;
  if (!opt.feasible) return { ok: false, message: `Diversion to ${to} is blocked (${opt.blockedBy.join(", ")}).` };
  const c = g.book.cargoes.find((x) => x.id === v.cargoId)!;
  // Freight: deviation and admin costs for the charterer's account
  g.post("freight", () => {
    g.book.cash -= opt.costUsd;
  });
  // The cargo now belongs to the new market: the value of the destination option is realised here
  const arrive = g.day + Math.max(1, Math.ceil(opt.remainingDays));
  g.post("optionality", () => {
    c.hub = to;
    c.markDay = arrive;
    v.arriveDisch = arrive;
  });
  if (v.saleId) {
    const s = g.book.deals.find((x) => x.id === v.saleId);
    if (s) s.voyageId = undefined;
    g.alert(`Sale ${v.saleId} needs another cargo`, `Voyage ${v.id} no longer goes to ${v.to}. Find another cargo before the laycan or face a delivery penalty.`, "warn");
    v.saleId = undefined;
  }
  const remainingDays = Math.ceil(opt.remainingDays);
  v.divertedFrom = v.divertedFrom ?? v.to;
  v.to = to;
  v.pathKey = `${v.from}>${to}`;
  v.path = plan.path;
  v.chokepoints = plan.chokepoints;
  v.pathNm = plan.remainingNm;
  v.legStartDay = g.day;
  v.legStartFrac = 0;
  v.sailDays = arrive - (v.blDay ?? g.day);
  return {
    ok: true,
    message: `${v.id} diverted to ${to}: arrives in ~${remainingDays} days; deviation cost ${(opt.costUsd / 1e3).toFixed(0)}k; price at ${to} ${opt.priceGainPerBbl >= 0 ? "+" : ""}${opt.priceGainPerBbl.toFixed(2)} $/bbl vs ${v.divertedFrom}.`,
  };
}
