#!/usr/bin/env bash
# Rebuilds the RLS integration test database from scratch: drops it,
# recreates it, applies the local Supabase auth stub (test-only — see
# tests/integration/fixtures/supabase-stub.sql), then every migration in
# supabase/migrations/ in order. Used both locally and in CI
# (.github/workflows/ci.yml) so the same script is what's actually
# verified, not a hand-copied version of the steps.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/vexo_test}"

# Split out the admin connection (defaults to the `postgres` maintenance
# database) so we can DROP/CREATE the target database itself.
ADMIN_URL="$(node -e "
  const u = new URL(process.env.DATABASE_URL);
  const dbName = u.pathname.replace(/^\//, '');
  u.pathname = '/postgres';
  console.log(JSON.stringify({ adminUrl: u.toString(), dbName }));
" DATABASE_URL="$DATABASE_URL")"

DB_NAME="$(node -e "console.log(JSON.parse(process.argv[1]).dbName)" "$ADMIN_URL")"
ADMIN_CONN="$(node -e "console.log(JSON.parse(process.argv[1]).adminUrl)" "$ADMIN_URL")"

echo "Resetting database '$DB_NAME'..."
psql "$ADMIN_CONN" -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB_NAME\";"
psql "$ADMIN_CONN" -v ON_ERROR_STOP=1 -c "create database \"$DB_NAME\";"

echo "Applying test-only Supabase auth stub..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../fixtures/supabase-stub.sql"

echo "Applying migrations..."
for f in "$(dirname "$0")"/../../../supabase/migrations/*.sql; do
  echo "  -> $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

echo "Done."
