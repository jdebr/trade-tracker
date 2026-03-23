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

## Next Steps

Suggested order of development:

1. [ ] Finalize data model (tickers, OHLCV cache, indicator snapshots, alerts)
2. [ ] Stand up FastAPI backend with Supabase connection
3. [ ] Implement OHLCV fetching + caching layer (Twelve Data + yfinance)
4. [ ] Build `pandas-ta` indicator engine (Tier 1 indicators)
5. [ ] Implement two-pass screener (S&P 500 universe, BB squeeze focus)
6. [ ] Build React frontend — watchlist + scanner table + chart view
7. [ ] Wire up APScheduler for daily 4PM ET scan
8. [ ] Add screener on-demand trigger from dashboard
9. [ ] Harden, tune alert conditions, deploy
