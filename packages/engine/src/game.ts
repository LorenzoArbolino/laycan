/**
 * Game facade: a pure, serialisable simulation of a physical refined-products book.
 *
 *   const g = Game.create({ scenario: "now_2026_11", seed: "42" });
 *   g.observe();                 // market, offers, book, P&L
 *   g.act({ type: "accept", offerId, charter: { routeId: "TC14" } });
 *   g.advance();                 // run daily steps to the next weekly decision point
 *
 * Each day: the market moves (seeded, independent of the player); events fire; the book is
 * revalued and the change is attributed exactly to P&L buckets; voyages progress; pricing
 * windows fix; margin, interest and invoices settle.
 */
import { attributeMarketMove, exposures, type Exposure } from "./book/attribution";
import {
  BUCKETS,
  addAttribution,
  attributionTotal,
  emptyAttribution,
  emptyBook,
  type Attribution,
  type Book,
  type Bucket,
  type Cargo,
  type Deal,
  type FuturesPosition,
  type Leg,
  type Voyage,
} from "./book/types";
import { contractPrice, equity, equityBreakdown, futuresPrice, monthBusinessDays, type EquityBreakdown } from "./book/valuation";
import {
  ROSTER,
  defaultProbability,
  emptyRelations,
  maybeTender,
  negotiate,
  requestQuote,
  tenderCompetition,
  weeklyOffers,
  type Offer,
  type OfferContext,
  type Relation,
  type Tender,
} from "./agents/counterparties";
import { isBusinessDay, isoDate, parseDate } from "./core/calendar";
import { exp, sqrt } from "./core/dmath";
import { Rng, type RngState } from "./core/rng";
import { productBblPerTonne, type ProductId } from "./core/units";
import { applyTransitions, drawMacroEvents, fireEvent, type MacroContext, type MacroEventKind, type NewsItem, type PortDisruption } from "./events/macro";
import { quoteRoute, vlsfoPrice, type VoyageQuote } from "./market/freight";
import { FUTURES, listedMonths, type FuturesId } from "./market/futures";
import { hubForward } from "./market/curve";
import {
  cloneMarket,
  freightInputs,
  refreshCurve,
  hubPrice,
  initMarket,
  makeConfig,
  priceRow,
  rowPrice,
  stepMarket,
  type MarketConfig,
  type MarketState,
  type PriceRow,
} from "./market/market";
import { MODEL, SCENARIOS, type Scenario, type ScriptedEvent } from "./params/model";
import { makeGeneratedScenario } from "./params/generated";
import { EPISODES, makeHistoricalScenario } from "./params/episodes";
import { CHOKEPOINT_INFO, HUBS, VESSELS, routeById, type ChokepointId, type HubId } from "./world/world";
import { HUB_PAIRS, chokepointsOn, insideGulf, nearestOnPath, pathLength, voyagePosition } from "./world/geo";
import { est } from "./params/param";
import { BLEND_FEE, blendQuality, checkSpec, componentPrices, gradeFor, offSpecDiscount, optimalRecipe, recipeCost, type Recipe } from "./blending/blend";

export const DAYS_PER_MONTH = 30.4375;
export const MARGIN_PCT = { normal: 0.08, stressed: 0.12, war: 0.14 } as const;
export const BORROWING_BASE_ADVANCE = 0.8;
export const BLEND_HUBS: readonly HubId[] = ["ARA", "USGC", "NYH", "SIN"];
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
export const PENALTY = { failToLift: 2, failToDeliver: 3, late: 0.5 } as const;

export interface GameOptions {
  /** "generated" (default), a historical episode id, or a snapshot scenario id */
  scenario?: string;
  seed: string;
  weeks?: number;
}

export interface DayRecord {
  day: number;
  equity: number;
  pnl: number;
  attribution: Attribution;
  residual: number;
}

export interface GameState {
  version: 1;
  seed: string;
  scenarioId: string;
  scenario: Scenario;
  scriptIdx: number;
  startDay: number;
  endDay: number;
  market: MarketState;
  book: Book;
  offers: Offer[];
  news: NewsItem[];
  history: PriceRow[];
  days: DayRecord[];
  attribution: Attribution;
  ports: PortDisruption[];
  financeShock: MacroContext["financeShock"];
  rng: { market: RngState; events: RngState; cpty: RngState; quotes: RngState };
  nextOfferId: number;
  maxEquity: number;
  maxDrawdown: number;
  varBreachDays: number;
  liquidityBreachDays: number;
  maxResidual: number;
  /** attribution accumulated by actions since the last daily step */
  pending: Attribution;
  lastEquity: number;
  relations: Record<string, Relation>;
  tenders: Tender[];
}

export type Action =
  | { type: "accept"; offerId: string; charter?: { routeId: string; via?: Voyage["via"] }; voyageId?: string }
  | { type: "charter"; routeId: string; via?: Voyage["via"]; laycanStart: number; product: ProductId; purchaseId?: string; saleId?: string }
  | { type: "futures"; contract: FuturesId; y: number; m: number; lots: number }
  | { type: "quote"; side: "buy" | "sell"; product: ProductId; hub: HubId; incoterm: "FOB" | "CIF" | "DES" | "ITT" }
  | { type: "assign"; saleId: string; voyageId: string }
  | { type: "lease"; hub: HubId; capacityBbl: number; months: number }
  | { type: "sellSpot"; cargoId: string; qtyBbl?: number }
  | { type: "divert"; voyageId: string; to: HubId }
  | { type: "counter"; offerId: string; diff: number }
  | { type: "tenderBid"; tenderId: string; diff: number }
  | { type: "blend"; hub: HubId; volumeBbl: number; recipe?: Recipe };

export interface ActionResult {
  ok: boolean;
  message: string;
  id?: string;
}

export interface Score {
  pnl: number;
  returnPct: number;
  maxDrawdown: number;
  varBreachDays: number;
  liquidityBreachDays: number;
  riskAdjusted: number;
}

export class Game {
  state: GameState;
  readonly scenario: Scenario;
  readonly cfg: MarketConfig;
  private rMarket: Rng;
  private rEvents: Rng;
  private rCpty: Rng;
  private rQuotes: Rng;

  private get dayAttr(): Attribution {
    return this.state.pending;
  }

  private constructor(state: GameState) {
    this.state = state;
    state.relations ??= emptyRelations();
    state.tenders ??= [];
    this.scenario = state.scenario;
    this.cfg = makeConfig(state.scenario);
    this.rMarket = new Rng(state.rng.market);
    this.rEvents = new Rng(state.rng.events);
    this.rCpty = new Rng(state.rng.cpty);
    this.rQuotes = new Rng(state.rng.quotes);
  }

  /** Resolve a scenario id: "generated", a historical episode, or a snapshot scenario. */
  static scenarioFor(id: string, seed: string): Scenario {
    if (id === "generated") return makeGeneratedScenario(seed);
    if (EPISODES.some((e) => e.id === id)) return makeHistoricalScenario(id);
    const sc = SCENARIOS[id];
    if (!sc) throw new Error(`unknown scenario ${id}`);
    return sc;
  }

  static create(opts: GameOptions): Game {
    const sc = Game.scenarioFor(opts.scenario ?? "generated", opts.seed);
    const cfg = makeConfig(sc);
    const startDay = parseDate(sc.startDate);
    const market = initMarket(sc, cfg, startDay - sc.burnInDays);
    const book = emptyBook(sc.finance.equity.value);
    const s = (n: string) => Rng.stream(opts.seed, n).snapshot();
    const state: GameState = {
      version: 1,
      seed: opts.seed,
      scenarioId: sc.id,
      scenario: sc,
      scriptIdx: 0,
      startDay,
      endDay: startDay + 7 * (opts.weeks ?? sc.weeks),
      market,
      book,
      offers: [],
      news: sc.news.map((t) => ({ day: startDay, kind: "market" as const, severity: "info" as const, title: t, body: "" })),
      history: [priceRow(market)],
      days: [],
      attribution: emptyAttribution(),
      ports: [],
      financeShock: null,
      rng: { market: s("market"), events: s("events"), cpty: s("counterparties"), quotes: s("quotes") },
      nextOfferId: 1,
      maxEquity: book.cash,
      maxDrawdown: 0,
      varBreachDays: 0,
      liquidityBreachDays: 0,
      maxResidual: 0,
      pending: emptyAttribution(),
      lastEquity: book.cash,
      relations: emptyRelations(),
      tenders: [],
    };
    const g = new Game(state);
    g.burnIn();
    g.newOffers();
    return g;
  }

