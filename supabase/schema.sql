-- =============================================================================
-- Trade Tracker Schema
-- Run this in the Supabase SQL editor to initialize the database.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- tickers
-- The full stock universe (S&P 500 / Russell 1000 constituents).
-- Populated once from a CSV, refreshed monthly.
-- -----------------------------------------------------------------------------
CREATE TABLE tickers (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          text        UNIQUE NOT NULL,
    name            text,
    sector          text,
    industry        text,
    exchange        text,
    is_etf          boolean     NOT NULL DEFAULT false,
    in_sp500        boolean     NOT NULL DEFAULT false,
    in_russell1000  boolean     NOT NULL DEFAULT false,
    avg_volume      bigint,
    last_price      numeric(12,4),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- watchlist
-- The user's active set of tickers to monitor daily.
-- -----------------------------------------------------------------------------
CREATE TABLE watchlist (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol      text        NOT NULL REFERENCES tickers(symbol) ON UPDATE CASCADE ON DELETE CASCADE,
    group_name  text,       -- e.g. 'Active Trades', 'Watching', 'Tech'
    notes       text,
    added_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE(symbol)
);

CREATE INDEX watchlist_group_idx ON watchlist(group_name);


-- -----------------------------------------------------------------------------
-- ohlcv_cache
-- Raw daily OHLCV data fetched from Twelve Data or yfinance.
-- One row per ticker per day. Never update — only insert.
-- -----------------------------------------------------------------------------
CREATE TABLE ohlcv_cache (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol      text        NOT NULL,
    date        date        NOT NULL,
    open        numeric(12,4) NOT NULL,
    high        numeric(12,4) NOT NULL,
    low         numeric(12,4) NOT NULL,
    close       numeric(12,4) NOT NULL,
    volume      bigint      NOT NULL,
    source      text        NOT NULL CHECK (source IN ('twelve_data', 'yfinance')),
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(symbol, date)
);

CREATE INDEX ohlcv_symbol_date_idx ON ohlcv_cache(symbol, date DESC);


-- -----------------------------------------------------------------------------
-- indicator_snapshots
-- Computed technical indicator values per ticker per day.
-- Recalculated on each scanner/screener run; upsert on (symbol, date).
-- -----------------------------------------------------------------------------
CREATE TABLE indicator_snapshots (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          text        NOT NULL,
    date            date        NOT NULL,

    -- RSI
    rsi_14          numeric(8,4),

    -- MACD (12/26/9)
    macd_line       numeric(12,6),
    macd_signal     numeric(12,6),
    macd_hist       numeric(12,6),

    -- Bollinger Bands (20/2)
    bb_upper        numeric(12,4),
    bb_middle       numeric(12,4),
    bb_lower        numeric(12,4),
    bb_width        numeric(10,6),  -- (upper - lower) / middle; used for squeeze detection
    bb_squeeze      boolean,        -- true when bb_width is in the lowest 20th percentile (rolling)

    -- EMA Ribbon
    ema_8           numeric(12,4),
    ema_21          numeric(12,4),
    ema_50          numeric(12,4),

    -- Tier 2 (included now — needed for stop-loss sizing and volume confirmation)
    atr_14          numeric(12,4),
    obv             bigint,

    calculated_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE(symbol, date)
);

CREATE INDEX indicator_symbol_date_idx ON indicator_snapshots(symbol, date DESC);
CREATE INDEX indicator_bb_squeeze_idx  ON indicator_snapshots(date, bb_squeeze) WHERE bb_squeeze = true;


-- -----------------------------------------------------------------------------
-- screener_results
-- Output of each on-demand Sunday screener run.
-- Stores the ranked candidate list for historical review and filter tuning.
-- -----------------------------------------------------------------------------
CREATE TABLE screener_results (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at              timestamptz NOT NULL DEFAULT now(),
    symbol              text        NOT NULL,
    rank                integer,    -- rank within this run (1 = best)
    signal_score        integer     NOT NULL DEFAULT 0,  -- 0–4: signals passed

    -- Pass 2 filter results (stored for auditability)
    bb_squeeze          boolean,
    rsi_14              numeric(8,4),
    rsi_in_range        boolean,    -- true if 35 <= rsi_14 <= 65
    above_ema50         boolean,
    volume_expansion    boolean,

    close_price         numeric(12,4),
    notes               text
);

CREATE INDEX screener_run_at_idx ON screener_results(run_at DESC);
CREATE INDEX screener_symbol_idx  ON screener_results(symbol);


-- -----------------------------------------------------------------------------
-- alerts
-- Conditions that fired during daily scanner or screener runs.
-- Includes outcome columns for basic backtesting/journaling.
-- -----------------------------------------------------------------------------
CREATE TABLE alerts (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              text        NOT NULL,
    date                date        NOT NULL,
    alert_type          text        NOT NULL,   -- e.g. 'bb_squeeze', 'rsi_oversold', 'macd_crossover'
    signal_score        integer,                -- how many indicators aligned (composite scoring, post-MVP)
    price_at_trigger    numeric(12,4),
    details             jsonb,                  -- which conditions fired and their exact values

    acknowledged        boolean     NOT NULL DEFAULT false,

    -- Outcome logging — fill in manually or via a scheduled job after N days
    outcome_price       numeric(12,4),
    outcome_date        date,
    outcome_notes       text,

    triggered_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alerts_symbol_idx       ON alerts(symbol);
CREATE INDEX alerts_date_idx         ON alerts(date DESC);
CREATE INDEX alerts_unacknowledged   ON alerts(triggered_at DESC) WHERE NOT acknowledged;


-- -----------------------------------------------------------------------------
-- trade_log
-- Manual record of trades actually taken.
-- Links back to the alert or screener result that surfaced the idea.
-- P&L is stored explicitly — compute it in the app and save it here.
-- -----------------------------------------------------------------------------
CREATE TABLE trade_log (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol                  text        NOT NULL,
    alert_id                uuid        REFERENCES alerts(id) ON DELETE SET NULL,
    screener_result_id      uuid        REFERENCES screener_results(id) ON DELETE SET NULL,

    entry_date              date        NOT NULL,
    entry_price             numeric(12,4) NOT NULL,
    shares                  numeric(12,4),          -- share count
    position_value          numeric(12,4),          -- entry_price * shares

    exit_date               date,
    exit_price              numeric(12,4),
    pnl                     numeric(12,4),           -- (exit_price - entry_price) * shares
    pnl_pct                 numeric(8,4),            -- percentage return

    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trade_log_symbol_idx ON trade_log(symbol);
CREATE INDEX trade_log_open_idx   ON trade_log(exit_date) WHERE exit_date IS NULL;  -- open positions
