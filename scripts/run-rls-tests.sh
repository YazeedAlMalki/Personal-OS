#!/usr/bin/env bash
# Phase 8 gate — run the RLS / security suite against a Postgres database that
# already has migrations 0001–0014 applied.
#
#   SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
#     ./scripts/run-rls-tests.sh
#
# Get the connection string from Supabase → Project Settings → Database →
# "Connection string" (URI). Or point it at a local `supabase start` instance:
#   SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
#
# The suite runs inside one transaction and ROLLS BACK, so it never mutates
# your data. ON_ERROR_STOP=1 makes any failed assertion exit non-zero (CI-ready).
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
if [[ -z "${DB_URL}" ]]; then
  echo "error: set SUPABASE_DB_URL (or DATABASE_URL) to your Postgres connection string." >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE="${HERE}/tests/rls/rls_policies.test.sql"

echo "Running RLS suite against ${DB_URL%@*}@…"
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${SUITE}"
echo "✓ RLS suite passed."
