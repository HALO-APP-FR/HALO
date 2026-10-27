#!/usr/bin/env bash
# Lance les tests d'isolation sur une base PostgreSQL vierge.
# Usage : DATABASE_URL=postgres://user:pass@host:5432/postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
URL="${DATABASE_URL:?DATABASE_URL requis (base de test jetable, jamais la production)}"
DB="halo_isolation_$$"
psql "$URL" -v ON_ERROR_STOP=1 -qc "create database $DB"
trap 'psql "$URL" -qc "drop database if exists $DB with (force)" >/dev/null' EXIT
TEST_URL="${URL%/*}/$DB"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "→ tests d'isolation"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/isolation.sql
