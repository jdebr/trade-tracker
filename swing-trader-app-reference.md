# Swing Trader App — Developer Reference

> Working log for a personal swing trading assistant. Milestones 1–8 are complete. Use this doc to understand the current state of the app, then see the Dev Work Tracker for what's next.

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
| **Frontend** | React + Vite (no TypeScript) | Tailwind v4, shadcn/ui primitives, TanStack Query v5, React Router v6 |
| **Backend** | FastAPI (Python 3.12) | Conda env `swing-trader`; APScheduler for scheduled scan |
| **Database** | PostgreSQL via Supabase | Free tier (500MB); 7 tables — see schema below |
| **Market Data** | Twelve Data (primary) + yfinance fallback | 800 req/day free; OHLCV cached in Supabase to minimize API calls |
| **Indicators** | `pandas-ta` | RSI, MACD, Bollinger Bands, EMA ribbon (8/21/50), ATR, OBV — computed on cached OHLCV |
| **Scheduler** | APScheduler `AsyncIOScheduler` | In-process; runs at 4PM ET Mon–Fri, skips NYSE holidays |
| **Charts** | TradingView Lightweight Charts v5 | Candlestick + BB/EMA overlays; deep link to TradingView.com |
| **Hosting (planned)** | Render.com (backend) + Vercel (frontend) | Render starter ~$7/mo; Vercel free |

### Running locally
- Backend: `conda activate swing-trader && cd backend && uvicorn app.main:app --reload`
- Frontend: `cd frontend && npm run dev`
- API docs: `http://localhost:8000/docs`

---

## Database Schema

7 tables in Supabase (Postgres). Schema source of truth: `supabase/schema.sql`.

| Table | Purpose |
|---|---|
| `tickers` | S&P 500 universe — symbol, name, sector, avg_volume, last_price, is_etf |
| `watchlist` | User's tracked tickers; FK to `tickers.symbol`; optional `group_name` |
| `ohlcv_cache` | Daily OHLCV bars per symbol; `UNIQUE(symbol, date)` — upserted on every fetch |
| `indicator_snapshots` | Latest computed indicator values per symbol/date — RSI, MACD, BB, EMA, ATR, OBV |
| `screener_results` | Output of each screener run — rank, score, signal flags, run timestamp |
| `alerts` | Fired alert conditions — type, symbol, price_at_trigger, details (JSONB) |
| `trade_log` | (Schema only) Links to alerts + screener_results via nullable FKs — not yet surfaced in UI |

---

## Architecture

### Screener vs. Scanner

| Mode | Purpose | Trigger | Scope |
|---|---|---|---|
| **Screener** | Find new candidates from the full S&P 500 universe | On-demand (user clicks "Run Screener") | ~500 tickers, two-pass filter |
| **Scanner** | Monitor active watchlist tickers for alert conditions | Scheduled 4PM ET daily (also manual via "Run Scan Now") | Watchlist (10–20 tickers) |

### Screener — Two-Pass Logic

**Pass 1** (static filter, no API cost): avg volume > 1M, price $15–$500, not an ETF → ~150–200 survivors

**Pass 2** (uses cached OHLCV + indicator snapshots):

| Signal | Condition |
|---|---|
| BB Squeeze | `bb_width` ≤ 20th percentile of rolling 252-bar window |
| RSI in range | 35 ≤ RSI ≤ 65 |
| Above EMA 50 | Close price > EMA-50 |
| Volume expansion | 3-day avg volume > 20-day avg volume |

Each ticker scores 0–4; output is ranked by `signal_score` descending.

### Scanner — Alert Conditions

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

### Data Flow

