/**
 * Macro events: market-level shocks with base rates, durations and effects.
 * Each event applies an immediate jump (attributed the same day to the market buckets)
 * and/or a decaying shift to a long-run mean, and emits player-facing news.
 */
import { ymd } from "../core/calendar";
import { log } from "../core/dmath";
import type { Rng } from "../core/rng";
import { PRODUCTS, type ProductId } from "../core/units";
import type { MarketConfig, MarketState, MarketStepNews } from "../market/market";
import { MODEL } from "../params/model";
import { CHOKEPOINT_INFO, HUB_INFO, type HubId } from "../world/world";

export interface NewsItem {
  day: number;
  kind: "market" | "event" | "book" | "alert";
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
}

export interface PortDisruption {
  hub: HubId;
  untilDay: number;
  extraDays: number;
}

export interface MacroContext {
  m: MarketState;
  cfg: MarketConfig;
  rng: Rng;
  ports: PortDisruption[];
  news: NewsItem[];
  financeShock: { lcFeeMult: number; overdraftMult: number; untilDay: number } | null;
}

const between = (rng: Rng, a: number, b: number) => a + (b - a) * rng.uniform();
/** Heavy-tailed magnitude: uniform core with an exponential tail. */
const heavy = (rng: Rng, a: number, b: number) => between(rng, a, b) * (1 + 0.5 * -log(1 - rng.uniform() * 0.999));

function addEffect(ctx: MacroContext, target: MarketState["effects"][number]["target"], amount: number, halfLifeDays: number) {
  ctx.m.effects.push({ id: `fx${ctx.m.day}-${ctx.m.effects.length}`, target, amount, halfLifeDays, startDay: ctx.m.day });
}

function crackShock(ctx: MacroContext, p: ProductId, jump: number, shift: number, hl: number) {
  ctx.m.cracks[p] += jump;
  addEffect(ctx, { kind: "crack", product: p }, shift, hl);
}

function diffShock(ctx: MacroContext, hub: HubId, p: ProductId, jump: number, shift: number, hl: number) {
  ctx.m.diffs[hub][p] += jump;
  addEffect(ctx, { kind: "diff", hub, product: p }, shift, hl);
}

function news(ctx: MacroContext, severity: NewsItem["severity"], title: string, body: string) {
  ctx.news.push({ day: ctx.m.day, kind: "event", severity, title, body });
}

const fmt = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(1);

/** React to regime and chokepoint transitions produced by the market step. */
export function applyTransitions(ctx: MacroContext, transitions: MarketStepNews[]): void {
  const { m, rng } = ctx;
  for (const t of transitions) {
    if (t.kind === "regime") {
      news(ctx, "warn", `Regime change: ${t.from} → ${t.to}`, `Volatility, crack levels and curve structure now follow the ${t.to} regime.`);
      continue;
    }
    const c = t.chokepoint!;
    const name = CHOKEPOINT_INFO[c].name;
    if (t.to === "closed") {
      if (c === "hormuz") {
        const j = heavy(rng, 0.06, 0.12);
        m.brent *= 1 + j;
        for (const p of ["diesel", "jet"] as const) crackShock(ctx, p, heavy(rng, 4, 10), 8, 30);
        news(ctx, "critical", `${name} closed`, `Tankers halted; insurers withdraw cover. Brent +${(j * 100).toFixed(0)}%. Cargoes inside the Gulf are stranded; Middle East export prices collapse while Europe and Asia scramble for diesel and jet.`);
      } else {
        for (const p of ["diesel", "jet"] as const) diffShock(ctx, "ARA", p, between(rng, 1, 3), 2, 30);
        news(ctx, "critical", `${name} closed`, "Traffic diverts around the Cape of Good Hope. Voyages from East of Suez to Europe lengthen by ~10 days; tonnage tightens.");
      }
    } else if (t.to === "restricted") {
      news(ctx, "warn", `${name}: restricted`, `Transits continue under escort with elevated war-risk premiums (${CHOKEPOINT_INFO[c].warRiskPctHull.restricted.value}% of hull value) and incident risk.`);
      if (c === "hormuz" && t.from === "open") m.brent *= 1 + between(rng, 0.03, 0.07);
    } else {
      if (c === "hormuz") {
        const j = between(rng, 0.04, 0.09);
        m.brent *= 1 - j;
        for (const p of ["diesel", "jet"] as const) crackShock(ctx, p, -between(rng, 3, 8), -5, 30);
        news(ctx, "warn", `${name} reopens`, `Traffic resumes; Brent −${(j * 100).toFixed(0)}%, diesel and jet cracks ease.`);
      } else news(ctx, "info", `${name} reopens`, "Transits resume at normal premiums.");
    }
  }
}

