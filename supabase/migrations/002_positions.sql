-- =============================================================================
-- Migration 002 — Position tracking, exit strategy, performance reporting
--
-- Run this in the Supabase SQL editor.
--
-- NOTE: this DROPS trade_log. That table was created in milestone 1 but never
-- written to and never surfaced in the UI. Its role (recording taken trades and
-- linking them back to the alert / screener row that surfaced the idea) is taken
-- over by `positions`, which carries the same alert_id / screener_result_id FKs.
-- Confirm it is empty before running:  SELECT count(*) FROM trade_log;
-- =============================================================================

DROP TABLE IF EXISTS trade_log;


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

-- Seed the single row with defaults.
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


-- -----------------------------------------------------------------------------
-- alerts — extended to carry position alerts alongside opportunity alerts.
--
-- `category` defaults to 'opportunity', which correctly backfills every existing
-- row: everything in the table today was fired by the screener/scanner/intraday
-- jobs. No data migration needed.
-- -----------------------------------------------------------------------------
ALTER TABLE alerts
    ADD COLUMN category text NOT NULL DEFAULT 'opportunity'
        CHECK (category IN ('opportunity', 'position'));

ALTER TABLE alerts
    ADD COLUMN position_id uuid REFERENCES positions(id) ON DELETE CASCADE;

CREATE INDEX alerts_category_idx ON alerts(category, acknowledged);
CREATE INDEX alerts_position_idx ON alerts(position_id) WHERE position_id IS NOT NULL;
