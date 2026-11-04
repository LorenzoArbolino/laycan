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
import { isBusinessDay, parseDate } from "./core/calendar";
import { sqrt } from "./core/dmath";
import { Rng, type RngState } from "./core/rng";
import type { ProductId } from "./core/units";
import { applyTransitions, drawMacroEvents, fireEvent, type MacroContext, type MacroEventKind, type NewsItem, type PortDisruption } from "./events/macro";
import { quoteRoute, type VoyageQuote } from "./market/freight";
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
import { CHOKEPOINT_INFO, routeById, type HubId } from "./world/world";
import { BLEND_FEE, blendQuality, checkSpec, componentPrices, gradeFor, offSpecDiscount, optimalRecipe, recipeCost, type Recipe } from "./blending/blend";
import { charter as charterVoyage, diversionPlans, divert, pickVariant, progressVoyages, type DiversionOption } from "./game/voyages";
import { counterpartyDeliveries, deadlines, fixPricing, payments, retroFix, settleFutures } from "./game/settlement";
import { BORROWING_BASE_ADVANCE, carryAndInterest, lcFeePct, lease, liquidity, marginPct, overdraftLimit, sellSpot } from "./game/finance";
export { DIVERSION, type DiversionOption } from "./game/voyages";
export { PENALTY } from "./game/settlement";
export { BORROWING_BASE_ADVANCE, MARGIN_PCT } from "./game/finance";

export const DAYS_PER_MONTH = 30.4375;
export const BLEND_HUBS: readonly HubId[] = ["ARA", "USGC", "NYH", "SIN"];


export interface GameOptions {
  /** "generated" (default), a historical episode id, or a snapshot scenario id */
  scenario?: string;
  seed: string;
  weeks?: number;
  /** generated markets only: no fixed end; the player ends the game with end() */
  openEnded?: boolean;
}

