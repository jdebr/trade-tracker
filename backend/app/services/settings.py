"""
App settings — position sizing and exit plan defaults.

Backed by a single-row `app_settings` table (guarded by `id boolean PK CHECK (id)`).
The row is seeded by the migration, but `get_settings()` falls back to the same
defaults in code so a fresh or half-migrated database can't take the app down.
"""

import logging
from app.database import get_client

logger = logging.getLogger(__name__)

# Mirrors the column defaults in supabase/schema.sql. Used only as a safety net
# when the app_settings row is missing.
DEFAULTS = {
    "account_size":          10000.0,
    "risk_per_trade_pct":    1.0,
    "max_position_pct":      25.0,
    "default_stop_method":   "atr_multiple",
    "default_atr_mult":      2.0,
    "default_stop_pct":      8.0,
    "default_target_method": "r_multiple",
    "default_target_r":      2.0,
    "default_target_pct":    16.0,
    "trail_enabled":         False,
    "trail_atr_mult":        3.0,
    "time_stop_days":        10,
}


def get_settings() -> dict:
    """Return the settings row, falling back to DEFAULTS if it is missing."""
    result = get_client().table("app_settings").select("*").limit(1).execute()
    if not result.data:
        logger.warning("app_settings row missing — using built-in defaults")
        return dict(DEFAULTS)
    return result.data[0]


def update_settings(updates: dict) -> dict:
    """Apply a partial update to the settings row and return the new state."""
    if not updates:
        return get_settings()

    result = (
        get_client()
        .table("app_settings")
        .update(updates)
        .eq("id", True)
        .execute()
    )
    if not result.data:
        raise ValueError("app_settings row not found — run migration 002")

    logger.info("Settings updated: %s", updates)
    return result.data[0]
