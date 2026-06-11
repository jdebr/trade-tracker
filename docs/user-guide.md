# Swing Trader — User Guide

A personal assistant for finding and monitoring swing trades. It does **not** execute trades — all buy/sell decisions and order placement happen in your brokerage separately.

---

## Contents

1. [First-Time Setup](#first-time-setup)
2. [Weekly Workflow](#weekly-workflow)
3. [Pages](#pages)
   - [Watchlist](#watchlist)
   - [Scanner](#scanner)
   - [Screener](#screener)
   - [Charts](#charts)
   - [Alerts](#alerts)
4. [Scheduler Controls](#scheduler-controls)
5. [Alert Types Reference](#alert-types-reference)
6. [Troubleshooting](#troubleshooting)
7. [Technical Reference](#technical-reference)

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

You need at least one watchlist ticker before the Scanner or Charts pages will show anything.

### 4. Run your first scan

Go to the **Scanner** page and click **Run Scan Now**. This fetches fresh price data and indicator values for your watchlist, and fires any alerts that apply.

---

## Weekly Workflow

### Sunday evening (~15 min)

1. Open the **Screener** page. Results from Saturday night's automatic run are waiting.
2. Review the top candidates — highest scores appear first.
3. Click through 2–3 finalists on the **Charts** page to review the setup.
4. Add your picks to the watchlist. Remove any tickers you're no longer watching.
5. Decide on 1–2 trades for Monday entry.

### Monday–Friday (~5 min/day)

1. Check the **Alerts** page for any conditions that fired overnight or that morning.
2. Review the **Scanner** table for current indicator levels on your watchlist.
3. Decide: hold, adjust stop, or close.

The EOD scan runs automatically at **4:15 PM ET** each weekday and generates alerts if conditions are met. Intraday price alerts fire at 9:30, 11:00, 12:30, 2:00, and 3:30 PM ET.

### Friday

Close remaining positions before market close. Clean up your watchlist.

---

## Pages

### Watchlist

Manage the tickers you're actively monitoring. The watchlist feeds the Scanner, Charts, and intraday alerts.

**Adding a ticker:**
- Type in the symbol search box — it fuzzy-matches against the full S&P 500 universe by default.
- Switch to **Screener** mode in the toggle below the box to limit suggestions to your latest screener results.
- The **Add** button stays disabled until you've selected a valid ticker from the list.
- Optionally type or pick a group name (e.g. "Tech", "Open positions") to organize your list.

**Removing a ticker:**
- Click the trash icon on any row. A confirmation dialog appears before anything is deleted.
- If the removal fails, the ticker reappears automatically (optimistic update with rollback).

**Filtering by group:**
- Use the pill buttons above the list to filter by group. Click **All** to clear the filter.

**Common errors:**
- *"That symbol is already in your watchlist"* — it's already there, no action needed.
- *"Symbol not found in the universe"* — the ticker isn't in the `tickers` table. Run **Refresh Data** on the Screener admin panel, then try again.

---

### Scanner

Shows the latest indicator snapshot for every ticker on your watchlist. This is your daily check-in view.

**The table columns:**

| Column | What it shows |
|---|---|
| Symbol | Ticker; hover for company name |
| RSI | 14-day RSI. Red ≥ 70 (overbought), Blue ≤ 30 (oversold), Green 35–65 (neutral range) |
| BB Squeeze | Filled dot = squeeze active (bands are tight; breakout may be coming) |
| MACD Hist | Histogram value. Green = positive momentum, Red = negative |
| EMA 50 | Price relative to the 50-day EMA |
| ATR | 14-day Average True Range (volatility measure) |
| As of | Date of the snapshot |

**Running a manual scan:**
- Click **Run Scan Now** to fetch fresh data and re-evaluate alert conditions immediately.
- The button is disabled during cooldown (60 min after any scan). The remaining time is shown in the status bar.
- If the scheduler is paused, manual scans are also blocked until you resume it.

**Status bar** (bottom of page):
- **Last scan** — when the most recent scan completed
- **Next scan** — the next scheduled run time (across all jobs)
- **API credits** — Twelve Data usage for today (e.g. `42/800`)
- **Paused until** — shown in amber if the scheduler is currently paused

---

### Screener

Ranks the full S&P 500 universe by signal score (0–4) so you can find trade candidates each week.

**The results table:**

| Column | What it shows |
|---|---|
| # | Rank (1 = strongest signal) |
| Symbol | Ticker; hover for company name |
| Score | 0–4 badge — count of signals firing |
| Close | Most recent closing price |
| BB Squeeze | Signal active? |
| RSI Range | RSI between 35–65? |
| Above EMA 50 | Price above the 50-day EMA? |
| Vol Expand | 3-day avg volume > 20-day avg volume? |

Each signal column is a dot — filled means the condition is true for that ticker.

**Running the screener:**
- Click **Screen Tickers**. Results appear in a few seconds — the screener reads from cached data, no API calls needed.
- Results update in place; the run timestamp shows when they were last generated.

**Adding to watchlist:**
- Click **+** on any row to add a ticker. The button turns into a green checkmark once added.

**Admin panel** (click "admin" to expand):
- **Refresh Data** — re-fetches OHLCV and recomputes indicators for all tickers. Use this when data is stale (e.g. after a long gap or on first setup). Takes several minutes.
- **Recompute Indicators** — recomputes indicators from cached OHLCV without re-fetching price data. Faster than a full refresh.

The screener also runs **automatically every Saturday night** so results are ready before your Sunday review. You rarely need to trigger it manually.

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
- *"No chart data"* — the ticker hasn't been scanned yet. Go to Scanner → Run Scan Now, then come back.
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

See [Alert Types Reference](#alert-types-reference) for what each alert means and how to act on it.

---

## Scheduler Controls

The scheduler runs the EOD scan, intraday poller, earnings check, and Saturday prefetch automatically. Most of the time you don't need to touch it.

**Pause** — stops all scheduled jobs (and blocks manual scans) for a set duration. Useful if you're traveling and don't want alerts firing.

> Go to the Scanner page status bar — paused state is shown with the expiry time. Pause/resume is currently API-only (no UI button). Use `POST /scheduler/pause?hours=N` from the API docs if needed.

**Resume** — lifts the pause immediately. Use `POST /scheduler/resume`.

**Cooldown** — after any scan (scheduled or manual), a 60-minute cooldown prevents duplicate runs. The remaining time shows in the Scanner status bar. This does not affect scheduled runs — only the "Run Scan Now" button.

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

---

## Troubleshooting

**Scanner table is empty / "No indicator snapshots found"**
Run **Scan Now** on the Scanner page. If it's the first time, also make sure you've run **Refresh Data** from the Screener admin panel first.

**Screener shows no results**
Either the data hasn't been loaded yet (run **Refresh Data**) or the screener hasn't been run (click **Screen Tickers**). On a fresh install, do both in order.

**"Symbol not found in the universe" when adding a watchlist ticker**
The ticker isn't in the `tickers` table. Run **Refresh Data** on the Screener admin panel. If the symbol is genuinely outside the S&P 500, it can't be added — the app covers S&P 500 constituents only.

**"Run Scan Now" button is disabled**
Either the scheduler is paused (check the status bar) or a 60-minute cooldown is active after the last scan. The remaining cooldown time is shown in the status bar.

**Chart overlays (BB Bands / EMAs) not showing**
Indicator history needs to be populated. Run a scan first (Scanner → Run Scan Now), then reload the Charts page.

**API credits at or near limit (e.g. 790/800)**
The Twelve Data free tier allows 800 requests/day. The EOD scan uses ~20 credits for a typical watchlist. If you're near the limit, avoid running manual scans — wait for the next day when credits reset.

**Backend went to sleep (Render cold start)**
Render's free/starter tier spins down after inactivity. The first request after a cold start can take 30–60 seconds. The app will reconnect automatically — just wait and retry.

---

## Technical Reference

### Scheduled Jobs

| Job | Schedule | What it does |
|---|---|---|
| Intraday poll | Mon–Fri 9:30, 11:00, 12:30, 2:00, 3:30 ET | Fetches live quotes for watchlist; fires intraday price alerts |
| Earnings check | Mon–Fri 8:00 AM ET | Checks earnings calendar for watchlist tickers; fires earnings alerts |
| EOD scan | Mon–Fri 4:15 PM ET | Fetches OHLCV, recomputes indicators, evaluates 6 alert conditions |
| Universe prefetch + screener | Saturday 11:00 PM ET | Refreshes all ~505 tickers and runs screener; results ready Sunday morning |

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

### Key API Endpoints

| Endpoint | What it does |
|---|---|
| `GET /scheduler/status` | Scheduler state, last/next run, API usage |
| `POST /scheduler/trigger` | Run a manual scan now |
| `POST /scheduler/pause?hours=N` | Pause all scheduled jobs for N hours (0.5–168) |
| `POST /scheduler/resume` | Resume immediately |
| `POST /screener/run` | Run the screener (async, returns job_id) |
| `POST /screener/refresh-data` | Refresh OHLCV + indicators for all tickers |
| `GET /screener/results` | Latest screener results |
| `GET /indicators/snapshots` | Latest indicator values for watchlist |
| `GET /ohlcv/bars?symbol=X` | OHLCV bar history for a symbol |
| `GET /alerts` | All unacknowledged alerts |

Full interactive API docs available at `http://localhost:8000/docs` (local) or your Render URL + `/docs`.
