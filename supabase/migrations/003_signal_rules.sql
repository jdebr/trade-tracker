-- =============================================================================
-- Migration 003 — Signal rules (data-driven screener scoring)
--
-- Run this in the Supabase SQL editor.
--
-- Turns the four hardcoded Pass-2 screener signals into rows in a `signal_rules`
-- table: a "signal" is a named JsonLogic boolean expression (see M18 rule engine)
-- over the feature dictionary. Scoring becomes data-driven — add/disable/soft-
-- delete signals without a code change. (Distinct from "indicators", which compute
-- the underlying technical values into indicator_snapshots.)
--
-- Dual-write: the four legacy boolean columns on screener_results stay populated
-- from the corresponding builtin results, so the API, the frontend Screener table,
-- and the public /status/summary endpoint are unaffected.
-- =============================================================================

CREATE TABLE signal_rules (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          text        UNIQUE NOT NULL,          -- machine name, e.g. 'bb_squeeze'
    name          text        NOT NULL,                 -- display name
    description   text,
    type          text,                                 -- family: rsi / macd / bb / ema / atr / obv / volume / composite
    expression    jsonb       NOT NULL,                 -- JsonLogic rule over the feature dict
    weight        integer     NOT NULL DEFAULT 1 CHECK (weight >= 1),  -- contribution to signal_score when it fires
    enabled       boolean     NOT NULL DEFAULT true,
    is_builtin    boolean     NOT NULL DEFAULT false,
    sort_order    integer     NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz                           -- soft delete
);

CREATE INDEX signal_rules_active_idx ON signal_rules(sort_order) WHERE deleted_at IS NULL;

-- Seed the four Pass-2 signals as builtins. These expressions evaluate identically
-- to the previous hardcoded logic (thresholds imported from screener.py: 35/65).
INSERT INTO signal_rules (slug, name, description, type, expression, weight, is_builtin, sort_order) VALUES
    ('bb_squeeze',       'BB Squeeze',       'Bollinger Band squeeze is active',        'bb',
        '{"var":"bb_squeeze"}'::jsonb, 1, true, 1),
    ('rsi_in_range',     'RSI in range',     'RSI(14) between 35 and 65',               'rsi',
        '{"<=":[35,{"var":"rsi_14"},65]}'::jsonb, 1, true, 2),
    ('above_ema50',      'Above EMA 50',     'Close is above the 50-day EMA',           'ema',
        '{">":[{"var":"close"},{"var":"ema_50"}]}'::jsonb, 1, true, 3),
    ('volume_expansion', 'Volume expansion', '3-day average volume exceeds 20-day avg', 'volume',
        '{">":[{"var":"vol_3d"},{"var":"vol_20d"}]}'::jsonb, 1, true, 4);

-- screener_results gains the dynamic signal map + the frozen normalized score.
-- The four legacy boolean columns remain (dual-written) for back-compat.
ALTER TABLE screener_results
    ADD COLUMN signals                  jsonb,          -- {slug: bool} for every evaluated signal
    ADD COLUMN signal_score_normalized  numeric(6,4),   -- achieved_weight / total_enabled_weight, frozen
    ADD COLUMN max_signal_score         numeric(8,2);   -- denominator, frozen at run time