/** In long games, keep this much history in the saved state (charts and saves stay small). */
export const RETAIN = { historyRows: 780, dayRecords: 1100, news: 600 } as const;

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
  /** no fixed end date (the player stops when they like) */
  openEnded?: boolean;
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

  /** @internal shared with the game/ modules (voyages, settlement, finance) */
  get dayAttr(): Attribution {
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
      endDay: opts.openEnded && sc.kind === "generated" ? Number.MAX_SAFE_INTEGER : startDay + 7 * (opts.weeks ?? sc.weeks),
      openEnded: !!opts.openEnded && sc.kind === "generated",
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

  /** End the game today (open-ended games, or stopping early) and freeze the score. */
  end(): Score {
    if (!this.over) this.state.endDay = this.day;
    return this.score();
  }

  // ---------------------------------------------------------------- accounting helpers

  equity(): number {
    return equity(this.book, this.market);
  }

  /** Apply a book change and attribute the resulting change in equity to a bucket. */
  /** @internal shared with the game/ modules (voyages, settlement, finance) */
  post(bucket: Bucket, fn: () => void, leg: Leg = "physical"): number {
    const e0 = this.equity();
    fn();
    const d = this.equity() - e0;
    this.dayAttr[bucket][leg] += d;
    return d;
  }

  /** @internal shared with the game/ modules (voyages, settlement, finance) */
  id(prefix: string): string {
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

  /** @internal shared with the game/ modules (voyages, settlement, finance) */
  alert(title: string, body: string, severity: NewsItem["severity"] = "warn") {
    this.state.news.push({ day: this.day, kind: "book", severity, title, body });
  }

  /** @internal shared with the game/ modules (voyages, settlement, finance) */
  priceOn(day: number, hub: HubId, p: ProductId): number {
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
        return charterVoyage(this, a.routeId, a.via, a.laycanStart, a.product, a.purchaseId, a.saleId);
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
        return { ok: true, message: `Bid submitted to ${t.cptyName}: index ${t.bid >= 0 ? "+" : ""}${t.bid.toFixed(2)} $/bbl. Award on ${this.displayDate(t.closeDay)}.` };
      }
      case "lease":
        return lease(this, a.hub, a.capacityBbl, a.months);
      case "sellSpot":
        return sellSpot(this, a.cargoId, a.qtyBbl);
      case "divert":
        return divert(this, a.voyageId, a.to);
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
      const q = pickVariant(this, charter.routeId, charter.via);
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
      retroFix(this, d);
    });
    this.state.offers = this.state.offers.filter((x) => x.id !== offerId);
    if (d.side === "buy" && d.payment.kind === "LC") {
      this.post("finance", () => {
        this.book.cash -= notional * lcFeePct(this);
        this.book.lcUsed += notional;
        d.lcOpen = true;
      });
    }
    let msg = `${d.side === "buy" ? "Bought" : "Sold"} ${(d.qty / 1000).toFixed(0)} kbbl ${d.product} ${d.incoterm} ${d.hub} ${d.side === "buy" ? "from" : "to"} ${cp?.name ?? d.cpty}.`;
    if (charter) {
      const r = charterVoyage(this, charter.routeId, charter.via, d.laycan[0], d.product, d.id, undefined);
      msg += " " + r.message;
    }
    if (voyageId && d.side === "sell") {
      const r = this.act({ type: "assign", saleId: d.id, voyageId });
      msg += " " + r.message;
    }
    return { ok: true, message: msg, id: d.id };
  }

  private tradeFutures(contract: FuturesId, y: number, m: number, lots: number): ActionResult {
    if (!Number.isInteger(lots) || lots === 0) return { ok: false, message: "Lots must be a non-zero integer." };
    const lm = listedMonths(contract, this.day, 8).find((x) => x.y === y && x.m === m);
    if (!lm || lm.expiry <= this.day) return { ok: false, message: "Contract month not tradable." };
    const spec = FUTURES[contract];
    const F = futuresPrice(contract, lm.expiry, this.market);
    let pos = this.book.futures.find((f) => f.contract === contract && f.y === y && f.m === m);
    const newLots = (pos?.lots ?? 0) + lots;
    const newMargin = Math.abs(newLots) * spec.bblPerLot * F * marginPct(this);
    const dCash = newMargin - (pos?.margin ?? 0);
    if (this.book.cash - dCash < -overdraftLimit(this)) return { ok: false, message: "Not enough liquidity for initial margin." };
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
      this.state.news.push({ day: this.day, kind: "market", severity: "info", title: `Tender: ${t.cptyName} ${t.playerSide === "sell" ? "buys" : "sells"} ${(t.qtyBbl / 1000).toFixed(0)} kbbl ${t.product} ${t.incoterm} ${t.hub}`, body: `Sealed bids close ${this.displayDate(t.closeDay)}.` });
    }
  }

  /** @internal shared with the game/ modules (voyages, settlement, finance) */
  relate(cptyId: string, delta: number, kind: "deal" | "fail" | "none" = "none") {
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
    const fresh = this.state.news.slice(from);
    const news = this.state.news;
    if (news.length > RETAIN.news) news.splice(0, news.length - RETAIN.news);
    return fresh;
  }

  stepDay(): DayRecord {
    const st = this.state;
    const e0 = st.lastEquity;
    const prev = cloneMarket(this.market);
    const biz = this.marketDay();
    addAttribution(this.dayAttr, attributeMarketMove(this.book, prev, this.market));

    settleFutures(this);
    if (biz) fixPricing(this);
    progressVoyages(this);
    counterpartyDeliveries(this);
    deadlines(this);
    this.resolveTenders();
    payments(this);
    carryAndInterest(this);
    liquidity(this);

    const e1 = this.equity();
    const total = attributionTotal(this.dayAttr);
    const residual = e1 - e0 - total;
    st.maxResidual = Math.max(st.maxResidual, Math.abs(residual));
    addAttribution(st.attribution, this.dayAttr);
    const rec: DayRecord = { day: this.day, equity: e1, pnl: e1 - e0, attribution: this.dayAttr, residual };
    st.days.push(rec);
    // long games: drop the oldest records (cumulative P&L, drawdown and attribution are kept)
    if (st.days.length > RETAIN.dayRecords) st.days.splice(0, st.days.length - RETAIN.dayRecords);
    if (st.history.length > RETAIN.historyRows) st.history.splice(0, st.history.length - RETAIN.historyRows);
    st.pending = emptyAttribution();
    st.lastEquity = e1;
    st.maxEquity = Math.max(st.maxEquity, e1);
    st.maxDrawdown = Math.max(st.maxDrawdown, st.maxEquity - e1);
    if (biz && this.var99() > this.scenario.finance.varLimit.value) st.varBreachDays++;
    return rec;
  }

  // ---------------------------------------------------------------- diversions at sea

  /**
   * Where a laden cargo could go instead. Distances come from sea paths between the hubs;
   * the ship's position is mapped onto the new path by distance already sailed (a good
   * approximation early in a voyage, which is when diversions happen).
   */
  diversionOptions(voyageId: string): DiversionOption[] {
    return diversionPlans(this, voyageId).map((p) => p.option);
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
