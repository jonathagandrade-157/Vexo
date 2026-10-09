#!/usr/bin/env bash
# Validates the expand/deploy/contract sequence for Etapa 2A in a second,
# disposable PostgreSQL database. It deliberately refuses non-local hosts
# and base database names that do not end in `_test`.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/vexo_test}"
BASE_DB_NAME="$(node -e "const u=new URL(process.argv[1]); console.log(u.pathname.slice(1))" "$DATABASE_URL")"
DB_HOST="$(node -e "const u=new URL(process.argv[1]); console.log(u.hostname)" "$DATABASE_URL")"
ADMIN_CONN="$(node -e "const u=new URL(process.argv[1]); u.pathname='/postgres'; console.log(u.toString())" "$DATABASE_URL")"

case "$DB_HOST" in
  localhost|127.0.0.1|::1) ;;
  *) echo "Refusing rollout validation against non-local host: $DB_HOST" >&2; exit 1 ;;
esac

case "$BASE_DB_NAME" in
  *_test) ;;
  *) echo "Refusing rollout validation: database must end in _test" >&2; exit 1 ;;
esac

ROLLOUT_DB_NAME="${BASE_DB_NAME}_cart_rollout"
ROLLOUT_URL="$(node -e "const u=new URL(process.argv[1]); u.pathname='/' + process.argv[2]; console.log(u.toString())" "$DATABASE_URL" "$ROLLOUT_DB_NAME")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../../../supabase/migrations" && pwd)"

cleanup() {
  psql "$ADMIN_CONN" -v ON_ERROR_STOP=1 \
    -c "drop database if exists \"$ROLLOUT_DB_NAME\" with (force);" >/dev/null
}
trap cleanup EXIT

cleanup
psql "$ADMIN_CONN" -v ON_ERROR_STOP=1 -c "create database \"$ROLLOUT_DB_NAME\";" >/dev/null
psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/../fixtures/supabase-stub.sql" >/dev/null

echo "Applying baseline migrations through 20260817220121..."
for migration in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$migration")"
  case "$name" in
    20260817220122_*) break ;;
  esac
  psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not has_table_privilege('anon', 'public.carts', 'SELECT')
     or not has_table_privilege('anon', 'public.cart_items', 'SELECT') then
    raise exception 'baseline app contract is missing anonymous cart reads';
  end if;
  if not has_function_privilege(
    'anon', 'public.add_to_cart(uuid,uuid,uuid,integer,uuid)', 'EXECUTE'
  ) or not has_function_privilege(
    'anon', 'public.create_order_from_cart(uuid,uuid,text,text,text,jsonb,text,text,text,numeric)', 'EXECUTE'
  ) then
    raise exception 'baseline app contract is missing legacy anonymous RPC access';
  end if;
  if to_regprocedure(
    'public.checkout_cart_secure(uuid,uuid,text,text,text,text,jsonb,text,text,text,numeric,text,uuid,numeric,text,text,numeric,integer)'
  ) is not null then
    raise exception 'secure checkout unexpectedly exists before expansion';
  end if;
end
$$;
SQL

echo "Applying expansion migration 20260817220122..."
psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 \
  -f "$MIGRATIONS_DIR/20260817220122_cart_ownership_expand.sql" >/dev/null

psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'carts'
      and column_name = 'owner_token_hash'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'carts'
      and column_name = 'checkout_order_id'
  ) then
    raise exception 'expansion columns were not created';
  end if;
  if not has_table_privilege('anon', 'public.carts', 'SELECT')
     or not has_function_privilege(
       'anon', 'public.add_to_cart(uuid,uuid,uuid,integer,uuid)', 'EXECUTE'
     ) then
    raise exception 'expansion broke the old application before deployment';
  end if;
  if has_function_privilege(
    'anon',
    'public.checkout_cart_secure(uuid,uuid,text,text,text,text,jsonb,text,text,text,numeric,text,uuid,numeric,text,text,numeric,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.checkout_cart_secure(uuid,uuid,text,text,text,text,jsonb,text,text,text,numeric,text,uuid,numeric,text,text,numeric,integer)',
    'EXECUTE'
  ) then
    raise exception 'expansion secure checkout privileges are incorrect';
  end if;
  if not has_table_privilege('service_role', 'public.carts', 'SELECT')
     or not has_table_privilege('service_role', 'public.carts', 'INSERT')
     or not has_table_privilege('service_role', 'public.carts', 'UPDATE')
     or not has_table_privilege('service_role', 'public.carts', 'DELETE')
     or not has_table_privilege('service_role', 'public.cart_items', 'SELECT')
     or not has_table_privilege('service_role', 'public.cart_items', 'INSERT')
     or not has_table_privilege('service_role', 'public.cart_items', 'UPDATE')
     or not has_table_privilege('service_role', 'public.cart_items', 'DELETE')
     or not has_function_privilege(
       'service_role', 'public.add_to_cart(uuid,uuid,uuid,integer,uuid)', 'EXECUTE'
     )
     or not has_function_privilege(
       'service_role', 'public.create_payment_for_order(uuid,uuid,text)', 'EXECUTE'
     )
     or not has_function_privilege(
       'service_role', 'public.attach_payment_preference(uuid,uuid,text)', 'EXECUTE'
     ) then
    raise exception 'expansion does not support the new server-side application';
  end if;
end
$$;
SQL

echo "Applying lockdown migration 20260817220123..."
psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 \
  -f "$MIGRATIONS_DIR/20260817220123_cart_checkout_lockdown.sql" >/dev/null

psql "$ROLLOUT_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if has_table_privilege('anon', 'public.carts', 'SELECT')
     or has_table_privilege('authenticated', 'public.carts', 'SELECT')
     or has_table_privilege('anon', 'public.cart_items', 'SELECT')
     or has_table_privilege('authenticated', 'public.cart_items', 'SELECT') then
    raise exception 'lockdown left direct cart table access open';
  end if;
  if has_function_privilege(
    'anon', 'public.add_to_cart(uuid,uuid,uuid,integer,uuid)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.create_order_from_cart(uuid,uuid,text,text,text,jsonb,text,text,text,numeric)',
    'EXECUTE'
  ) then
    raise exception 'lockdown left a privileged legacy RPC open';
  end if;
  if not has_function_privilege(
    'service_role', 'public.add_to_cart(uuid,uuid,uuid,integer,uuid)', 'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.create_order_from_cart(uuid,uuid,text,text,text,jsonb,text,text,text,numeric)',
    'EXECUTE'
  ) then
    raise exception 'lockdown broke the new server-side application path';
  end if;
end
$$;
SQL

echo "Cart security migration rollout validated successfully."
