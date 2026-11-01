/**
 * Historical replays. The US benchmark (Brent, US Gulf cracks, NYH spreads) and US stock
 * levels follow the real EIA daily/weekly data; other hubs, freight and curves are generated
 * by the model around them, and the major events of the period are scripted from public
 * reporting. Dates marked "approx." are approximate.
 */
import replay from "../../../../params/replay.json" with { type: "json" };
import { parseDate } from "../core/calendar";
import type { ProductId } from "../core/units";
import { MODEL, ROUTE_MULT_NORMAL, SCENARIOS, type Regime, type Scenario, type ScriptedEvent } from "./model";
import { est, type Param } from "./param";

export interface ReplayRow {
  t: string;
  b: number;
  g: number;
  d: number;
  j: number;
  ng: number;
  nd: number;
  sd: number | null;
  sg: number | null;
  sj: number | null;
}

interface EpisodeData {
  id: string;
  name: string;
  start: string;
  weeks: number;
  rows: ReplayRow[];
}

export const REPLAY_SOURCE: string = replay.meta.source;
const DATA = replay.episodes as EpisodeData[];

export function replayRows(id: string): ReplayRow[] {
  const e = DATA.find((x) => x.id === id);
  if (!e) throw new Error(`unknown episode ${id}`);
  return e.rows;
}

interface EpisodeSpec {
  id: string;
  name: string;
  teaser: string;
  regimeBefore: Regime;
  choke: Scenario["choke"];
  script: ScriptedEvent[];
}

