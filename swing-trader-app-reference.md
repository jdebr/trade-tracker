# Swing Trader App — Developer Reference

> Working log for a personal swing trading assistant. Milestones 1–11 are complete. Use this doc to understand the current state of the app, then see the Dev Work Tracker for what's next.

---

## Project Overview

A personal, web-hosted swing trading assistant that reduces manual chart analysis time. The app identifies trade candidates from the S&P 500 universe and monitors a watchlist of active positions — it does **not** execute trades. Trading occurs via a separate commercial brokerage.

**Goals:**
- Identify 1–2 high-quality swing trade setups per week (Monday entry, Friday exit)
- Spend no more than 5–10 hours/week on trading activities
- Keep infrastructure costs under $25/month

**Intended weekly workflow:**
```
Sunday evening (~15 min):
  → Run screener on S&P 500 universe from dashboard
  → Review top candidates, check charts on 2–3 finalists
  → Pick 1–2 trades for Monday

Mon–Fri (~5 min/day):
  → Watchlist scanner auto-runs at 4PM ET
  → Check dashboard for exit condition alerts
  → Hold or close

Friday:
  → Close remaining positions
```

---

## Tech Stack

| Layer | Choice | Details |
|---|---|---|
| **Frontend** | React + Vite (no TypeScript) | Tailwind v4, shadcn/ui primitives, TanStack Query v5, React Router v6; Radix UI (Slot, Tooltip, Dialog) |
| **Backend** | FastAPI (Python 3.12) | Conda env `swing-trader`; APScheduler for scheduled scan |
| **Database** | PostgreSQL via Supabase | Free tier (500MB); 7 tables — see schema below |
| **Market Data** | Twelve Data (primary) + yfinance fallback | 800 req/day free; OHLCV cached in Supabase to minimize API calls |
| **Indicators** | `pandas-ta` | RSI, MACD, Bollinger Bands, EMA ribbon (8/21/50), ATR, OBV — computed on cached OHLCV |
| **Scheduler** | APScheduler `AsyncIOScheduler` | In-process; EOD scan 4:15 PM ET Mon–Fri, intraday poll 5× daily, universe prefetch Sat 23:00 ET |
| **Charts** | TradingView Lightweight Charts v5 | Candlestick + BB/EMA overlays; deep link to TradingView.com |
| **Auth** | Supabase Auth | Email/password + Google OAuth; JWT validated server-side via `supabase.auth.get_user()` |
| **Hosting** | Render.com (backend) + Vercel (frontend) | Render starter ~$7/mo; Vercel free |

### Running locally
- Backend: `conda activate swing-trader && cd backend && uvicorn app.main:app --reload`
- Frontend: `cd frontend && npm run dev`
- API docs: `http://localhost:8000/docs`

---

## Database Schema

10 tables in Supabase (Postgres). Schema source of truth: `supabase/schema.sql`.
Migrations: `supabase/migrations/` — apply by hand in the Supabase SQL editor.

| Table | Purpose |
|---|---|
| `tickers` | S&P 500 universe — symbol, name, sector, avg_volume, last_price, is_etf |
| `watchlist` | User's tracked tickers; FK to `tickers.symbol`; optional `group_name` |
| `ohlcv_cache` | Daily OHLCV bars per symbol; `UNIQUE(symbol, date)` — upserted on every fetch |
| `indicator_snapshots` | Latest computed indicator values per symbol/date — RSI, MACD, BB, EMA, ATR, OBV |
| `signal_rules` | User-defined named scoring rules (M19) — JsonLogic `expression`, `weight`, `enabled`; 4 seeded builtins. Expression immutable once created |
| `screener_results` | Output of each screener run — rank, `signal_score`, `signals` (JSONB) + `signal_score_normalized`, run timestamp |
| `alerts` | Fired alert conditions — type, symbol, `category`, `position_id`, details (JSONB) |
| `positions` | Trades taken (real or simulated) — entry, exit plan, outcome, `entry_signals` (JSONB) |
| `position_events` | Append-only log of everything that happened to a position |
| `app_settings` | Single row — position sizing and exit-plan defaults |

`trade_log` was dropped in migration 002. It was schema-only since M1 and never written to; `positions` + `position_events` replace it and carry the same `alert_id` / `screener_result_id` provenance FKs.

---

## Architecture

### Screener vs. watchlist update

Three backend modes. Note the naming: the daily watchlist scan is a backend job (`scanner.py` / `run_watchlist_scan`, unchanged), but in the UI it's surfaced on the **Watchlist** page and its manual trigger is labelled **Update Now**. There is no longer a separate "Scanner" page.

| Mode | Purpose | Trigger | Scope |
|---|---|---|---|
| **Screener** | Find new candidates from the full S&P 500 universe | Automated Saturday night; manual admin button available | ~505 tickers, two-pass filter |
| **Watchlist update** (EOD scan) | Monitor active watchlist tickers for EOD alert conditions | Scheduled 4:15 PM ET daily (also manual via "Update Now") | Watchlist (10–20 tickers) |
| **Intraday poller** | Track watchlist price movement vs. stored indicator levels | Every 1.5 hours during market hours (9:30–3:30 ET) | Watchlist (10–20 tickers) |

### Scheduled Jobs

| Job | Time | Tickers | Data Source | Credits |
|---|---|---|---|---|
| Intraday quote poll | 9:30, 11:00, 12:30, 2:00, 3:30 ET (Mon–Fri) | Watchlist (~20) | yfinance `fast_info` | 0 (free) |
| Pre-market earnings check | 8:00 AM ET (Mon–Fri) | Watchlist (~20) | Twelve Data `/earnings` or yfinance | ~20/day |
| EOD scan | 4:15 PM ET (Mon–Fri) | Watchlist (~20) | Twelve Data | ~20/day |
| Universe prefetch + screener | Saturday ~11 PM ET | All 505 tickers | yfinance (TD fallback for failures) | ~0–30/week |
| Storage retention cleanup | Sunday 4:00 AM ET | — | — | 0 |
| **Daily Twelve Data budget** | | | | **~140 used / 800 available** |

