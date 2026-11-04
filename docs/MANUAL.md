# Laycan — game manual

Laycan puts you in charge of a physical refined-products trading book. You buy and sell real cargoes of gasoline, diesel and jet fuel, charter tankers to move them between eight hubs, store them, blend them, hedge them with futures, and deal with counterparties who have their own interests. At the end, every dollar of profit or loss is explained.

This manual covers everything in the game: how markets are built, every action you can take, what can go wrong, how you are scored, and how to read the P&L.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Game modes](#2-game-modes)
3. [The screen](#3-the-screen)
4. [How prices work](#4-how-prices-work)
5. [The world: hubs, routes, chokepoints](#5-the-world-hubs-routes-chokepoints)
6. [Fundamentals: refinery runs and stocks](#6-fundamentals-refinery-runs-and-stocks)
7. [Trading cargoes](#7-trading-cargoes)
8. [Counterparties, negotiation and tenders](#8-counterparties-negotiation-and-tenders)
9. [Shipping](#9-shipping)
10. [Diversions at sea](#10-diversions-at-sea)
11. [Storage](#11-storage)
12. [Blending](#12-blending)
13. [Hedging with futures](#13-hedging-with-futures)
14. [Money: cash, credit, margin and payments](#14-money-cash-credit-margin-and-payments)
15. [Events: what can go wrong](#15-events-what-can-go-wrong)
16. [P&L attribution](#16-pl-attribution)
17. [Risk and scoring](#17-risk-and-scoring)
18. [Strategies that work (and some that do not)](#18-strategies-that-work-and-some-that-do-not)
19. [Command-line game](#19-command-line-game)
20. [Glossary](#20-glossary)
21. [Simplifications and honesty notes](#21-simplifications-and-honesty-notes)

---

## 1. Quick start

1. Pick a mode on the start screen. **Generated market** is a fresh, realistic world. **Historical replay** puts you inside a real episode, such as the 2022 diesel crisis. Choose a seed (the same seed always gives the same market) and, for generated markets, a length from 8 to 52 weeks.
2. Look at the **world map**. Each hub shows its price for the selected product. **Green routes** are routes where, at today's prices, the destination pays more than the origin plus freight: the arbitrage is open.
3. Open **Offers & bids**. Under a cargo you can buy FOB (free on board, so you arrange the ship), each possible route shows freight and the arb at today's prices. Click **Buy + ship** to buy the cargo and charter a tanker in one step.
4. Find a buyer at the destination (a **YOU SELL** bid delivered there) and attach it to your voyage, or let the ship discharge into a tank and sell later.
5. Click **Next week**. Days pass, ships sail, prices move, events happen. You decide again each week.
6. Watch the **P&L attribution** panel to see exactly why you made or lost money.

Your first game: start a generated market, buy one FOB cargo where the map shows a green route, sell it delivered at the destination, and do nothing else. Then look at the attribution after the cargo is delivered: you will see the arbitrage you captured, the freight you paid, and how much the market moved while you held it.

---

## 2. Game modes

### Generated market (default)

A realistic world with no real date and no real prices. The game draws a starting regime (calm, stressed or at war), Brent, product cracks, freight rates, inventories and chokepoint states from a model calibrated on twenty years of public data, then runs the market for three months before you start so that charts have history. Dates appear as "Year 1". Every seed is a different world; share a seed (or the URL with `?seed=...`) to play the same one.

Length: 8, 12, 26 or 52 weeks. Longer games mean more regime changes, more events and more time for storage plays.

### Historical replay

Real episodes. The US benchmark prices (Brent, US Gulf gasoline, diesel and jet, New York Harbor spreads) follow the actual daily data, and US refinery runs and stocks follow the actual weekly data. Everything else (other hubs, freight, futures curves) is modelled around them, and the main events of the period happen on their real dates. You cannot change the benchmark path; you can only trade it better or worse.

| Episode | Start | Weeks | What happens |
|---|---|---|---|
| Financial crisis, autumn 2008 | 15 Sep 2008 | 24 | Lehman fails after Hurricane Ike; credit lines shrink; crude halves; contango opens |
| Abqaiq attack, autumn 2019 | 26 Aug 2019 | 19 | Half of Saudi output offline overnight; sanctions on a tanker fleet spike freight; IMO 2020 approaches |
| COVID collapse, spring 2020 | 2 Mar 2020 | 18 | Price war plus pandemic; jet demand vanishes; super-contango; storage is the trade |
| Texas freeze, winter 2021 | 8 Feb 2021 | 17 | A fifth of US refining shuts; the Suez Canal is blocked; the Colonial Pipeline is hacked |
| Russia invades Ukraine, spring 2022 | 21 Feb 2022 | 20 | Europe loses its biggest diesel supplier; diesel cracks and backwardation explode |
| Diesel squeeze, autumn 2022 | 3 Oct 2022 | 20 | French refinery strikes, record-low East Coast diesel, the EU embargoes and price caps |
| Red Sea attacks, winter 2023-24 | 4 Dec 2023 | 14 | Shipping avoids Bab-el-Mandeb; East-to-Europe voyages lengthen; freight spikes |
| War with Iran, 2026 | 23 Feb 2026 | 26 | Hormuz closes, half-reopens under a ceasefire, then closes again |

Headlines summarise public reporting. Dates marked "approx." are approximate.

---

## 3. The screen

**Top bar.** Date, week, equity, P&L, cash and credit line, mode, market regime, and the **Next week** button. **Assumptions** lists every number the model uses, with its source. **Manual** opens this document.

**Left: market.**
- *Prices*: every hub's price for each product in $/bbl; the small number is the hub's differential to the US Gulf. Charts of cracks, Brent and the Europe–US diesel spread.
- *Stocks*: refinery runs and inventories by region against their normal (see section 6).
- *Freight*: every route and variant with $/t, $/bbl, voyage days and war-risk cost; blocked routes are struck through. Charts of tanker earnings.
- *Curves*: futures prices for the next months of each contract.

**Centre: the world map.**
- Hubs with prices for the selected product (switch gasoline / diesel / jet at the top right).
- Routes: green where the arbitrage is open today, grey where it is closed, red dashed where blocked. Hover for freight and arb.
- Diamonds: chokepoints, coloured green (open), amber (restricted) or red (closed).
- Rings around hubs: red if the region is short of the selected product, green if long.
- A dashed ring means you have product in tank there; a purple bubble counts the offers and bids at that hub.
- Ships: your vessels, moving along their routes. Dashed teal lines are diverted voyages. A storm icon marks a port disrupted by a hurricane.
- Click a hub to filter offers to that hub.

**Centre: tabs.**
- *Offers & bids*: this week's deal flow, tenders, and quote requests.
- *Book, storage & hedges*: your deals, voyages (with divert controls), cargo in tank, futures, storage leases, blending and your exposures.
- *Counterparties*: who you trade with, their ratings and your relationship with each.

**Right: P&L attribution, risk and news.** Attribution by bucket (physical and paper), equity chart, return, drawdown, Value-at-Risk, breaches, and the accounting check. Below it, news and alerts.

---

## 4. How prices work

Every price in Laycan is built from additive pieces, in dollars per barrel:

```
hub price  =  Brent  +  crack (product margin at the US Gulf)  +  regional differential (hub vs US Gulf)
forward    =  expected hub price on a future day (the curve)
futures    =  forward for the contract's expiry day
```

**Brent** is the crude anchor. Its volatility clusters (calm periods and turbulent ones), its shocks have fat tails, and it is pulled slowly (half-life about five months) towards a level that depends on the regime: $75 normal, $60 stressed, $110 war. That level is the long-run *average* price in the regime.

**Cracks** are product margins over crude: what a refiner earns by turning a barrel of Brent into gasoline, diesel or jet. Each crack has two speeds, as in the historical data:
- a *physical basis* that clears within one to two weeks (a prompt squeeze, a hurricane spike, a glut of cargoes): about a third to a half of the day-to-day variation;
- a *fundamental level* that moves over months towards the regime's mean (half-lives of three to ten months in normal markets, about two months after a regime change).

On top of these sit the season (gasoline stronger in summer), the US inventory effect (low stocks, higher cracks) and decaying shifts from events such as refinery outages.

**Regional differentials** are where most physical money is made and lost. Each hub is tied to another hub by a shipping route:
- An *importing* hub trades near the anchor price **plus** freight (it must attract cargoes).
- An *exporting* hub trades near the anchor price **minus** freight (its cargoes must be shipped away).
- Most of the time a hub sits a little inside that band: the arbitrage is nearly, but not fully, open.
- When the spread exceeds freight plus costs, cargoes flow and the gap closes within days.
- If a route is blocked (a chokepoint closed), the hub decouples: exporters face a glut and fall, importers face a shortage and rise. A spread can look wide open on paper and be impossible to trade.

**Curves.** A forward price is the market's expectation of the spot price on that day, worked out from the same model that moves spot: the regime may change (a war is expected to end, a crash to recover), Brent reverts to its level, a physical basis fades within days, the fundamental part of each crack drifts back to its mean, stocks refill or drain, the season turns, event shocks decay, and hub differentials return to freight parity. So:
- *Backwardation* (later prices lower) means prices are expected to fall: typical when stocks are low, in a squeeze, or at war.
- *Contango* (later prices higher) means prices are expected to rise: typical in a glut or a crash.
- Futures converge to spot at expiry.
- **The curve is a fair forecast.** Rolling futures earns nothing on average, in any regime. There is no risk premium to harvest: money is made by knowing more than the curve (fundamentals, events, counterparties, logistics), not by owning backwardation.

**How your positions are valued.** Everything is marked on the curve for the date that matters: a floating deal's unpriced days at the forward for each pricing day, an open deal at the forward for its delivery date, a cargo at sea at its destination's forward for the arrival date, futures at the forward for their expiry. Product in tank is marked at today's spot. A cargo at sea in a backwardated market is therefore worth less than spot at its destination, and its value rises towards spot as it approaches, if the market stays where it is.

**Regimes.** The market switches between *normal*, *stressed* (crises with demand collapse and contango) and *war* (high volatility, wide spreads, backwardation, expensive freight). Margins, spreads, freight and counterparty credit all change with the regime.

---

## 5. The world: hubs, routes, chokepoints

### Hubs

| Hub | Region | Role |
|---|---|---|
| USGC — US Gulf Coast | US | Refining surplus, exports diesel and gasoline. Benchmark hub. |
| NYH — New York Harbor | US | East Coast demand hub, NYMEX delivery point. |
| ARA — Amsterdam-Rotterdam-Antwerp | Europe | Gasoline surplus, diesel and jet deficit. ICE Gasoil delivery area. |
| WAF — West Africa (Lagos/Lomé) | West Africa | Imports gasoline; exports diesel and jet since Nigeria's new refinery. |
| MEG — Middle East Gulf (inside Hormuz) | Middle East | Big export refineries; every cargo leaves through Hormuz. |
| FUJ — Fujairah (outside Hormuz) | Middle East | Storage and bunkering hub; avoids Hormuz. |
| SIN — Singapore | Asia | Asian hub and price reference. |
| JPN — Japan (Tokyo Bay) | Asia | Long diesel and jet (exports), short gasoline at the margin. |

### Routes

| Route | From → to | Ship | Notes |
|---|---|---|---|
| TC2 | ARA → NYH | MR | Transatlantic gasoline; a backhaul, usually cheap |
| TC14 | USGC → ARA | MR | Transatlantic diesel; usually dear |
| TC19 | ARA → WAF | MR | Europe → West Africa gasoline |
| WAF-ARA | WAF → ARA | MR | Nigerian exports to Europe |
| TC8 | MEG → ARA | LR1 | Via Suez or the Cape; crosses Hormuz |
| FUJ-ARA | FUJ → ARA | LR1 | Via Suez or the Cape; avoids Hormuz |
| MEG-SIN | MEG → SIN | LR2 | Crosses Hormuz |
| FUJ-SIN | FUJ → SIN | LR1 | |
| TC1 | MEG → JPN | LR2 | Crosses Hormuz |
| JPN-SIN / SIN-JPN | Japan ↔ Singapore | MR | Intra-Asia trade |
| USGC-NYH | USGC → NYH | MR | US coastwise trade needs US-flag ships (Jones Act): expensive |
| USGC-WAF | USGC → WAF | MR | |

Ship classes: **MR** (about 37,000 t), **LR1** (about 65,000 t), **LR2** (about 75,000 t).

### Chokepoints

Hormuz, Bab-el-Mandeb (the Red Sea) and Suez can each be:
- **Open**: normal transits.
- **Restricted**: war-risk insurance premiums (a percentage of the ship's value per transit), convoy delays, and a risk of a security incident (which delays the ship by one to two weeks).
- **Closed**: the route is impossible. Ships reroute (for example via the Cape of Good Hope) if they can; otherwise they wait, at a daily cost, until it reopens. Cargoes inside the Gulf are stranded when Hormuz closes.

Restrictions and closures also raise freight everywhere, because longer voyages absorb ships.

---

## 6. Fundamentals: refinery runs and stocks

The **Stocks** tab shows, for each region (US, Europe, West Africa, Middle East, Asia), refinery runs and the stocks of each product compared with their usual level for the time of year.

How it feeds into everything:
- **Outages cut runs.** A hurricane or refinery fire reduces runs; over the following days and weeks, stocks of every product fall.
- **Low stocks lift prices.** Cracks rise (US stocks are the strongest signal), the short region's premium over its supply hub widens, and curves move into backwardation.
- **Arbitrage refills short regions.** When a region pays more than freight parity, cargoes arrive and its stocks recover.
- **Policy and demand shocks are flows.** An export ban drains a region's stocks at a rate over weeks; a demand collapse fills them up.
- **Deal flow follows.** Long regions offer more cargoes and cheaper; short regions bid more and pay more.

In historical replays, US runs and stocks are the real weekly data. Other regions are modelled.

How to use it: a region that is short and getting shorter (red ring on the map, negative and falling numbers in the table) is where delivered sales pay best and where prices are likely to stay firm. A long region is where to buy, and where storage plays start.

---

## 7. Trading cargoes

### Reading an offer

```
YOU BUY  300 kbbl diesel  FOB USGC  laycan 12 Mar–16 Mar
5 quotes around B/L +0.35 $/bbl · letter of credit · ±5% (your option) · Bayside Refining [BBB]
Index today 135.20 → indicative 135.55 $/bbl.
```

- **Side.** *YOU BUY*: the counterparty sells. *YOU SELL*: the counterparty buys.
- **Quantity** in thousand barrels (kbbl), with a **tolerance** (±5%). Whoever holds the option chooses the final quantity at loading or delivery. When it is *your option*, the game picks the more valuable end for you; when it is *their option*, they pick the end that suits them.
- **Incoterm** (who does what):
  - **FOB** (free on board): the buyer brings a ship to the load port. If you buy FOB, you must charter a ship that arrives within the laycan.
  - **DES / CIF** (delivered): the seller ships the cargo to the destination. If you sell DES, you must get a cargo there. CIF sales are priced around the loading date of your ship.
  - **ITT** (in-tank transfer): a prompt parcel changes hands inside a terminal at the hub. No ship needed.
- **Laycan**: the window in which the ship must arrive (FOB) or the cargo must be delivered.
- **Pricing**: you do not pay today's price. You pay an *index average* plus the premium (or minus the discount):
  - *5 quotes around B/L*: the average of five daily prices centred on the bill-of-lading (loading) date.
  - *5 quotes after B/L*: the five prices from loading onwards.
  - *Month average*: every business day of the delivery month.
  - *Fixed*: a fixed price agreed now.
- **Payment**: a **letter of credit** (you pay a fee to your bank when you buy; buyers' banks guarantee payment, but documents can be held up) or **open account** (no fee, but the buyer might not pay). Payment is due 30 days after delivery, or after the last pricing day if later.

### Pricing risk: the most important idea in the game

A floating-price purchase has **no price risk** until its pricing window starts, because you will pay whatever the market is then. Your exposure builds up only as the quotes fix. The **Exposure** table in the Book tab always shows your true exposure by price component. Watch it before you hedge.

A mismatch between the pricing of a purchase and the sale it feeds is real risk. Buying on "5 quotes around loading" and selling on "month average" leaves you exposed for the days between.

### Deal flow

Each week you receive about nine offers and bids from different counterparties. They expire at the next weekly decision point. You can also **ask for a quote** for a specific product, hub, side and incoterm. You will usually get one, but at a wider premium: you showed your hand.

---

## 8. Counterparties, negotiation and tenders

### Who you trade with

| Counterparty | Type | Rating | Where | Character |
|---|---|---|---|---|
| Meridian Energy | Major | A | USGC, ARA, SIN, NYH, JPN | Well informed, rarely leaves money on the table |
| Northgate Petroleum | Major | A | ARA, NYH, WAF | Atlantic-basin major with a big gasoline position |
| Bayside Refining | Refiner | BBB | USGC, NYH | Places surplus barrels around run cuts; flexible |
| Rhine Delta Refinery | Refiner | BBB | ARA | Long gasoline, short diesel |
| Gulf Crown Refining Co. | National oil company | A | MEG, FUJ | Sells by tender; does not haggle |
| Coastal National Oil Co. | National oil company | BB | WAF | Buys gasoline by tender; local LCs can be slow |
| Straits Petroleum | Refiner | BBB | SIN, FUJ, JPN | Active in Singapore and Fujairah |
| Kanto Bay Refining | Refiner | A | JPN | Exports diesel and jet; precise and reliable |
| Kestrel Trading | Trader | B | Everywhere | Sharp prices on open account; credit is your problem |
| Cobalt Energy Trading | Trader | BB | ARA, WAF, USGC | West Africa focus |
| Atlas Aviation Fuels | End user | A | ARA, NYH, SIN | Pays up for reliable jet; never defaults |
| Lowlands Distribution | End user | BBB | ARA, NYH | Buys prompt barrels into its network |

All counterparties are fictional.

- **Ratings** set the chance that a buyer on open account fails to pay: about 0.2% per invoice for A, 0.6% for BBB, 2% for BB and 6% for B, three times higher in a stressed market and 50% higher in war. A default recovers 30% after legal costs.
- **Reliability** is the chance a seller delivers on time. Late deliveries arrive two to seven days late.
- **Off-spec risk**: some sellers' cargoes fail inspection and are worth $1.5–3.5/bbl less.
- **Letters of credit** from weaker banks (BB and B issuers) run into document discrepancies more often (15% against 6%), delaying payment by about ten days.

### Negotiation

Every offer has a hidden **reservation price**: the worst premium the counterparty will accept. It depends on the counterparty, the market regime, how long or short the region is, and your relationship.

Type a premium in the box under an offer and press **Counter**:
- At or better than their reservation, they **agree**. The offer is then yours to take at that price.
- Otherwise they may **come back** halfway (never past their reservation), or **walk away**. Patient counterparties (traders, refiners) keep talking; national oil companies and majors rarely do. After three rounds they always walk.
- Walking away costs a little goodwill.

### Relationships

Every completed, paid deal improves your relationship with that counterparty; failing to lift a cargo or to deliver one damages it badly, and late delivery damages it a little. Good relationships bring more offers, better reservation prices and more patience. A badly damaged relationship (below −0.5) means they stop dealing with you. The **Counterparties** tab shows each relationship.

### Tenders

National oil companies run sealed-bid tenders, announced in the news and shown at the top of Offers:
- **Coastal National Oil Co.** buys gasoline delivered to West Africa: the **lowest** premium wins.
- **Gulf Crown Refining Co.** sells diesel FOB in the Gulf: the **highest** premium wins.

Submit a premium before the closing date (three business days). Between three and six competitors bid around the market-clearing level, which depends on the regional fundamentals. If you win, the deal appears in your book and you must perform it like any other.

---

## 9. Shipping

### Chartering

Use **Buy + ship** on an FOB offer, or **Ship on ...** under cargo in tank. You charter a voyage on a route; the cheapest open variant is chosen (or you pick Suez or the Cape). The voyage charter costs a lump sum, booked as freight when you fix the ship and paid at loading. You also pay war-risk premiums for restricted chokepoints.

### How freight is priced

There are no free published freight indices, so freight is rebuilt from first principles:

```
cost per tonne = (daily earnings × days at sea laden and in ballast + days in port
                  + fuel + port costs + canal fees) ÷ cargo tonnes  + war-risk premium
```

Daily earnings for each ship class drift with the market, jump on shocks and rise when chokepoints are restricted. Some routes are cheaper than others for the same ship because ships want to end up where the next cargo is (TC2 is a backhaul; TC14 is in demand).

### A voyage, step by step

1. **Fixed**: the ship heads to the load port and arrives within the laycan.
2. **Loading**: about a day and a half, sometimes longer (port congestion). The bill of lading (B/L) is issued: title passes, pricing windows anchored on B/L start fixing, and freight is paid.
3. **Sailing**: the cargo now belongs to the destination market. Its value is measured at the destination price, so the *arbitrage* shows up in your P&L at loading. Weather can add days; a security incident in a restricted chokepoint can add one to two weeks.
4. **Discharging**: about a day and a half. Then the cargo is delivered to your buyer, or into your tank if you have no buyer yet.

### Laytime and demurrage

Each charter includes laytime: 72 hours in port for an MR, 84 for an LR1, 96 for an LR2 (loading and discharging combined). Time in port beyond that costs **demurrage** at roughly the ship's daily earning rate. Port congestion and hurricanes are the usual causes.

### Delivering sales

A delivered sale at a hub is fulfilled by your ship discharging there (attach it when you accept the sale, or it is matched automatically on arrival), or from your tank at that hub. An FOB sale or ITT sale is fulfilled from your tank at the hub.

---

## 10. Diversions at sea

A laden ship can be sent somewhere else. Open **Divert…** under a sailing voyage:
- Each possible destination shows the price difference against the current destination, extra (or saved) days, the cost, and the net gain per barrel.
- The ship joins the sea route from its load port to the new hub at the nearest point, crossing open water from where it is.
- You pay extra days of hire and fuel (no refund if the new trip is shorter), a $25,000 diversion fee and any new war-risk premiums.
- A diversion is blocked if the new leg needs a closed chokepoint.
- The cargo is re-valued at the new destination immediately: the gain appears in **optionality**, the cost in **freight**.
- If the voyage was delivering a sale at the old destination, that sale is released and you must find another cargo for it, or face a penalty.

---

## 11. Storage

- **Lease tank capacity** at any hub (Book → Storage). Leases are take-or-pay: you pay for the full capacity every day of the term, used or not. Rents rise when the market is in contango, because storage is then valuable to everyone.
- Product in tank above your leased capacity pays **spot tankage**, 1.6 times the lease rate.
- **Buy in tank (ITT)** offers are prompt parcels you can put straight into storage. Delivered purchases also land in your tank.
- **Sell spot now** sells a parcel from your tank immediately to a merchant at the index minus $0.60/bbl, paid in five days.

### The cash-and-carry trade

When the curve is in steep contango, you can buy prompt product, store it, and sell futures for later delivery. The **carry** table shows, for each hub and product, the monthly contango against rent and interest on the barrels:

```
net carry per month  =  contango  −  storage rent  −  financing (price × interest rate ÷ 12)
```

Positive net carry is a profitable storage trade, as long as you hedge the price. In backwardation, holding inventory costs you twice: the curve against you, plus the rent.

---

## 12. Blending

At ARA, Singapore, the US Gulf or New York you can blend gasoline from refinery components in your leased tank (Book → Blending). You need free leased tank space for the volume.

| Component | Strength | Weakness |
|---|---|---|
| Butane | cheap octane | very volatile (vapour pressure), limited in summer |
| Light virgin naphtha | cheap | low octane |
| Isomerate | clean | volatile |
| Reformate | high octane | aromatics and benzene are capped |
| FCC (cat) gasoline | the workhorse | olefins are capped |
| Alkylate | clean premium octane | expensive |
| Ethanol | very high octane | capped at 10% and by oxygen; pricier in Europe |

Grades:
- **ARA and Singapore**: EN 228 E10, 95 RON. RON ≥ 95, MON ≥ 85, aromatics ≤ 35%, olefins ≤ 18%, benzene ≤ 1%, oxygen ≤ 3.7%, ethanol ≤ 10%, sulphur ≤ 10 mg/kg. Vapour pressure 45–60 kPa in summer, 60–90 kPa in winter.
- **US Gulf and New York**: US regular 87 ((R+M)/2 ≥ 87). Vapour pressure ≤ 62 kPa in summer, ≤ 93 kPa in winter; sulphur ≤ 10; benzene ≤ 1%; ethanol ≤ 10%.

Summer runs from 1 May to 15 September.

Octane blends in proportion to volume; vapour pressure blends through an index (RVP^1.25); sulphur and oxygen blend by mass.

How to play: press **Optimise** to see the cheapest recipe that meets every specification (a linear program). Then edit the shares yourself and watch the specification table. The panel shows your cost against the optimiser's and against the price of finished gasoline. Blending costs a $0.35/bbl fee. An off-spec batch is marked down by $2/bbl plus $1 for every failed specification.

Margins are thin in summer, when the vapour-pressure limit keeps cheap butane out, and fatter in winter.

---

## 13. Hedging with futures

| Contract | Exchange | Lot | Quoted in | Follows | Last trading day |
|---|---|---|---|---|---|
| RB — RBOB Gasoline | NYMEX | 1,000 bbl | $/gal | New York gasoline | last business day of the month before delivery |
| HO — NY Harbor ULSD | NYMEX | 1,000 bbl | $/gal | New York diesel | last business day of the month before delivery |
| GO — Low Sulphur Gasoil | ICE | 100 t (745 bbl) | $/t | ARA diesel | two business days before the 14th of the delivery month |
| BRN — Brent | ICE | 1,000 bbl | $/bbl | Brent | last business day of the second month before delivery |

Choose the contract, month and number of lots, then **Buy** or **Sell**. **Close** flattens a position. Positions still open at expiry are cash-settled.

- **Initial margin** is held from your cash: 8% of the position's value in a normal market, 12% stressed, 14% at war.
- **Variation margin** is settled every day. A position can be right and still drain cash.
- **Fees**: $3 per lot.

How to hedge well:
- Sell futures against barrels you own or have bought at a fixed or already-fixed price. Buy futures against fixed-price sales.
- Hedge what is *priced*, not what is *bought*. Check the Exposure table first.
- Hedge with the contract that follows the market you are exposed to: ARA diesel with GO, New York with HO and RB. The leftover risk between your hub and the contract's hub is *basis*.
- Hedge in the month that matches when your barrels price or are delivered. Your physical marks sit on the same curve, so a well-matched hedge leaves little time-spread risk.
- In backwardation, inventory in tank is expected to lose value as spot falls towards the curve. Selling it forward (futures, or a fixed-price sale) locks the curve in; the futures themselves earn nothing on average.

---

## 14. Money: cash, credit, margin and payments

- **Starting equity**: $50 million.
- **Credit**: a $40 million revolving line plus 80% of the value of your inventory and receivables (a borrowing base). Negative cash costs 7.2% a year; positive cash earns 3.5%.
- **Letters of credit**: opening one costs 0.15% of the cargo value. Your facility is $250 million.
- **Margin calls**: if cash falls below your credit limit while you hold futures, the broker closes all your futures positions at market (with extra fees). Without futures, you pay penalty interest (5% more) until you are back inside the limit. Every day beyond the limit counts as a credit breach in your score.
- **Payments**: invoices settle 30 days after delivery, or after the last pricing day if that is later.

---

## 15. Events: what can go wrong

**Your operations**
- Late arrival, slow loading, weather, port congestion → **demurrage**.
- Off-spec cargo at loading (3% of voyages) or from an unreliable seller → value lost.
- In-transit loss of 0.05–0.4% of the cargo at discharge.
- Security incident in a restricted chokepoint → one to two weeks' delay.
- Chokepoint closure → reroute at your cost, or wait at your cost.
- Failure to lift: no ship within the laycan → contract cancelled, $2/bbl penalty, relationship damaged.
- Failure to deliver: no cargo within five days after the laycan → buyer cancels, $3/bbl penalty, and you lose the contract's value.
- Late delivery → $0.50/bbl claim. Short delivery below tolerance → $3/bbl on the missing barrels.
- Buyer default on open account; LC document discrepancies.

**The market**
- **Hurricanes** (June–November, peaking in August–September): US Gulf refining and ports shut, US cracks jump, stocks drain over the following weeks.
- **Refinery outages** at any hub; **drone strikes** on Russian refineries (Europe's diesel premium widens) or Gulf facilities.
- **Export bans and quotas** (Russia, China): the importing region's stocks drain over weeks.
- **Emergency stock releases** in crises: Brent falls, backwardation eases.
- **Cold snaps** in winter: gas-to-oil switching lifts diesel.
- **Chokepoint changes**: escalations and reopenings.
- **Regime changes**: calm to stressed to war and back.
- **Black swans** (rare): demand collapse, a big supply outage, a tanker-market squeeze, or a trade-finance squeeze (LC fees more than double and your credit line is cut by 40% for two months).

---

## 16. P&L attribution

Every day, the change in your equity is split exactly into buckets, each shown for physical positions and for paper (futures):

| Bucket | What it measures | Example |
|---|---|---|
| Flat price | Brent moves on your net exposure | You hold an unhedged cargo; Brent falls $5 |
| Crack | Product margin moves | Diesel crack rises while you are long diesel |
| Regional / arb | Location spreads, including the arbitrage captured when a cargo is loaded for a dearer destination | US Gulf diesel loaded for ARA, worth $9/bbl more there |
| Time spread & carry | Changes in curve shape, roll-down of futures and forward-marked cargoes towards delivery, storage rent | A cargo at sea in backwardation rolls up towards spot as it nears arrival |
| Quality | Off-spec, grade discounts, blending margins | Blended gasoline worth $0.70/bbl more than its components |
| Freight | Charter costs, war-risk premiums, deviation costs | A $3m TC14 voyage |
| Optionality | Tolerance choices, pricing windows revealed at loading, diversion gains | Diverting to a hub $2/bbl dearer |
| Deal edge | Premiums and discounts agreed against the index | Buying at index −$0.50 |
| Events | Demurrage, losses, defaults, penalties, reroutes | Four days over laytime |
| Finance | Interest, LC fees, exchange fees | Overdraft interest during a long voyage |

How it works: prices are additive, so the book can be re-valued with only Brent updated, then cracks, then regional differentials, then curves and time. The differences add up exactly. Every action and event is measured as equity after minus equity before. The **Accounting check** row shows the largest unexplained daily difference; it should read "exact".

Reading a typical arbitrage:

```
Regional / arb   +$2.9m   the destination paid more than the origin when the cargo loaded
Freight          −$2.4m   the charter
Deal edge        −$0.1m   the premium you paid the seller
Crack            −$0.6m   diesel weakened while the cargo floated
Events           −$0.1m   one day of demurrage
Finance          −$0.05m  interest until the buyer paid
```

---

## 17. Risk and scoring

- **Value-at-Risk (VaR)**: a one-day, 99% estimate of how much the book could lose, from your exposures and current volatility. The limit is $6 million; every business day above it counts as a breach.
- **Max drawdown**: the largest fall in equity from a previous peak.
- **Credit breaches**: days with cash below your credit limit.
- **Score** at the end:

```
risk-adjusted score = P&L ÷ max(max drawdown, 2% of starting equity)
                      − 0.1 × VaR breach days − 0.5 × credit breach days
```

A modest profit with small drawdowns and no breaches beats a large profit earned by betting the firm. Replay the same seed to compare strategies on an identical market.

---

## 18. Strategies that work (and some that do not)

**Arbitrage done right.** Buy FOB where the region is long and the route is green, sell delivered where the region is short, and line up the pricing windows so that what you pay and what you receive fix at similar times. Hedge any mismatch. Prices usually sit just inside freight parity, so shipping on every route every week loses money: wait for the green.

**Storage in contango.** When the carry table shows positive net carry (often in stressed regimes or when stocks are high), lease tanks, buy prompt ITT parcels and sell futures several months out. Exit as the contango collapses or the futures approach expiry.

**Blending margin.** In winter, blends rich in butane can beat the price of finished gasoline by a couple of dollars a barrel. In summer the margin is thin; check the optimiser before committing tank space.

**Destination optionality.** Buy FOB with your own ship rather than selling delivered in advance: you keep the right to divert to whichever market pays best, at a known cost.

**Tenders.** Know the regional fundamentals: when West Africa is short of gasoline, the clearing premium is higher, so a slightly lower bid still wins with a margin.

**Counterparties.** Negotiate with patient counterparties, take the A-rated buyers' bids when you would otherwise sell on open account to a B-rated trader, and never miss a laycan: it costs money and goodwill.

**Common mistakes**
- Hedging a floating purchase the day you buy it: you are now short until it prices.
- Holding unhedged tank inventory in steep backwardation: spot is expected to fall towards the curve.
- Shipping on every route every week: shipping whenever a bid exists loses money on average; checking freight, financing, quantities and laycans first earns a modest edge.
- Selling delivered without a ship or cargo to deliver it.
- Letting cash fall below the credit line while holding futures: forced liquidation at the worst moment.
- Buying Gulf cargoes inside Hormuz when the strait is restricted: if it closes, you are stranded.

---

## 19. Command-line game

```bash
npm run play -- --seed 42                         # generated market, 12 weeks
npm run play -- --seed 42 --weeks 52              # a full year
npm run play -- --scenario covid_2020 --seed 42   # a historical replay
npx tsx packages/cli/src/main.ts list             # all modes and episodes
npx tsx packages/cli/src/main.ts assumptions      # the assumptions sheet
```

| Command | What it does |
|---|---|
| `m`, `market` | hub prices, cracks, chokepoints |
| `f`, `freight` | route freight |
| `curve` | futures curves |
| `stocks` | regional runs and stocks vs normal |
| `o`, `offers` | offers and bids, with the arb for each FOB purchase |
| `accept <offer> [route] [suez\|cape]` | accept an offer; name a route to charter for an FOB purchase |
| `counter <offer> <premium>` | negotiate |
| `tenders`, `bid <tender> <premium>` | see open tenders, submit a bid |
| `assign <sale> <voyage>` | deliver a sale with a voyage |
| `charter <route> <product> <days ahead>` | lift product from your tank |
| `divert <voyage> [hub]` | list diversion options, or divert |
| `lease <hub> [kbbl] [months]` | lease tank capacity |
| `spot <cargo>` | sell a tank parcel now |
| `carry` | storage economics |
| `blend <hub> [kbbl]` | show the optimal blend, or blend |
| `fut <RB\|HO\|GO\|BRN> <month #> <lots>` | trade futures (negative lots to sell) |
| `b`, `book` / `p`, `pnl` / `x`, `exposure` | positions, attribution, exposures |
| `cpty` | counterparties and relationships |
| `n`, `next` | run to next week |
| `save <file>` | save the game (resume with `--load <file>`) |

---

## 20. Glossary

- **Arbitrage (arb)**: buying where a product is cheap and shipping it to where it is dear, when the price difference beats freight and costs. "The arb is open."
- **Backwardation / contango**: prompt prices above / below later prices.
- **Basis**: the difference between your physical price and the futures contract you hedge with.
- **B/L (bill of lading)**: the shipping document issued at loading; it transfers title and often anchors pricing.
- **Crack**: a product's price minus crude's price, in $/bbl.
- **Demurrage**: what the charterer pays per day when a ship spends longer in port than the laytime.
- **DES / CIF / FOB / ITT**: delivered ex ship / cost, insurance and freight / free on board / in-tank transfer.
- **Differential (diff)**: a hub's price minus the US Gulf price for the same product.
- **Laycan**: the window in which a ship must arrive to load (or a cargo must be delivered).
- **Laytime**: the time allowed in port before demurrage starts.
- **LC (letter of credit)**: a bank's guarantee of payment against shipping documents.
- **MR / LR1 / LR2**: tanker sizes, medium range and long range.
- **Off-spec**: failing a quality specification.
- **Pricing window**: the days whose prices are averaged to set a cargo's price.
- **Regrade**: the price difference between jet and diesel.
- **RVP**: Reid vapour pressure, the volatility specification of gasoline.
- **Tolerance**: the allowed deviation from the nominal quantity (±5%), an option held by one side.
- **Turnaround**: planned refinery maintenance.
- **TCE (time-charter equivalent)**: a ship's daily earnings after voyage costs.
- **VaR**: Value-at-Risk, an estimate of a bad-day loss.

---

## 21. Simplifications and honesty notes

- Prices outside the US are modelled around freight parity and regional stocks; there is no free daily price data for Europe or Asia. Futures curves are modelled everywhere.
- You are a price-taker: your trades do not move the market.
- Each product has one curve for Brent and the crack, shared across hubs; each hub's differential reverts to its own parity target along it.
- Curves carry no risk premium, so they are a fair forecast and flatter than real ones in extreme markets. In November 2026 the model's front spreads are about $1.2/bbl/month for Brent and $1.8 for diesel, against roughly $3 and $6.5 observed: real backwardation also pays for the risk of holding inventory, which the game does not reward.
- Diversions approximate the open-water leg from the ship's position to the new route.
- Only gasoline can be blended.
- Many parameters (counterparty behaviour, war-risk premiums, component prices, event sizes, storage rents) are informed estimates. The **Assumptions** sheet lists every number with its label (`data`, `derived` or `estimate`) and its source.
- Historical replays follow real US prices and stocks exactly; everything else in a replay is modelled, and some event dates are approximate.
- Laycan is an educational simulation, not investment advice.