export type MacroEventKind = "hurricane" | "refineryOutage" | "refineryAttack" | "exportBan" | "emergencyRelease" | "gasSwitching" | "blackSwan";

/** Fire one macro event now (used by the stochastic generator, scripted scenarios and tests). */
export function fireEvent(ctx: MacroContext, kind: MacroEventKind, variant?: string): void {
  const { m, rng } = ctx;
  switch (kind) {
    case "hurricane": {
      const g = heavy(rng, 4, 12);
      crackShock(ctx, "gasoline", g, g * 0.7, 14);
      crackShock(ctx, "diesel", g * 0.6, g * 0.4, 14);
      crackShock(ctx, "jet", g * 0.6, g * 0.4, 14);
      for (const p of PRODUCTS) diffShock(ctx, "NYH", p, between(rng, 1, 4), 2, 14);
      const extra = 2 + rng.int(4);
      ctx.ports.push({ hub: "USGC", untilDay: m.day + extra + 2, extraDays: extra });
      news(ctx, "critical", "Hurricane hits the US Gulf Coast", `Refineries and terminals shut. US cracks jump (gasoline ${fmt(g)} $/bbl). USGC loadings delayed ~${extra} days; demurrage risk on vessels there.`);
      return;
    }
    case "refineryOutage": {
      const hub = (variant as HubId | undefined) ?? rng.pick<HubId>(["USGC", "ARA", "SIN", "MEG", "WAF", "NYH"]);
      const p = rng.pick(PRODUCTS);
      const size = heavy(rng, 1.5, 5);
      if (hub === "USGC") crackShock(ctx, p, size, size * 0.6, 20);
      else diffShock(ctx, hub, p, size, size * 0.7, 20);
      news(ctx, "warn", `Unplanned refinery outage: ${HUB_INFO[hub].name}`, `Local ${p} supply short: ${hub} ${p} ${fmt(size)} $/bbl.`);
      return;
    }
    case "refineryAttack": {
      if (variant === "russia" || (variant === undefined && rng.bernoulli(0.6))) {
        const s = heavy(rng, 1.5, 4.5);
        diffShock(ctx, "ARA", "diesel", s, s, 25);
        crackShock(ctx, "diesel", s * 0.5, s * 0.4, 25);
        news(ctx, "warn", "Drone strikes on Russian refineries and ports", `Russian diesel exports cut; Europe pays up: ARA diesel ${fmt(s)} $/bbl.`);
      } else {
        const s = heavy(rng, 2, 6);
        for (const p of ["diesel", "jet"] as const) diffShock(ctx, "MEG", p, s, s * 0.6, 20);
        m.brent *= 1 + between(rng, 0.01, 0.04);
        news(ctx, "warn", "Attack on Saudi energy facilities", `Gulf refinery and terminal damage: MEG diesel/jet ${fmt(s)} $/bbl, Brent firmer.`);
      }
      return;
    }
    case "exportBan": {
      if (variant === "russia" || (variant === undefined && rng.bernoulli(0.55))) {
        const s = heavy(rng, 2, 5);
        diffShock(ctx, "ARA", "diesel", s * 0.6, s, 35);
        crackShock(ctx, "gasoline", -s * 0.3, -s * 0.2, 30);
        news(ctx, "warn", "Russia extends product export bans", `Diesel export restrictions for producers extended. Europe's diesel premium widens (${fmt(s)} $/bbl over the coming weeks).`);
      } else {
        const s = heavy(rng, 1.5, 4.5);
        for (const p of ["diesel", "jet"] as const) diffShock(ctx, "SIN", p, s * 0.5, s, 30);
        news(ctx, "warn", "China cuts product export quotas", `Fewer Chinese diesel and jet cargoes for Asia: Singapore ${fmt(s)} $/bbl.`);
      }
      return;
    }
    case "emergencyRelease": {
      const j = between(rng, 0.03, 0.08);
      m.brent *= 1 - j;
      addEffect(ctx, { kind: "structure", key: "brent" }, -1.5, 30);
      news(ctx, "info", "Coordinated emergency stock release", `IEA members release strategic stocks. Brent −${(j * 100).toFixed(0)}%, backwardation eases.`);
      return;
    }
    case "gasSwitching": {
      const s = heavy(rng, 2, 6);
      crackShock(ctx, "diesel", s * 0.5, s, 20);
      diffShock(ctx, "ARA", "diesel", 1, 1.5, 20);
      news(ctx, "warn", "Cold snap: gas-to-oil switching", `Low gas storage pushes power and industry to burn distillates. Diesel crack ${fmt(s)} $/bbl over the coming weeks.`);
      return;
    }
    case "blackSwan": {
      const k = (variant as "demand" | "supply" | "freight" | "credit" | undefined) ?? rng.pick(["demand", "supply", "freight", "credit"] as const);
      if (k === "demand") {
        const j = heavy(rng, 0.12, 0.25);
        m.brent *= 1 - j;
        for (const p of PRODUCTS) crackShock(ctx, p, -heavy(rng, 4, 10), -6, 40);
        m.regime = "stressed";
        news(ctx, "critical", "Black swan: demand collapse", `A sudden macro shock crushes demand. Brent −${(j * 100).toFixed(0)}%, cracks slump, curves flip towards contango.`);
      } else if (k === "supply") {
        const j = heavy(rng, 0.08, 0.2);
        m.brent *= 1 + j;
        for (const p of ["diesel", "jet"] as const) crackShock(ctx, p, heavy(rng, 4, 12), 6, 30);
        news(ctx, "critical", "Black swan: major supply outage", `A large unexpected supply loss. Brent +${(j * 100).toFixed(0)}%, middle distillates spike.`);
      } else if (k === "freight") {
        for (const c of ["MR", "LR1", "LR2"] as const) addEffect(ctx, { kind: "tce", cls: c }, heavy(rng, 0.3, 0.6), 30);
        news(ctx, "critical", "Black swan: tanker market squeeze", "Sanctions on a large fleet segment remove tonnage overnight. Clean tanker earnings surge.");
      } else {
        ctx.financeShock = { lcFeeMult: 2.5, overdraftMult: 0.6, untilDay: m.day + 60 };
        news(ctx, "critical", "Black swan: trade-finance squeeze", "Banks cut commodity lines after a trader default. LC fees more than double; your credit line is cut by 40% for two months.");
      }
      return;
    }
  }
}