**Storage retention cleanup** (`services/cleanup.py`, `run_cleanup()`) prunes the two re-derivable caches — `ohlcv_cache` and `indicator_snapshots` older than 18 months — and stale `alerts` older than 90 days. It never touches `positions`, `position_events`, or `screener_results`: those are the analytics substrate and the filter-tuning dataset. Cutoffs are absolute dates so the job is idempotent (a missed run self-corrects), deletes are batched, and alerts referenced by a surviving position/event are protected (the provenance FK is `ON DELETE SET NULL`, so pruning a referenced alert would silently erase a kept trade's provenance). The 18-month window sits above the ~14-month floor that indicator computation needs (`BB_SQUEEZE_WINDOW + 50` = 302 trading days). Also runnable on demand via `POST /scheduler/cleanup`.

### Screener — Two-Pass Logic

The screener reads from pre-populated `ohlcv_cache` and `indicator_snapshots` — it does not fetch data itself. The Saturday prefetch job ensures the full universe is fresh before Sunday review.

**Pass 1** (DB query only, no API cost): avg volume > 1M, price $15–$500, not an ETF → ~150–200 survivors

**Pass 2** (reads cached indicator snapshots):

| Signal | Condition |
|---|---|
| BB Squeeze | `bb_width` ≤ 20th percentile of rolling 252-bar window |
| RSI in range | 35 ≤ RSI ≤ 65 |
| Above EMA 50 | Close price > EMA-50 |
| Volume expansion | 3-day avg volume > 20-day avg volume |

Each ticker scores 0–4; output is ranked by `signal_score` descending. Results are waiting on Sunday morning — no manual run required. A low-key admin button remains available for exceptional re-runs.

> **As of M19 (backend):** these four are no longer hardcoded — they are seeded `signal_rules` rows (JsonLogic expressions), and Pass 2 scoring iterates the enabled signal set via the M18 engine, writing a dynamic `signals` map + `signal_score_normalized` alongside the four legacy columns (dual-written for back-compat). Adding/disabling a signal changes scoring with no code change. Score stays 0–4 until custom signals are enabled. See milestone 19.

### Scanner — EOD Alert Conditions

Six conditions evaluated against each watchlist ticker's latest snapshot (plus prior snapshot for crossovers):

| Condition | Trigger |
|---|---|
| `bb_squeeze` | BB squeeze flag is true |
| `rsi_oversold` | RSI < 30 |
| `rsi_overbought` | RSI > 70 |
| `macd_crossover` | MACD histogram crosses from ≤ 0 to > 0 |
| `ema_crossover` | EMA-8 crosses above EMA-21 |
| `vol_expansion` | 3-day avg volume > 20-day avg volume |

Alerts are deduplicated by `(symbol, alert_type)` per day — fully idempotent.

### Intraday Alert Conditions

Evaluated against current quote price vs. the **last EOD indicator snapshot** (no full recompute needed). Price-level conditions only — RSI/MACD crossovers can't be meaningfully computed from a single quote.

| Condition | Trigger |
|---|---|
| `price_below_lower_bb` | Current price < lower BB from last EOD snapshot |
| `price_above_upper_bb` | Current price > upper BB from last EOD snapshot |
| `price_below_ema8` | Current price < EMA-8 from last EOD snapshot |
| `price_above_ema8` | Current price > EMA-8 from last EOD snapshot |

Intraday alerts deduplicated per `(symbol, alert_type)` per calendar day — won't re-alert every 1.5 hours for the same condition.

### Position Tracking & Exit Strategy

The app closes the loop between "here's a trade idea" and "here's how it turned out."

**Two kinds of alert.** Both live in the `alerts` table, separated by `category`:

| Category | Meaning | Produced by |
|---|---|---|
| `opportunity` | "Here's a trade idea" | screener, EOD scanner, intraday poller |
| `position` | "A trade you hold hit its exit" | `position_monitor.py` |

Opportunity alerts dedup on `(symbol, alert_type, date)`; position alerts dedup on `(position_id, alert_type, date)` — two positions in one name each get their own alerts. The dedup queries filter on `category` so the two kinds can't suppress each other.

**Position alert conditions** (evaluated on each intraday poll and the EOD scan):

| Condition | Trigger |
|---|---|
| `stop_hit` | price ≤ `stop_price` |
| `target_hit` | price ≥ `target_price` |
| `approaching_target` | price within 2% of target |
| `time_stop_reached` | held past `time_stop_date` without resolving |
| `trailing_stop_moved` | chandelier stop ratcheted up |

**Alerts only — never auto-closes.** The app has no broker connection and cannot know the real fill price. Inventing one would quietly corrupt the performance record, so closing is always a deliberate act by the user.

**Symbol union.** An open position can be in a name that is no longer on the watchlist. Both the intraday poll and the EOD scan therefore cover `watchlist ∪ open-position symbols` — polling the watchlist alone would leave those trades unmonitored.

### Exit Strategy Builder

`POST /positions/plan` is a pure calculation (no persistence) that the UI calls on every input change. It returns the recommended plan **plus every alternative level side by side**, so levels can be compared rather than accepted on faith.

| Stop methods | Target methods |
|---|---|
| `atr_multiple` (default, 2×), `percent`, `bb_lower`, `ema_21`, `ema_50`, `swing_low`, `manual` | `r_multiple` (default, 2R), `atr_multiple`, `percent`, `bb_upper`, `manual` |

**Position sizing is fixed-fractional:** risk a constant % of the account (default 1%) on every trade, and let the stop distance determine the share count.

```
risk_per_share = entry − stop
shares         = floor((account_size × risk_pct / 100) / risk_per_share)
risk_amount    = shares × risk_per_share      # this is 1R in dollars
```

A tight stop buys more shares, a wide stop fewer — but the dollars at risk are the same either way. **That is what makes R-multiples comparable across trades**, and it's the foundation the entire reporting layer rests on.

`initial_stop_price` is frozen at entry and never mutates, even when a trailing stop ratchets `stop_price` up. It is the denominator of every R-multiple the trade will ever report; letting it move would flatter every winner.

Guard rails: a stop at or above entry is a **hard error** (there's no risk to divide by). Thin R:R, over-concentration, an unusually wide stop, and a 0-share risk budget are **advisory warnings** — the plan still builds.

### Simulation

`positions.is_simulated` defaults to **true** — real money is opt-in, never the default. The Reports page keeps simulated and real results strictly separate (a Simulated / Real toggle, no blended view): a paper trade you'd never actually have taken, averaged with real fills, describes a strategy nobody ran. The API still accepts an omitted `is_simulated` to combine both for programmatic/MCP use, but the UI does not expose it.

### Performance Reporting & Signal Attribution

Every position stores `entry_signals` (JSONB) — the indicator state at the moment of entry, using the same thresholds as the screener (imported from `screener.py`, not restated, so they can't drift).

That snapshot is what makes `GET /reports/by-signal` possible: it splits closed trades by each signal and compares average R with the flag on versus off. The difference (`edge_r`) is the evidence base for keeping, dropping, or retuning a signal — and it's exactly the data milestone 16 (alert tuning) was blocked on.

Metrics follow standard trade-journal definitions: win rate, profit factor, **expectancy** (`win_rate × avg_win − loss_rate × avg_loss`), average R, max drawdown (in R), consecutive win/loss streaks. Reports below 20 closed trades are flagged `sample_is_thin`.

### Earnings Calendar

Fetched daily at 8 AM ET for watchlist tickers. Surfaces as an alert or dashboard notice when earnings are within 5 days. Useful for deciding whether to hold or exit before an event.

### API Usage Tracking

`GET /api_usage` on Twelve Data returns `current_usage` and `plan_limit`. Surfaced in the scheduler status bar so daily credit consumption is always visible. Used to gate Twelve Data calls: if credits are near exhaustion, fall back to yfinance for that day's scan.

### Data Flow

```
Saturday ~11 PM ET                   Mon–Fri 8 AM ET
        ↓                                   ↓
yfinance bulk fetch (505 tickers)   Earnings calendar check (watchlist)
        ↓                                   ↓
Compute indicators (505 tickers)    Surface upcoming earnings alerts
        ↓
Run screener (two-pass)            Mon–Fri 9:30/11:00/12:30/2:00/3:30 ET
        ↓                                   ↓
Results ready for Sunday review    Intraday quote poll (watchlist)
                                            ↓
                                   Evaluate price-vs-snapshot alerts
                                            ↓
                                   Insert deduped intraday alerts

                                   Mon–Fri 4:15 PM ET
                                            ↓
                                   EOD scan: fetch OHLCV (Twelve Data)
                                            ↓
                                   Compute indicators (watchlist)
                                            ↓
                                   Evaluate 6 EOD alert conditions
                                            ↓
                                   Insert deduped EOD alerts
```

---

## Dashboard Pages

All pages are implemented and working (Milestones 1–8 complete):

| Page | Description |
|---|---|
| **Watchlist** | Combined management + readings (merged the former Scanner page). Per-row indicator table (RSI color-coded, BB squeeze dot, MACD, EMA 50, ATR) with add/remove, group assignment via fuzzy-match combobox, group filter pills, delete confirmation, optimistic remove with rollback; "Open" badge on held tickers; per-row **Plan a trade** (target icon) → exit builder; update status bar (last/next update, API credits, cooldown, pause) with **Update Now** button |
| **Screener** | Read-only results display (auto-populated Saturday night); ranked table with signal dots, score badges, symbol name tooltips, indicator header tooltips, Add to Watchlist and **Plan a trade** buttons per row, "Open" badge on held tickers; admin re-run button |
| **Charts** | Candlestick + BB/EMA overlays; 1M/3M/6M/1Y/All zoom; candlestick/line toggle; TradingView deep link; company name subtitle; chart height 65vh (clamp 400–720px) |
| **Alerts** | Alert cards with type badges; category tabs (All / Positions / Opportunities); acknowledge + clear-all; unread count badge in nav |
| **Positions** | Open positions with live unrealized R and a stop→entry→target progress bar; closed history with P&L, R, hold time, exit reason; SIM/LIVE badges; close dialog with outcome preview |
| **Reports** | Headline metrics (P&L, win rate, expectancy, avg R, profit factor, max drawdown); cumulative-R equity curve; **signal attribution table**; exit-reason breakdown; Simulated / Real toggle (kept strictly separate) |
| **Settings** | Position sizing defaults (account size, risk %, concentration limit) and exit-plan defaults (stop/target method, ATR multiplier, target R, trailing stop, time stop) |

---

## Cost Estimate

| Service | Tier | Est. Monthly Cost |
|---|---|---|
| Vercel (frontend) | Free | $0 |
| Render.com (backend) | Starter | ~$7 |
| Supabase (database) | Free (500MB) | $0 |
| Twelve Data (market data) | Free (800 req/day) | $0 |
| yfinance (fallback) | Free (unofficial) | $0 |
| **Total** | | **~$7/mo** |

---

## Dev Work Tracker

Status legend: ✅ Done · 🔄 In Progress · ⬜ Pending

---

### 1. ✅ Finalize data model

**Subtasks**
- [x] Design schema (tables, columns, indexes)
- [x] Apply schema to Supabase dev project

**Technical notes**
- 7 tables: `tickers`, `watchlist`, `ohlcv_cache`, `indicator_snapshots`, `screener_results`, `alerts`, `trade_log`
- Supabase project: `awthrbddawoqqeyidbbz` (region: us-east-1)
- Schema source of truth: `supabase/schema.sql` — re-run in SQL editor to reset, or extend with new `ALTER TABLE` statements
- `ohlcv_cache` and `indicator_snapshots` use `UNIQUE(symbol, date)` — use upsert (INSERT ... ON CONFLICT DO UPDATE) from the backend
- `alerts.details` is JSONB — store the raw indicator values that triggered the alert for auditability
- `trade_log` links back to `alerts.id` and `screener_results.id` via nullable FKs

---

### 2. ✅ Stand up FastAPI backend with Supabase connection

**Subtasks**
- [x] Scaffold `backend/` structure (`app/`, `routers/`, `services/`, `models/`)
- [x] Create conda environment (`swing-trader`, Python 3.12)
- [x] Install core dependencies: `fastapi`, `uvicorn`, `supabase`, `python-dotenv`
- [x] Wire `.env` → Supabase client singleton
- [x] Implement health check endpoint (`GET /health`)
- [x] Implement basic CRUD endpoints for watchlist

**Testing criteria**
- [x] `GET /health` returns `200 OK` with Supabase connectivity confirmed
- [x] Can add/remove a ticker from watchlist via API and verify in Supabase dashboard
- [x] Server starts cleanly with `uvicorn app.main:app --reload`

**Technical notes**
- Conda env name: `swing-trader` (Python 3.12)
- Use `supabase-py` client with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (service role bypasses RLS for backend operations)
- `.env` lives at repo root; loaded via `python-dotenv` in `backend/app/config.py`
- `environment.yml` at `backend/environment.yml` for reproducible env setup
- `watchlist.symbol` has a FK to `tickers.symbol` — a ticker must exist in `tickers` before it can be added to the watchlist. This is intentional; the screener populates `tickers` from the S&P 500 universe (milestone 5)
- Start dev server: `conda activate swing-trader && cd backend && uvicorn app.main:app --reload`
- Interactive API docs available at `http://localhost:8000/docs` when server is running

---

### 3. ✅ Implement OHLCV fetching + caching layer

**Subtasks**
- [x] Twelve Data client: fetch daily OHLCV for a list of symbols
- [x] yfinance fallback: same interface, used when Twelve Data quota is exhausted
- [x] Cache check: query `ohlcv_cache` before fetching — only fetch if date is stale
- [x] Upsert fetched data into `ohlcv_cache`
- [x] Bulk fetch endpoint for screener (up to ~500 tickers with cache)

**Testing criteria**
- [x] Fetching a fresh ticker populates `ohlcv_cache`
- [x] Re-fetching same ticker same day hits cache, makes zero API calls
- [x] yfinance fallback activates correctly when Twelve Data returns a rate limit error

**Technical notes**
- Twelve Data free tier: 800 requests/day — protect with a daily counter or check response headers
- yfinance is unofficial and rate-limited; use for fallback only, not primary
- Store `source` column (`twelve_data` or `yfinance`) on every row for debugging
- Screener should batch-check cache freshness before deciding which tickers to fetch
- `volume` column is `bigint` in Supabase — cast to `int` before upserting (not `float`)
- Cache freshness threshold: 1 trading day (today or yesterday) — covers case where today's close hasn't happened yet
- `is_cache_fresh` rolls back to the most recent weekday, so weekend runs don't mark Friday data as stale
- Bulk fetch endpoint: `POST /ohlcv/fetch` — accepts `{"symbols": [...], "lookback_days": 100}`; returns `fetched/cached/failed` lists and `bars_upserted` count
- `get_cached_bars(symbol)` returns bars oldest→newest (ready for pandas/TA consumption)
- Run tests: `conda run -n swing-trader python -m pytest backend/tests/test_ohlcv.py -v`

---

### 4. ✅ Build indicator engine (Tier 1)

**Subtasks**
- [x] Load OHLCV from `ohlcv_cache` into a pandas DataFrame
- [x] Compute RSI (14), MACD (12/26/9), Bollinger Bands (20/2), EMA ribbon (8/21/50) via `pandas-ta`
- [x] Compute `bb_width` and `bb_squeeze` flag (lowest 20th percentile of rolling bb_width)
- [x] Upsert results into `indicator_snapshots`
- [x] Add ATR (14) and OBV at the same time (Tier 2 but trivial to include)

**Testing criteria**
- [x] Indicator values for a known ticker/date match a reference (e.g. cross-check against TradingView)
- [x] `bb_squeeze = true` fires correctly on a ticker known to be in a squeeze
- [x] Upsert is idempotent — running twice doesn't duplicate rows

**Technical notes**
- `pandas-ta` appends columns directly to a DataFrame — just call `df.ta.rsi()`, `df.ta.macd()`, etc.
- Need at least 50 trading days of OHLCV history to compute EMA-50 reliably; fetch 100 days on first load
- `bb_squeeze` threshold: `rolling(252).quantile(0.20)` — fires when current `bb_width` ≤ 20th percentile of last 252 bars
- `bb_width = (bb_upper - bb_lower) / bb_middle` (normalized bandwidth, not raw width)
- `pandas-ta` column names are dynamic (e.g. `BBU_20_2.0`, `MACD_12_26_9`) — resolve by prefix in `compute_indicators()`
- Minimum 60 bars required; returns `None` if insufficient history (caller adds symbol to `skipped` list)
- `POST /indicators/compute` — accepts `{"symbols": [...]}`, returns `computed/skipped/failed` lists and `rows_upserted`
- Run tests: `conda run -n swing-trader python -m pytest backend/tests/test_indicators.py -v`

---

### 5. ✅ Implement two-pass screener

**Subtasks**
- [x] Load S&P 500 constituent list (static CSV, refresh monthly)
- [x] Pass 1: filter by avg volume > 1M, price $15–$500, exclude ETFs
- [x] Pass 2: apply BB squeeze + RSI range + EMA trend + volume expansion filters
- [x] Score each survivor (0–4) and rank by score descending
- [x] Write results to `screener_results` with `run_at` timestamp
- [x] Expose `POST /screener/run` endpoint (triggers on-demand run, returns ranked list)

**Testing criteria**
- [x] Pass 1 reduces ~500 tickers to ~150–200
- [x] Pass 2 produces a ranked list of 10–20 candidates
- [x] Results are persisted in `screener_results` and retrievable via `GET /screener/results`
- [x] Runs complete in under 2 minutes (with warm cache)

**Technical notes**
- S&P 500 primary source: Wikipedia (`pandas.read_html`) — falls back to `backend/data/sp500.csv` (99 symbols bundled)
- `sync_universe()` upserts into `tickers`; `update_ticker_metadata()` derives `avg_volume` + `last_price` from `ohlcv_cache` and updates `tickers` — must be called before running screener on a fresh database
- Pass 1 uses `tickers` table columns: `is_etf=False`, `avg_volume > 1M`, `15 ≤ last_price ≤ 500`; symbols with NULL metadata are excluded
- Pass 2: `bb_squeeze` + `rsi_in_range` from `indicator_snapshots`; `above_ema50` from comparing close (ohlcv_cache) to ema_50; `volume_expansion` from avg(last 3d vol) > avg(last 20d vol) in ohlcv_cache
- `signal_score` = sum of: `bb_squeeze`, `rsi_in_range`, `above_ema50`, `volume_expansion` (each bool, max 4)
- `GET /screener/results` — without params returns most recent run; pass `?run_at=<ISO>` for a historical run
- Wikipedia symbol dots replaced with dashes (BRK.B → BRK-B) for yfinance compatibility
- Run tests: `conda run -n swing-trader python -m pytest backend/tests/test_screener.py -v`

---

### 6. ✅ Build React frontend (MVP)

**Subtasks**
- [x] 6a — Set up React + Vite, Tailwind v4, shadcn/ui primitives, `@/lib/api`, routing scaffold
- [x] 6b — Screener view: Run button, ranked results table, score badges, signal dots
- [x] 6c — Layout shell: Sidebar (desktop) + BottomNav (mobile), React Router nested routes, smoke tests
- [x] 6d — Watchlist manager: add/remove tickers, group assignment, ticker count footer
- [x] 6e — Scanner view: watchlist → indicator snapshots, RSI/MACD colour coding, bool signal dots
- [x] 6f — Chart view: TradingView Lightweight Charts, candlestick/line toggle, 1M/3M/6M/1Y/All zoom, BB + EMA overlays, TradingView deep link
- [x] 6g — Alerts view: alert cards with type badges, acknowledge + clear-all, unread count badge in nav

**Testing criteria**
- [x] Can add/remove tickers from watchlist and see changes persist
- [x] Scanner table renders all indicator columns and updates on page load
- [x] Screener run triggers backend call and displays ranked results
- [x] Chart loads for any watchlist ticker and renders correctly
- [x] 51 tests across 7 test files, all passing; production build clean (493KB JS / gzip 155KB)

**Technical notes**
- Frontend stack: React + Vite (ESM, no TypeScript); `@tailwindcss/vite` plugin (Tailwind v4)
- Tailwind v4 uses `@theme inline` block in `index.css` to map CSS variables to utility classes; dark mode via `class="dark"` on `<html>`
- shadcn/ui pattern (manual install): `cn()` + `cva` + Radix UI Slot; components in `frontend/src/components/ui/`
- `@/lib/api.js` — thin fetch wrapper with `get/post/patch/delete`; base URL from `VITE_API_URL` env var
- TanStack Query v5: `useQuery`, `useMutation`, `queryClient.invalidateQueries`; default `staleTime: 60_000`
- MSW v2 (`msw/node`) for API mocking in Vitest; handlers in `src/test/handlers.js`; jsdom needs `ResizeObserver` stub
- `lightweight-charts` v5 is ESM-only + uses canvas — fully mocked with `vi.mock()` in chart tests
- Chart overlays: BB bands (indigo/violet), EMA 8 (amber), EMA 21 (emerald), EMA 50 (blue)
- Responsive layout: Sidebar (`hidden md:flex w-56`) + BottomNav (`md:hidden fixed bottom-0`); both share alert unread count from `GET /alerts`
- New backend endpoints added for frontend: `GET /ohlcv/bars`, `GET /indicators/snapshots`, `GET /indicators/history`, full alerts CRUD (`GET /alerts`, `PATCH /alerts/{id}/acknowledge`, `POST /alerts/acknowledge-all`)
- Last commit: `96817a0` — "feat: milestone 6g — alerts view + polish pass"
- Will deploy to Vercel (free tier) — configure `VITE_API_URL` env var pointing at backend

---

### 7. ✅ Wire up APScheduler (daily scan)

**Subtasks**
- [x] Add APScheduler to FastAPI app startup via `lifespan` context manager
- [x] Schedule watchlist scan job at 4:00 PM ET daily (Mon–Fri)
- [x] Job pipeline: fetch OHLCV → compute indicators → evaluate 6 alert conditions → insert deduped alerts
- [x] Skip job on NYSE market holidays (`pandas_market_calendars`)
- [x] Pause/resume controls with configurable duration
- [x] Cooldown enforcement to protect API quota on both scheduled and manual runs

**Testing criteria**
- [x] Scheduler starts with the app and logs next run time on startup
- [x] Manual trigger via `POST /scheduler/trigger` respects cooldown (429 if too soon)
- [x] Job skips correctly on NYSE holidays and weekends
- [x] All 6 alert conditions evaluated and deduped correctly (34 new tests, 47 total passing)

**Technical notes**
- New files: `app/services/scanner.py`, `app/services/scheduler.py`, `app/routers/scheduler.py`
- `AsyncIOScheduler` with `CronTrigger(day_of_week="mon-fri", hour=16, timezone="America/New_York")`
- `max_instances=1`, `coalesce=True`, `misfire_grace_time=3600` — no overlapping runs; one catch-up if server was down at fire time
- Alert conditions: `bb_squeeze`, `rsi_oversold` (<30), `rsi_overbought` (>70), `macd_crossover` (hist ≤0→>0), `ema_crossover` (ema_8 crosses above ema_21), `vol_expansion` (3d avg > 20d avg)
- Crossover detection requires 2 consecutive snapshots; silently skipped if only 1 exists
- Dedup: queries `(symbol, alert_type)` pairs already in `alerts` for today before inserting — fully idempotent
- Pause is in-memory (resets on restart); cooldown `_last_run_at` is set before scan starts so it activates even on partial failure
- `.env` knobs: `SCHEDULER_ENABLED`, `SCHEDULER_HOUR`, `SCHEDULER_MINUTE`, `SCAN_COOLDOWN_MINUTES` (default 60)
- API: `GET /scheduler/status`, `POST /scheduler/trigger`, `POST /scheduler/pause?hours=N`, `POST /scheduler/resume`

---

### 8. ✅ Add screener on-demand trigger from dashboard + UX polish

**Subtasks**
- [x] `POST /screener/run` returns `202 + job_id` immediately via FastAPI `BackgroundTasks`
- [x] `GET /screener/job/{job_id}` endpoint for polling — returns status, result, error
- [x] In-memory job registry (`screener_job.py`) — OrderedDict, max 20 entries, auto-evicts oldest
- [x] ScreenerPage polls every 2s until done/error; shows pulse progress message while running
- [x] Run metadata shown after completion: run timestamp, pass1_count, pass2_count
- [x] ScannerPage: scheduler status bar (last scan, next scan, pause notice, cooldown countdown)
- [x] ScannerPage: "Run Scan Now" button → `POST /scheduler/trigger` with 429 cooldown handling
- [x] ScannerPage: Retry button on snapshot fetch error; actionable empty state
- [x] ChartPage: fixed deprecated `onSuccess` → `useEffect` for auto-symbol-select
- [x] ChartPage: "Run Scan Now" guidance in no-bars error instead of dead-end message
- [x] WatchlistPage: distinct errors for FK violation, duplicate symbol, and generic failures
- [x] WatchlistPage: inline error on remove failure

**Testing criteria**
- [x] Button triggers async run, shows progress, then renders results (polling tested with MSW)
- [x] Job error state shown when backend reports failure; button re-enables
- [x] Cooldown disables Run Scan Now; paused scheduler shows notice
- [x] All 3 watchlist add error cases tested (FK, duplicate, generic)
- [x] Chart auto-selects first symbol without deprecated API
- [x] 69 frontend tests passing (18 new), 47 backend tests passing

**Technical notes**
- New file: `app/services/screener_job.py` — `create_job / set_running / set_done / set_error / get_job`
- `POST /screener/run` → `202 {job_id, status: "pending"}`; worker calls `asyncio.to_thread(run_screener)`
- `GET /screener/job/{id}` → `{status, result, error, created_at, started_at, finished_at}`
- Job registry is in-memory — resets on server restart; 404 response includes a note about this
- Frontend `refetchInterval` callback stops polling when status is `done` or `error`
- Scanner `POST /scheduler/trigger` 429 errors parsed and surfaced as human-readable messages
- `friendlyAddError()` checks duplicate before FK (FK message contains "violates", a substring of duplicate key messages)
- Last commit: `f4101fc` (Milestone 7); this work committed on top

---

### 9. ✅ Deploy to production

Get the app running on Render.com + Vercel and accessible from a real URL. Data pipeline refactored to use automated Saturday prefetch + intraday polling.

**Subtasks — Infrastructure**
- [x] Add CORS config to FastAPI via `ALLOWED_ORIGINS` env var
- [x] Add `POST /screener/sync-universe` endpoint for fresh install
- [x] `requirements.txt` and `render.yaml` for Render deploy
- [x] `.python-version` pinned to 3.12
- [x] `vercel.json` SPA rewrite for client-side routing
- [x] Refresh `sp500.csv` to full 505 symbols; replace Wikipedia fetch with datahub.io
- [x] Render pre-deploy test gate (`pytest -x -q` in buildCommand)
- [x] Render deploy stable; Vercel frontend connects to Render backend

**Subtasks — Data pipeline**
- [x] Screener refactored as pure DB rules engine (no API calls during screening)
- [x] `run_data_refresh()` in `prefetch.py` — OHLCV fetch + indicators + metadata, separate from screener
- [x] `POST /screener/refresh-data` endpoint for on-demand seeding; skips fresh symbols (idempotent); `?force=true` to override
- [x] Saturday prefetch job calls `run_data_refresh` then `run_screener` as separate steps
- [x] `_get_recent_volumes()` uses single bulk `.in_()` query (N+1 eliminated)
- [x] Intraday quote poller: yfinance `fast_info` at 9:30, 11:00, 12:30, 2:00, 3:30 ET; deduped intraday alerts
- [x] Pre-market earnings check: daily at 8 AM ET; yfinance `Ticker.calendar`; surfaces as alerts
- [x] API usage tracking: `fetch_td_api_usage()` exposed via `GET /scheduler/status`
- [x] EOD scan time shifted to 4:15 PM ET

**Subtasks — Screener UX**
- [x] Results display is read-only with last-run timestamp
- [x] "Screen Tickers" button in header — fast, pure DB, no API calls
- [x] Admin panel with "Refresh Data" button for the slow OHLCV fetch (hidden by default)

**Technical notes**
- Saturday job uses yfinance for bulk fetch (free, no credits); TD only for individual failures
- Screener `run_screener()` is now ~10 lines — pure DB filter + score + save, no bootstrapping logic
- `run_data_refresh(force=False)` uses `bulk_check_freshness()` to skip up-to-date symbols
- Intraday alerts use last EOD snapshot as baseline — no full indicator recompute needed
- Earnings check uses `yfinance.Ticker.calendar` (free, no TD credits)
- `ALLOWED_ORIGINS` on Render: `https://trade-tracker-blush.vercel.app,http://localhost:5173`
- 104 backend tests / 72 frontend tests passing

---

### 10. ✅ Authentication and user login

Secure the app behind a login wall before it's accessible on a public URL. Single-user for now; multi-user deferred until there's a concrete need.

**Goals**
- Protect the personal instance — no unauthenticated access to any page or API endpoint
- Keep multi-user as a future option without building it now (small DB migration when needed; not worth the complexity upfront)

**Subtasks**
- [x] Enable Supabase Auth; create first user account (email/password + Google OAuth via Supabase bundled credentials)
- [x] FastAPI auth dependency: validate JWT on all non-health routes via `supabase.auth.get_user(token)`
- [x] Frontend: `/login` page, auth context provider, redirect unauthenticated users, attach token to API client
- [x] Confirm all existing features work end-to-end with auth in place

**Technical notes**
- Backend validates tokens by calling `supabase.auth.get_user(token)` — Supabase verifies server-side, no local JWT library needed
- This approach is algorithm-agnostic (works with RS256 or HS256) and handles key rotation automatically
- Disable public signups in Supabase dashboard (Authentication → Settings) — new accounts only via Invite User
- `SUPABASE_JWT_SECRET` is not used and not needed — token validation goes through Supabase's auth API
- Backend continues using the service role key for DB access; auth dependency is the gate on all non-health routes
- For shared access: add additional Supabase Auth users — all share the same single-tenant data
- Admin role extension point: `require_admin_role` stub in `backend/app/dependencies.py`; set `app_metadata.role = "admin"` on the privileged user in Supabase dashboard when needed
- 110 backend tests / 78 frontend tests passing at end of M10 (M11 added 3 more backend tests)

---

### 11. ✅ Deployment testing and polish (V1)

Iterated on the live deployed app — verified scheduled jobs, fixed rough edges, and shipped UI polish.

**Live verification**
- [x] Trigger "Refresh Data" on live app; confirm OHLCV populates and "Screen Tickers" returns results
- [ ] Saturday prefetch job fires automatically and screener results are ready Sunday morning
- [ ] Intraday poller fires on schedule and produces alerts in the dashboard
- [ ] Earnings calendar alerts appearing in dashboard
- [x] API usage visible in scheduler status bar
- [ ] Twelve Data credit usage stays well under 800/day after a full week of live operation
- [ ] No credentials in git history or deployed environment

**Bug fixes**
- [x] `api.js`: `DELETE /watchlist/{symbol}` was throwing JSON parse error — fixed by returning `null` on 204 No Content responses instead of calling `res.json()`
- [x] Watchlist delete now URL-encodes symbols (handles `BRK.B` and similar)
- [x] `GET /screener/results` was returning 404 on empty table — fixed to return `200 []`
- [x] `compute_indicators()` return value was discarded in `prefetch.py` — screener had 0 candidates; fixed to collect and upsert snapshots

**New backend endpoint**
- [x] `GET /tickers` — returns all non-ETF tickers sorted by symbol (`{symbol, name}`); used for symbol name tooltips and chart subtitle; auth required; registered in `main.py`

**Shared frontend infrastructure**
- [x] `src/lib/indicators.js` — central metadata for all 11 indicators (label, fullName, description, interpretation, params)
- [x] `src/components/ui/Tooltip.jsx` — Radix tooltip wrapper; self-wrapping with Provider so it works in tests without extra setup; 300ms delay
- [x] `src/components/ui/Dialog.jsx` — `ConfirmDialog` component with title, description, confirm/cancel, destructive variant, isPending state
- [x] `src/components/ui/Combobox.jsx` — fuzzy-match combobox; scorer: exact symbol prefix > symbol contains > name contains; `allowNew` shows "+ Create 'X'" option; keyboard navigation (ArrowDown/Up, Enter, Escape); click-outside to close

**Watchlist**
- [x] Delete confirmation dialog (ConfirmDialog); optimistic remove with rollback on error
- [x] Group input → Combobox (allowNew=true, fuzzy match existing groups from watchlist data)
- [x] Group filter pills above list; clicking filters to that group; "All" pill resets

**Scanner**
- [x] Indicator header tooltips: RSI, BB Squeeze, MACD Hist, EMA 50, ATR (description + interpretation from INDICATORS metadata)
- [x] Symbol name tooltips on hover (from `GET /tickers` cache, staleTime 1h)

**Screener**
- [x] Indicator header tooltips on all 4 signal columns (BB Squeeze, RSI Range, Above EMA50, Vol Expand)
- [x] Symbol name tooltips on hover
- [x] "Add to Watchlist" `+`/`✓` button column — optimistic update, reverts to `+` on error

**Chart**
- [x] Company name subtitle below heading (from tickers cache)
- [x] Chart height: `clamp(400px, 65vh, 720px)` (was fixed 420px)
- [x] Chart overlay logic reviewed — series refs + cleanup already correct; overlay issues in production are data-related (empty `indicator_history` table), not a code bug

**Observability**
- [x] `dependencies.py`: log auth failures (M10)
- [x] `screener.py` / `prefetch.py`: log indicator/metadata failure counts; log symbols skipped for insufficient data
- [x] `routers/watchlist.py`: INFO logs for add/remove/update (M10)
- [x] `frontend/src/lib/api.js`: log failed requests (method, path, status) before throwing (M10)
- [x] `frontend/src/App.jsx`: React error boundary (M10)
- [ ] `scheduler.py`: add `exc_info=True` to all job exception handlers; log job registration count at startup
- [ ] `intraday.py` / `earnings.py`: log per-symbol fetch failures; log count of symbols skipped

**Technical notes**
- `GET /tickers` registered with `app.include_router(tickers.router, dependencies=[Depends(get_current_user)])` in `main.py`
- Tooltip self-wraps with `TooltipPrimitive.Provider` per instance — preserves delay behavior; App-level `TooltipProvider` kept for potential future shared state
- Combobox `aria-label` prop forwarded to the inner `<input>` — allows test selection via `getByLabelText`
- Watchlist groups are derived client-side from watchlist data (`useMemo`) — no API call or schema change needed
- Tickers cache: `staleTime: 60 * 60 * 1000` (1 hour) across Scanner, Screener, and Chart pages — single fetch per session
- Watchlist cache on Screener: `staleTime: 5 * 60 * 1000` (5 min) — shared query key `["watchlist"]` with Watchlist page
- 113 backend tests / 78 frontend tests passing

---

### 12. 🔄 App User Guide

Document the app for a user who didn't build it — covers setup, daily workflow, and what each feature does. Also serves as reference for LLM tooling and informs integration/E2E test scenarios.

**Subtasks**
- [x] First-time setup: sync universe, run screener, add watchlist tickers
- [x] Weekly workflow walkthrough: Sunday screener run → pick trades → monitor scanner → act on alerts
- [x] Page-by-page feature reference: what each control does, what errors mean, how to recover
- [x] Scheduler controls: how to pause, resume, trigger manually, interpret status bar
- [x] Alert types: what each condition means and how to interpret it for a trade decision
- [x] Troubleshooting: common issues (empty tickers, stale cache, cooldown, etc.)
- [ ] Review pass: verify accuracy against live app; fill any gaps

**Technical notes**
- Draft at `docs/user-guide.md`
- Should be accurate enough that someone with no codebase knowledge can operate the app
- Will directly inform E2E test scenarios (milestone 14) and LLM tool descriptions (milestone 15)

---

### 13. ✅ Position tracking, exit strategy & performance reporting

Closes the loop between "here's a trade idea" and "here's how it turned out." Plan an exit before entering, record the position as an event stream, monitor it with alerts, and report on results segmented by the signals that triggered entry. Simulation mode accumulates outcome data before real money is at risk.

**Subtasks**
- [x] Slice 1 — Schema (`positions`, `position_events`, `app_settings`, `alerts.category`), exit strategy builder, positions + settings API
- [x] Slice 2 — Position alerts (`position_monitor.py`), wired into the intraday poll and EOD scan
- [x] Slice 3 — Positions page, exit strategy builder dialog, Settings page, alert category tabs, nav
- [x] Slice 4 — Performance reporting: metrics, equity curve, signal attribution
- [x] Apply migration `002_positions.sql` in the Supabase SQL editor
- [x] Live verification: open a simulated position end-to-end, confirm a position alert fires (deployed to production)

**Testing criteria**
- [x] Exit calculator: every stop/target method, sizing maths, R:R, warnings, hard errors
- [x] Trailing stop ratchets up and never down
- [x] Position alert dedup keys on `position_id`, not symbol
- [x] Opportunity dedup is unaffected by position alerts (category filter)
- [x] Intraday poll covers position symbols that aren't on the watchlist
- [x] Report metrics: expectancy sign, profit factor with zero losses, drawdown, signal edge
- [x] 206 backend tests / 98 frontend tests passing (117 / 78 before)

**Technical notes**
- Design follows established trade-journal practice (R-multiples, ATR stops, expectancy) rather than anything invented — see the Exit Strategy Builder section above
- `initial_stop_price` is frozen at entry: it's the R denominator and must never move
- The monitor raises alerts but **never auto-closes** — no broker connection means no knowable fill price
- `entry_signals` (JSONB) is the linchpin: without it, "which signals make money?" is unanswerable after the fact. It unblocks milestone 16.
- `is_simulated` defaults to **true** — real money is opt-in
- Frontend: `ExitPlanDialog.jsx` recalculates against `POST /positions/plan` on every input change, so the levels shown are always the ones the server would use
- New files: `services/exit_strategy.py`, `services/position_monitor.py`, `services/positions.py`, `services/reports.py`, `services/settings.py`; routers `positions.py`, `settings.py`, `reports.py`; pages `PositionsPage`, `ReportsPage`, `SettingsPage`; `components/ExitPlanDialog.jsx`; `lib/exitMethods.js`, `lib/nav.js`

---

### 14. ⬜ Integration testing

Test the full backend stack against a real (test) Supabase database — exercises routes, services, and DB together without mocks.

**Subtasks**
- [ ] Set up a separate Supabase test project (or test schema) with the same schema
- [ ] Integration test suite: key user flows end-to-end through the API (add watchlist ticker, run screener, trigger scan, check alerts)
- [ ] CI-friendly: runnable with a single command against the test DB

**Technical notes**
- Use pytest with a dedicated `.env.test` pointing at the test DB
- Focus on the seams between services — not re-testing unit logic already covered by existing tests
- Auth integration tests can be added here once milestone 10 is complete

---

### 15. ⬜ End-to-end testing

Drive the full app in a real browser against a deployed (or local) backend. Validates the complete user experience.

**Subtasks**
- [ ] Choose framework: Playwright (recommended — good Windows support, works with Vite dev server)
- [ ] Key scenarios from the user guide: login, add ticker to watchlist, run screener, view results, run scan, view alerts
- [ ] Run against local stack in CI; optionally against staging on Render

**Technical notes**
- User guide (milestone 11) defines the test scenarios
- Can be added incrementally — start with the 3–4 highest-value flows, not exhaustive coverage
- Auth flows should be included once milestone 10 is complete

---

### 16. ⬜ LLM integrations + Claude skill

Two related features sharing the same Claude/API infrastructure.

**Feature: News summarizer**
- For each watchlist ticker, fetch recent news headlines (e.g. from a free API like NewsAPI or Twelve Data news endpoint)
- Pass headlines to Claude with a prompt to identify and summarize events relevant to price action: earnings, guidance, macro, regulatory, geopolitical
- Surface summaries in the dashboard alongside scanner indicators

**Feature: Trade setup advisor**
- Input: current indicator snapshot for a ticker + recent alert history + (optionally) past trade outcomes from `trade_log`
- Output: Claude-generated analysis including suggested entry/exit range, stop loss level, options/hedging considerations, and risks to monitor as the trade unfolds
- Not a trade executor — surfaces analysis for the user to act on

**Claude MCP skill**
- Expose key app data (watchlist, alerts, screener results, scanner snapshots) as Claude tool calls via an MCP server
- Allows querying the app from Claude chat: "What alerts fired today?" / "What does the screener show for NVDA?" / "Summarize my current watchlist positions"
- Pairs naturally with both LLM features above

**Technical notes**
- Anthropic SDK (`anthropic` Python package) for Claude API calls
- MCP server can be a small FastAPI app or standalone process exposing tool definitions
- News API: NewsAPI.org free tier (100 req/day) or Twelve Data news endpoint (already in stack)
- User guide (milestone 11) should document how to interpret LLM output — these are suggestions, not instructions

---

### 17. ⬜ Alert condition tuning

Review and adjust alert thresholds based on real data observed after the app has been live for several weeks.

**Subtasks**
- [ ] Review alert history: which conditions fire most/least, any obvious false positives
- [ ] Use `GET /reports/by-signal` to compare each signal's average R with the flag on vs off
- [ ] Adjust thresholds in `scanner.py` if needed (e.g. RSI oversold cutoff, vol expansion multiplier)
- [ ] Consider enabling/disabling specific conditions based on observed usefulness

**Technical notes**
- **Unblocked by milestone 13** — `positions.entry_signals` records the indicator state at entry, and `/reports/by-signal` turns that into a per-signal edge. This is the evidence base that was previously missing.
- Still requires a real sample: reports flag `sample_is_thin` below 20 closed trades, and a signal "edge" drawn from three trades is not an edge
- Simulated positions count for this purpose — that's what simulation mode is for
- This milestone is the manual precursor to the full custom alert rule engine (see Future work)

---

### 18. ✅ Expression rule engine (foundation)

A single, reusable boolean-expression engine that both custom indicators (M19) and custom alerts (M21) are built on. This is the linchpin: build it once, generically, and every downstream "user-defined condition" feature falls out of it.

**Design direction — adopt the JsonLogic *format*, with a strict backend evaluator.** Rather than invent an expression language, copy the well-known open-source pattern. [JsonLogic](https://jsonlogic.com/) represents rules as JSON, which is the ideal fit here: rules serialize straight into a `jsonb` column, ship to the browser for building/validation via the original [`json-logic-js`](https://github.com/jwadhams/json-logic-js), and are deterministic, side-effect-free, and introspectable (walk the AST to see which variables a rule uses). A human-readable formatter renders `{"<":[{"var":"rsi_14"},35]}` as `RSI(14) < 35` for display. (Alternative considered: a string DSL via [`simpleeval`](https://github.com/danthedeckie/simpleeval)/`evalidate` — more readable to hand-write but needs a parser on both ends and is harder to introspect. JsonLogic wins for a builder UI + signal attribution.) **We keep the JsonLogic format but evaluate on the backend with a small purpose-built interpreter** ([`json-logic-py`](https://github.com/nadirizr/json-logic-py) serves as reference), because stock JsonLogic inherits JS null-coercion (`null < 35` → `true`) — dangerous here, since a missing RSI would silently satisfy an oversold rule. See the technical plan for the strict null semantics.

**The unifying concept — a per-symbol feature dictionary.** Each scan/screener run assembles a flat `{variable_name: value}` map per symbol: raw indicator values (`rsi_14`, `macd_hist`, `bb_width`…), derived booleans (`bb_squeeze`, `above_ema50`…), and later candlestick flags (`engulfing_bullish`…). An indicator (M19) and an alert rule (M21) are both just named JsonLogic expressions evaluated against that dict. This is what "generic enough to reuse the same engine for alerts" means concretely.

**Scope**
- [ ] Adopt JsonLogic; add `json-logic-py` (backend) + `json-logic-js` (frontend) deps
- [ ] `services/rule_engine.py`: `evaluate(rule, features)`, `extract_variables(rule)`, `validate(rule)` (schema + unknown-variable check)
- [ ] Comparison operators (`< <= > >= == !=`) + logical (`and`/`or`/`not`) over named variables — keep the surface minimal but complete
- [ ] `build_feature_context(symbol)` — assembles the flat variable dict from `indicator_snapshots` + `ohlcv_cache`
- [ ] Variable registry with metadata (name, type, description, source) driving the builder UI + reusing the `indicators.js` tooltip treatment
- [ ] Human-readable formatter for display; frontend mirror for live validation/preview
- [ ] Tests: evaluation truth tables, variable extraction, validation errors, formatter

**Dependencies:** none — foundation for M19, M21 (and consumed by M20, M22).

#### Technical plan (Phase B)

**Format vs. evaluator.** Adopt the JsonLogic *format* (the interchange standard) so the same rule JSON is stored in `jsonb`, shipped to the browser, and built/validated there with `json-logic-js`. But evaluate on the backend with a small strict interpreter (~60 lines) rather than stock JsonLogic, for **trading-safe null semantics**: any comparison with a missing/None operand evaluates to `False`, while `and`/`or` compose normally (so `bb_squeeze OR rsi_14 < 35` still fires on the squeeze even when `rsi_14` is null). To keep the builder's preview identical to production, **preview evaluates via a backend endpoint, never client-side.**

**New files (backend)**
- `services/rule_engine.py`
  - `evaluate(rule, features) -> bool` — strict, null-safe interpreter over the operator allowlist
  - `extract_variables(rule) -> set[str]` — walks the AST collecting `var` refs (feeds M19 signal attribution + validation)
  - `validate(rule, known_vars) -> list[str]` — error messages for: disallowed operator, unknown variable, malformed node, depth/size over cap; `[]` means valid
  - `format_human(rule) -> str` — renders `RSI(14) < 35 AND bb_squeeze` for display
  - Operator allowlist: `var`; `== != < <= > >=`; `and or ! !!`; chained `<`/`<=` for ranges (`{"<":[35,{"var":"rsi_14"},65]}`); arithmetic `+ - * /` (pending decision below)
  - Safety caps: max node count (~100) + max depth (~10)
- `services/feature_context.py`
  - `VARIABLE_REGISTRY` — `{name, type, description, source, group}` for every readable variable (`rsi_14`, `macd_line/signal/hist`, `bb_upper/middle/lower/width`, `bb_squeeze`, `ema_8/21/50`, `atr_14`, `obv`, `close`, `vol_3d`, `vol_20d`, …). Single source of truth; drives validation + the builder UI + tooltips (reuse the `indicators.js` treatment)
  - `build_feature_context(symbol) -> dict` — flat variable dict from the latest `indicator_snapshots` row + recent `ohlcv_cache` (close, `vol_3d`, `vol_20d`, mirroring `pass2_score`'s current inline derivations). Missing fields → None
  - `build_feature_contexts(symbols) -> dict[str, dict]` — batched (one query) for screener/scan use
- `models/rules.py` — pydantic request/response models
- `routers/rules.py` (auth-required):
  - `GET /rules/variables` — the registry, for the builder
  - `POST /rules/validate` — `{rule}` → `{valid, errors, variables_used}`
  - `POST /rules/preview` — `{rule, symbol}` → `{value, features_used}`; evaluates against the live feature context so the builder shows a real result

**Frontend**
- Add `json-logic-js` dep.
- `lib/ruleEngine.js` — build/serialize JsonLogic nodes, client-side structural validation (well-formed + operator allowlist), and a `formatHuman()` mirror for instant display. **Evaluation/preview always calls the backend** so semantics never diverge.
- No visual builder yet — M18 ships the primitives; the builder UI lands with M19 (indicators) and M21 (alerts). Optional dev-only panel to exercise `/rules/preview`.

**No schema changes.** M18 is pure services + registry + endpoints. Rules are persisted by the `indicators` table (M19) and `alert_rules` table (M21); M18 defines only how a rule is evaluated, validated, introspected, and displayed.

**Integration seams (consumed later)**
- M19 scoring: `score += evaluate(ind.expression, features)` over enabled indicators
- M19 attribution: `entry_signals = {ind.slug: evaluate(ind.expression, features), …}` + raw values; `extract_variables` documents dependencies
- M21 alerts: `if evaluate(rule.expression, features): fire_alert(...)`
- M20 candlesticks + M22 indicators: just add entries to `VARIABLE_REGISTRY` + `build_feature_context` — zero engine changes

**Tests** (`test_rule_engine.py`, `test_feature_context.py`)
- Operator truth tables; nested `and`/`or`/`not`; chained range
- **Null safety**: `rsi_14 < 35` with `rsi_14=None` → False; `bb_squeeze OR rsi_14<35` fires on squeeze despite null RSI
- `extract_variables` on nested rules; `validate` catches disallowed op / unknown var / depth-size overflow
- `format_human` output; `build_feature_context` assembles expected dict from a fixture snapshot; batched variant
- Safety-cap enforcement

**Open decisions**
- **Arithmetic operators** (`+ - * /`) in v1? Enables `close > ema_50 * 1.02` and `atr_14 / close` volatility filters — small added surface. (Rec: include; cheap and useful for "within X%" rules.)
- **Preview scope**: single-symbol only in M18, or also a "how many of the universe match right now" batch preview? (Rec: single-symbol now, batch later.)

---

### 19. ✅ Custom & extensible indicators (signals)

Turn the hardcoded screener signals into user-defined, named indicators built on the M18 engine, and let new indicators flow automatically into scoring and position tracking.

**Status: M19a (backend) complete + deployed** — `signal_rules` table + service + CRUD API, data-driven screener scoring (dual-write), dynamic `entry_signals`, `signal_score_normalized`, reports generalized; 321 tests green; two adversarial reviews passed; expression immutability locked in. Migration 003 applied to the live DB; committed (38b1548) and deployed to Render (live OpenAPI confirms `/signal-rules` + `/rules` routes). **M19b (frontend) complete, unpushed — pending a UI/UX review before it deploys.** Dynamic Screener display (M19b.1, 35f41bd), signals management page + functional builder + `/rules/preview-universe` (M19b.2, 4925fb2), structured condition builder as the default surface with a JSON escape hatch (M19b.3). Sub-slicing + locked decisions below.

**Scope**
- [ ] `indicators` table: `name`, `slug`, `type` (one of the current indicator families), `expression` (jsonb JsonLogic), `enabled`, `is_builtin`, `weight`, `deleted_at` (soft delete), timestamps
- [ ] Migrate the 4 hardcoded Pass-2 signals (`bb_squeeze`, `rsi_in_range`, `above_ema50`, `volume_expansion`) into seeded rows → screener scoring becomes data-driven, not code-driven
- [ ] Add a brand-new indicator of any current type with a new name → automatically enters the screener scoring algorithm
- [ ] **Parameter customization:** adding an indicator of an existing type with different parameters (e.g. RSI period 14 → 10, a 3× ATR stop threshold) computes a new named variable (`rsi_10`) that the expression can reference — distinct from just re-thresholding an existing value
- [ ] Disable + remove (soft delete) indicators
- [ ] Screener scoring iterates enabled indicators, evaluates each expression, sums (optionally weighted) score
- [ ] Keep the "light on/off" UI for enable/disable; note a future redesign to prevent UX crowding as the set grows
- [ ] **Position tracking:** `positions.entry_signals` snapshots *all* enabled indicator results dynamically (not the fixed 4) so new indicators are tracked for reporting; `/reports/by-signal` generalizes to the dynamic set → hone in on working strategies over time
- [ ] Tests: scoring against seeded indicators, add/disable/soft-delete, dynamic entry_signals snapshot

**Dependencies:** M18.

#### Technical plan (Phase B)

**Decisions locked (review):**
- **Entity name = `signal_rules`** (not "indicators", which already means the computed technical values / `indicator_snapshots`). A *base indicator* is a feature variable (M18 registry, M22 extends); a *signal* is a named JsonLogic scoring rule over those variables. Parallels M21's `alert_rules`.
- **Expression is immutable** once a signal is created (freeze-expression, not full immutability). `expression` and `slug` cannot be PATCHed — editing the logic would silently change the meaning of every historical attribution that references the slug, corrupting by-signal edge analysis. To change the logic you clone to a new signal. `name`/`description`/`weight`/`enabled`/`sort_order` stay mutable (weight only affects future scores; per-position normalized score is frozen at entry, so by-signal coherence is preserved). This also closes the "silently re-express a builtin" hole from the M19a review. Residual caveat: coherence is only as strong as the stability of the underlying *variables* (changing how `bb_squeeze` is computed still shifts meaning — a deeper concern).
- **Dual-write transition.** The 4 legacy boolean columns on `screener_results` feed the API models, the frontend Screener table, the public `/status/summary` endpoint, and reports. Keep populating them (from the builtin results) *and* write a new `signals` jsonb — existing surfaces stay untouched while scoring/reporting go data-driven.
- **Sliced: M19a (backend) then M19b (frontend).** M19a = `signal_rules` table + data-driven scoring + CRUD API + dynamic `entry_signals`/reports, all backend + tested. M19b = signal management page + the first rule-builder UI + a dynamic Screener display. Everything below is M19a unless marked (M19b).

**Two layers.** A signal has (a) a **scoring rule** — a named JsonLogic boolean over the feature dict, the thing with an on/off light and a weight — and (b) optionally a **computed base variable** it introduces (parameterization, e.g. `rsi_10`). Most user-created signals are layer (a) only: expressions over the *existing* variable set (`RSI < 30`, `macd_hist > 0 AND above_ema50`) — no new computation, just a new row. Layer (b) is the smaller, more advanced case and is called out as a scoped decision below.

**Schema — migration `003_signal_rules.sql`**
- `signal_rules` table: `id`, `slug` (unique machine name, e.g. `bb_squeeze`), `name` (display), `description`, `type` (family: `rsi`/`macd`/`bb`/`ema`/`atr`/`obv`/`volume`/`composite`), `expression` (jsonb JsonLogic), `weight` (integer, default 1), `enabled` (bool), `is_builtin` (bool), `sort_order`, `created_at`, `updated_at`, `deleted_at` (soft delete)
- **Seed the 4 hardcoded Pass-2 signals as builtin rows** so scoring becomes data-driven:
  - `bb_squeeze` → `{"var":"bb_squeeze"}`
  - `rsi_in_range` → `{"<=":[35,{"var":"rsi_14"},65]}`
  - `above_ema50` → `{">":[{"var":"close"},{"var":"ema_50"}]}`
  - `volume_expansion` → `{">":[{"var":"vol_3d"},{"var":"vol_20d"}]}`
- `ALTER screener_results ADD COLUMN signals jsonb` — holds `{slug: bool}` for every evaluated signal; plus `signal_score_normalized numeric` and `max_signal_score numeric` (see cross-set section). **Dual-write:** the 4 legacy boolean columns keep being written from the corresponding builtin results so the API/frontend/status endpoint are unaffected.

**Screener scoring rewrite (`screener.py`)**
- `pass2_score` becomes data-driven: load enabled signal_rules once, `build_feature_contexts(symbols)` (from M18), then per symbol `score = sum(rule.weight * evaluate(rule.expression, features))` and `signals = {rule.slug: result}`
- `save_results` writes `signals` (jsonb) + `signal_score` + `signal_score_normalized` + `max_signal_score`, and **dual-writes** the 4 legacy columns from `signals[builtin_slug]` (when those builtins are enabled) for back-compat
- Deleting/disabling a signal changes future scores only — historical `screener_results` are immutable

**Dynamic entry-signal attribution (`positions.py`)**
- `snapshot_entry_signals` rewrite: evaluate **all enabled indicators** against the entry feature context → `entry_signals = {ind.slug: bool, …}` + `signal_score`, alongside the raw values it already keeps (`rsi_14`, `macd_hist`, `atr_14`, `bb_width`, emas, `close_at_entry`) and `triggering_alert_types`
- Add `features_from_context(ctx)` so we reuse the `MarketContext` already loaded at entry instead of re-querying — keeps one code path with `build_feature_context`
- **This is what makes new indicators "tracked for positions to hone strategies over time"** — every open records the full enabled set, not a frozen 4

**Reports generalization (`reports.py`)**
- `performance_by_signal`: replace the hardcoded `SIGNAL_FLAGS` with the dynamic slug set = enabled indicators ∪ any slug present in historical `entry_signals` (soft delete keeps removed indicators reportable)
- `performance_by_score`: replace `range(5)` with `range(0, max_score+1)` where `max_score` derives from the indicator set
- **Analytics caveat (document it):** raw `signal_score` semantics shift when the indicator set changes, so raw-score buckets are only comparable within a stable set; per-signal `edge_r` stays valid because it's keyed on individual slugs — and `signal_score_normalized` (below) is the cross-set-comparable alternative

**Cross-set comparability — `signal_score_normalized`.** To make score trackable as the indicator set evolves, compute a normalized score at evaluation time:
`signal_score_normalized = achieved_weight / total_enabled_weight` — a 0–1 fraction of the maximum score attainable *given the set that was live when the position was opened*. Store it (plus its denominator `max_signal_score`) **frozen** alongside `signal_score` on both `screener_results.signals` and `positions.entry_signals`, so it is never recomputed against a later set. Reports add `performance_by_normalized_score` bucketed into bands (e.g. 0–0.2, 0.2–0.4, …, or quintiles) so "did high-conviction setups outperform?" stays answerable across eras.
- **What it does and doesn't control for (document it):** normalization corrects for set *size and weight* — a 3-of-4 setup (0.75) and a 6-of-8 setup (0.75) become directly comparable. It does **not** correct for indicator *quality*: diluting the set with a weak indicator still shifts the distribution. It's a strong first-order cross-set metric, not a claim of semantic equivalence. Pairs naturally with per-signal `edge_r`, which remains the tool for judging any individual indicator's worth.

**API + models (`routers/signal_rules.py`, `models/signal_rules.py`)** — auth-required, prefix `/signal-rules`
- `GET /signal-rules` (filter `enabled`, `include_deleted`) · `GET /signal-rules/{id}`
- `POST /signal-rules` — create; **validates `expression` via `rule_engine.validate` → 422 with errors** on a bad/unknown-variable rule
- `PATCH /signal-rules/{id}` — edit name/description/weight/enabled/sort_order. `expression` and `slug` are **immutable** (rejected with 422 via `extra="forbid"`) — clone to change the logic
- `DELETE /signal-rules/{id}` — soft delete (`deleted_at` + `enabled=false`); builtins can be disabled and soft-deleted but the action logs a warning (their legacy dual-written column stops being written)
- `POST /signal-rules/{id}/restore`
- **New for M19b — `POST /rules/preview-universe`** (on the `/rules` router, not `/signal-rules`): body `{rule}`; runs the candidate rule against the **current cached data** for the full Pass-1 universe and returns `{matched: [...], match_count, universe_count, values: {sym: {var: val}}}`. Reuses `pass1_filter()` + `build_feature_contexts()` + `evaluate()` verbatim (no external fetch, no indicator recompute — the same cheap cache reads a real run does), so the preview universe/values are identical to what an actual run would score. Validates first (422 on bad rule). Semantics: evaluates the rule **in isolation** ("which tickers does this fire on"), not "how would ranking change if added to the set"; universe = Pass-1 survivors (liquid, in-band, non-ETF). Label results "against latest cached data (refreshed <date>)". It's a **button**, not live-on-keystroke, since it touches ~380 symbols per call (still seconds). Optional future memoization of the full-universe context with a short TTL if repeated previews feel slow.

**UI (M19b) — locked decisions**
- **Own page in nav** (`/signals` route + Sidebar entry, `primary:false` so it stays off the crowded bottom bar). Management list: name, human-formatted expression (from the server `formatted` string), weight, the **light on/off toggle**, and edit/clone/delete actions. Active shown by default; a "Show removed" toggle reveals soft-deleted rows with **Restore** (`include_deleted`).
- **Two-stage builder.** Stage 1: **raw-JSON textarea + live validate** (`POST /rules/validate` → `formatted` + errors) and single-symbol live preview (`POST /rules/preview?symbol=`) — functional, ships first. Stage 2: **structured condition builder** (`[variable ▾][operator ▾][value]` rows combined with AND/OR, variable picker from `GET /rules/variables` with tooltips; single-level groups in v1, nested deferred) — becomes the **default**, with a "raw JSON" **escape hatch** button that opens Stage 1. Both modes share the same validate/preview/CRUD endpoints. No client-side `formatHuman` needed — the server returns `formatted` on every validate/preview.
- **Full-universe preview** button (calls `POST /rules/preview-universe`) in the builder: "Matches N of M tickers" + expandable list with each match's rule-relevant values.
- **Preview symbol picker** — searchable `Combobox` with free/direct input, seeded from the ticker list, defaulting to the first watchlist symbol (fallback `AAPL`), remembered across opens.
- **Immutability UX.** Editing an existing signal only exposes name/description/weight/enabled/sort_order; the expression rows are **read-only**. A prominent **Clone** action opens the *create* dialog pre-filled with the expression — the escape valve that makes freeze-expression livable.
- **Adding/enabling a signal affects future runs only** (historical `screener_results` immutable, each row carries its own `max_signal_score`). The page shows a hint pointing at the Screener's existing "Screen Tickers" button.
- **Builtin edits** allowed like any signal; disable/delete surfaces a warning that the legacy dual-written Screener column stops updating; delete goes through a confirm dialog.
- **Dynamic Screener display** — drive columns/score off `row.signals` / `row.max_signal_score` / `row.signal_score_normalized`: score badge reads `achieved/max` + normalized %, per-signal dots render for whatever signals exist (wrap/scroll, expand-on-click for large sets). Rows with `signals = null` (pre-migration) fall back to the legacy four booleans + `/4`.
- Note the future redesign to prevent crowding as the set grows (per the brainstorm).

**Sub-slices (each independently shippable + `bash test.sh`-green)**
- **M19b.1 — Dynamic Screener display. ✅** Pure frontend over fields the backend already returns; rewrote the hardcoded `SIGNALS`/`ScoreBadge` in `ScreenerPage.jsx` (single "Signals" cell of labeled dots, `ScoreCell` = achieved/max + normalized %, slug labels from `GET /signal-rules?include_deleted=true`) with the legacy fallback. Committed 35f41bd.
- **M19b.2 — Signals page + functional builder. ✅** `/signals` page + nav entry (Sidebar only, `primary:false`); list with light toggle / weight / server-`formatted` expression / edit-clone-delete-restore + "Show removed". Raw-JSON `SignalRuleDialog` with live `/rules/validate`, single-symbol `/rules/preview`, and the `POST /rules/preview-universe` full-universe button. Backend: `preview_rule_over_universe()` in `screener.py` + `/rules/preview-universe` endpoint, and `formatted` now server-computed on every `SignalRule` response. 324 backend / 104 frontend green.
- **M19b.3 — Structured condition builder. ✅** `ConditionBuilder` — "Match all/any of these conditions" with `[variable ▾][operator ▾][value|variable]` rows (booleans → is true/false, numbers → comparisons + between, RHS can be a value or another variable). Emits JsonLogic into the same `exprText` the dialog validates/saves, so validate/preview/universe/save are untouched. Now the **default** create/clone surface with a Builder/JSON segmented toggle; the JSON escape hatch stays for anything the builder can't express, and the Builder tab auto-disables (with a note) when a cloned expression is too complex (`logicToConditions` returns null → nested groups, arithmetic). 324 backend / 118 frontend green.

**Parameterization — scoped decision (layer b).** Supporting a genuinely new base series (`rsi_10`, `ema_100`) means computing and storing a new variable, not just a new expression. Proposed mechanism: an `ALTER indicator_snapshots ADD COLUMN extra jsonb`, plus a small `base_config` (type + params) that the indicator engine reads to compute extra series via `pandas-ta` and merge into the feature dict + `VARIABLE_REGISTRY` dynamically — no per-indicator migration. **Recommendation:** ship M19 v1 with expression indicators over the existing variable set (covers the bulk of the ask), and fast-follow parameterization as M19.2 using the `extra` jsonb approach.

**Tests**
- `test_indicators_api.py`: CRUD, expression validation rejection, soft delete + restore, builtin guard
- `screener` scoring against seeded indicators (score matches the old hardcoded result for the 4 builtins — a regression anchor)
- `snapshot_entry_signals` produces the dynamic map; `reports` by-signal/by-score over a dynamic slug set
- Migration seed correctness (4 builtins evaluate identically to today)

**Open decisions — resolved**
- **Parameterization (layer b, `rsi_10`):** deferred to M19.2 (`indicator_snapshots.extra` jsonb approach). M19b v1 = expressions over the existing 17-variable registry.
- **Weights:** integer-only in v1 (keeps `signal_score` an integer and `by-score` buckets clean).
- **Builtin deletion:** allowed via soft delete with a warning (their legacy dual-written column stops updating); nothing special about them once scoring is data-driven.
- **Builder fidelity:** two-stage — raw-JSON-live-validate first, then structured builder as default with a JSON escape hatch (see UI decisions above).
- **Management surface:** own `/signals` page in nav.
- **Screener display:** dynamic — score `achieved/max` + normalized %, dots-on-demand (see UI decisions above).

**Deferred / future (post-M19b)**
- **Configurable Pass 1.** The Pass-1 gate (`MIN_AVG_VOLUME`, `MIN_PRICE`/`MAX_PRICE`, `is_etf`) is currently hardcoded in `screener.py`. Make it user-configurable (likely `app_settings` columns or a small `screener_config` row) so the tradeable universe isn't fixed. Touches `pass1_filter()` and, by extension, the universe that `/rules/preview-universe` reports against. Independent quick win; no dependency on the M19b slices.
- **Full-universe preview memoization** — cache `build_feature_contexts(pass1_survivors)` with a short TTL if repeated previews feel slow (skip until measured).

---

### 20. ⬜ Candlestick pattern recognition

Identify common candlestick patterns and their meanings, and expose them as variables to the engine so they're usable anywhere indicators are.

**Scope**
- [ ] Detect common patterns: doji, engulfing, hammer, shooting star, harami, morning/evening star, marubozu, spinning top, etc.
- [ ] **Library decision (open question):** [TA-Lib](https://ta-lib.github.io/ta-lib-python/func_groups/pattern_recognition.html) exposes 60+ `CDL*` functions returning +100/−100/0 (bullish/bearish/none) — the standard, but requires the TA-Lib C library at build time (a real consideration on Render). Alternatives: a pandas-ta subset (already in stack) or a small pure-Python implementation of the ~15 highest-value patterns
- [ ] Pattern metadata (bullish/bearish/neutral + plain-English meaning) for the in-app reference + tooltips
- [ ] Expose pattern flags as boolean variables in the feature dict → immediately usable in custom indicators (M19) and alerts (M21) with no special-casing
- [ ] Storage decision: compute on the fly vs persist (columns or a `patterns` jsonb on `indicator_snapshots`)
- [ ] Tests: pattern detection against known fixtures, feature-dict exposure

**Dependencies:** M18 (to be usable in expressions); otherwise standalone.

#### Technical plan (Phase B)

**Library decision — TA-Lib (the deployment objection is gone).** As of TA-Lib v0.6.5+ the Python package ships [prebuilt manylinux wheels that bundle the C library](https://pypi.org/project/TA-Lib/) (v0.7.0 covers Python 3.10–3.14), so `pip install TA-Lib` works on Render with no source build, and `conda install -c conda-forge ta-lib` covers local Windows dev. That removes the one real reason to avoid it. TA-Lib gives 60+ `CDL*` pattern functions, each returning `+100 / -100 / 0` (bullish / bearish / none) from OHLC arrays — battle-tested, so we don't own pattern-detection correctness. (Fallbacks if an install ever breaks: the small pandas-ta subset already in-stack, or a pure-Python implementation of ~15 patterns. Not recommended given wheels now work.)

**Variable representation.** Each pattern becomes a signed-int variable in the feature dict — `cdl_engulfing ∈ {-100, 0, 100}` — which is the canonical form expressions read (`{"==":[{"var":"cdl_engulfing"},100]}`). For ergonomics in the builder, the registry also advertises derived booleans (`cdl_engulfing_bull`, `cdl_engulfing_bear`) computed from the sign. This keeps the engine unchanged (M18 seam: patterns are just more variables) while making rules readable.

**Curated set.** Surface ~15–20 high-value patterns rather than all 60 to avoid overwhelming the builder: doji (+ dragonfly/gravestone), hammer, inverted hammer, hanging man, shooting star, bullish/bearish engulfing, harami, morning star, evening star, piercing, dark cloud cover, three white soldiers, three black crows, marubozu, spinning top. The full set stays available behind a flag if wanted.

**Computation & storage**
- Compute inside the existing indicator pipeline (`indicators.py compute_indicators` already loads the OHLC bars) — call the curated `CDL*` functions on the same DataFrame, take the most-recent bar's value per pattern
- Multi-bar patterns need history (e.g. three-white-soldiers needs 3+ bars); reuse the existing `MIN_BARS` guard, emit `0`/None when insufficient
- **Storage:** migration `004_candlesticks.sql` → `ALTER indicator_snapshots ADD COLUMN patterns jsonb` holding `{pattern_slug: signed_int}`. Keeps it fully dynamic (no column-per-pattern) and chartable/historical
- `feature_context.build_feature_context` merges `patterns` into the flat variable dict and `VARIABLE_REGISTRY` gains a `candlestick` group (so they auto-appear in the M19/M21 builders)

**Metadata (`services/candlesticks.py`)**
- `CURATED_PATTERNS` — the CDL function list + slugs
- `CANDLESTICK_META` — per pattern: display name, direction (bullish/bearish/neutral), category (reversal/continuation), and a plain-English meaning, for tooltips now and the M22 strategy reference later
- `compute_patterns(df) -> dict[slug, int]`

**Integration (zero engine changes)**
- M19 indicators can now be built on patterns, e.g. a `bullish_reversal` indicator = `{"or":[{"==":[{"var":"cdl_engulfing"},100]},{"==":[{"var":"cdl_hammer"},100]}]}`
- M21 alerts likewise (`bb_squeeze AND cdl_hammer_bull`)

**UI (kept light for M20)**
- Patterns appear automatically as variables in the rule builder (from the registry) — no bespoke work
- Surface detected patterns as badges on Watchlist/Chart rows, with the `CANDLESTICK_META` meaning in a tooltip
- The full pattern **reference** (glossary of meanings) is deferred to M22's strategy library to avoid duplication — M20 ships the data + tooltips, M22 gives it a home page

**Tests** (`test_candlesticks.py`)
- Detection against hand-crafted OHLC fixtures that unambiguously form a hammer / bullish engulfing / doji (assert sign + magnitude)
- Short-history guard → no crash, emits 0/None
- `patterns` jsonb storage round-trip; feature-dict + registry exposure of pattern variables
- A rule referencing a pattern evaluates correctly through the M18 engine

**Open decisions**
- **Curated ~15–20 vs. all 60 patterns** surfaced in the UI (Rec: curated, full set behind a flag)
- **Store curated only, or all detected patterns** in the `patterns` jsonb (Rec: store curated to keep snapshots lean; widen later if needed)
- **Representation:** signed-int canonical + derived booleans (recommended) vs. booleans only

---

### 21. ⬜ First-class alerts (CRUD + rule engine + notifications)

Promote alerts from a hardcoded condition set to user-managed rules with expressive triggers and outbound notifications.

**Scope**
- [ ] `alert_rules` table: `name`, `expression` (jsonb) **or** `indicator_id` reference, `message_template`, `notify_channels`, `enabled`, `category`, scope, cooldown/dedup config, `deleted_at`
- [ ] Full CRUD API + UI: create / edit / enable / disable / delete an alert
- [ ] A rule's trigger is an inline expression **or** points at an already-created indicator (M19)
- [ ] **Combine multiple expressions/indicators** via AND/OR/NOT — this falls out for free once the M18 operators are expressive enough (e.g. `(RSI < 35) AND bb_squeeze AND engulfing_bullish`)
- [ ] **Richer alert-time variables (feedback):** beyond indicator scores, expose live/derived stock data — current `price`, `price_change_pct`/`price_change_abs`, plus position state (`has_open_position`, `position_age_days`, `position_unrealized_r`, distance-to-stop/target) — so rules can read "is a position on, and how long"
- [ ] **Evaluate on every data arrival (feedback):** all enabled rules run whenever new data lands (intraday poll, EOD scan) — not a separate schedule
- [ ] **Customizable messages (feedback):** per-rule `message_template` with `{variable}` interpolation rendered against the alert context
- [ ] **Alerts UI: sort / search / filter (feedback)** across fired alerts (by rule, symbol, category, date, acknowledged) and the rule list
- [ ] **Notifications: email first (feedback).** Email only in v1 (low lift, free); **channel is configurable per alert** so SMS (Twilio) can be added later without reshaping the model. Per-rule channel selection + a user contact-settings surface
- [ ] Tests: CRUD, expression + indicator-pointer triggers, combined rules, message rendering, email dispatch (mocked)

**Dependencies:** M18; best sequenced after M19/M20 so rules can reference custom indicators and candlestick patterns.

#### Technical plan (Phase B)

**The centerpiece — a richer "alert context" (feedback note 1).** Screener-time variables aren't enough for alerts; rules need live and stateful data. Extend the M18 feature dict with a superset used only at alert time:
- **Price group:** `price` (latest quote), `prev_close`, `price_change_pct`, `price_change_abs`, `intraday_high`/`low` where available
- **Position group:** `has_open_position` (bool), `position_age_days`, `position_unrealized_r`, `position_pnl_pct`, `distance_to_stop_pct`, `distance_to_target_pct`, `position_is_simulated`
- **Indicator-score group (lets alerts fire "over indicator scores"):** `signal_score`, `signal_score_normalized`, and each enabled indicator's result as `ind_<slug>` (boolean) — computed by evaluating M19 indicators against the same context
- New `services/alert_context.py`: `build_alert_context(symbol, price, position=None)` layers these onto `build_feature_context(symbol)`. `VARIABLE_REGISTRY` gains `price` / `position` / `score` groups, each tagged with the **contexts it's valid in** (`screener` vs `alert`) so the M19 indicator builder hides position/price vars while the M21 alert builder shows everything

**Schema — migration `005_alert_rules.sql`**
- `alert_rules`: `id`, `name`, `description`, `symbol` (nullable — null = evaluate across the watchlist ∪ open-position union, set = one symbol), `expression` (jsonb) **or** `indicator_id` (FK → `indicators`, nullable), `message_template` (text), `notify_channels` (jsonb/text[] — `['email']` in v1), `enabled`, `category` (add `'custom'` to the alerts category vocabulary), `cooldown_minutes` (dedup window), `is_builtin`, `created_at`, `updated_at`, `deleted_at`
  - CHECK: at least one of `expression` / `indicator_id` present (pointing at an indicator is sugar for `{"var":"ind_<slug>"}`)
- `ALTER alerts ADD COLUMN alert_rule_id uuid REFERENCES alert_rules(id) ON DELETE SET NULL`, `ADD COLUMN message text`
- `ALTER app_settings ADD COLUMN notify_email text, ADD COLUMN notify_email_enabled boolean DEFAULT false` (user contact surface)

**Evaluation (`services/alert_engine.py`), feedback note 2**
- `run_alert_rules(prices)` — load enabled rules once; for each, resolve in-scope symbols (its `symbol`, else the union), `build_alert_context`, `evaluate(rule.expression, ctx)`; on true and **not within `cooldown_minutes`** → render message, insert an `alerts` row (`category='custom'`, `alert_rule_id`, `message`), dispatch notifications
- **Hook into every data-arrival job** — call it from `run_intraday_poll` and `run_watchlist_scan` right after quotes/indicators refresh, reusing the price dict already assembled there (same seam the position monitor already uses)
- Dedup keyed on `(alert_rule_id, symbol, date)` plus the per-rule cooldown, mirroring the existing opportunity/position dedup
- **Future convergence (note, not v1):** once `price`/`position` variables exist, the hardcoded `position_monitor` conditions (`stop_hit`, `target_hit`, `time_stop`) are expressible as seeded builtin `alert_rules`. Keep the working monitor as-is for v1; unify later

**Message rendering (`services/alert_engine.py`), feedback note 3**
- `render_message(template, ctx) -> str` — safe `{variable}` interpolation over known registry vars only (unknown placeholder → validation error at save time, not runtime), with sensible number formatting; a default template when none is set (e.g. `"{name}: {symbol} @ {price}"`)

**Notifications — email only in v1 (`services/notifications.py`), feedback note 5**
- `send_email(to, subject, body)` via a transactional API (**Resend** or SendGrid free tier — simpler and better deliverability than raw SMTP; SMTP/Gmail app-password as fallback). Config via env (`RESEND_API_KEY` etc.)
- Dispatch reads each rule's `notify_channels`; v1 handles `email`, silently skips unconfigured channels. **Per-alert configurable** so adding `sms` later is a channel handler + Twilio creds, no model change
- Volume is low (a few/day) → send inline within the job with try/except + logging; no queue needed yet
- SMS explicitly deferred: note the Twilio cost + US A2P 10DLC registration hurdle

**API + models (`routers/alert_rules.py`, `models/alert_rules.py`)** — auth-required
- `GET /alert-rules` (filter `enabled`/`category`/`symbol`) · `GET /alert-rules/{id}`
- `POST /alert-rules` — create; **validates `expression` against the alert-context variable set** and validates `message_template` placeholders → 422 on error
- `PATCH /alert-rules/{id}` · `DELETE /alert-rules/{id}` (soft delete)
- `POST /alert-rules/{id}/test` — evaluate now against a symbol and optionally send a test email (verifies wiring end-to-end)
- Extend the existing fired-alerts endpoints with **sort/search/filter** params (feedback note 4)

**UI**
- **Alert-rules management page** — list (name, human-formatted expression, channels, enabled toggle, edit/delete) + create/edit dialog reusing the M19 rule builder, extended with the price/position/score variables, a **message-template editor** (with a variable picker + live preview via `/alert-rules/{id}/test`), channel toggles (email on, SMS shown-but-disabled), and scope (all vs one symbol)
- **Fired-alerts page** — add sort/search/filter controls (by rule, symbol, category, date, acknowledged), reusing the existing `useSort` hook + a debounced search
- **Settings** — notification email + enable toggle

**Tests** (`test_alert_rules_api.py`, `test_alert_engine.py`, `test_alert_context.py`)
- CRUD + expression/template validation rejection; soft delete
- `build_alert_context` assembles price/position/score variables (position present vs absent)
- `run_alert_rules`: fires on a true rule, respects cooldown/dedup, scope resolution (single symbol vs union), indicator-pointer rule
- `render_message` interpolation + unknown-placeholder rejection
- Email dispatch mocked; `notify_channels` honored; unconfigured channel skipped

**Open decisions**
- **Email provider:** Resend vs SendGrid vs SMTP/Gmail app-password (Rec: Resend — simplest API + free tier)
- **Cooldown model:** per-rule `cooldown_minutes` vs. once-per-day dedup like today (Rec: `cooldown_minutes`, defaulting to same-day)
- **Scope default:** watchlist ∪ open positions vs. also allowing full-universe rules (Rec: union only in v1 — universe-wide alerting is an API-cost multiplier)

---

### 22. ⬜ Indicator & strategy library + strategy tagging

Broaden the indicator set, add an in-app strategy quick-reference, and tag positions by strategy so reporting can segment on it.

**Scope**
- [ ] Research + add new indicators (candidates: ADX/DMI, Stochastic, VWAP, Supertrend, CCI, MFI, Williams %R, Ichimoku) → expand the computed feature set, giving the engine more variables
- [ ] Curated **strategy reference**: basic strategies paired with the indicators each needs (BB-squeeze breakout, RSI mean-reversion, MACD trend, EMA-ribbon pullback, …), sourced from trading literature and folded into the app UX as a quick reference (a Strategies page and/or tooltips)
- [ ] **Strategy tagging on positions:** add a `strategy_tag` / free-text tag to `positions` (pick from the library or type any custom string), searchable/filterable in reports → **performance by strategy**
- [ ] Tests: new indicator computation, performance-by-strategy reporting

**Dependencies:** new indicators feed the M19 registry; strategy tagging is independent and could ship anytime as a quick win.

#### Technical plan (Phase B)

Three sub-features. Decisions locked: **Tier A + MFI** indicator set, **content-as-code** knowledge base, tag list seeded with **indicator + strategy names**.

**A. New indicators (5) — ADX/DMI, Stochastic, Supertrend, Keltner, MFI**
- Compute in the existing `indicators.py` pipeline via `pandas-ta` (all natively supported): `adx` → `adx_14`, `di_plus`, `di_minus`; `stoch(14,3,3)` → `stoch_k`, `stoch_d`; `supertrend(10,3)` → `supertrend`, `supertrend_dir`; `kc(20, 2×ATR)` → `kc_upper/middle/lower`; `mfi(14)` → `mfi_14`
- Derived **`ttm_squeeze`** boolean: BB sitting inside Keltner (`bb_upper < kc_upper AND bb_lower > kc_lower`) — the high-probability squeeze the research highlights; a strict upgrade to the percentile-based `bb_squeeze`
- **Storage:** migration `006_indicators_extra.sql` adds explicit typed columns (matching the existing `indicator_snapshots` convention, keeping them queryable/chartable) for the above + `ttm_squeeze`
- `feature_context.build_feature_context` reads the new columns; `VARIABLE_REGISTRY` gains entries (each linked to a KB slug). **No engine or scoring changes** — they arrive as variables the user composes into M19 indicators / M21 alerts. Optionally seed 1–2 example indicators (e.g. `adx_strong` = `adx_14 > 25`) as disabled builtins to demonstrate
- Tier B indicators (Williams %R, CCI, PSAR, Donchian, Ichimoku, VWAP, Aroon, ROC, CMF, pivots, Fibonacci) recorded in M23's backlog as the "future possibilities" list

**B. Knowledge base / quick-reference (content-as-code)**
- Canonical content module `app/knowledge/registry.py` — the single source for all explainer content, keyed by slug, entry `type` ∈ {`indicator`, `pattern`, `strategy`, `concept`, `exit_method`}. Each entry: `name`, `gist` (one line — what it tells you), `how_to_read` (optional one line), `external_url` (link out for depth), `category`, `related` (slugs). Deliberately terse; **zero DB storage**
- Served read-only via `GET /knowledge`; the M18 `VARIABLE_REGISTRY` references KB entries by slug so descriptions have one home
- **Consolidation (the "one place" win):** migrate scattered content into the registry — `lib/indicators.js` descriptions, `exitMethods.js`, M20's `CANDLESTICK_META`, and the R-multiple/expectancy explainers — then refactor those call sites onto one shared `<InfoPopover term="…">` component used everywhere a term appears (Screener, Watchlist, Positions, Reports, the rule builder)
- **Strategy entries** (type=`strategy`): the researched swing strategies (pullback-to-EMA, TTM/BB squeeze breakout, MACD trend-follow, RSI/Stochastic mean-reversion, ADX-filtered momentum, Supertrend trend-follow), each linking the indicators it uses via `related`. This is the strategy quick-reference *and* the source of the strategy tag seeds
- **UI:** the shared `<InfoPopover>` popup everywhere; a **Reference page** listing entries grouped by type with search — the browse/review/amend home (also houses the M20 pattern glossary)
- In-app editing is explicitly out of scope (amend via repo); notable as a future option only

**C. Strategy tagging**
- Migration `007_tags.sql`: `tags` (`id` text PK = normalized slug, `label` text display, `created_at`) + `position_tags` join (`position_id` FK ON DELETE CASCADE, `tag_id` FK, PK `(position_id, tag_id)`)
- **Normalization at create time:** `normalize_tag(s)` = trim → lowercase → collapse internal whitespace to `_` → single token (e.g. `"Breakout Setup"` → `breakout_setup`). Uniqueness on `id` means `"Breakout"` and `"breakout"` can't duplicate. Any string is allowed
- **Seed** from indicator slugs + strategy slugs (pulled from the knowledge registry) so both are discoverable immediately; create-on-type for anything else
- **Service `services/tags.py`:** `list_tags(search, with_counts)`, `upsert_tag(label) -> id`, `set_position_tags(position_id, labels)`, `performance_by_tag()`
- **API:** `GET /tags?search=` (autocomplete + usage counts) · `POST /tags` · `PATCH /positions/{id}` accepts a `tags` array (normalizes + upserts + links) · `GET /positions?tag=` filter · `GET /reports/by-tag`
- **UI:** a `TagInput` (autocomplete over existing tags + create-on-type) on the position open/edit dialog; tag chips on position rows; tag filter/search on Positions and Reports; a **performance-by-tag** section in Reports — "which strategies actually work," complementing by-signal
- **Tests:** normalization (case/whitespace/dedup), seed correctness, tag CRUD + autocomplete search, set/replace position tags, `performance_by_tag` math, `?tag=` filter

**Migrations added by M22:** `006_indicators_extra.sql`, `007_tags.sql`.

**Open decisions**
- **Seed example indicators** on the 5 new variables (a couple disabled builtins as templates) or ship variables only? (Rec: seed 1–2 disabled examples for discoverability)
- **Tag separator** `_` vs `-` for the single-token id (Rec: `_`)
- **Reference page vs. section:** standalone Reference/Knowledge page vs. folding it into an existing page (Rec: standalone page, given it's the consolidation home)

---

### 23. ⬜ Future work / next features (idea backlog)

> The custom-alert / rule-engine ideas that used to live here have been promoted to concrete milestones M18–M21. What remains below is the unscheduled idea parking lot.

#### Universe / Ticker Browser
A dedicated page for browsing and managing the `tickers` table. Key ideas:
- Search/filter by symbol, sector, avg volume, price range
- Show watchlist status per ticker (in watchlist or not) with add/remove controls
- Admin controls: "Sync Universe" button (calls `sync_universe()` + `update_ticker_metadata()`), manual refresh of ticker metadata
- Ticker detail: basic info panel per symbol (sector, avg volume, last price, data freshness)
- Out-of-universe lookup: if a symbol isn't in `tickers`, hit a free public API (e.g. Yahoo Finance or Twelve Data) to fetch basic info and offer an "Add to Universe" flow
- Full design TBD when we're ready to build

#### LLM Integrations
- **News summarizer**: scan headlines for watchlist tickers and surface relevant events (earnings, macro, geopolitical) that could affect price — summarized by an LLM
- **Trade setup advisor**: given current indicators + past trade performance, recommend entry/exit prices, stop loss levels, options/hedging strategies, and flag risks to watch as a trade unfolds

#### Deferred indicators (Tier B, from M22 research)
Evaluated during M22 and deferred; each is available in `pandas-ta` and would enter as new feature-dict variables when picked up:
- **Williams %R**, **CCI** — additional bounded oscillators; redundant with RSI/Stochastic until there's a specific need
- **Parabolic SAR** — trailing/trend; overlaps Supertrend (which we adopted)
- **Donchian Channels** — breakout / Turtle-style; adds a distinct breakout strategy family
- **Ichimoku Cloud** — powerful multi-line trend system, but heavy on variables, UI, and interpretation
- **Anchored VWAP** — needs an anchor-selection UX; more intraday-oriented
- **Aroon**, **ROC/Momentum**, **CMF / Accumulation-Distribution**, **pivot points**, **Fibonacci retracement** (tools rather than indicators)

#### Deferred from milestone 13
- **Partial exits / scale-out**: close 50% at 1R and trail the rest. `position_events` already accepts a `partial_exit` type, so no migration is needed — what's missing is the weighted-average P&L maths and the UI
- **Short positions**: `positions.direction` exists and the schema supports it, but the calculator and UI are long-only in v1
- **Broker import**: everything is manual entry today

#### Other Ideas (to evaluate)
- **Backtesting**: replay historical OHLCV + indicator snapshots through alert conditions to evaluate rule quality before going live. Now more valuable — `/reports/by-signal` gives a way to score the output
- **Multi-timeframe confirmation**: check daily setup against weekly chart before alerting — reduces false positives on shorter-term noise
- **Portfolio risk view**: correlation between open positions, total exposure by sector, aggregate open risk in R across all positions
- **Chart indicator toggles**: show/hide individual overlays (BB, EMA 8/21/50) from the chart UI; save preferences
- **Stop/target overlays on the chart**: draw an open position's entry, stop, and target as horizontal lines on the Chart page
