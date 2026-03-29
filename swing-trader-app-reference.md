# Swing Trader App — Developer Reference

> Summary of initial planning conversation. Use as a starting reference for architecture, stack decisions, and feature scope.

---

## Project Overview

A personal, web-hosted swing trading assistant designed to reduce manual chart analysis time. The app surfaces trade candidates and monitors a watchlist — it does **not** execute trades. The user trades via a separate commercial brokerage.

**Goals:**
- Identify 1–2 high-quality swing trade setups per week (Monday entry, Friday exit)
- Spend no more than 5–10 hours/week on trading activities
- Keep infrastructure costs under $25/month
- Build something useful without overengineering

---

## User Profile

| Attribute | Detail |
|---|---|
| Trading style | Swing trading (days to weeks) |
| Target trades | 1–2 per week |
| Coding level | Advanced (comfortable with infra) |
| Alert delivery | In-app dashboard only |
| Monthly budget | $10–$25 |

---

## Architecture

### Two-Mode Design

The core pattern is a **screener/scanner split**:

| Mode | Purpose | When to Run | Scope |
|---|---|---|---|
| **Screener** | Broad universe scan to find candidates | On-demand (Sunday evening) | S&P 500 or Russell 1000 (~500 tickers) |
| **Scanner** | Deep daily monitoring of chosen tickers | Scheduled at market close (4PM ET) | Watchlist (10–20 tickers) |

### Weekly Workflow

```
Sunday evening (~15 min):
  → Run screener on S&P 500 universe
  → Review top 10–15 candidates in dashboard
  → Manually check charts on 2–3 finalists
  → Pick 1–2 trades for Monday

Mon–Fri (~5 min/day):
  → Watchlist scanner auto-runs at 4PM ET
  → Check dashboard for exit condition hits
  → Hold or close

Friday:
  → Close remaining positions
  → (Optional) log outcome for future tuning
```

---

## Recommended Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| **Frontend** | React (Vite) | Hosted on Vercel — free tier sufficient |
| **Backend** | FastAPI (Python) | On AWS EC2 t3.micro (~$8/mo) or Render.com starter (~$7/mo) |
| **Database** | PostgreSQL via Supabase | Free tier (500MB) — stores watchlist, indicator snapshots, alert history, OHLCV cache |
| **Market Data** | Twelve Data (free tier) + yfinance fallback | 800 req/day free; sufficient for swing trading with caching |
| **Indicator Engine** | `pandas-ta` (Python) | Covers all planned indicators out of the box |
| **Job Scheduler** | APScheduler (in-process) | Runs scans at market close; on-demand screener runs |
| **Charts** | TradingView Lightweight Charts | Free, excellent candlestick + overlay support |

### Why Not Lambda?

An always-on small server (EC2 or Render) is preferred over Lambda for this use case:
- Easier to run scheduled jobs (APScheduler in-process)
- No cold start latency for on-demand screener runs
- Simpler to manage indicator calculation workloads

---

## Market Data Strategy

### API: Twelve Data (Primary)
- Free tier: 800 requests/day
- Supports EOD + 15-min delayed intraday
- Sufficient for swing trading — no need for real-time tick data

### Caching Strategy
- Store every OHLCV response in Supabase
- On each run, only fetch tickers where cached date is stale
- After a few weeks, incremental updates are minimal

### Screener Universe
- Start from S&P 500 or Russell 1000 constituent list (free CSV/JSON)
- Avoids scanning all 8,000+ US tickers
- 500 tickers × ~1 API call each = well within free tier limits

---

## Screener Logic (Two-Pass)

### Pass 1 — Universe Filter
*Static list, refresh monthly. No API cost.*

- Constituents of S&P 500 or Russell 1000
- Average daily volume > 1M shares
- Price between $15–$500
- Exclude ETFs

**Result:** ~500 tickers → filtered to ~150–200 serious candidates

### Pass 2 — Setup Filter
*Run Sunday evening using cached/fresh OHLCV data.*

| Signal | Condition | Rationale |
|---|---|---|
| Bollinger Band squeeze | Bands narrowing | Predicts explosive move; resolves over days–weeks |
| RSI | Between 35–65 | Avoids already-extended setups |
| EMA trend | Price above 50-day EMA | Don't fight the primary trend |
| Volume expansion | Increasing volume last 2–3 days | Confirms accumulation |

**Output:** Ranked list of 10–15 candidates for manual review

---

## Technical Indicators

### Tier 1 — Build First

| Indicator | Params | Use Case |
|---|---|---|
| RSI | 14 | Oversold bounces / overbought fades; core swing entry signal |
| MACD | 12/26/9 | Histogram crossovers align with multi-day moves; easy to scan |
| Bollinger Bands | 20/2 | Squeeze detection + breakout confirmation |
| EMA Ribbon | 8 / 21 / 50 | Trend direction at a glance across watchlist |

### Tier 2 — Add After MVP

| Indicator | Use Case |
|---|---|
| ATR (14) | Stop-loss and target sizing — critical for swing trading |
| OBV | Confirms whether price moves have institutional backing |
| Stochastic RSI | More sensitive early-turn detection than plain RSI |

### Tier 3 — Later or Manual Only

| Indicator | Notes |
|---|---|
| Candlestick patterns | `pandas-ta` can auto-flag (Doji, Hammer, Engulfing, etc.) — good secondary signal layer |
| Elliott Wave | **Do not automate.** Highly subjective; use as a manual chart-reading skill only |

### Full Indicator Reference (for future consideration)