/** Stochastic macro events, drawn once per business day from the events stream. */
export function drawMacroEvents(ctx: MacroContext): void {
  const { m, rng, cfg } = ctx;
  const rates = cfg.scenario.eventRates;
  const daily = (perYear: number) => perYear / 252;
  const { m: month } = ymd(m.day);
  // Hurricanes: Gulf of Mexico hurricane frequency by month from HURDAT2 (~21 business days a month)
  if (rng.bernoulli((MODEL.hurricane.value[month - 1] ?? 0) / 21)) fireEvent(ctx, "hurricane");
  if (rng.bernoulli(daily(rates.refineryOutage!.value))) fireEvent(ctx, "refineryOutage");
  if (rng.bernoulli(daily(rates.refineryAttack!.value))) fireEvent(ctx, "refineryAttack");
  if (rng.bernoulli(daily(rates.exportBan!.value))) fireEvent(ctx, "exportBan");
  if (m.regime !== "normal" && rng.bernoulli(daily(rates.emergencyRelease!.value))) fireEvent(ctx, "emergencyRelease");
  if ((month === 12 || month <= 2) && rng.bernoulli(daily(rates.gasSwitching!.value) * 3)) fireEvent(ctx, "gasSwitching");
  if (rng.bernoulli(daily(rates.blackSwan!.value))) fireEvent(ctx, "blackSwan");
}