export const EPISODES: EpisodeSpec[] = [
  {
    id: "abqaiq_2019",
    name: "Abqaiq attack — autumn 2019",
    teaser: "A drone strike takes half of Saudi output offline overnight. Then sanctions on a large tanker fleet send freight through the roof, while shipping prepares for the 2020 sulphur cap.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2019-09-16", severity: "critical", title: "Attack on Abqaiq and Khurais knocks out ~5.7 mb/d of Saudi output", body: "Drones and missiles hit the world's largest crude processing plant on 14 Sep. Brent posts a record one-day jump.", diff: [["MEG", "diesel", 3, 10], ["MEG", "jet", 3, 10]], structure: [["brent", 1.5, 10]] },
      { date: "2019-09-17", title: "Saudi Aramco: output to be fully restored by end-September", severity: "info" },
      { date: "2019-09-26", severity: "warn", title: "US sanctions COSCO tanker subsidiaries; tanker rates spike", body: "A large slice of the fleet becomes untouchable for many charterers.", tce: [["MR", 0.35, 25], ["LR1", 0.45, 25], ["LR2", 0.5, 25]] },
      { date: "2019-10-14", title: "IMO 2020 approaches: the 0.5% sulphur cap lifts demand for low-sulphur fuels and gasoil", severity: "info", structure: [["diesel", 0.6, 60]] },
      { date: "2020-01-01", severity: "warn", title: "IMO 2020 takes effect: ships must burn 0.5% sulphur fuel or install scrubbers" },
    ],
  },
  {
    id: "gfc_2008",
    name: "Financial crisis — autumn 2008",
    teaser: "Lehman fails a few days after Hurricane Ike. Credit lines shrink, demand collapses, and crude falls by more than half. The curve flips into contango.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2008-09-15", severity: "critical", title: "Lehman Brothers files for bankruptcy; credit markets seize", body: "Banks cut trade-finance lines and raise LC fees.", regime: "stressed", finance: { lcFeeMult: 2.5, overdraftMult: 0.6, days: 90 } },
      { date: "2008-09-15", severity: "warn", title: "Gulf Coast refineries restart after Hurricane Ike (landfall 13 Sep)", port: ["USGC", 3] },
      { date: "2008-10-03", title: "US Congress passes the $700bn TARP bank rescue", severity: "info" },
      { date: "2008-10-24", title: "OPEC agrees to cut output by 1.5 mb/d", severity: "warn" },
      { date: "2008-11-24", severity: "warn", title: "Contango deepens; storing oil (even at sea) starts to pay (approx.)", structure: [["brent", -1.2, 60], ["diesel", -1, 60], ["gasoline", -1, 60], ["jet", -1, 60]] },
      { date: "2008-12-17", severity: "warn", title: "OPEC agrees a further 2.2 mb/d output cut" },
      { date: "2009-01-12", severity: "warn", title: "Floating storage builds as traders lock in the contango (approx.)", tce: [["LR1", 0.3, 40], ["LR2", 0.3, 40]] },
    ],
  },
  {
    id: "covid_2020",
    name: "COVID collapse — spring 2020",
    teaser: "A price war meets a pandemic. Jet demand evaporates, tanks fill up, the curve goes into super-contango and storage becomes the trade.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2020-03-06", severity: "warn", title: "OPEC+ talks collapse; Saudi Arabia launches a price war" },
      { date: "2020-03-09", severity: "critical", title: "Brent suffers its biggest one-day fall since 1991", regime: "stressed" },
      { date: "2020-03-11", severity: "critical", title: "WHO declares a pandemic; lockdowns spread and jet demand collapses", structure: [["jet", -2, 60], ["gasoline", -1.5, 45], ["diesel", -1, 45], ["brent", -1, 45]] },
      { date: "2020-04-01", severity: "warn", title: "Floating storage absorbs tankers; clean freight spikes (approx.)", tce: [["MR", 0.4, 30], ["LR1", 0.6, 30], ["LR2", 0.6, 30]] },
      { date: "2020-04-13", severity: "warn", title: "OPEC+ agrees a record 9.7 mb/d output cut (12 Apr)" },
      { date: "2020-04-20", severity: "critical", title: "WTI May futures settle at −$37.63: US storage is nearly full", structure: [["brent", -2, 30]] },
      { date: "2020-05-01", severity: "warn", title: "OPEC+ output cuts take effect; lockdowns begin to ease", structure: [["brent", 1.5, 30]] },
    ],
  },
  {
    id: "uri_2021",
    name: "Texas freeze — winter 2021",
    teaser: "Winter Storm Uri shuts a fifth of US refining in a week. A month later a container ship blocks the Suez Canal for six days.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2021-02-15", severity: "critical", title: "Winter Storm Uri: Texas grid fails; about a fifth of US refining capacity shuts", body: "Gulf Coast loadings and discharges stall.", port: ["USGC", 6] },
      { date: "2021-02-22", severity: "info", title: "Gulf Coast refineries begin restarting; some units out for weeks" },
      { date: "2021-03-23", severity: "critical", title: "Ever Given grounds in the Suez Canal; the canal is blocked", choke: ["suez", "closed"] },
      { date: "2021-03-29", severity: "warn", title: "Ever Given refloated; Suez traffic resumes", choke: ["suez", "open"] },
      { date: "2021-05-07", severity: "critical", title: "Ransomware attack shuts the Colonial Pipeline", body: "The main artery from the Gulf Coast to the East Coast stops; NY Harbor needs barrels by sea.", diff: [["NYH", "jet", 3, 10]] },
      { date: "2021-05-12", severity: "warn", title: "Colonial Pipeline restarts" },
    ],
  },
  {
    id: "ukraine_2022",
    name: "Russia invades Ukraine — spring 2022",
    teaser: "Europe's biggest diesel supplier becomes untouchable. Diesel cracks go vertical, backwardation explodes and the volatility regime shifts.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2022-02-24", severity: "critical", title: "Russia invades Ukraine", body: "Buyers shun Russian diesel; Europe scrambles for replacement barrels.", regime: "war", diff: [["ARA", "diesel", 4, 60]], structure: [["diesel", 3, 60], ["brent", 2, 45]] },
      { date: "2022-03-01", severity: "warn", title: "IEA members agree a 60 mb emergency stock release", structure: [["brent", -0.8, 20]] },
      { date: "2022-03-08", severity: "critical", title: "US bans imports of Russian oil; Brent spot near record highs" },
      { date: "2022-03-14", severity: "warn", title: "Self-sanctioning reshuffles product tanker trade; MR rates jump (approx.)", tce: [["MR", 0.4, 60], ["LR1", 0.3, 60]] },
      { date: "2022-03-31", severity: "warn", title: "US announces a 1 mb/d SPR release for six months", structure: [["brent", -1, 30]] },
      { date: "2022-06-03", severity: "warn", title: "EU adopts its sixth sanctions package: phased embargo on Russian crude and products", diff: [["ARA", "diesel", 2, 60]] },
    ],
  },
  {
    id: "squeeze_2022",
    name: "Diesel squeeze and price cap — autumn 2022",
    teaser: "French refinery strikes, record-low US East Coast diesel stocks and the start of the EU embargo and G7 price cap on Russian crude.",
    regimeBefore: "war",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2022-10-05", severity: "warn", title: "OPEC+ cuts its production target by 2 mb/d" },
      { date: "2022-10-10", severity: "warn", title: "Strikes at French refineries cut output (approx.)", diff: [["ARA", "diesel", 2, 20], ["ARA", "gasoline", 1, 20]] },
      { date: "2022-11-03", severity: "critical", title: "NY Harbor diesel spikes as East Coast stocks sit at seasonal lows" },
      { date: "2022-12-05", severity: "warn", title: "EU embargo on seaborne Russian crude and the G7 price cap take effect", body: "The product embargo follows on 5 Feb 2023; tonne-miles rise.", tce: [["MR", 0.2, 60], ["LR1", 0.2, 60]] },
      { date: "2023-02-06", severity: "warn", title: "EU embargo and price caps on Russian refined products take effect (5 Feb)", body: "Russian diesel heads to Turkey, Brazil and Africa; Europe imports from further away.", tce: [["MR", 0.2, 45], ["LR1", 0.3, 45], ["LR2", 0.3, 45]] },
    ],
  },
  {
    id: "redsea_2023",
    name: "Red Sea attacks — winter 2023-24",
    teaser: "Houthi attacks push shipping away from Bab-el-Mandeb. Voyages from the East to Europe lengthen by ten days and freight spikes.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2023-12-04", severity: "warn", title: "Houthi attacks on shipping escalate near Bab-el-Mandeb (Galaxy Leader seized 19 Nov)" },
      { date: "2023-12-18", severity: "critical", title: "Major carriers and oil companies pause Red Sea transits; US launches a naval coalition", choke: ["babelmandeb", "restricted"] },
      { date: "2024-01-12", severity: "warn", title: "US and UK strike Houthi targets in Yemen" },
      { date: "2024-01-26", severity: "critical", title: "Product tanker Marlin Luanda hit by a missile in the Gulf of Aden", tce: [["LR1", 0.25, 30], ["LR2", 0.25, 30]] },
    ],
  },
  {
    id: "hormuz_2026",
    name: "War with Iran — 2026",
    teaser: "Strikes on Iran close the Strait of Hormuz. Gulf exports collapse, Brent breaks $100, a ceasefire half-reopens the strait, then the truce collapses. Six months.",
    regimeBefore: "normal",
    choke: { hormuz: "open", babelmandeb: "open", suez: "open" },
    script: [
      { date: "2026-02-28", severity: "critical", title: "US and Israel strike Iran", regime: "war" },
      { date: "2026-03-02", severity: "critical", title: "Strait of Hormuz effectively closed: insurers withdraw cover, tankers struck (approx.)", choke: ["hormuz", "closed"], tce: [["LR1", 0.5, 60], ["LR2", 0.6, 60]] },
      { date: "2026-03-09", severity: "warn", title: "Brent spot above $100 for the first time since 2022 (8 Mar)" },
      { date: "2026-03-16", severity: "warn", title: "IEA coordinates a 400 mb emergency stock release (approx.)", structure: [["brent", -1.5, 30]] },
      { date: "2026-03-16", severity: "warn", title: "China halts new product export deals (approx.)", diff: [["SIN", "diesel", 3, 40], ["SIN", "jet", 3, 40]] },
      { date: "2026-04-13", severity: "warn", title: "Ceasefire: Hormuz partially reopens under escort (approx.)", choke: ["hormuz", "restricted"] },
      { date: "2026-04-20", severity: "warn", title: "Europe's jet scare: warnings of only weeks of jet stocks (approx.)", diff: [["ARA", "jet", 3, 20]] },
      { date: "2026-06-17", severity: "warn", title: "Memorandum on Gulf shipping: more transits allowed under escort" },
      { date: "2026-07-13", severity: "critical", title: "Truce collapses: Hormuz closed again (approx.)", choke: ["hormuz", "closed"], tce: [["LR1", 0.4, 45], ["LR2", 0.4, 45]] },
      { date: "2026-08-10", severity: "warn", title: "Hormuz runs at a fraction of normal traffic, under attack (approx.)", choke: ["hormuz", "restricted"] },
    ],
  },
];