```
Market Close (4PM ET)                    On-Demand
        ↓                                      ↓
APScheduler triggers scan         User clicks "Run Screener"
        ↓                                      ↓
FastAPI: fetch OHLCV (Twelve Data / yfinance fallback → cache in Supabase)
        ↓                                      ↓
pandas-ta: compute indicators      Pass 1: filter tickers table
        ↓                                      ↓
Evaluate 6 alert conditions        Pass 2: score + rank survivors
        ↓                                      ↓
Insert deduped alerts              Write screener_results to Supabase
        ↓                                      ↓
Dashboard shows alerts + snapshots   Dashboard shows ranked candidates
```

---

## Dashboard Pages

All pages are implemented and working (Milestones 1–8 complete):

| Page | Description |
|---|---|
| **Watchlist** | Add/remove tickers, assign groups; user-friendly errors for duplicates and missing symbols |
| **Scanner** | Indicator snapshot table — RSI color-coded, BB squeeze dot, MACD histogram; scheduler status bar (last/next scan, cooldown, pause notice); Run Scan Now button |
| **Screener** | Run Screener button → async background job with 2s polling; ranked results table with signal dots and score badges |
| **Charts** | Candlestick + BB/EMA overlays; 1M/3M/6M/1Y/All zoom; candlestick/line toggle; TradingView deep link |
| **Alerts** | Alert cards with type badges; acknowledge + clear-all; unread count badge in nav |

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

### 9. ⬜ Deploy to production

Get the app running on Render.com + Vercel and accessible from a real URL.

**Subtasks**
- [ ] Add CORS config to FastAPI (allow Vercel domain + localhost for dev)
- [ ] Add `POST /screener/sync-universe` endpoint so universe can be initialized from the UI on a fresh install
- [ ] Push backend to GitHub → connect Render.com for auto-deploy from `main`
- [ ] Set environment variables on Render: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TWELVEDATA_API_KEY`, scheduler knobs
- [ ] Configure Vercel deployment for frontend: set `VITE_API_URL` → Render backend URL
- [ ] Set up basic error logging (stdout → Render log viewer is sufficient for now)
- [ ] Verify scheduler fires at 4PM ET and writes alerts to Supabase

**Testing criteria**
- Frontend loads from Vercel URL and connects to deployed backend
- Daily scheduler fires at 4PM ET and produces alerts
- No credentials in git history or deployed environment
- Universe sync works from a cold Supabase instance

**Technical notes**
- Render.com starter ~$7/mo; auto-deploys from `main` branch on push
- CORS: `https://<your-vercel-app>.vercel.app` and `http://localhost:5173`
- Alert condition tuning is split to a later milestone — deploy first, tune with real data

---

### 10. ⬜ Authentication and user login

Secure the app behind a login wall before it's accessible on a public URL. Single-user for now; multi-user deferred until there's a concrete need.

**Goals**
- Protect the personal instance — no unauthenticated access to any page or API endpoint
- Keep multi-user as a future option without building it now (small DB migration when needed; not worth the complexity upfront)

**Approach**
- Use Supabase Auth (email/password; OAuth optional)
- Backend: validate Supabase JWT on all protected endpoints via a FastAPI dependency
- Frontend: login page, auth context, protected route wrapper, token attached to all `@/lib/api` requests
- No `user_id` schema changes for now — all users share the same data. If multiple users are needed later, the migration on a small personal DB is straightforward.

**Subtasks**
- [ ] Enable Supabase Auth; create first user account
- [ ] FastAPI auth dependency: validate JWT on all non-health routes
- [ ] Frontend: `/login` page, auth context provider, redirect unauthenticated users, attach token to API client
- [ ] Confirm all existing features work end-to-end with auth in place

**Technical notes**
- Supabase Auth is free and already in the stack — no new service needed
- Backend continues using the service role key for DB access; JWT validation is the auth gate
- For shared access (friends/family): share one set of credentials, or add additional Supabase Auth users with the same single-tenant data

---

### 11. ⬜ App User Guide

Document the app for a user who didn't build it — covers setup, daily workflow, and what each feature does. Also serves as reference for LLM tooling and informs integration/E2E test scenarios.

