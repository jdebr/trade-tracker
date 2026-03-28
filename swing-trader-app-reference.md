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

### 2. ⬜ Stand up FastAPI backend with Supabase connection

**Subtasks**
- [ ] Scaffold `backend/` structure (`app/`, `routers/`, `services/`, `models/`)
- [ ] Create conda environment (`swing-trader`, Python 3.12)
- [ ] Install core dependencies: `fastapi`, `uvicorn`, `supabase`, `python-dotenv`
- [ ] Wire `.env` → Supabase client singleton
- [ ] Implement health check endpoint (`GET /health`)
- [ ] Implement basic CRUD endpoints for watchlist

**Testing criteria**
- `GET /health` returns `200 OK` with Supabase connectivity confirmed
- Can add/remove a ticker from watchlist via API and verify in Supabase dashboard
- Server starts cleanly with `uvicorn app.main:app --reload`

**Technical notes**
- Conda env name: `swing-trader` (Python 3.12)
- Use `supabase-py` client with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (service role bypasses RLS for backend operations)
- `.env` lives at repo root; loaded via `python-dotenv` in `backend/app/config.py`
- `environment.yml` at `backend/environment.yml` for reproducible env setup

---

### 3. ⬜ Implement OHLCV fetching + caching layer

**Subtasks**
- [ ] Twelve Data client: fetch daily OHLCV for a list of symbols
- [ ] yfinance fallback: same interface, used when Twelve Data quota is exhausted
- [ ] Cache check: query `ohlcv_cache` before fetching — only fetch if date is stale
- [ ] Upsert fetched data into `ohlcv_cache`
- [ ] Bulk fetch endpoint for screener (up to ~500 tickers with cache)

**Testing criteria**
- Fetching a fresh ticker populates `ohlcv_cache`
- Re-fetching same ticker same day hits cache, makes zero API calls
- yfinance fallback activates correctly when Twelve Data returns a rate limit error

**Technical notes**
- Twelve Data free tier: 800 requests/day — protect with a daily counter or check response headers
- yfinance is unofficial and rate-limited; use for fallback only, not primary
- Store `source` column (`twelve_data` or `yfinance`) on every row for debugging
- Screener should batch-check cache freshness before deciding which tickers to fetch

---

### 4. ⬜ Build indicator engine (Tier 1)

**Subtasks**
- [ ] Load OHLCV from `ohlcv_cache` into a pandas DataFrame
- [ ] Compute RSI (14), MACD (12/26/9), Bollinger Bands (20/2), EMA ribbon (8/21/50) via `pandas-ta`
- [ ] Compute `bb_width` and `bb_squeeze` flag (lowest 20th percentile of rolling bb_width)
- [ ] Upsert results into `indicator_snapshots`
- [ ] Add ATR (14) and OBV at the same time (Tier 2 but trivial to include)

**Testing criteria**
- Indicator values for a known ticker/date match a reference (e.g. cross-check against TradingView)
- `bb_squeeze = true` fires correctly on a ticker known to be in a squeeze
- Upsert is idempotent — running twice doesn't duplicate rows

**Technical notes**
- `pandas-ta` appends columns directly to a DataFrame — just call `df.ta.rsi()`, `df.ta.macd()`, etc.
- Need at least 50 trading days of OHLCV history to compute EMA-50 reliably; fetch 100 days on first load
- `bb_squeeze` threshold: compute `bb_width` percentile over rolling 252-day window (1 trading year)

---

### 5. ⬜ Implement two-pass screener

**Subtasks**
- [ ] Load S&P 500 constituent list (static CSV, refresh monthly)
- [ ] Pass 1: filter by avg volume > 1M, price $15–$500, exclude ETFs
- [ ] Pass 2: apply BB squeeze + RSI range + EMA trend + volume expansion filters
- [ ] Score each survivor (0–4) and rank by score descending
- [ ] Write results to `screener_results` with `run_at` timestamp
- [ ] Expose `POST /screener/run` endpoint (triggers on-demand run, returns ranked list)

**Testing criteria**
- Pass 1 reduces ~500 tickers to ~150–200
- Pass 2 produces a ranked list of 10–20 candidates
- Results are persisted in `screener_results` and retrievable via `GET /screener/results`
- Runs complete in under 2 minutes (with warm cache)

**Technical notes**
- S&P 500 CSV source: Wikipedia table via pandas `read_html` or a static file in `backend/data/sp500.csv`
- Pass 1 uses pre-loaded ticker metadata from `tickers` table (no API calls)
- Pass 2 reads from `indicator_snapshots` cache first; only fetches/computes missing tickers
- `signal_score` = sum of: `bb_squeeze`, `rsi_in_range`, `above_ema50`, `volume_expansion` (each bool)

---

### 6. ⬜ Build React frontend (MVP)

**Subtasks**
- [ ] Set up React Router, global layout, nav
- [ ] Watchlist manager: add/remove tickers, group assignment
- [ ] Scanner view: table of watchlist tickers with live indicator values, color-coded status
- [ ] Screener view: trigger run button, ranked results table
- [ ] Chart view: TradingView Lightweight Charts with candlesticks + BB + EMA overlays
- [ ] Alert display: list of unacknowledged alerts with condition detail

**Testing criteria**
- Can add/remove tickers from watchlist and see changes persist
- Scanner table renders all indicator columns and updates on page load
- Screener run triggers backend call and displays ranked results
- Chart loads for any watchlist ticker and renders correctly

**Technical notes**
- Frontend stack: React + Vite, scaffolded in `frontend/`
- Will deploy to Vercel (free tier) — configure `VITE_API_URL` env var pointing at backend
- Use `@supabase/supabase-js` on the frontend with the `anon` key (read-only, public data only)
- Sensitive ops (screener run, writes) go through the FastAPI backend, not direct Supabase calls from frontend
- TradingView Lightweight Charts: `npm install lightweight-charts`

---

### 7. ⬜ Wire up APScheduler (daily scan)

**Subtasks**
- [ ] Add APScheduler to FastAPI app startup
- [ ] Schedule watchlist scan job at 4:00 PM ET daily (Mon–Fri)
- [ ] Job: fetch OHLCV → compute indicators → evaluate alert conditions → write to `alerts`
- [ ] Skip job on market holidays (use `pandas_market_calendars` or a static holiday list)

**Testing criteria**
- Scheduler starts with the app and logs next run time on startup
- Manual trigger of the job function populates `alerts` correctly
- Job skips correctly on a known market holiday

**Technical notes**
- Use `APScheduler` with `AsyncIOScheduler` (compatible with FastAPI's async event loop)
- Timezone: `America/New_York` — set explicitly on the cron trigger
- Job should be idempotent: re-running on the same day upserts, doesn't duplicate alerts

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