const fromData = (value: number, unit: string, what: string, date: string): Param => ({ value, unit, label: "data", source: REPLAY_SOURCE, method: what, date });

export function makeHistoricalScenario(id: string): Scenario {
  const spec = EPISODES.find((e) => e.id === id);
  if (!spec) throw new Error(`unknown episode ${id}`);
  const data = DATA.find((e) => e.id === id)!;
  const first = data.rows[0]!;
  const normal = SCENARIOS.normal_2025!;
  const r = spec.regimeBefore;
  const fr = MODEL.freight.mean[r];
  const st = MODEL.structure.mean[r];
  const stock = (v: number | null, p: string): Param => (v === null ? est(0, "%", "no stock data: assumed average") : fromData(v, "%", `US ${p} stocks vs 5-year same-week mean`, first.t));
  return {
    id: spec.id,
    kind: "historical",
    name: spec.name,
    description: spec.teaser,
    startDate: data.start,
    weeks: data.weeks,
    regime: r,
    stocks: { gasoline: stock(first.sg, "gasoline"), diesel: stock(first.sd, "distillate"), jet: stock(first.sj, "jet") },
    burnInDays: parseDate(data.start) - parseDate(first.t),
    randomEvents: false,
    replay: spec.id,
    script: spec.script,
    scriptSource: est(`${spec.script.length} dated events`, "-", "public reporting of the period (news, IEA/EIA statements); dates marked approx. are approximate", "event dates are historical; the size of their effects on freight, curves and non-US hubs is an estimate"),
    brent: fromData(first.b, "$/bbl", "Brent spot", first.t),
    cracks: {
      gasoline: fromData(first.g, "$/bbl", "USGC gasoline crack", first.t),
      diesel: fromData(first.d, "$/bbl", "USGC ULSD crack", first.t),
      jet: fromData(first.j, "$/bbl", "USGC jet crack", first.t),
    },
    regimeMeans: {},
    nyhUsgc: { gasoline: fromData(first.ng, "$/bbl", "NYH − USGC gasoline", first.t), diesel: fromData(first.nd, "$/bbl", "NYH − USGC ULSD", first.t), jet: fromData(first.nd, "$/bbl", "NYH − USGC ULSD (proxy for jet)", first.t) },
    nyhMeans: {},
    freight: { MR: fr.MR, LR1: fr.LR1, LR2: fr.LR2 },
    routeMult: ROUTE_MULT_NORMAL,
    choke: { ...spec.choke },
    chokeTransition: {
      hormuz: est({}, "prob/day", "replay: chokepoints change only by script"),
      babelmandeb: est({}, "prob/day", "replay: chokepoints change only by script"),
      suez: est({}, "prob/day", "replay: chokepoints change only by script"),
    },
    structure: { brent: st.brent, gasoline: st.gasoline, diesel: st.diesel, jet: st.jet },
    finance: normal.finance,
    eventRates: normal.eventRates,
    news: [],
  };
}

export type { ProductId };