**Subtasks**
- [ ] First-time setup: clone repo, configure `.env`, sync universe, run screener, add watchlist tickers
- [ ] Weekly workflow walkthrough: Sunday screener run → pick trades → monitor scanner → act on alerts
- [ ] Page-by-page feature reference: what each control does, what errors mean, how to recover
- [ ] Scheduler controls: how to pause, resume, trigger manually, interpret status bar
- [ ] Alert types: what each condition means and how to interpret it for a trade decision
- [ ] Troubleshooting: common issues (empty tickers, stale cache, cooldown, etc.)

**Technical notes**
- Written as a standalone Markdown doc (`docs/user-guide.md` or similar)
- Should be accurate enough that someone with no codebase knowledge can operate the app
- Will directly inform E2E test scenarios (milestone 13) and LLM tool descriptions (milestone 14)

---

### 12. ⬜ Integration testing

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

### 13. ⬜ End-to-end testing

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

### 14. ⬜ LLM integrations + Claude skill

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

### 15. ⬜ Alert condition tuning

Review and adjust alert thresholds based on real data observed after the app has been live for several weeks.

**Subtasks**
- [ ] Review alert history: which conditions fire most/least, any obvious false positives
- [ ] Compare alert triggers against subsequent price action (use `trade_log` or manual review)
- [ ] Adjust thresholds in `scanner.py` if needed (e.g. RSI oversold cutoff, vol expansion multiplier)
- [ ] Consider enabling/disabling specific conditions based on observed usefulness

**Technical notes**
- Requires several weeks of live data — do this after the app has been deployed and running
- This milestone is the manual precursor to the full custom alert rule engine (feature 16)

---

### 16. ⬜ Future work / next features

#### Universe / Ticker Browser
A dedicated page for browsing and managing the `tickers` table. Key ideas:
- Search/filter by symbol, sector, avg volume, price range
- Show watchlist status per ticker (in watchlist or not) with add/remove controls
- Admin controls: "Sync Universe" button (calls `sync_universe()` + `update_ticker_metadata()`), manual refresh of ticker metadata
- Ticker detail: basic info panel per symbol (sector, avg volume, last price, data freshness)
- Out-of-universe lookup: if a symbol isn't in `tickers`, hit a free public API (e.g. Yahoo Finance or Twelve Data) to fetch basic info and offer an "Add to Universe" flow
- Full design TBD when we're ready to build

#### Custom Alert Rule Engine
User-defined alert conditions, replacing or extending the hardcoded 6-condition set. Key ideas:
- Add/remove/toggle alert rules from the UI
- Rule builder: combine indicator expressions with AND/OR/NOT operators (e.g. `RSI < 35 AND bb_squeeze = true`)
- Rules and their enabled/disabled state persisted per user
- Indicator parameter customization (e.g. change RSI period from 14 to 10); saved per user
- Support for adding new indicator types beyond the current set
- Full design TBD — schema changes required (new `alert_rules` table, parameterized `indicator_configs`)

#### LLM Integrations
- **News summarizer**: scan headlines for watchlist tickers and surface relevant events (earnings, macro, geopolitical) that could affect price — summarized by an LLM
- **Trade setup advisor**: given current indicators + past trade performance, recommend entry/exit prices, stop loss levels, options/hedging strategies, and flag risks to watch as a trade unfolds

#### Other Ideas (to evaluate)
- **Trade journal + outcome logging**: record entry/exit per trade linked to the alert that triggered it; track P&L and outcome vs. alert prediction — foundational for tuning and backtesting (`trade_log` table schema already exists)
- **Backtesting**: replay historical OHLCV + indicator snapshots through alert conditions to evaluate rule quality before going live
- **Multi-timeframe confirmation**: check daily setup against weekly chart before alerting — reduces false positives on shorter-term noise
- **Portfolio risk view**: position sizing suggestions, correlation between current watchlist holdings, total exposure by sector
- **Chart indicator toggles**: show/hide individual overlays (BB, EMA 8/21/50) from the chart UI; save preferences
