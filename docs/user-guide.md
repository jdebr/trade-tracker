# Swing Trader — User Guide

A personal assistant for finding and monitoring swing trades. It does **not** execute trades — all buy/sell decisions and order placement happen in your brokerage separately.

**🔗 App:** https://trade-tracker-blush.vercel.app
**API:** https://trade-tracker-t1ee.onrender.com (backend — `/docs` for the interactive API reference)

> First load after a quiet spell can take 30–60s while the backend wakes from sleep (Render starter tier). That's normal.

---

## Contents

1. [First-Time Setup](#first-time-setup)
2. [Weekly Workflow](#weekly-workflow)
3. [Planning a Trade](#planning-a-trade)
4. [Pages](#pages)
   - [Watchlist](#watchlist)
   - [Screener](#screener)
   - [Charts](#charts)
   - [Alerts](#alerts)
   - [Positions](#positions)
   - [Reports](#reports)
   - [Signals](#signals)
   - [Settings](#settings)
5. [Scheduler Controls](#scheduler-controls)
6. [Alert Types Reference](#alert-types-reference)
7. [Troubleshooting](#troubleshooting)
8. [Technical Reference](#technical-reference)

---

## First-Time Setup

These steps are only needed once on a fresh install.

### 1. Sync the ticker universe

The app needs to know about the ~500 S&P 500 tickers before you can add any to your watchlist or run the screener.

Go to the **Screener** page → click **admin** → click **Refresh Data**.

This fetches price history and computes indicators for all tickers. It takes several minutes. Wait for the status to show completion before continuing.

> **Tech note:** "Refresh Data" calls `POST /screener/refresh-data`, which runs `run_data_refresh()` — bulk OHLCV fetch via yfinance + indicator computation for all ~505 symbols. Safe to re-run; already-fresh symbols are skipped.

### 2. Run the screener

Once data is refreshed, click **Screen Tickers** on the Screener page. This scores and ranks all tickers by signal strength. Results are ready in a few seconds.

### 3. Add tickers to your watchlist

From the Screener results, click **+** next to any symbol to add it to your watchlist. Or go to the **Watchlist** page and type a symbol directly into the search box.

You need at least one watchlist ticker before the Watchlist readings or Charts will show anything.

### 4. Run your first scan

Go to the **Watchlist** page and click **Update Now**. This fetches fresh price data and indicator values for your watchlist, and fires any alerts that apply.

---

## Weekly Workflow

### Sunday evening (~15 min)

1. Open the **Screener** page. Results from Saturday night's automatic run are waiting.
2. Review the top candidates — highest scores appear first.
3. Click through 2–3 finalists on the **Charts** page to review the setup.
4. Add your picks to the watchlist. Remove any tickers you're no longer watching.
5. Decide on 1–2 trades for Monday entry.
6. For each one, click the **target icon** to [plan the exit](#planning-a-trade) — stop, target, and share count — before the market opens.

### Monday–Friday (~5 min/day)

1. Check the **Alerts** page. Look at the **Positions** tab first — those are trades you already have money in.
2. Check the **Positions** page to see where each open trade sits between its stop and its target.
3. Review the **Watchlist** table for current indicator levels on your tickers.
4. Decide: hold, adjust the stop, or close.
5. If you closed something in your brokerage, **record it on the Positions page** while you still remember the fill price.

The EOD scan runs automatically at **4:15 PM ET** each weekday and generates alerts if conditions are met. Intraday price alerts fire at 9:30, 11:00, 12:30, 2:00, and 3:30 PM ET.

### Friday

Close remaining positions before market close. Record the exits. Clean up your watchlist.

### Monthly

Open the **Reports** page and look at what's actually working — especially the signal table. After enough closed trades, it'll start telling you which of your setups earn their keep and which don't.

---

## Planning a Trade

When you find a candidate worth trading, click the **target icon** next to it on the Screener or Watchlist page. This opens the **exit plan builder**, with the entry price pre-filled to the latest close (adjust it to where you actually plan to enter).

The idea is simple: decide where you'll get out *before* you get in — both when you're wrong (the stop) and when you're right (the target).

### The one concept worth understanding: R

**R is the amount of money you're risking on the trade.**

If you buy at $100 and set your stop at $94, you're risking $6 per share. Buy 16 shares and you're risking $96. That $96 is **1R**.

Everything else is measured against it:

- Stopped out → you lose 1R
- Price hits $112 (twice your risk above entry) → you made **2R**
- Price hits $118 → **3R**

Why bother? Because it makes trades comparable. A $200 win on a small trade and a $2,000 win on a big one are both "+2R" — so you can average them together and see whether your *strategy* is working, separate from how much money you happened to put on.

### How many shares should I buy?

The app works this out for you. You tell it two things (on the **Settings** page):

- How big your account is
- What percentage you're willing to risk per trade (1% is the usual starting point)

From there, the share count falls out of where your stop is. A **tight stop means more shares**; a **wide stop means fewer**. Either way, the dollars you're risking stay the same.

That's the whole point — it's what keeps one bad trade from doing real damage.

### Choosing a stop

The builder shows you every stop level side by side so you can compare them, not just accept one:

| Method | Where it puts the stop |
|---|---|
| **ATR Multiple** (default) | Below entry by a multiple of the stock's typical daily range. Wider for jumpy stocks, tighter for calm ones. |
| **Fixed %** | A set percentage below entry. Simple, but ignores how volatile the stock actually is. |
| **Lower Bollinger Band** | At the lower band. A break below suggests the move has failed. |
| **EMA 21 / EMA 50** | At a moving average. Keeps you in while the trend holds. |
| **Swing Low** | At the lowest low of the last 10 days. |
| **Manual** | You type in a price. |

The default (2× ATR) is a reasonable starting point and the most common choice among swing traders.

### Choosing a target

| Method | Where it puts the target |
|---|---|
| **R Multiple** (default) | A multiple of what you're risking. 2R aims to make twice what you'd lose. |
| **ATR Multiple** | A multiple of the stock's typical range above entry. |
| **Fixed %** | A set percentage above entry. |
| **Upper Bollinger Band** | At the upper band — a natural resistance level. |
| **Manual** | You type in a price. |

### What the warnings mean

The builder will flag a plan without blocking it:

- **"Reward-to-risk is below 1.5:1"** — you're risking more than the trade stands to make. Usually worth rethinking.
- **"Position is X% of the account"** — too much money in one name.
- **"Stop is X% below entry"** — an unusually wide stop for a swing trade.
- **"This trade would be 0 shares"** — your risk budget is too small for a stop that far away. Tighten the stop or raise the risk percentage.

One thing it *won't* let you do is set a stop above your entry price. That isn't a plan — there'd be no risk to measure anything against.

### Simulated vs. real

**New positions are simulated by default.** Nothing is at stake; the app just tracks what *would* have happened.

This is the recommended way to start. Trade on paper for a few weeks, then check the **Reports** page to see whether your setups actually make money before putting real cash behind them.

To record a real trade, tick **Real money** in the builder. Simulated and real results are always kept separate in reports.

> **Tech note:** The builder calls `POST /positions/plan` on every input change — a pure calculation with nothing saved. Confirming calls `POST /positions`, which recomputes the risk figures server-side from (entry, stop, shares) rather than trusting the browser. `initial_stop_price` is frozen at that moment and never changes, even if a trailing stop later moves the live stop up — it's the denominator for every R figure the trade will ever report.

---

## Pages

### Watchlist

Your daily check-in view. One page to **manage** the tickers you're tracking and **read** their current indicator levels. (This combines what used to be two separate pages.)

**The table** — one row per ticker, showing:

| Column | What it shows |
|---|---|
| Symbol | Ticker; hover for company name. A green **Open** badge appears if you hold a position in it. |
| Price | Latest close from the cache |
| RSI | 14-day RSI. Red ≥ 70 (overbought), Blue ≤ 30 (oversold), Green 35–65 (neutral range) |
| BB Squeeze | Filled dot = squeeze active (bands are tight; breakout may be coming) |
| MACD Hist | Histogram value. Green = positive momentum, Red = negative |
| EMA 50 | Price relative to the 50-day EMA |
| ATR | 14-day Average True Range (volatility measure) |
| Actions | 🎯 **Plan a trade** (opens the exit builder) · 🗑 **Remove** from the watchlist |

**Sorting:** click any column header to sort by it; click again to flip ascending/descending. (The closed-positions table on the Positions page works the same way.)

**Adding a ticker:**
- Type in the symbol search box — it fuzzy-matches against the full S&P 500 universe by default.
- Switch to **Screener** mode in the toggle below the box to limit suggestions to your latest screener results.
- The **Add** button stays disabled until you've selected a valid ticker from the list.
- Optionally type or pick a group name (e.g. "Tech", "Open positions") to organize your list.

**Removing a ticker:**
- Click the trash icon on any row. A confirmation dialog appears before anything is deleted.
- If the removal fails, the ticker reappears automatically (optimistic update with rollback).

**Filtering by group:** use the pill buttons above the table. Click **All** to clear the filter.

**Updating the data** (the status bar at the top):
- Click **Update Now** to fetch fresh prices and re-evaluate alert conditions immediately.
- The button is disabled during cooldown (60 min after any update) and while the scheduler is paused.
- **Last update / Next update** — when the most recent update ran, and the next scheduled one.
- **API credits** — Twelve Data usage (e.g. `42/800`). **Paused until** shows in amber when paused.

**Common errors:**
- *"That symbol is already in your watchlist"* — it's already there, no action needed.
- *"Symbol not found in the universe"* — the ticker isn't in the `tickers` table. Run **Refresh Data** on the Screener admin panel, then try again.

---

### Screener

Ranks the full S&P 500 universe by signal score so you can find trade candidates each week.

**The results table:**

| Column | What it shows |
|---|---|
| # | Rank (1 = strongest signal) |
| Symbol | Ticker; hover for company name |
| Score | `achieved / max` badge plus a normalized % (e.g. `3/4 · 75%`) |
| Close | Most recent closing price |
| Signals | One dot per signal — filled (green) means the condition is true for that ticker; hover a dot for what it means |

**The score is now data-driven.** The signals it counts, and the maximum it scores out of, come from whatever you've enabled on the [Signals](#signals) page — not a fixed set of four. Out of the box there are four seeded signals (BB Squeeze, RSI in Range, Above EMA 50, Volume Expansion), so a fresh install scores out of 4. Add or disable signals and the columns and the denominator change with them.

- **`achieved / max`** — how many weighted points fired, out of the most attainable given the signals live when the run happened.
- **The normalized %** is the same thing as a 0–100% fraction. Because it's frozen per run, a `75%` from a four-signal era and a `75%` from a six-signal era are directly comparable — useful once you've changed your signal set over time.

Older results generated before this change still display correctly, scored out of 4.

**Running the screener:**
- Click **Screen Tickers**. Results appear in a few seconds — the screener reads from cached data, no API calls needed.
- Results update in place; the run timestamp shows when they were last generated.

**Adding to watchlist:**
- Click **+** on any row to add a ticker. The button turns into a green checkmark once added.

**Admin panel** (click "admin" to expand):
- **Refresh Data** — re-fetches OHLCV and recomputes indicators for all tickers. Use this when data is stale (e.g. after a long gap or on first setup). Takes several minutes.
- **Recompute Indicators** — recomputes indicators from cached OHLCV without re-fetching price data. Faster than a full refresh.

The screener also runs **automatically every Saturday night** so results are ready before your Sunday review. You rarely need to trigger it manually.

**Changed your signals?** Adding, enabling, or reweighting a signal only affects *future* runs — past results keep the scores they were computed with. Click **Screen Tickers** to re-score with your current signal set. See [Signals](#signals).

---

### Charts

Candlestick chart with technical overlay support for any ticker on your watchlist.

**Selecting a symbol:**
- Ticker pills at the top of the page. The first symbol is selected automatically on load.

**Chart controls:**
- **Candlestick / Line** toggle — switch chart style
- **1M / 3M / 6M / 1Y / All** — zoom range
- **BB Bands** toggle — show/hide Bollinger Bands (upper, middle, lower)
- **EMAs** toggle — show/hide EMA ribbon (EMA 8 in amber, EMA 21 in green, EMA 50 in blue)
- **TradingView** link (top right) — opens the symbol on TradingView.com for deeper analysis

**If the chart is empty:**
- *"No chart data"* — the ticker hasn't been updated yet. Go to Watchlist → Update Now, then come back.
- *"No bars found for the selected range"* — the zoom range is narrower than the available data. Try a wider range (e.g. All).

---

### Alerts

All unacknowledged signal alerts from the EOD scan and intraday poller.

**Alert cards show:**
- Symbol and alert type (color-coded badge)
- Price at the time the alert fired
- Date and time
- Supporting indicator values (e.g. the RSI value that triggered an RSI alert)

**Acknowledging alerts:**
- Click the checkmark on an individual alert to dismiss it.
- Click **Clear All** to dismiss everything at once.
- Acknowledged alerts disappear from this view. The unread count in the nav badge clears when all are acknowledged.

**Two kinds of alert.** The tabs at the top separate them:

- **Opportunities** — "here's a trade you might want to take." These come from the screener and the daily watchlist update.
- **Positions** — "a trade you're already in just hit something." A stop, a target, a time limit. These have a coloured spine down the left edge and usually want action today.

See [Alert Types Reference](#alert-types-reference) for what each alert means and how to act on it.

---

### Positions

Everything you're currently in, and everything you've closed.

**Open positions** show as cards. Each one has a bar running from your stop (left, red) through your entry to your target (right, green), with a dot showing where the price is now. At a glance you can see whether a trade is heading for the exit or the payday.

You'll also see:

- **Unrealized R** — how much you're up or down, measured in units of what you risked. `+1.00R` means you're up by the amount you'd have lost if stopped out.
- **Risk (1R)** — the dollar amount on the line.
- **SIM / LIVE** badge — whether this is a paper trade or real money.

**Closing a trade.** Click **Close** — the exit price is pre-filled with the ticker's last known close; change it to the price you actually got filled at, and pick a reason. Before you confirm, the dialog shows you exactly what the result will be in both dollars and R.

Be honest about the fill price — this is the number every report is built on.

> **Important:** The app never closes a position for you. When a stop or target is hit you get an *alert*, not an automatic exit. The app has no connection to your broker, so it has no way of knowing what price you'd actually get filled at — and a made-up fill price would quietly poison every performance number downstream.

**Closed positions** appear in a table below, with the P&L, R-multiple, how long you held, and why the trade ended.

---

### Reports

Where you find out whether any of this is working.

Use the tabs at the top to switch between **Simulated** and **Real** results. They're kept strictly apart on purpose — averaging paper trades you might never have actually taken together with real fills gives you a track record that describes nothing.

**The headline numbers:**

| Metric | What it tells you |
|---|---|
| **Total P&L** | The money. |
| **Win rate** | What share of trades made money. On its own, this means less than you'd think. |
| **Expectancy** | What you make per trade on average, accounting for both the wins and the losses. **This is the number that matters most.** |
| **Average R** | The same idea, in units of risk. |
| **Profit factor** | Gross profit divided by gross loss. Above 1.0 you're making money. |
| **Max drawdown** | The deepest hole the strategy dug before recovering. |

Why expectancy beats win rate: you can win **80% of your trades and still lose money** if the occasional loss is bigger than all the wins put together. Expectancy catches that; win rate hides it.

**Which signals are working** — the table near the bottom is the reason this page exists.

For each signal — the four seeded ones plus any custom [Signals](#signals) you've added — it compares trades where that signal fired at entry against trades where it didn't, and shows the difference as an **edge**. A signal you removed still appears here as long as closed trades recorded it at entry, so its track record isn't lost.

- A **positive edge** means trades with that signal did better. It's pulling its weight.
- A **negative edge** means trades with that signal did *worse*. It may be actively costing you money.

That's the evidence you use to tune what the app alerts you about.

> **Careful:** an edge measured across three trades is not an edge, it's noise. The app marks thin samples with a **thin** tag and warns you above the metrics. You need a few dozen closed trades before any of this means much — which is exactly what simulation mode is for.

---

### Signals

The rules that score the Screener — and, in time, the raw material for custom alerts. A **signal** is a named yes/no condition over a ticker's indicators (e.g. *"RSI is below 30"*, *"Close is above the 50-day EMA"*). Each enabled signal a ticker satisfies adds its **weight** to that ticker's screener score.

The app ships with four seeded signals (BB Squeeze, RSI in Range, Above EMA 50, Volume Expansion) — the original hardcoded four, now just ordinary editable rows. You can add your own, disable ones you don't want, and change how much each is worth.

**The list** — one row per signal:

| Element | What it does |
|---|---|
| **Light toggle** | On/off. A disabled signal stops counting toward the score on the next run. |
| **Name + `×weight`** | The display name and how many points it contributes. |
| **Expression** | The rule in plain reading form (e.g. `35 ≤ RSI(14) ≤ 65`). |
| **builtin** badge | Marks the four seeded signals. |
| **Edit / Clone / Remove** | See below. |

**Creating a signal.** Click **New signal**. You get a name, an optional description, a weight, and the condition itself — built two ways:

- **Builder** (default) — pick a variable, an operator, and a value from dropdowns. "Match **all**" combines conditions with AND; "Match **any**" with OR. The right-hand side of a comparison can be a number *or* another variable (so `Close > EMA 50` is buildable). Boolean variables (like BB Squeeze) offer *is true / is false*; numbers offer `< ≤ > ≥ = ≠` and *between*.
- **JSON** — the escape hatch. Raw [JsonLogic](https://jsonlogic.com/) for anything the builder can't express (nested groups, arithmetic). The two modes are the same rule; switch freely with the toggle. If a rule is too complex for the builder, it stays in JSON and the Builder tab is disabled with a note.

As you build, three checks run live:

1. **Valid / errors** — the rule is validated against the known variable set. An unknown variable or malformed rule is rejected before you can save, with the reason shown.
2. **Preview on \<symbol\>** — evaluates the rule against one ticker's latest data right now: *fires* or *doesn't fire*, with the actual values it used. The symbol picker is searchable and remembers your last choice.
3. **Preview across universe** — a button that runs the rule against every ticker in the screener's tradeable universe on the current cached data and reports *"Matches N of M."* It's a fast sanity check on how selective the rule is; it doesn't re-fetch or recompute anything, and it evaluates the rule on its own (not as part of the full score).

**Editing vs. cloning — the one rule to know.** A signal's **expression is locked once created**. You can freely rename it, change its weight or description, and enable/disable it — but you **cannot change its logic in place**. To change the logic, use **Clone**: it opens a new signal pre-filled with the old expression for you to modify and save under a new name.

Why the lock? Every closed trade records which signals fired at entry, by name. If you could silently redefine "RSI in Range" from *35–65* to *40–60*, every past trade's attribution would quietly become a lie, and the Reports edge analysis would be built on sand. Freezing the expression keeps a signal's name meaning exactly one thing, forever.

**Removing and restoring.** **Remove** soft-deletes a signal (it stops scoring but its history is retained); a confirmation appears first. Removed signals live under **Show removed**, each with a **Restore** button. Removing a builtin is allowed but warns you — the Screener's built-in columns for it will stop updating.

**Applying changes.** Signals take effect on the **next screener run**. After adding, enabling, or reweighting, head to the [Screener](#screener) and click **Screen Tickers** to re-score. Past results are immutable and keep their original scores.

> **Tech note:** Signals are rows in the `signal_rules` table; scoring iterates the enabled set through a shared rule engine (`POST /rules/validate`, `/rules/preview`, `/rules/preview-universe` power the builder's live checks). The screener dual-writes the four builtin results into their legacy columns for back-compat, so nothing downstream breaks as the set changes. Per-run `signal_score_normalized` is frozen at evaluation time for cross-era comparability.

---

### Settings

Your defaults. Everything here can be overridden on an individual trade.

**Position sizing**
- **Account size** — used to work out how many shares to buy.
- **Risk per trade** — what percentage you'll put on the line each time. 1% is the standard starting point.
- **Max position size** — warns you when a single trade would be too large a share of the account.

**Stop loss / Profit target** — which method the builder reaches for by default, and its settings (ATR multiplier, target R, and so on).

**Trailing stop** — off by default. When on, your stop follows the price up as a trade goes your way, locking in gains. It only ever moves up, never down.

**Time stop** — alerts you when a trade has been sitting for N trading days without hitting either its stop or its target. A trade going nowhere is still tying up money and attention.

---

## Scheduler Controls

The scheduler runs the EOD scan, intraday poller, earnings check, and Saturday prefetch automatically. Most of the time you don't need to touch it.

**Pause** — stops all scheduled jobs (and blocks manual scans) for a set duration. Useful if you're traveling and don't want alerts firing.

> The Watchlist status bar shows the paused state with its expiry time. Pause/resume is currently API-only (no UI button). Use `POST /scheduler/pause?hours=N` from the API docs if needed.

**Resume** — lifts the pause immediately. Use `POST /scheduler/resume`.

**Cooldown** — after any update (scheduled or manual), a 60-minute cooldown prevents duplicate runs. The remaining time shows in the Watchlist status bar. This does not affect scheduled runs — only the "Update Now" button.

> **Tech note:** Pause state is in-memory. If the backend restarts (e.g. Render cold start), the scheduler resumes from scratch — no paused state is restored.

---

## Alert Types Reference

### EOD Alerts (fired at 4:15 PM ET after each scan)

| Alert | What it means | Trading interpretation |
|---|---|---|
| **BB Squeeze** | Bollinger Bands are unusually tight | Volatility is compressed. A breakout (up or down) is likely approaching. Watch for direction. |
| **RSI Oversold** | RSI < 30 | Potential bounce candidate. Don't catch a falling knife — confirm with price action. |
| **RSI Overbought** | RSI > 70 | May be extended. Consider taking partial profits or tightening a stop. |
| **MACD Crossover** | MACD histogram flips from negative to positive | Momentum is shifting bullish. Often a useful entry confirmation signal. |
| **EMA Crossover** | EMA-8 crosses above EMA-21 | Short-term trend turning up. Better signal when price is also above EMA-50. |
| **Volume Expansion** | 3-day avg volume > 20-day avg volume | Unusual activity. Can confirm a breakout or warn of distribution. |

### Intraday Alerts (fired up to 5× per day during market hours)

| Alert | What it means |
|---|---|
| **Price Below Lower BB** | Price has dipped below the lower Bollinger Band intraday |
| **Price Above Upper BB** | Price has pushed above the upper Bollinger Band intraday |
| **Price Below EMA-8** | Price has crossed below the short-term trend line intraday |
| **Price Above EMA-8** | Price has crossed back above the short-term trend line intraday |

Intraday alerts use the **last EOD snapshot** as the baseline (not a live recalculation). They're meant to flag intraday price extremes — not precise technical levels.

> **Note:** Each alert fires at most once per (symbol, type) per calendar day, regardless of how many intraday polls see the condition.

### Position Alerts (on trades you're actually holding)

These are checked on every intraday poll and again after the EOD scan. Unlike the alerts above, these are about money you already have on the line.

| Alert | What it means | What to do |
|---|---|---|
| **Stop Hit** | Price reached your stop | Your thesis is wrong. Get out. This is the alert that protects you — acting on it is the whole point of having set a stop. |
| **Target Hit** | Price reached your profit target | The trade worked. Take it off, or move your stop up if you want to let it run. |
| **Near Target** | Price is within 2% of the target | Heads up — start paying attention. |
| **Stop Trailed** | Your trailing stop ratcheted up | Informational. Some profit is now locked in. |
| **Time Stop** | The trade has run out of time without resolving | It's going nowhere and tying up capital. Review it. |

Every position alert shows your **unrealized R**, so you can see where the trade stands without opening the Positions page.

> **These are alerts, not actions.** Even a Stop Hit alert doesn't close your trade — you still have to place the order with your broker and then record the exit on the Positions page.

> **Note:** Position alerts are deduped per position per day, so if you somehow hold two positions in the same stock, each gets its own alerts.

---

## Troubleshooting

**Watchlist table shows no indicator data**
Click **Update Now** on the Watchlist page. If it's the first time, also make sure you've run **Refresh Data** from the Screener admin panel first.

**Screener shows no results**
Either the data hasn't been loaded yet (run **Refresh Data**) or the screener hasn't been run (click **Screen Tickers**). On a fresh install, do both in order.

**"Symbol not found in the universe" when adding a watchlist ticker**
The ticker isn't in the `tickers` table. Run **Refresh Data** on the Screener admin panel. If the symbol is genuinely outside the S&P 500, it can't be added — the app covers S&P 500 constituents only.

**"Update Now" button is disabled**
Either the scheduler is paused (check the status bar) or a 60-minute cooldown is active after the last update. The remaining cooldown time is shown in the status bar.

**Chart overlays (BB Bands / EMAs) not showing**
Indicator history needs to be populated. Click **Update Now** on the Watchlist page first, then reload the Charts page.

**Exit plan builder says "No indicator data for SYMBOL"**
The app needs an ATR value to size the stop, and it hasn't computed one for that symbol yet. Click **Update Now** on the Watchlist page, or pick a stop method that doesn't need indicator data — **Fixed %** or **Manual** both work without it.

**The builder says my trade would be 0 shares**
Your risk budget is smaller than the cost of a single share's worth of risk. If you're risking 1% of a $10,000 account, that's $100 — and a stop $150 below entry can't be sized into. Either tighten the stop, raise the risk percentage, or accept that the trade is too big for the account.

**A stop got hit but my position is still open**
That's expected. The app alerts you; it never closes trades. It has no connection to your broker and can't know your real fill price. Close the trade with your broker, then record the exit on the **Positions** page.

**Reports look wrong / too good / too bad**
Check which tab you're on — **Simulated** and **Real** are kept strictly separate and show very different things. And check the trade count: below about 20 closed trades the numbers are noise, which is why the app tags them as thin.

**A position's symbol disappeared from my watchlist and I stopped getting alerts on it**
It shouldn't. Open positions are monitored whether or not the symbol is on your watchlist. If alerts genuinely stopped, check that the backend is awake (see below).

**API credits at or near limit (e.g. 790/800)**
The Twelve Data free tier allows 800 requests/day. The EOD scan uses ~20 credits for a typical watchlist. If you're near the limit, avoid running manual scans — wait for the next day when credits reset.

**Backend went to sleep (Render cold start)**
Render's free/starter tier spins down after inactivity. The first request after a cold start can take 30–60 seconds. The app will reconnect automatically — just wait and retry.

---

## Technical Reference

### Scheduled Jobs

| Job | Schedule | What it does |
|---|---|---|
| Intraday poll | Mon–Fri 9:30, 11:00, 12:30, 2:00, 3:30 ET | Fetches live quotes; fires intraday price alerts and position alerts |
| Earnings check | Mon–Fri 8:00 AM ET | Checks earnings calendar for watchlist tickers; fires earnings alerts |
| EOD scan | Mon–Fri 4:15 PM ET | Fetches OHLCV, recomputes indicators, evaluates 6 alert conditions, then runs the position monitor |
| Universe prefetch + screener | Saturday 11:00 PM ET | Refreshes all ~505 tickers and runs screener; results ready Sunday morning |

The intraday poll and EOD scan cover the **union of watchlist symbols and open-position symbols**. An open position in a name you've since removed from the watchlist is still monitored — quotes are fetched once and shared by both evaluators.

### Data Sources

| Source | Used for | Cost |
|---|---|---|
| Twelve Data | EOD OHLCV fetch for watchlist | ~20 credits/day (800/day free) |
| yfinance | Intraday quotes, earnings calendar, universe bulk fetch | Free (unofficial) |
| Supabase | All persistent storage (PostgreSQL) | Free tier (500MB) |

### Indicator Parameters

| Indicator | Parameters |
|---|---|
| RSI | 14-day period |
| MACD | 12 / 26 / 9 (fast/slow/signal) |
| Bollinger Bands | 20-day SMA, 2 standard deviations |
| EMA ribbon | 8, 21, 50-day periods |
| ATR | 14-day period |
| OBV | Cumulative (no period) |
| BB Squeeze threshold | Lowest 20th percentile of rolling 252-bar BB width |

### EOD Alert Conditions (exact thresholds)

| Alert | Condition |
|---|---|
| RSI Oversold | RSI < 30 |
| RSI Overbought | RSI > 70 |
| BB Squeeze | `bb_squeeze` flag true (BB width ≤ 20th percentile of 252-bar window) |
| MACD Crossover | `macd_hist` was ≤ 0 previous snapshot, now > 0 |
| EMA Crossover | `ema_8` was ≤ `ema_21` previous snapshot, now > |
| Volume Expansion | avg(last 3 days volume) > avg(last 20 days volume) |

All EOD alerts are deduplicated per `(symbol, alert_type, calendar_date)` — running the scan multiple times on the same day won't create duplicate alerts.

### Position Alert Conditions (exact thresholds)

| Alert | Condition |
|---|---|
| Stop Hit | `price <= stop_price` |
| Target Hit | `price >= target_price` |
| Near Target | price within 2% of `target_price` (and target not yet hit) |
| Time Stop | `today >= time_stop_date` |
| Stop Trailed | chandelier stop moved up: `highest_high_since_entry − (trail_atr_mult × ATR) > stop_price` |

Position alerts are deduplicated per `(position_id, alert_type, calendar_date)` — keyed on the position, not the symbol, so two positions in one name each get their own alerts.

Both kinds of alert live in the `alerts` table, separated by a `category` column (`opportunity` / `position`). The dedup queries filter on it, so the two can't suppress each other.

### Exit Plan Formulas

```
risk_per_share = entry − stop
shares         = floor((account_size × risk_pct / 100) / risk_per_share)
risk_amount    = shares × risk_per_share       # 1R in dollars
rr_ratio       = (target − entry) / risk_per_share

r_multiple     = (exit − entry) / (entry − initial_stop)
```

`initial_stop_price` is frozen at entry and never mutates. Measuring R against a trailed stop would flatter every winner.

Stop methods: `atr_multiple` (default, 2×), `percent`, `bb_lower`, `ema_21`, `ema_50`, `swing_low` (10-bar low), `manual`.
Target methods: `r_multiple` (default, 2R), `atr_multiple`, `percent`, `bb_upper`, `manual`.

### Report Metrics

```
win_rate      = wins / total_trades
profit_factor = gross_profit / gross_loss          # None when there are no losses
expectancy    = (win_rate × avg_win) − (loss_rate × avg_loss)
max_drawdown  = largest peak-to-trough decline of the cumulative R curve
edge_r        = avg_R(trades with signal) − avg_R(trades without signal)
```

`avg_loss` is stored as a positive magnitude — the expectancy formula subtracts it. Reports below 20 closed trades are flagged `sample_is_thin`.

### Key API Endpoints

| Endpoint | What it does |
|---|---|
| `GET /scheduler/status` | Scheduler state, last/next run, API usage |
| `POST /scheduler/trigger` | Run a manual scan now |
| `POST /scheduler/pause?hours=N` | Pause all scheduled jobs for N hours (0.5–168) |
| `POST /scheduler/resume` | Resume immediately |
| `POST /screener/run` | Run the screener (async, returns job_id) |
| `POST /screener/refresh-data` | Refresh OHLCV + indicators for all tickers |
| `GET /screener/results` | Latest screener results (includes the dynamic `signals` map + normalized score) |
| `GET /signal-rules` · `POST /signal-rules` | List / create scoring signals (`?include_deleted=true` to include removed) |
| `PATCH /signal-rules/{id}` | Edit name/description/weight/enabled (expression is immutable) |
| `DELETE /signal-rules/{id}` · `POST /signal-rules/{id}/restore` | Soft-delete / restore a signal |
| `GET /rules/variables` | The variables a signal expression may reference, with labels |
| `POST /rules/validate` · `POST /rules/preview` | Validate a rule; evaluate it against one symbol's live data |
| `POST /rules/preview-universe` | Evaluate a rule across the Pass-1 universe — "matches N of M" |
| `GET /indicators/snapshots` | Latest indicator values for watchlist |
| `GET /ohlcv/bars?symbol=X` | OHLCV bar history for a symbol |
| `GET /alerts?category=position` | Unacknowledged alerts, optionally filtered by category |
| `POST /positions/plan` | Compute stop/target/sizing for a prospective trade (pure calc, saves nothing) |
| `GET /positions?status=open` | List positions, filterable by status and `is_simulated` |
| `POST /positions` | Open a position |
| `POST /positions/{id}/close` | Close a position and compute its outcome |
| `GET /positions/{id}` | Position detail with its full event log |
| `GET /settings` · `PATCH /settings` | Sizing and exit-plan defaults |
| `GET /reports/performance` | Headline metrics (defaults to simulated) |
| `GET /reports/by-signal` | Per-signal edge — which signals make money |
| `GET /reports/equity-curve` | Cumulative R and P&L over time |

Full interactive API docs available at `http://localhost:8000/docs` (local) or your Render URL + `/docs`.