**Trend:** SMA, EMA, WMA, MACD, ADX, Ichimoku Cloud
**Momentum/Oscillators:** RSI, Stochastic, CCI, Williams %R
**Volatility:** Bollinger Bands, ATR, Keltner Channels
**Volume:** OBV, VWAP, Volume Profile, MFI
**Pattern-based:** Candlestick patterns, Support/Resistance levels

---

## Data Flow

```
Market Close (4PM ET)
        ↓
APScheduler triggers watchlist scan
        ↓
FastAPI fetches OHLCV for watchlist tickers (Twelve Data / yfinance fallback)
        ↓
pandas-ta runs indicator calculations on each ticker
        ↓
Condition engine evaluates alert rules
  e.g. "RSI < 35 AND price touching lower BB AND OBV rising"
        ↓
Results written to Supabase (alerts table + indicator snapshots)
        ↓
Dashboard reads on next login → shows triggered alerts + charts

─────────────────────────────────────────

On-Demand (Sunday Screener Run)
        ↓
User clicks "Run Screener" in dashboard
        ↓
Pass 1: filter pre-loaded universe list
        ↓
Pass 2: fetch OHLCV for survivors (use cache where fresh)
        ↓
Run BB squeeze + RSI + EMA + volume filters
        ↓
Return ranked candidate list to dashboard
```

---

## Dashboard Features

### MVP (Build First)

- **Watchlist manager** — add/remove tickers, organize into groups (e.g. "Active Trades", "Watching", "Tech")
- **Scanner view** — table of all watchlist tickers with current indicator values, color-coded by condition status
- **Screener view** — on-demand run, ranked output table with key signals per candidate
- **Chart view** — candlestick chart with overlaid indicators per ticker (TradingView Lightweight Charts)
- **Alert condition display** — shows which rules fired and when

### Post-MVP (Add Later)

- **Alert rule builder** — UI to define custom conditions (e.g. `RSI < 35 AND BB_lower_touch = true`)
- **Alert history log** — what fired, when, and price outcome (useful for tuning rules)
- **Composite signal score** — rank tickers by number of bullish signals (e.g. "4 of 5 indicators aligned") rather than binary alerts
- **Multi-timeframe view** — confirm daily setups against weekly chart

### Deprioritize / Skip

- Real-time intraday data (overkill for weekly swings, expensive)
- Elliott Wave automation
- Algorithmic trade recommendations (surface candidates, don't make decisions)
- SMS/email alerts (in-app only per user preference)

---

## Open Design Questions

These were flagged during planning and should be decided before or during early development:

1. **Multi-timeframe analysis** — Do you want the scanner to check both the daily and weekly chart simultaneously? Affects data fetching and indicator storage model.

2. **Scoring vs. binary alerts** — Composite score per ticker (e.g. "3 of 5 bullish") vs. simple pass/fail condition. Score-based ranking is more useful for the screener; binary is simpler for watchlist alerts.

3. **Backtesting** — Even basic outcome logging ("alert fired at $X, price was $Y one week later") needs to be designed into the schema from day one if desired later.

4. **Watchlist grouping** — Simple flat list vs. named groups (e.g. "Active", "Candidates", "Sector: Tech"). Groups are low-effort to build and high-value for organization.

---

## Cost Estimate

| Service | Tier | Est. Monthly Cost |
|---|---|---|
| Vercel (frontend) | Free | $0 |
| Render.com or EC2 t3.micro (backend) | Starter / free tier | $0–$8 |
| Supabase (database) | Free (500MB) | $0 |
| Twelve Data (market data) | Free (800 req/day) | $0 |
| yfinance (fallback) | Free (unofficial) | $0 |
| **Total** | | **$0–$8/mo** |

Well within budget. Room to upgrade Twelve Data to a paid plan (~$29/mo) if real-time data becomes desirable later.

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

### 8. ⬜ Add screener on-demand trigger from dashboard

**Subtasks**
- [ ] "Run Screener" button in frontend hits `POST /screener/run`
- [ ] Show progress indicator while running (can take 30–90 seconds with cold cache)
- [ ] Display results immediately on completion without page reload

**Testing criteria**
- Button triggers run, shows loading state, then renders results
- Works end-to-end from deployed frontend → backend → Supabase

**Technical notes**
- Consider using a background task (`BackgroundTasks` in FastAPI) so the endpoint returns immediately with a job ID, then poll for completion
- This is particularly important once deployed, where request timeouts may be an issue

---

### 9. ⬜ Harden, tune, and deploy

**Subtasks**
- [ ] Choose hosting: Render.com starter ($7/mo) vs AWS EC2 t3.micro (~$8/mo)
- [ ] Set up environment variables on host
- [ ] Configure Vercel deployment for frontend (`VITE_API_URL` → backend URL)
- [ ] Add CORS config to FastAPI (allow Vercel domain)
- [ ] Tune alert conditions against a few weeks of real data
- [ ] Set up basic error logging (stdout → host log viewer is sufficient)

**Testing criteria**
- Frontend loads from Vercel URL and connects to deployed backend
- Daily scheduler fires at 4PM ET and produces alerts
- No credentials in git history or deployed environment

**Technical notes**
- Render.com is simpler to deploy than EC2 for a personal project — recommended first choice
- Backend deploy: push to GitHub → Render auto-deploys from `main` branch
- CORS: allow `https://<your-vercel-app>.vercel.app` and `http://localhost:5173` (dev)

### 10. Public API
[TODO]

### 11. Claude Skill for public api
[TODO]

### 12. App User Guide
- Explain app features and functionality
- Informs testing and future work

### 13. Integration testing
[TODO]

### 14. End-to-end testing
[TODO]

### 15. Future work, next features
[TODO]