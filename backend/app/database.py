from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


# PostgREST caps every response (including .rpc()) at 1000 rows. The per-symbol
# SQL functions (migration 004) return at most one row per symbol, so chunking
# the symbol list keeps each call safely under the cap.
RPC_SYMBOL_CHUNK = 500


def rpc_per_symbol(fn: str, symbols: list[str], **params) -> list[dict]:
    """Call a one-row-per-symbol SQL function over `symbols`, chunked; returns all rows."""
    syms = sorted({s.upper() for s in symbols if s})
    rows: list[dict] = []
    for i in range(0, len(syms), RPC_SYMBOL_CHUNK):
        chunk = syms[i:i + RPC_SYMBOL_CHUNK]
        rows.extend(get_client().rpc(fn, {"p_symbols": chunk, **params}).execute().data or [])
    return rows
