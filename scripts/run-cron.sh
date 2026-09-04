#!/usr/bin/env bash
# Phase 4 cron runner for self-hosted deployments (Docker Compose).
# Hits each cron route over HTTP with the CRON_SECRET. Schedule from system cron:
#
#   # 7am briefing + forecasts
#   0 7 * * *  /app/scripts/run-cron.sh briefing
#   30 7 * * * /app/scripts/run-cron.sh forecast
#   # rolling sweeps every 4h
#   0 */4 * * * /app/scripts/run-cron.sh sweeps
#   # weekly correlations Mon 8am
#   0 8 * * 1 /app/scripts/run-cron.sh analytics
#
# Requires: BASE_URL (e.g. http://app:3000) and CRON_SECRET in the env.

set -euo pipefail
job="${1:-}"
case "$job" in
  briefing|sweeps|forecast|analytics|health-scores|graph-importance|data-quality|backup) ;;
  *) echo "usage: $0 {briefing|sweeps|forecast|analytics|health-scores|graph-importance|data-quality|backup}" >&2; exit 2 ;;
esac

base="${BASE_URL:-http://localhost:3000}"
secret="${CRON_SECRET:?CRON_SECRET must be set}"

curl -fsS -X POST \
  -H "Authorization: Bearer ${secret}" \
  -H "Content-Type: application/json" \
  "${base}/api/cron/${job}"
echo
