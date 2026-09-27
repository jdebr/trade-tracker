-- =============================================================================
-- Migration 004 — Per-symbol bulk reads + indicator_snapshots.extra
--
-- Run this in the Supabase SQL editor.
--
-- 1. Bulk-read functions. PostgREST caps every response (including .rpc()) at
--    1000 rows. The app used to fetch per-day history for hundreds of symbols
--    and reduce it in Python, so those reads were silently truncated (the
--    screener's 20-day volume average was really ~3 days). These functions do
--    the reduction in Postgres and return at most ONE row per requested symbol,
--    via LATERAL + LIMIT on the existing (symbol, date DESC) indexes.
--
-- 2. indicator_snapshots.extra (jsonb) — sparse computed flags (M20 candlestick
--    patterns; later other computed variables). Only true keys are stored.
--    NULL = not computed yet; {} = computed, nothing fired.
--
-- All functions are SECURITY INVOKER (the default) and callable only by the
-- backend's service role.
-- =============================================================================

ALTER TABLE indicator_snapshots ADD COLUMN IF NOT EXISTS extra jsonb;


-- Newest snapshot per symbol.
CREATE OR REPLACE FUNCTION latest_indicator_snapshots(p_symbols text[])
RETURNS SETOF indicator_snapshots
LANGUAGE sql STABLE AS $$
    SELECT s.*
    FROM (SELECT DISTINCT unnest(p_symbols) AS sym) u
    CROSS JOIN LATERAL (
        SELECT * FROM indicator_snapshots i
        WHERE i.symbol = u.sym
        ORDER BY i.date DESC
        LIMIT 1
    ) s;
$$;


-- Second-newest snapshot per symbol (crossover detection needs two bars).
CREATE OR REPLACE FUNCTION prior_indicator_snapshots(p_symbols text[])
RETURNS SETOF indicator_snapshots
LANGUAGE sql STABLE AS $$
    SELECT s.*
    FROM (SELECT DISTINCT unnest(p_symbols) AS sym) u
    CROSS JOIN LATERAL (
        SELECT * FROM indicator_snapshots i
        WHERE i.symbol = u.sym
        ORDER BY i.date DESC
        OFFSET 1 LIMIT 1
    ) s;
$$;


-- Per-symbol summary of the trailing `p_window` bars: latest date/close, how
-- many bars were found, 3-bar and full-window average volume, newest fetch time.
-- Symbols with no cached bars are omitted.
CREATE OR REPLACE FUNCTION ohlcv_summary(p_symbols text[], p_window int DEFAULT 20)
RETURNS TABLE (
    symbol          text,
    last_date       date,
    last_close      numeric,
    bar_count       int,
    vol_3d          numeric,
    vol_avg         numeric,
    last_fetched_at timestamptz
)
LANGUAGE sql STABLE AS $$
    SELECT
        u.sym,
        max(b.date),
        (array_agg(b.close ORDER BY b.date DESC))[1],
        count(*)::int,
        avg(b.volume) FILTER (WHERE b.rn <= 3),
        avg(b.volume),
        max(b.fetched_at)
    FROM (SELECT DISTINCT unnest(p_symbols) AS sym) u
    CROSS JOIN LATERAL (
        SELECT c.date, c.close, c.volume, c.fetched_at,
               row_number() OVER (ORDER BY c.date DESC) AS rn
        FROM ohlcv_cache c
        WHERE c.symbol = u.sym
        ORDER BY c.date DESC
        LIMIT greatest(p_window, 1)
    ) b
    GROUP BY u.sym;
$$;


-- Set tickers.last_price / avg_volume from the trailing 20 bars in one
-- statement (was two round trips per ticker). Returns rows updated.
CREATE OR REPLACE FUNCTION refresh_ticker_metadata(p_symbols text[])
RETURNS int
LANGUAGE sql VOLATILE AS $$
    WITH s AS (SELECT * FROM ohlcv_summary(p_symbols, 20)),
    upd AS (
        UPDATE tickers t
        SET last_price = s.last_close,
            avg_volume = round(s.vol_avg)::bigint
        FROM s
        WHERE t.symbol = s.symbol
        RETURNING 1
    )
    SELECT count(*)::int FROM upd;
$$;


REVOKE EXECUTE ON FUNCTION latest_indicator_snapshots(text[])  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prior_indicator_snapshots(text[])   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ohlcv_summary(text[], int)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refresh_ticker_metadata(text[])     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION latest_indicator_snapshots(text[])  TO service_role;
GRANT  EXECUTE ON FUNCTION prior_indicator_snapshots(text[])   TO service_role;
GRANT  EXECUTE ON FUNCTION ohlcv_summary(text[], int)          TO service_role;
GRANT  EXECUTE ON FUNCTION refresh_ticker_metadata(text[])     TO service_role;

-- Make PostgREST see the new functions immediately.
NOTIFY pgrst, 'reload schema';
