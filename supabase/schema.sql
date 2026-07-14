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
-- `category` separates opportunity alerts (screener / scanner / intraday — "here
-- is a trade idea") from position alerts (a stop or target was hit on a trade you
-- are actually in). Both live in this table; the dedup queries in scanner.py and
-- intraday.py filter on category so the two kinds cannot interfere.
CREATE TABLE alerts (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              text        NOT NULL,
    date                date        NOT NULL,
    alert_type          text        NOT NULL,   -- e.g. 'bb_squeeze', 'rsi_oversold', 'macd_crossover'
    category            text        NOT NULL DEFAULT 'opportunity'
                                    CHECK (category IN ('opportunity', 'position')),
    position_id         uuid,                   -- FK added after positions table is created (below)
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
CREATE INDEX alerts_category_idx     ON alerts(category, acknowledged);
CREATE INDEX alerts_position_idx     ON alerts(position_id) WHERE position_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- app_settings
-- Single-row table holding position-sizing and exit-plan defaults.
-- The exit strategy builder pre-fills from these; any field can be overridden
-- for an individual trade without changing the defaults.
--
-- The `id boolean PRIMARY KEY CHECK (id)` trick constrains this to exactly one
-- row: the only permitted value is `true`, and the PK forbids a second one.
-- -----------------------------------------------------------------------------
CREATE TABLE app_settings (
    id                      boolean       PRIMARY KEY DEFAULT true CHECK (id),

    -- Position sizing
    account_size            numeric(14,2) NOT NULL DEFAULT 10000,
    risk_per_trade_pct      numeric(6,4)  NOT NULL DEFAULT 1.0,    -- 1.0 = risk 1% of account per trade
    max_position_pct        numeric(6,4)  NOT NULL DEFAULT 25.0,   -- warn above this % of account in one name

    -- Exit plan defaults (swing-trading conventions: 2x ATR stop, 2R target)
    default_stop_method     text          NOT NULL DEFAULT 'atr_multiple',
    default_atr_mult        numeric(6,3)  NOT NULL DEFAULT 2.0,
    default_stop_pct        numeric(6,3)  NOT NULL DEFAULT 8.0,    -- used when stop_method = 'percent'
    default_target_method   text          NOT NULL DEFAULT 'r_multiple',
    default_target_r        numeric(6,3)  NOT NULL DEFAULT 2.0,
    default_target_pct      numeric(6,3)  NOT NULL DEFAULT 16.0,   -- used when target_method = 'percent'

    -- Trailing stop (chandelier exit)
    trail_enabled           boolean       NOT NULL DEFAULT false,
    trail_atr_mult          numeric(6,3)  NOT NULL DEFAULT 3.0,

    -- Time stop — close if the thesis hasn't played out in N trading days
    time_stop_days          integer       NOT NULL DEFAULT 10,

    updated_at              timestamptz   NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (true);


-- -----------------------------------------------------------------------------
-- positions
-- One row per trade. Holds current state, denormalized for reporting.
-- The append-only audit trail lives in position_events.
--
-- is_simulated defaults to TRUE — real money is opt-in, never the default.
-- -----------------------------------------------------------------------------
CREATE TABLE positions (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              text          NOT NULL REFERENCES tickers(symbol) ON UPDATE CASCADE,
    direction           text          NOT NULL DEFAULT 'long'
                                      CHECK (direction IN ('long', 'short')),
    is_simulated        boolean       NOT NULL DEFAULT true,
    status              text          NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'closed', 'cancelled')),

    -- Provenance: what surfaced this idea
    alert_id            uuid          REFERENCES alerts(id) ON DELETE SET NULL,
    screener_result_id  uuid          REFERENCES screener_results(id) ON DELETE SET NULL,

    -- Entry
    entry_date          date          NOT NULL,
    entry_price         numeric(12,4) NOT NULL CHECK (entry_price > 0),
    shares              numeric(14,4) NOT NULL CHECK (shares > 0),
    position_value      numeric(14,4),                  -- entry_price * shares

    -- Exit plan.
    -- initial_stop_price is FROZEN at entry: it is the denominator of every
    -- R-multiple for this trade and must never change, even when the live
    -- stop_price ratchets up under a trailing stop.
    initial_stop_price  numeric(12,4) NOT NULL,
    stop_price          numeric(12,4) NOT NULL,
    target_price        numeric(12,4),
    stop_method         text,
    target_method       text,
    exit_plan           jsonb,                          -- full param set the builder used
    time_stop_date      date,

    -- Risk. risk_amount is 1R in dollars.
    risk_per_share      numeric(12,4) NOT NULL CHECK (risk_per_share > 0),
    risk_amount         numeric(14,4) NOT NULL,

    -- Signal attribution — the indicator state at the moment of entry.
    -- This is what lets the reports answer "which signals actually make money".
    entry_signals       jsonb,

    -- Exit
    exit_date           date,
    exit_price          numeric(12,4),
    exit_reason         text          CHECK (exit_reason IS NULL OR exit_reason IN (
                                          'target_hit', 'stop_hit', 'trailing_stop',
                                          'time_stop', 'manual', 'earnings'
                                      )),
    pnl                 numeric(14,4),
    pnl_pct             numeric(10,4),
    r_multiple          numeric(10,4),
    hold_days           integer,

    notes               text,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),

    -- A closed position must have its outcome filled in.
    CONSTRAINT closed_has_exit CHECK (
        status <> 'closed'
        OR (exit_date IS NOT NULL AND exit_price IS NOT NULL)
    )
);

CREATE INDEX positions_symbol_idx    ON positions(symbol);
CREATE INDEX positions_status_idx    ON positions(status);
CREATE INDEX positions_sim_idx       ON positions(is_simulated, status);
CREATE INDEX positions_open_idx      ON positions(symbol) WHERE status = 'open';
CREATE INDEX positions_exit_date_idx ON positions(exit_date DESC) WHERE status = 'closed';

-- alerts.position_id could not be declared inline above (positions did not exist yet).
ALTER TABLE alerts
    ADD CONSTRAINT alerts_position_id_fkey
    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE;


-- -----------------------------------------------------------------------------
-- position_events
-- Append-only log of everything that happened to a position.
-- Never updated, never deleted (except by cascade when the position is deleted).
--
-- partial_exit is accepted by the CHECK constraint but is not produced in v1 —
-- v1 is all-or-nothing. Listing it now means scale-out can be added later
-- without a migration.
-- -----------------------------------------------------------------------------
CREATE TABLE position_events (
    id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id  uuid          NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    event_type   text          NOT NULL CHECK (event_type IN (
                                   'opened', 'plan_revised', 'stop_moved',
                                   'target_hit', 'stop_hit', 'time_stop_reached',
                                   'partial_exit', 'closed', 'note'
                               )),
    occurred_at  timestamptz   NOT NULL DEFAULT now(),
    price        numeric(12,4),                  -- price at the time of the event
    payload      jsonb,                          -- event-specific detail
    alert_id     uuid          REFERENCES alerts(id) ON DELETE SET NULL,
    created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX position_events_position_idx ON position_events(position_id, occurred_at);