  /**
   * Run the market from (start − burnInDays) to the start with an empty book, so charts have
   * history and the opening state is consistent. Generated worlds keep the last month's news
   * as context; historical replays keep their scripted headlines.
   */
  private burnIn() {
    const st = this.state;
    if (this.day >= st.startDay) return;
    st.history = [priceRow(this.market)];
    while (this.day < st.startDay) this.marketDay();
    const cutoff = st.startDay - 30;
    st.news = st.news.filter((n) => n.day >= cutoff || this.scenario.kind === "historical");
    st.news.push({ day: st.startDay, kind: "market", severity: "info", title: "Trading starts", body: this.scenario.kind === "generated" ? "A generated market: no real date or prices. The charts show the last three months." : "The charts show the run-up to today." });
    st.pending = emptyAttribution();
    st.lastEquity = this.equity();
    st.maxEquity = st.lastEquity;
  }

  /** One market day: price step, scripted and random events, history. Returns whether it was a business day. */
  private marketDay(): boolean {
    const st = this.state;
    // the curves are rebuilt once, after the day's events
    const transitions = stepMarket(this.market, { ...this.cfg, skipCurve: true }, this.rMarket);
    const biz = isBusinessDay(this.day);
    const ctx: MacroContext = { m: this.market, cfg: this.cfg, rng: this.rEvents, ports: st.ports, news: st.news, financeShock: st.financeShock };
    if (biz) {
      applyTransitions(ctx, transitions);
      if (this.scenario.randomEvents) drawMacroEvents(ctx);
    }
    this.applyScript(ctx);
    // events may have moved the state the curves are built from
    if (biz) refreshCurve(this.market, this.cfg);
    st.financeShock = ctx.financeShock;
    if (biz) st.history.push(priceRow(this.market));
    st.ports = st.ports.filter((p) => p.untilDay >= this.day);
    return biz;
  }

  private applyScript(ctx: MacroContext) {
    const script = this.scenario.script ?? [];
    const st = this.state;
    while (st.scriptIdx < script.length && parseDate(script[st.scriptIdx]!.date) <= this.day) {
      this.applyScripted(ctx, script[st.scriptIdx]!);
      st.scriptIdx++;
    }
  }

  private applyScripted(ctx: MacroContext, ev: ScriptedEvent) {
    const m = this.market;
    if (ev.regime) m.regime = ev.regime;
    if (ev.choke) m.choke[ev.choke[0]] = ev.choke[1];
    if (ev.finance) ctx.financeShock = { lcFeeMult: ev.finance.lcFeeMult, overdraftMult: ev.finance.overdraftMult, untilDay: m.day + ev.finance.days };
    if (ev.port) ctx.ports.push({ hub: ev.port[0], untilDay: m.day + ev.port[1], extraDays: ev.port[1] });
    let k = 0;
    const add = (target: MarketState["effects"][number]["target"], amount: number, hl: number) =>
      m.effects.push({ id: `sc${m.day}-${k++}-${m.effects.length}`, target, amount, halfLifeDays: hl, startDay: m.day });
    for (const [cls, a, hl] of ev.tce ?? []) add({ kind: "tce", cls }, a, hl);
    for (const [hub, product, a, hl] of ev.diff ?? []) add({ kind: "diff", hub, product }, a, hl);
    for (const [product, a, hl] of ev.stocks ?? []) add({ kind: "stocks", product, region: "US" }, (a * 0.6931471805599453) / hl, hl);
    for (const [region, product, a, hl] of ev.regionStocks ?? []) add({ kind: "stocks", product, region }, (a * 0.6931471805599453) / hl, hl);
    for (const [region, a, hl] of ev.util ?? []) add({ kind: "util", region }, a, hl);
    ctx.news.push({ day: m.day, kind: "event", severity: ev.severity ?? "warn", title: ev.title, body: ev.body ?? "" });
  }

