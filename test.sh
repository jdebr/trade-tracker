#!/usr/bin/env bash
# Run all backend and frontend tests.
# Usage: bash test.sh  (from the trading/ directory)

set -e

echo "=== Backend ==="
conda run -n swing-trader python -m pytest backend/tests/ -q

echo ""
echo "=== Frontend ==="
cd frontend && npm test -- --run