  /** Date label: real dates for snapshots and replays; "Year n" for generated worlds. */
  displayDate(day = this.day): string {
    const base = this.scenario.displayYearBase;
    const d = new Date(day * 86_400_000);
    const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    if (!base) return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`;
    return `${d.getUTCDate()} ${mon}, Year ${d.getUTCFullYear() - base + 1}`;
  }

  static fromJSON(json: string): Game {
    return new Game(JSON.parse(json) as GameState);
  }

  toJSON(): string {
    this.syncRng();
    return JSON.stringify(this.state);
  }

  private syncRng() {
    this.state.rng = { market: this.rMarket.snapshot(), events: this.rEvents.snapshot(), cpty: this.rCpty.snapshot(), quotes: this.rQuotes.snapshot() };
  }

  get day(): number {
    return this.state.market.day;
  }
  get market(): MarketState {
    return this.state.market;
  }
  get book(): Book {
    return this.state.book;
  }
  get over(): boolean {
    return this.day >= this.state.endDay;
  }

  // ---------------------------------------------------------------- accounting helpers

  equity(): number {
    return equity(this.book, this.market);
  }

  /** Apply a book change and attribute the resulting change in equity to a bucket. */
  private post(bucket: Bucket, fn: () => void, leg: Leg = "physical"): number {
    const e0 = this.equity();
    fn();
    const d = this.equity() - e0;
    this.dayAttr[bucket][leg] += d;
    return d;
  }

  private id(prefix: string): string {
    return `${prefix}${this.book.nextId++}`;
  }

  /**
   * Credit available against cash: a base revolving line plus a borrowing base of 80% of
   * inventory and receivables (transactional trade finance).
   */
  creditLimit(): number {
    const f = this.state.financeShock && this.day <= this.state.financeShock.untilDay ? this.state.financeShock.overdraftMult : 1;
    const b = this.breakdown();
    const base = BORROWING_BASE_ADVANCE * Math.max(0, b.cargo + b.receivables);
    return (this.scenario.finance.overdraftLimit.value + base) * f;
  }

  private overdraftLimit(): number {
    return this.creditLimit();
  }
  private lcFeePct(): number {
    const f = this.state.financeShock && this.day <= this.state.financeShock.untilDay ? this.state.financeShock.lcFeeMult : 1;
    return (this.scenario.finance.lcFeePct.value / 100) * f;
  }

  private alert(title: string, body: string, severity: NewsItem["severity"] = "warn") {
    this.state.news.push({ day: this.day, kind: "book", severity, title, body });
  }

  private priceOn(day: number, hub: HubId, p: ProductId): number {
    const h = this.state.history;
    let row = h[0]!;
    for (const r of h) {
      if (r.day <= day) row = r;
      else break;
    }
    return rowPrice(row, hub, p);
  }

  // ---------------------------------------------------------------- observation

  quotes(routeId: string): VoyageQuote[] {
    return quoteRoute(routeId, freightInputs(this.market, this.cfg));
  }

  futuresQuote(contract: FuturesId, y: number, m: number): number {
    const lm = listedMonths(contract, this.day, 8).find((x) => x.y === y && x.m === m);
    if (!lm) throw new Error("contract not listed");
    return futuresPrice(contract, lm.expiry, this.market);
  }

  exposures(): Exposure[] {
    return exposures(this.book, this.market);
  }

  /** Parametric 1-day 99% VaR from component exposures (components treated as independent; a stated simplification). */
  var99(): number {
    const m = this.market;
    const r = m.regime;
    let v = 0;
    for (const e of this.exposures()) {
      let sigma = 0;
      if (e.key === "brent") sigma = m.brent * sqrt(m.brentH) * MODEL.brent.volMult[r].value;
      else if (e.key.startsWith("crack:")) sigma = MODEL.cracks[e.key.slice(6) as ProductId].byRegime[r].sigma.value;
      else if (e.key.startsWith("diff:")) sigma = MODEL.regional.sigma.value * (r === "normal" ? 1 : 1.6);
      else sigma = MODEL.structure.slopeSigma.value;
      v += (e.bbl * sigma) ** 2;
    }
    return 2.33 * sqrt(v);
  }

  breakdown(): EquityBreakdown {
    return equityBreakdown(this.book, this.market);
  }

  score(): Score {
    const pnl = this.equity() - this.scenario.finance.equity.value;
    const dd = this.state.maxDrawdown;
    return {
      pnl,
      returnPct: (pnl / this.scenario.finance.equity.value) * 100,
      maxDrawdown: dd,
      varBreachDays: this.state.varBreachDays,
      liquidityBreachDays: this.state.liquidityBreachDays,
      riskAdjusted: pnl / Math.max(dd, 0.02 * this.scenario.finance.equity.value) - 0.1 * this.state.varBreachDays - 0.5 * this.state.liquidityBreachDays,
    };
  }

  dealPrice(d: Deal): number {
    return contractPrice(d, this.market);
  }

  // ---------------------------------------------------------------- actions

  act(a: Action): ActionResult {
    if (this.over) return { ok: false, message: "Scenario finished." };
    switch (a.type) {
      case "accept":
        return this.accept(a.offerId, a.charter, a.voyageId);
      case "charter":
        return this.charter(a.routeId, a.via, a.laycanStart, a.product, a.purchaseId, a.saleId);
      case "futures":
        return this.tradeFutures(a.contract, a.y, a.m, a.lots);
      case "quote": {
        const o = requestQuote(this.rQuotes, this.market, `q${this.state.nextOfferId++}`, this.nextDecisionDay(), this.offerContext(), a);
        if (!o) return { ok: false, message: `Nobody will quote ${a.side === "buy" ? "a" : "a bid for"} ${a.product} ${a.incoterm} ${a.hub} right now.` };
        this.state.offers.push(o);
        return { ok: true, message: `Quote received from ${o.cptyName}: index ${o.pricing.diff >= 0 ? "+" : ""}${o.pricing.diff.toFixed(2)} $/bbl.`, id: o.id };
      }
      case "counter":
        return this.counter(a.offerId, a.diff);
      case "tenderBid": {
        const t = this.state.tenders.find((x) => x.id === a.tenderId && x.status === "open");
        if (!t) return { ok: false, message: "Tender closed or unknown." };
        t.bid = Math.round(a.diff * 100) / 100;
        return { ok: true, message: `Bid submitted to ${t.cptyName}: index ${t.bid >= 0 ? "+" : ""}${t.bid.toFixed(2)} $/bbl. Award on ${isoDate(t.closeDay)}.` };
      }
      case "lease":
        return this.lease(a.hub, a.capacityBbl, a.months);
      case "sellSpot":
        return this.sellSpot(a.cargoId, a.qtyBbl);
      case "divert":
        return this.divert(a.voyageId, a.to);
      case "blend":
        return this.blend(a.hub, a.volumeBbl, a.recipe);
      case "assign": {
        const s = this.book.deals.find((d) => d.id === a.saleId && d.side === "sell" && d.status === "open");
        const v = this.book.voyages.find((x) => x.id === a.voyageId);
        if (!s || !v) return { ok: false, message: "Unknown sale or voyage." };
        if (v.to !== s.hub) return { ok: false, message: `Voyage discharges at ${v.to}, sale is at ${s.hub}.` };
        v.saleId = s.id;
        s.voyageId = v.id;
        return { ok: true, message: `Sale ${s.id} will be delivered by voyage ${v.id}.` };
      }
    }
  }

  private accept(offerId: string, charter?: { routeId: string; via?: Voyage["via"] }, voyageId?: string): ActionResult {
    const o = this.state.offers.find((x) => x.id === offerId);
    if (!o) return { ok: false, message: "Offer not found or expired." };
    const notional = o.qtyBbl * o.indicative;
    const lcLimit = this.scenario.finance.lcLimit.value;
    if (o.playerSide === "buy" && o.payment.kind === "LC" && this.book.lcUsed + notional > lcLimit) {
      return { ok: false, message: `LC facility full: ${(this.book.lcUsed / 1e6).toFixed(0)}m used of ${(lcLimit / 1e6).toFixed(0)}m.` };
    }
    if (charter) {
      const r = routeById(charter.routeId);
      if (r.from !== o.hub || o.playerSide !== "buy" || o.incoterm !== "FOB") return { ok: false, message: `To charter ${r.id} you need an FOB purchase at ${r.from}.` };
      const q = this.pickVariant(charter.routeId, charter.via);
      if (!q.feasible) return { ok: false, message: `${r.id} is blocked (${q.blockedBy.join(", ")}).` };
    }
    const d: Deal = {
      id: this.id(o.playerSide === "buy" ? "P" : "S"),
      side: o.playerSide,
      cpty: o.cpty,
      product: o.product,
      hub: o.hub,
      incoterm: o.incoterm,
      qtyNominal: o.qtyBbl,
      qty: o.qtyBbl,
      tolPct: o.tolPct,
      tolHolder: o.tolHolder,
      laycan: o.laycan,
      pricing: structuredClone(o.pricing),
      payment: o.payment,
      status: "open",
      createdDay: this.day,
      fixings: [],
      lcOpen: false,
      defaultRisk: o.payment.kind === "open" && o.playerSide === "sell" ? o.defaultRisk : 0,
    };
    const cp = ROSTER.find((x) => x.id === o.cpty);
    if (d.pricing.kind === "month" && d.pricing.month) d.window = monthBusinessDays(d.pricing.month.y, d.pricing.month.m);
    // Counterparty-performed delivery dates (their vessel): drawn from a stream keyed by the deal id
    if ((d.side === "buy" && d.incoterm !== "FOB") || (d.side === "sell" && (d.incoterm === "FOB" || d.incoterm === "ITT"))) {
      const kr = Rng.stream(this.state.seed, `deal:${d.id}`);
      d.plannedDelivery = d.laycan[0] + kr.int(d.laycan[1] - d.laycan[0] + 1);
      // Counterparty performance: unreliable sellers deliver late
      if (d.side === "buy" && cp && !kr.bernoulli(cp.reliability)) d.plannedDelivery += 2 + kr.int(6);
    }
    this.post("execution", () => {
      this.book.deals.push(d);
      this.retroFix(d);
    });
    this.state.offers = this.state.offers.filter((x) => x.id !== offerId);
    if (d.side === "buy" && d.payment.kind === "LC") {
      this.post("finance", () => {
        this.book.cash -= notional * this.lcFeePct();
        this.book.lcUsed += notional;
        d.lcOpen = true;
      });
    }
    let msg = `${d.side === "buy" ? "Bought" : "Sold"} ${(d.qty / 1000).toFixed(0)} kbbl ${d.product} ${d.incoterm} ${d.hub} ${d.side === "buy" ? "from" : "to"} ${cp?.name ?? d.cpty}.`;
    if (charter) {
      const r = this.charter(charter.routeId, charter.via, d.laycan[0], d.product, d.id, undefined);
      msg += " " + r.message;
    }
    if (voyageId && d.side === "sell") {
      const r = this.act({ type: "assign", saleId: d.id, voyageId });
      msg += " " + r.message;
    }
    return { ok: true, message: msg, id: d.id };
  }

  private pickVariant(routeId: string, via?: Voyage["via"]): VoyageQuote {
    const qs = this.quotes(routeId);
    if (via) {
      const q = qs.find((x) => x.via === via);
      if (q) return q;
    }
    const feas = qs.filter((q) => q.feasible);
    const pool = feas.length ? feas : qs;
    return pool.reduce((a, b) => (b.allInPerTonne < a.allInPerTonne ? b : a));
  }

  private charter(routeId: string, via: Voyage["via"] | undefined, laycanStart: number, product: ProductId, purchaseId?: string, saleId?: string): ActionResult {
    const r = routeById(routeId);
    const q = this.pickVariant(routeId, via);
    if (!q.feasible) return { ok: false, message: `${routeId} via ${q.via} is blocked (${q.blockedBy.join(", ")}).` };
    const start = Math.max(laycanStart, this.day + 3);
    const id = this.id("V");
    const kr = Rng.stream(this.state.seed, `voyage:${id}`);
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
      fixedDay: this.day,
      arriveLoad: start + draws.arrivalOffset,
      sailDays: Math.ceil(q.ladenDays + draws.seaDelay + (draws.incident ? draws.incidentDelay : 0)),
      capacityTonnes: VESSELS[r.cls].cargoTonnes.value * 1.05,
      freightUsd: q.freightUsd,
      warRiskUsd: q.warRiskUsd,
      demurrageRate: Math.max(18_000, 0.9 * this.market.tce[r.cls]),
      laytimeHours: VESSELS[r.cls].laytimeHours.value,
      portHours: 0,
      heldDays: 0,
      draws,
      chokepoints: [...(r.variants.find((x) => x.via === q.via)?.chokepoints ?? [])],
      pathNm: q.distanceNm,
    };
    if (purchaseId) {
      const d = this.book.deals.find((x) => x.id === purchaseId);
      if (!d || d.side !== "buy" || d.incoterm !== "FOB" || d.hub !== r.from) return { ok: false, message: "Purchase must be FOB at the load port." };
      v.purchaseId = d.id;
      d.voyageId = id;
      v.laycan = [d.laycan[0], d.laycan[1]];
      v.arriveLoad = Math.max(this.day + 1, d.laycan[0] + Math.min(draws.arrivalOffset, d.laycan[1] - d.laycan[0]));
    }
    this.post("freight", () => {
      this.book.voyages.push(v);
      this.book.payables.freight += v.freightUsd + v.warRiskUsd;
    });
    if (saleId) this.act({ type: "assign", saleId, voyageId: id });
    else {
      const s = this.book.deals.find((d) => d.side === "sell" && d.status === "open" && !d.voyageId && d.hub === r.to && d.product === product && d.incoterm !== "FOB");
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

  private marginPct(): number {
    return MARGIN_PCT[this.market.regime];
  }

  private tradeFutures(contract: FuturesId, y: number, m: number, lots: number): ActionResult {
    if (!Number.isInteger(lots) || lots === 0) return { ok: false, message: "Lots must be a non-zero integer." };
    const lm = listedMonths(contract, this.day, 8).find((x) => x.y === y && x.m === m);
    if (!lm || lm.expiry <= this.day) return { ok: false, message: "Contract month not tradable." };
    const spec = FUTURES[contract];
    const F = futuresPrice(contract, lm.expiry, this.market);
    let pos = this.book.futures.find((f) => f.contract === contract && f.y === y && f.m === m);
    const newLots = (pos?.lots ?? 0) + lots;
    const newMargin = Math.abs(newLots) * spec.bblPerLot * F * this.marginPct();
    const dCash = newMargin - (pos?.margin ?? 0);
    if (this.book.cash - dCash < -this.overdraftLimit()) return { ok: false, message: "Not enough liquidity for initial margin." };
    this.post(
      "finance",
      () => {
        this.book.cash -= Math.abs(lots) * spec.feePerLot;
      },
      "paper",
    );
    this.post(
      "execution",
      () => {
        if (!pos) {
          pos = { id: this.id("F"), contract, y, m, expiry: lm.expiry, lots: 0, lastSettle: F, margin: 0 };
          this.book.futures.push(pos);
        }
        // realise variation since last settlement, then trade at F
        this.book.cash += pos.lots * spec.bblPerLot * (F - pos.lastSettle);
        pos.lastSettle = F;
        pos.lots = newLots;
        this.book.cash -= dCash;
        pos.margin = newMargin;
        if (pos.lots === 0) {
          this.book.cash += pos.margin;
          pos.margin = 0;
          this.book.futures = this.book.futures.filter((f) => f !== pos);
        }
      },
      "paper",
    );
    const q = F * spec.quotePerBbl;
    return { ok: true, message: `${lots > 0 ? "Bought" : "Sold"} ${Math.abs(lots)} ${lm.code} at ${q.toFixed(spec.quoteUnit === "$/gal" ? 4 : 2)} ${spec.quoteUnit}.` };
  }

  // ---------------------------------------------------------------- time

  nextDecisionDay(): number {
    const s = this.state.startDay;
    const k = Math.floor((this.day - s) / 7) + 1;
    return Math.min(s + 7 * k, this.state.endDay);
  }

  offerContext(): OfferContext {
    return { regime: this.market.regime, relations: this.state.relations };
  }

  private newOffers() {
    const expires = this.nextDecisionDay();
    const offers = weeklyOffers(this.rCpty, this.market, this.state.nextOfferId, expires, this.offerContext());
    this.state.nextOfferId += 12;
    this.state.offers = offers;
    const t = maybeTender(this.rCpty, this.market, `tn${this.state.nextOfferId++}`, this.offerContext());
    if (t) {
      this.state.tenders.push(t);
      this.state.news.push({ day: this.day, kind: "market", severity: "info", title: `Tender: ${t.cptyName} ${t.playerSide === "sell" ? "buys" : "sells"} ${(t.qtyBbl / 1000).toFixed(0)} kbbl ${t.product} ${t.incoterm} ${t.hub}`, body: `Sealed bids close ${isoDate(t.closeDay)}.` });
    }
  }

  private relate(cptyId: string, delta: number, kind: "deal" | "fail" | "none" = "none") {
    const r = this.state.relations[cptyId];
    if (!r) return;
    r.score = Math.max(-1, Math.min(1, r.score + delta));
    if (kind === "deal") r.deals++;
    if (kind === "fail") r.fails++;
  }

  private counter(offerId: string, diff: number): ActionResult {
    const o = this.state.offers.find((x) => x.id === offerId);
    if (!o) return { ok: false, message: "Offer not found or expired." };
    if (o.agreed) return { ok: false, message: "Price already agreed: accept it." };
    const c = ROSTER.find((x) => x.id === o.cpty);
    if (!c) return { ok: false, message: "Unknown counterparty." };
    const res = negotiate(Rng.stream(this.state.seed, `neg:${o.id}:${o.rounds}`), o, diff, c, this.state.relations[c.id]?.score ?? 0);
    const reprice = (d: number) => {
      o.pricing.diff = d;
      o.indicative = (o.pricing.kind === "fixed" ? o.pricing.fixedPrice! : hubForward(this.market, o.hub, o.product, Math.round((o.laycan[0] + o.laycan[1]) / 2))) + d;
    };
    const fmt = (d: number) => `index ${d >= 0 ? "+" : ""}${d.toFixed(2)}`;
    if (res.outcome === "accepted") {
      reprice(res.diff);
      o.agreed = true;
      return { ok: true, message: `${c.name} agrees at ${fmt(res.diff)}. The offer is yours to take.` };
    }
    if (res.outcome === "countered") {
      reprice(res.diff);
      o.rounds++;
      return { ok: true, message: `${c.name} comes back at ${fmt(res.diff)}.` };
    }
    this.state.offers = this.state.offers.filter((x) => x !== o);
    this.relate(c.id, -0.02);
    return { ok: false, message: `${c.name} walks away.` };
  }

  private resolveTenders() {
    for (const t of this.state.tenders) {
      if (t.status !== "open" || this.day < t.closeDay) continue;
      const best = tenderCompetition(Rng.stream(this.state.seed, `tender:${t.id}`), t, this.market);
      t.winning = best;
      const wins = t.bid !== undefined && (t.playerSide === "sell" ? t.bid < best : t.bid > best);
      if (!wins) {
        t.status = t.bid === undefined ? "cancelled" : "lost";
        if (t.bid !== undefined) this.alert(`Tender lost: ${t.cptyName}`, `Awarded at index ${best >= 0 ? "+" : ""}${best.toFixed(2)}; your bid was ${t.bid >= 0 ? "+" : ""}${t.bid.toFixed(2)}.`, "info");
        continue;
      }
      const c = ROSTER.find((x) => x.id === t.cpty)!;
      const d: Deal = {
        id: this.id(t.playerSide === "buy" ? "P" : "S"),
        side: t.playerSide,
        cpty: c.id,
        product: t.product,
        hub: t.hub,
        incoterm: t.incoterm,
        qtyNominal: t.qtyBbl,
        qty: t.qtyBbl,
        tolPct: 5,
        tolHolder: t.playerSide === "buy" ? "player" : "cpty",
        laycan: t.laycan,
        pricing: { kind: "bl5", diff: t.bid! },
        payment: c.payment,
        status: "open",
        createdDay: this.day,
        fixings: [],
        lcOpen: false,
        defaultRisk: t.playerSide === "sell" && c.payment.kind === "open" ? defaultProbability(c, this.market.regime) : 0,
        note: `tender ${t.id}`,
      };
      this.post("execution", () => this.book.deals.push(d));
      t.status = "won";
      t.dealId = d.id;
      this.alert(`Tender won: ${t.cptyName}`, `${t.playerSide === "sell" ? "You deliver" : "You lift"} ${(t.qtyBbl / 1000).toFixed(0)} kbbl ${t.product} ${t.incoterm} ${t.hub} at index ${t.bid! >= 0 ? "+" : ""}${t.bid!.toFixed(2)} (next best ${best >= 0 ? "+" : ""}${best.toFixed(2)}). Deal ${d.id}.`, "warn");
    }
  }

  /** Run day by day until the next weekly decision point (or the end). Returns news generated meanwhile. */
  advance(maxDays = 7): NewsItem[] {
    const from = this.state.news.length;
    const target = this.nextDecisionDay();
    let n = 0;
    while (!this.over && this.day < target && n < maxDays) {
      this.stepDay();
      n++;
    }
    if (!this.over && (this.day - this.state.startDay) % 7 === 0) this.newOffers();
    this.syncRng();
    return this.state.news.slice(from);
  }

  stepDay(): DayRecord {
    const st = this.state;
    const e0 = st.lastEquity;
    const prev = cloneMarket(this.market);
    const biz = this.marketDay();
    addAttribution(this.dayAttr, attributeMarketMove(this.book, prev, this.market));

    this.settleFutures();
    if (biz) this.fixPricing();
    this.progressVoyages();
    this.counterpartyDeliveries();
    this.deadlines();
    this.resolveTenders();
    this.payments();
    this.carryAndInterest();
    this.liquidity();

    const e1 = this.equity();
    const total = attributionTotal(this.dayAttr);
    const residual = e1 - e0 - total;
    st.maxResidual = Math.max(st.maxResidual, Math.abs(residual));
    addAttribution(st.attribution, this.dayAttr);
    const rec: DayRecord = { day: this.day, equity: e1, pnl: e1 - e0, attribution: this.dayAttr, residual };
    st.days.push(rec);
    st.pending = emptyAttribution();
    st.lastEquity = e1;
    st.maxEquity = Math.max(st.maxEquity, e1);
    st.maxDrawdown = Math.max(st.maxDrawdown, st.maxEquity - e1);
    if (biz && this.var99() > this.scenario.finance.varLimit.value) st.varBreachDays++;
    return rec;
  }

  private settleFutures() {
    for (const f of [...this.book.futures]) {
      const spec = FUTURES[f.contract];
      const F = futuresPrice(f.contract, f.expiry, this.market);
      this.post(
        "time_spread",
        () => {
          this.book.cash += f.lots * spec.bblPerLot * (F - f.lastSettle);
          f.lastSettle = F;
          const req = Math.abs(f.lots) * spec.bblPerLot * F * this.marginPct();
          this.book.cash -= req - f.margin;
          f.margin = req;
          if (this.day >= f.expiry) {
            this.book.cash += f.margin;
            f.margin = 0;
            this.book.futures = this.book.futures.filter((x) => x !== f);
            this.alert(`Futures expired: ${spec.name}`, `${f.lots} lots cash-settled at ${(F * spec.quotePerBbl).toFixed(2)} ${spec.quoteUnit}.`, "info");
          }
        },
        "paper",
      );
    }
  }

  private fixPricing() {
    for (const d of this.book.deals) {
      if (d.status === "settled" || d.status === "cancelled" || !d.window) continue;
      if (d.window.includes(this.day) && !d.fixings.some((f) => f.day === this.day)) {
        d.fixings.push({ day: this.day, price: hubPrice(this.market, d.hub, d.product) });
      }
    }
  }

  private windowFor(d: Deal, anchor: number): number[] {
    let a = anchor;
    while (!isBusinessDay(a)) a++;
    const out: number[] = [];
    if (d.pricing.kind === "bl5") {
      const before: number[] = [];
      let x = a - 1;
      while (before.length < 2) {
        if (isBusinessDay(x)) before.unshift(x);
        x--;
      }
      out.push(...before, a);
      x = a + 1;
      while (out.length < 5) {
        if (isBusinessDay(x)) out.push(x);
        x++;
      }
    } else if (d.pricing.kind === "post5") {
      let x = a;
      while (out.length < 5) {
        if (isBusinessDay(x)) out.push(x);
        x++;
      }
    }
    return out;
  }

  /** Fix quotes for window days already past (the B/L date reveals a window that started earlier). */
  private retroFix(d: Deal) {
    if (!d.window) return;
    for (const day of d.window) {
      if (day > this.day) break;
      if (!d.fixings.some((f) => f.day === day)) d.fixings.push({ day, price: this.priceOn(day, d.hub, d.product) });
    }
    d.fixings.sort((a, b) => a.day - b.day);
  }

  private setDelivery(d: Deal, anchor: number) {
    // The actual delivery date and pricing window replace the expected ones: timing optionality
    this.post("optionality", () => {
      d.deliveryDay = this.day;
      if (d.pricing.kind === "bl5" || d.pricing.kind === "post5") {
        d.window = this.windowFor(d, anchor);
        this.retroFix(d);
      }
    });
    const last = d.window && d.window.length ? d.window[d.window.length - 1]! : this.day;
    d.dueDay = Math.max(this.day + d.payment.days, last + 1);
  }

  private chooseQty(d: Deal, available: number): number {
    const lo = d.qtyNominal * (1 - d.tolPct / 100);
    const hi = d.qtyNominal * (1 + d.tolPct / 100);
    const M = hubPrice(this.market, d.hub, d.product);
    const P = contractPrice(d, this.market);
    // Player-held option: take more when the cargo is worth more than its price (buy) or the price exceeds value (sell)
    let want = d.qtyNominal;
    if (d.tolHolder === "player") {
      const gain = d.side === "buy" ? M - P : P - M;
      want = gain > 0 ? hi : lo;
    } else {
      // counterparty exercises against the player
      const gain = d.side === "buy" ? M - P : P - M;
      want = gain > 0 ? lo : hi;
    }
    return Math.max(0, Math.min(want, available));
  }

  private deliverPurchase(d: Deal, qty: number, where: Cargo["where"], voyageId?: string): Cargo {
    this.post("optionality", () => {
      d.qty = qty;
    });
    this.setDelivery(d, this.day);
    const c: Cargo = { id: this.id("C"), product: d.product, qty, hub: d.hub, where, voyageId, qualityDiscount: 0, sinceDay: this.day };
    this.post("events", () => {
      d.status = "delivered";
      this.book.cargoes.push(c);
    });
    return c;
  }

  private deliverSale(s: Deal, c: Cargo, anchor: number) {
    const hi = s.qtyNominal * (1 + s.tolPct / 100);
    const lo = s.qtyNominal * (1 - s.tolPct / 100);
    const qty = Math.min(this.chooseQty(s, Math.min(c.qty, hi)), c.qty);
    this.post("optionality", () => {
      s.qty = qty;
    });
    this.setDelivery(s, anchor);
    this.post("events", () => {
      s.status = "delivered";
      c.qty -= qty;
      if (c.qty < 1) this.book.cargoes = this.book.cargoes.filter((x) => x !== c);
    });
    if (c.qualityDiscount > 0) {
      // the buyer claims the off-spec discount on what was delivered
      this.post("quality", () => {
        this.book.cash -= qty * c.qualityDiscount;
      });
      // the claim offsets the discount already in the cargo mark, so re-add it here
      this.dayAttr.quality.physical += qty * c.qualityDiscount;
      this.dayAttr.events.physical -= qty * c.qualityDiscount;
    }
    if (qty < lo) {
      const short = lo - qty;
      this.post("events", () => {
        this.book.cash -= short * PENALTY.failToDeliver;
      });
      this.alert(`Short delivery on ${s.id}`, `Delivered ${(qty / 1000).toFixed(0)} kbbl, below tolerance. Penalty ${(short * PENALTY.failToDeliver / 1e3).toFixed(0)}k.`);
    }
    if (this.day > s.laycan[1]) {
      this.post("events", () => {
        this.book.cash -= qty * PENALTY.late;
      });
      this.alert(`Late delivery on ${s.id}`, `Arrived after the laycan; late-delivery claim settled at $${PENALTY.late}/bbl.`);
      this.relate(s.cpty, -0.1);
    }
  }

  private progressVoyages() {
    for (const v of this.book.voyages) {
      if (v.status === "done" || v.status === "cancelled") continue;
      let guard = 0;
      while (guard++ < 4 && this.stepVoyage(v)) {
        /* allow several state changes in one day */
      }
    }
  }

  private portDisrupted(hub: HubId): PortDisruption | undefined {
    return this.state.ports.find((p) => p.hub === hub && p.untilDay >= this.day);
  }

  private chokeBlocked(v: Voyage): boolean {
    const chokes = v.chokepoints ?? routeById(v.routeId).variants.find((x) => x.via === v.via)!.chokepoints;
    return chokes.some((c) => this.market.choke[c] === "closed");
  }

  /** Try to reroute around a closed chokepoint; returns true if rerouted. */
  private reroute(v: Voyage): boolean {
    if (v.pathKey) return false; // diverted voyages have no alternative variant
    const qs = this.quotes(v.routeId);
    const cur = qs.find((q) => q.via === v.via)!;
    const alt = qs.filter((q) => q.feasible && q.via !== v.via).sort((a, b) => a.allInPerTonne - b.allInPerTonne)[0];
    if (!alt) return false;
    const extraDays = Math.max(0, Math.ceil(alt.ladenDays - cur.ladenDays));
    const extraCost = extraDays * (this.market.tce[v.cls] + VESSELS[v.cls].seaConsumptionTpd.value * alt.vlsfo);
    this.post("events", () => {
      this.book.cash -= extraCost;
    });
    v.via = alt.via;
    v.chokepoints = [...(routeById(v.routeId).variants.find((x) => x.via === alt.via)?.chokepoints ?? [])];
    v.pathNm = alt.distanceNm;
    v.sailDays += extraDays;
    if (v.arriveDisch !== undefined) this.setArrival(v, v.arriveDisch + extraDays);
    this.alert(`Voyage ${v.id} rerouted via ${alt.via}`, `A chokepoint on the planned route closed. +${extraDays} days, deviation cost ${(extraCost / 1e3).toFixed(0)}k.`, "warn");
    return true;
  }

  private holdDay(v: Voyage, why: string) {
    if (v.heldDays === 0) this.alert(`Voyage ${v.id} held`, why, "critical");
    v.heldDays++;
    this.post("events", () => {
      this.book.cash -= v.demurrageRate;
    });
  }

  private stepVoyage(v: Voyage): boolean {
    const day = this.day;
    switch (v.status) {
      case "fixed": {
        if (day < v.arriveLoad) return false;
        if (this.chokeBlocked(v) && !this.reroute(v)) {
          this.holdDay(v, `${routeById(v.routeId).id}: route blocked by a closed chokepoint. Waiting costs demurrage-equivalent hire daily.`);
          v.arriveLoad = day + 1;
          return false;
        }
        const dis = this.portDisrupted(v.from);
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
        this.billOfLading(v);
        return true;
      }
      case "sailing": {
        if (day < (v.arriveDisch ?? day)) {
          const passed = day - (v.blDay ?? day) > v.sailDays / 2;
          if (!passed && this.chokeBlocked(v) && !this.reroute(v)) {
            this.setArrival(v, (v.arriveDisch ?? day) + 1);
            this.holdDay(v, "A chokepoint ahead is closed and there is no alternative route. The cargo is stranded until it reopens.");
          }
          return false;
        }
        const dis = this.portDisrupted(v.to);
        v.status = "discharging";
        v.portHours += 36 + 24 * (v.draws.dischDelay + (dis ? dis.extraDays : 0));
        v.doneDay = day + 1 + v.draws.dischDelay + (dis ? dis.extraDays : 0);
        return true;
      }
      case "discharging": {
        if (day < (v.doneDay ?? day)) return false;
        this.discharge(v);
        return false;
      }
      default:
        return false;
    }
  }

  private billOfLading(v: Voyage) {
    const capBbl = v.capacityTonnes * productBblPerTonne(v.product ?? "diesel");
    let cargo: Cargo | undefined;
    if (v.purchaseId) {
      const d = this.book.deals.find((x) => x.id === v.purchaseId)!;
      if (d.status === "open") cargo = this.deliverPurchase(d, this.chooseQty(d, capBbl), "vessel", v.id);
    } else {
      const tank = this.book.cargoes.find((c) => c.where === "tank" && c.hub === v.from && (!v.product || c.product === v.product));
      if (tank) {
        const q = Math.min(tank.qty, capBbl);
        if (q >= tank.qty - 1) cargo = tank;
        else {
          tank.qty -= q;
          cargo = { ...tank, id: this.id("C"), qty: q };
          this.book.cargoes.push(cargo);
        }
      }
    }
    // Pay the freight (owner's freight is due on loading) — no P&L, the liability was booked at fixture
    this.post("freight", () => {
      this.book.cash -= v.freightUsd + v.warRiskUsd;
      this.book.payables.freight -= v.freightUsd + v.warRiskUsd;
    });
    if (!cargo) {
      v.status = "cancelled";
      this.alert(`Voyage ${v.id}: no cargo to load`, "The vessel sailed empty (dead freight). Charter cost is lost.", "critical");
      return;
    }
    cargo.where = "vessel";
    cargo.voyageId = v.id;
    v.cargoId = cargo.id;
    v.product = cargo.product;
    if (v.draws.offSpec) {
      const c = cargo;
      this.post("quality", () => {
        c.qualityDiscount += v.draws.offSpecDiscount;
      });
      this.alert(`Off-spec cargo on ${v.id}`, `Inspector finds the ${c.product} off-spec at load. Valued at a $${v.draws.offSpecDiscount.toFixed(2)}/bbl discount (blend-fix or claim).`);
    }
    // CIF sale linked to this voyage prices around the B/L date
    if (v.saleId) {
      const s = this.book.deals.find((x) => x.id === v.saleId);
      if (s && s.incoterm === "CIF" && s.status === "open" && (s.pricing.kind === "bl5" || s.pricing.kind === "post5")) {
        this.post("optionality", () => {
          s.window = this.windowFor(s, this.day);
          this.retroFix(s);
        });
      }
    }
    // The cargo now belongs to the destination market: the location spread is captured here.
    const c = cargo;
    this.post("regional", () => {
      c.hub = v.to;
      c.markDay = this.day + v.sailDays;
    });
    v.status = "sailing";
    v.arriveDisch = this.day + v.sailDays;
  }

  /** Move a voyage's arrival date; the cargo's forward mark moves with it. */
  private setArrival(v: Voyage, day: number, bucket: Bucket = "events") {
    const c = this.book.cargoes.find((x) => x.id === v.cargoId);
    this.post(bucket, () => {
      v.arriveDisch = day;
      if (c && c.where === "vessel") c.markDay = day;
    });
  }

  private discharge(v: Voyage) {
    const c = this.book.cargoes.find((x) => x.id === v.cargoId);
    v.status = "done";
    if (!c) return;
    this.post("events", () => {
      c.qty *= 1 - v.draws.outturnLoss;
    });
    const overHours = Math.max(0, v.portHours - v.laytimeHours);
    if (overHours > 0) {
      const dem = (overHours / 24) * v.demurrageRate;
      this.post("events", () => {
        this.book.cash -= dem;
      });
      this.alert(`Demurrage on ${v.id}`, `${(overHours / 24).toFixed(1)} days over laytime at $${(v.demurrageRate / 1e3).toFixed(1)}k/day: ${(dem / 1e3).toFixed(0)}k.`);
    }
    let sale = v.saleId ? this.book.deals.find((x) => x.id === v.saleId && x.status === "open") : undefined;
    if (!sale) {
      sale = this.book.deals.find((d) => d.side === "sell" && d.status === "open" && !d.voyageId && d.hub === v.to && d.product === c.product && d.incoterm !== "FOB" && this.day <= d.laycan[1] + 5);
      if (sale) {
        sale.voyageId = v.id;
        v.saleId = sale.id;
      }
    }
    if (sale && sale.product === c.product) {
      const anchor = sale.incoterm === "CIF" ? v.blDay ?? this.day : this.day;
      this.deliverSale(sale, c, anchor);
    }
    if (this.book.cargoes.includes(c)) {
      // arrival was the mark date, so moving from the forward mark to spot changes nothing
      c.where = "tank";
      c.markDay = undefined;
      c.voyageId = undefined;
      c.sinceDay = this.day;
      this.alert(`Cargo ${c.id} into tank at ${v.to}`, `${(c.qty / 1000).toFixed(0)} kbbl ${c.product} stored. Leased tankage is used first; anything above it pays spot tankage (${this.spotStorageFee(v.to).toFixed(2)} $/bbl/month).`, "info");
    }
  }

  private counterpartyDeliveries() {
    for (const d of this.book.deals) {
      if (d.status !== "open" || d.plannedDelivery === undefined || this.day < d.plannedDelivery) continue;
      if (d.side === "buy") {
        const cargo = this.deliverPurchase(d, this.chooseQty(d, Infinity), "tank");
        const late = this.day - d.laycan[1];
        this.alert(`Delivery received: ${d.id}`, `${(d.qty / 1000).toFixed(0)} kbbl ${d.product} delivered into your tank at ${d.hub}${late > 0 ? `, ${late} days after the laycan` : ""}.`, late > 0 ? "warn" : "info");
        const cp = ROSTER.find((x) => x.id === d.cpty);
        const kr = Rng.stream(this.state.seed, `quality:${d.id}`);
        if (cp && kr.bernoulli(cp.offSpec)) {
          const disc = 1.5 + 2 * kr.uniform();
          this.post("quality", () => {
            cargo.qualityDiscount += disc;
          });
          this.alert(`Off-spec delivery from ${cp.name}`, `Inspection finds ${d.id} off-spec: valued $${disc.toFixed(2)}/bbl lower.`);
        }
      } else {
        const c = this.book.cargoes.find((x) => x.where === "tank" && x.hub === d.hub && x.product === d.product);
        if (c) this.deliverSale(d, c, this.day);
      }
    }
  }

  private deadlines() {
    for (const d of this.book.deals) {
      if (d.status !== "open") continue;
      if (d.side === "buy" && d.incoterm === "FOB" && !d.voyageId && this.day > d.laycan[1]) {
        this.post("events", () => {
          d.status = "cancelled";
          this.book.cash -= d.qtyNominal * PENALTY.failToLift;
          if (d.lcOpen) this.book.lcUsed -= d.qtyNominal * contractPrice(d, this.market);
        });
        this.alert(`Failed to lift ${d.id}`, `No vessel nominated within the laycan. Contract cancelled; penalty $${PENALTY.failToLift}/bbl. ${ROSTER.find((x) => x.id === d.cpty)?.name ?? "The seller"} will remember.`, "critical");
        this.relate(d.cpty, -0.3, "fail");
      }
      if (d.side === "sell" && this.day > d.laycan[1] + 5) {
        const v = d.voyageId ? this.book.voyages.find((x) => x.id === d.voyageId) : undefined;
        if (v && v.status !== "done" && v.status !== "cancelled") continue; // a ship is coming: late delivery handled at discharge
        this.post("events", () => {
          d.status = "cancelled";
          this.book.cash -= d.qtyNominal * PENALTY.failToDeliver;
        });
        this.alert(`Failed to deliver ${d.id}`, `No cargo delivered. Buyer cancels and claims $${PENALTY.failToDeliver}/bbl; the contract's value is lost. ${ROSTER.find((x) => x.id === d.cpty)?.name ?? "The buyer"} will remember.`, "critical");
        this.relate(d.cpty, -0.3, "fail");
      }
    }
  }

  private payments() {
    for (const d of this.book.deals) {
      if (d.status !== "delivered" || d.dueDay === undefined || this.day < d.dueDay) continue;
      const n = d.pricing.kind === "fixed" ? 0 : d.window?.length ?? 0;
      if (d.pricing.kind !== "fixed" && d.fixings.length < n) continue;
      const P = contractPrice(d, this.market);
      const kr = Rng.stream(this.state.seed, `pay:${d.id}`);
      const cpr = ROSTER.find((x) => x.id === d.cpty);
      const lcRisk = cpr && (cpr.rating === "BB" || cpr.rating === "B") ? 0.15 : 0.06;
      if (d.payment.kind === "LC" && d.side === "sell" && !d.note?.includes("LC delay") && kr.bernoulli(lcRisk)) {
        d.dueDay += 10;
        d.note = (d.note ?? "") + " LC delay";
        this.alert(`LC discrepancy on ${d.id}`, "The bank found a document discrepancy. Payment delayed ~10 days (financing cost).");
        continue;
      }
      if (d.side === "sell" && d.defaultRisk > 0 && kr.bernoulli(d.defaultRisk)) {
        this.post("events", () => {
          d.status = "settled";
          this.book.cash += 0.3 * d.qty * P;
        });
        this.alert(`Counterparty default on ${d.id}`, "Your open-account buyer cannot pay. 30% recovered after legal costs.", "critical");
        continue;
      }
      this.post("events", () => {
        this.book.cash += d.side === "sell" ? d.qty * P : -d.qty * P;
        d.status = "settled";
        this.relate(d.cpty, 0.05, "deal");
        if (d.lcOpen) {
          this.book.lcUsed = Math.max(0, this.book.lcUsed - d.qtyNominal * P);
          d.lcOpen = false;
        }
      });
    }
  }

  // ---------------------------------------------------------------- diversions at sea

  /**
   * Where a laden cargo could go instead. Distances come from sea paths between the hubs;
   * the ship's position is mapped onto the new path by distance already sailed (a good
   * approximation early in a voyage, which is when diversions happen).
   */
  diversionOptions(voyageId: string): DiversionOption[] {
    return this.diversionPlans(voyageId).map((p) => p.option);
  }

  /**
   * Plans for re-routing a laden ship: from its current position, join the sea path from its
   * load port to the new hub at the nearest point (crossing open water to get there), then
   * follow that path. Distances scale the map geometry to the sea-route length.
   */
  private diversionPlans(voyageId: string): { option: DiversionOption; path: [number, number][]; remainingNm: number; chokepoints: ChokepointId[] }[] {
    const v = this.book.voyages.find((x) => x.id === voyageId);
    const c = v && this.book.cargoes.find((x) => x.id === v.cargoId);
    if (!v || !c || v.status !== "sailing") return [];
    const spec = VESSELS[v.cls];
    const perDay = spec.speedKnots.value * 24;
    const here = voyagePosition(v, this.day);
    const P = here.at;
    const remainingOld = Math.max(0, (v.pathNm ?? 0) * (1 - here.progress));
    const vlsfo = vlsfoPrice(this.market.brent);
    const out: ReturnType<Game["diversionPlans"]> = [];
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
      const blockedBy = chokes.filter((k) => this.market.choke[k] === "closed");
      const extraDays = (remaining - remainingOld) / perDay;
      const warRisk = newChokes.reduce((s, k) => s + (CHOKEPOINT_INFO[k].warRiskPctHull[this.market.choke[k]].value / 100) * spec.hullValueUsd.value, 0);
      const cost = DIVERSION.fee.value + Math.max(0, extraDays) * (this.market.tce[v.cls] + spec.seaConsumptionTpd.value * vlsfo) + warRisk;
      // forward value at the new hub on the new arrival date vs the current mark
      const arrive = this.day + Math.max(1, Math.ceil(remaining / perDay));
      const priceGain = hubForward(this.market, to, c.product, arrive) - hubForward(this.market, v.to, c.product, c.markDay ?? this.day);
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

  private divert(voyageId: string, to: HubId): ActionResult {
    const v = this.book.voyages.find((x) => x.id === voyageId);
    const plan = this.diversionPlans(voyageId).find((p) => p.option.to === to);
    if (!v || !plan) return { ok: false, message: "Only laden ships at sea can be diverted, to another hub." };
    const opt = plan.option;
    if (!opt.feasible) return { ok: false, message: `Diversion to ${to} is blocked (${opt.blockedBy.join(", ")}).` };
    const c = this.book.cargoes.find((x) => x.id === v.cargoId)!;
    // Freight: deviation and admin costs for the charterer's account
    this.post("freight", () => {
      this.book.cash -= opt.costUsd;
    });
    // The cargo now belongs to the new market: the value of the destination option is realised here
    const arrive = this.day + Math.max(1, Math.ceil(opt.remainingDays));
    this.post("optionality", () => {
      c.hub = to;
      c.markDay = arrive;
      v.arriveDisch = arrive;
    });
    if (v.saleId) {
      const s = this.book.deals.find((x) => x.id === v.saleId);
      if (s) s.voyageId = undefined;
      this.alert(`Sale ${v.saleId} needs another cargo`, `Voyage ${v.id} no longer goes to ${v.to}. Find another cargo before the laycan or face a delivery penalty.`, "warn");
      v.saleId = undefined;
    }
    const remainingDays = Math.ceil(opt.remainingDays);
    v.divertedFrom = v.divertedFrom ?? v.to;
    v.to = to;
    v.pathKey = `${v.from}>${to}`;
    v.path = plan.path;
    v.chokepoints = plan.chokepoints;
    v.pathNm = plan.remainingNm;
    v.legStartDay = this.day;
    v.legStartFrac = 0;
    v.sailDays = arrive - (v.blDay ?? this.day);
    return {
      ok: true,
      message: `${v.id} diverted to ${to}: arrives in ~${remainingDays} days; deviation cost ${(opt.costUsd / 1e3).toFixed(0)}k; price at ${to} ${opt.priceGainPerBbl >= 0 ? "+" : ""}${opt.priceGainPerBbl.toFixed(2)} $/bbl vs ${v.divertedFrom}.`,
    };
  }

  // ---------------------------------------------------------------- blending

  /** Blending quote at a hub: grade, component prices, optimal recipe, cost and margin vs finished gasoline. */
  blendQuote(hub: HubId, recipe?: Recipe) {
    const grade = gradeFor(hub, this.day);
    const prices = componentPrices(this.market, hub);
    const optimal = optimalRecipe(prices, grade);
    const use = recipe ?? optimal ?? {};
    const quality = blendQuality(use);
    const checks = checkSpec(quality, grade);
    const cost = recipeCost(use, prices) + BLEND_FEE.value;
    const finished = hubPrice(this.market, hub, "gasoline");
    const discount = offSpecDiscount(checks);
    return { grade, prices, optimal, recipe: use, quality, checks, cost, finished, discount, margin: finished - discount - cost, freeTank: Math.max(0, this.leasedCapacity(hub) - this.tankStock(hub)) };
  }

  private blend(hub: HubId, volumeBbl: number, recipe?: Recipe): ActionResult {
    if (!BLEND_HUBS.includes(hub)) return { ok: false, message: `No blending terminal for you at ${hub}. Blend at ${BLEND_HUBS.join(", ")}.` };
    const q = this.blendQuote(hub, recipe);
    if (!q.optimal && !recipe) return { ok: false, message: "No combination of components meets the specification today." };
    const vol = Math.round(volumeBbl);
    if (!(vol > 0)) return { ok: false, message: "Volume must be positive." };
    if (vol > q.freeTank) return { ok: false, message: `Blending needs tank space: ${(q.freeTank / 1000).toFixed(0)} kbbl free at ${hub}. Lease more tankage first.` };
    const failed = q.checks.filter((x) => !x.ok);
    this.post("quality", () => {
      this.book.cash -= vol * q.cost;
      this.book.cargoes.push({ id: this.id("C"), product: "gasoline", qty: vol, hub, where: "tank", qualityDiscount: q.discount, sinceDay: this.day });
    });
    if (failed.length) this.alert(`Off-spec blend at ${hub}`, `Fails ${failed.map((f) => f.label).join(", ")}. The batch is worth $${q.discount.toFixed(2)}/bbl less until re-blended or sold at a discount.`, "warn");
    return {
      ok: true,
      message: `Blended ${(vol / 1000).toFixed(0)} kbbl ${q.grade.name} at ${hub}: cost ${q.cost.toFixed(2)} vs finished ${q.finished.toFixed(2)} $/bbl, margin ${q.margin >= 0 ? "+" : ""}${q.margin.toFixed(2)} $/bbl${failed.length ? " (OFF-SPEC)" : ""}.`,
    };
  }

  // ---------------------------------------------------------------- storage

  /** Term lease fee at a hub today: base tariff, dearer when contango makes storage valuable. */
  leaseQuote(hub: HubId): number {
    const S = MODEL.storage;
    const contango = Math.max(0, -this.market.structure.diesel, -this.market.structure.gasoline);
    return S.baseFee[hub].value * (1 + S.contangoPremium.value * contango);
  }

  spotStorageFee(hub: HubId): number {
    return this.leaseQuote(hub) * MODEL.storage.spotMultiplier.value;
  }

  leasedCapacity(hub: HubId): number {
    return this.book.leases.filter((l) => l.hub === hub && l.startDay <= this.day && this.day < l.endDay).reduce((s, l) => s + l.capacityBbl, 0);
  }

  tankStock(hub: HubId): number {
    return this.book.cargoes.filter((c) => c.where === "tank" && c.hub === hub).reduce((s, c) => s + c.qty, 0);
  }

  private lease(hub: HubId, capacityBbl: number, months: number): ActionResult {
    if (!(capacityBbl > 0) || !(months >= 1)) return { ok: false, message: "Capacity must be positive and the term at least one month." };
    const fee = this.leaseQuote(hub);
    const l = { id: this.id("T"), hub, capacityBbl: Math.round(capacityBbl), feePerBblMonth: fee, startDay: this.day, endDay: this.day + Math.round(months * DAYS_PER_MONTH) };
    this.book.leases.push(l);
    return { ok: true, message: `Leased ${(l.capacityBbl / 1000).toFixed(0)} kbbl at ${hub} for ${months} month(s) at ${fee.toFixed(2)} $/bbl/month (take-or-pay: ${((fee * l.capacityBbl) / 1e3).toFixed(0)}k a month).`, id: l.id };
  }

  /** Sell a parcel from your tank to a merchant now: fixed price at the index less a haircut, paid in 5 days. */
  private sellSpot(cargoId: string, qtyBbl?: number): ActionResult {
    const c = this.book.cargoes.find((x) => x.id === cargoId && x.where === "tank");
    if (!c) return { ok: false, message: "Only cargo in tank can be sold spot." };
    const qty = Math.min(c.qty, qtyBbl ?? c.qty);
    const M = hubPrice(this.market, c.hub, c.product);
    const h = MODEL.storage.spotSaleHaircut.value + c.qualityDiscount;
    const d: Deal = {
      id: this.id("S"),
      side: "sell",
      cpty: "spot",
      product: c.product,
      hub: c.hub,
      incoterm: "ITT",
      qtyNominal: qty,
      qty,
      tolPct: 0,
      tolHolder: "cpty",
      laycan: [this.day, this.day],
      pricing: { kind: "fixed", diff: -h, fixedPrice: M },
      payment: { kind: "open", days: 5 },
      status: "delivered",
      createdDay: this.day,
      deliveryDay: this.day,
      dueDay: this.day + 5,
      fixings: [],
      lcOpen: false,
      defaultRisk: 0,
      note: "spot sale",
    };
    this.post("execution", () => {
      this.book.deals.push(d);
      c.qty -= qty;
      if (c.qty < 1) this.book.cargoes = this.book.cargoes.filter((x) => x !== c);
    });
    return { ok: true, message: `Sold ${(qty / 1000).toFixed(0)} kbbl ${c.product} in tank at ${c.hub} for ${(M - h).toFixed(2)} $/bbl (index − ${h.toFixed(2)}).`, id: d.id };
  }

  /**
   * Cash-and-carry economics at a hub for a product: what holding a barrel for a month earns
   * from the curve, against storage and financing. Positive = storage pays.
   */
  carry(hub: HubId, product: ProductId) {
    const spot = hubPrice(this.market, hub, product);
    const contango = -this.market.structure[product];
    const storage = this.leaseQuote(hub);
    const finance = (spot * this.scenario.finance.borrowRate.value) / 12;
    return { spot, contango, storage, finance, net: contango - storage - finance };
  }

  private carryAndInterest() {
    // Term leases are take-or-pay; tank inventory above leased capacity pays spot tankage.
    for (const l of this.book.leases) {
      if (this.day < l.startDay || this.day >= l.endDay) continue;
      this.post("time_spread", () => {
        this.book.cash -= (l.capacityBbl * l.feePerBblMonth) / DAYS_PER_MONTH;
      });
    }
    const hubs = new Set(this.book.cargoes.filter((c) => c.where === "tank").map((c) => c.hub));
    for (const hub of hubs) {
      const excess = Math.max(0, this.tankStock(hub) - this.leasedCapacity(hub));
      if (excess <= 0) continue;
      this.post("time_spread", () => {
        this.book.cash -= (excess * this.spotStorageFee(hub)) / DAYS_PER_MONTH;
      });
    }
    const f = this.scenario.finance;
    const rate = this.book.cash >= 0 ? f.depositRate.value : f.borrowRate.value + (this.book.cash < -this.overdraftLimit() ? 0.05 : 0);
    this.post("finance", () => {
      this.book.cash *= exp(rate / 365);
    });
  }

  private liquidity() {
    if (this.book.cash >= -this.overdraftLimit()) return;
    this.state.liquidityBreachDays++;
    if (this.book.futures.length === 0) {
      this.alert("Credit line breached", "Cash is below the overdraft limit. Penalty interest applies until you raise cash.", "critical");
      return;
    }
    this.alert("Margin call: forced liquidation", "Cash fell below your credit line. The broker closes all futures positions.", "critical");
    for (const f of [...this.book.futures]) {
      const spec = FUTURES[f.contract];
      this.post(
        "finance",
        () => {
          this.book.cash -= Math.abs(f.lots) * spec.feePerLot * 3;
        },
        "paper",
      );
      this.post(
        "execution",
        () => {
          const F = futuresPrice(f.contract, f.expiry, this.market);
          this.book.cash += f.lots * spec.bblPerLot * (F - f.lastSettle) + f.margin;
          this.book.futures = this.book.futures.filter((x) => x !== f);
        },
        "paper",
      );
    }
  }

  // ---------------------------------------------------------------- scripted shocks (scenarios, tests, "what if")

  /** Fire a macro event now. Market jumps are attributed to the market buckets like any other move. */
  fireEvent(kind: MacroEventKind, variant?: string): NewsItem[] {
    const from = this.state.news.length;
    const prev = cloneMarket(this.market);
    const ctx: MacroContext = { m: this.market, cfg: this.cfg, rng: this.rEvents, ports: this.state.ports, news: this.state.news, financeShock: this.state.financeShock };
    fireEvent(ctx, kind, variant);
    this.state.financeShock = ctx.financeShock;
    addAttribution(this.dayAttr, attributeMarketMove(this.book, prev, this.market));
    return this.state.news.slice(from);
  }

  /** Force a chokepoint state (scripted scenario or "what if"). */
  setChokepoint(c: keyof MarketState["choke"], to: MarketState["choke"][keyof MarketState["choke"]]): NewsItem[] {
    const from = this.state.news.length;
    const before = this.market.choke[c];
    if (before === to) return [];
    const prev = cloneMarket(this.market);
    this.market.choke[c] = to;
    const ctx: MacroContext = { m: this.market, cfg: this.cfg, rng: this.rEvents, ports: this.state.ports, news: this.state.news, financeShock: this.state.financeShock };
    applyTransitions(ctx, [{ kind: "choke", chokepoint: c, from: before, to, text: "" }]);
    addAttribution(this.dayAttr, attributeMarketMove(this.book, prev, this.market));
    return this.state.news.slice(from);
  }

  // ---------------------------------------------------------------- reporting helpers

  attributionTotals(): { bucket: Bucket; physical: number; paper: number; total: number }[] {
    return BUCKETS.map((b) => ({ bucket: b, physical: this.state.attribution[b].physical, paper: this.state.attribution[b].paper, total: this.state.attribution[b].physical + this.state.attribution[b].paper }));
  }

  openPositions(): { deals: Deal[]; cargoes: Cargo[]; voyages: Voyage[]; futures: FuturesPosition[] } {
    return {
      deals: this.book.deals.filter((d) => d.status === "open" || d.status === "delivered"),
      cargoes: this.book.cargoes,
      voyages: this.book.voyages.filter((v) => v.status !== "done" && v.status !== "cancelled"),
      futures: this.book.futures,
    };
  }

  chokeSummary(): string {
    return Object.entries(this.market.choke)
      .map(([k, v]) => `${CHOKEPOINT_INFO[k as keyof typeof CHOKEPOINT_INFO].name}: ${v}`)
      .join(" · ");
  }
}
