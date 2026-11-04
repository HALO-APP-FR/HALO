#!/usr/bin/env bash
# Tests de concurrence réelle : deux sessions PostgreSQL en parallèle (base jetable, jamais la production).
# Usage : DATABASE_URL=postgres://user:pass@host:5432/postgres supabase/tests/concurrency.sh
#   OLD_OVERLAP=1 : rejoue d'abord avec l'ancien contrôle de chevauchement (sans verrou) pour montrer le défaut.
set -euo pipefail
cd "$(dirname "$0")/../.."
URL="${DATABASE_URL:?DATABASE_URL requis}"
DB="halo_concurrency_$$"
psql "$URL" -v ON_ERROR_STOP=1 -qc "create database $DB"
trap 'psql "$URL" -qc "drop database if exists $DB with (force)" >/dev/null' EXIT
T="${URL%/*}/$DB"
psql "$T" -v ON_ERROR_STOP=1 -q -f supabase/tests/supabase-stub.sql
for f in supabase/migrations/*.sql; do psql "$T" -v ON_ERROR_STOP=1 -q -f "$f"; done

ORG=11111111-1111-1111-1111-111111111111
MGR=22222222-2222-2222-2222-222222222222
MGR2=33333333-3333-3333-3333-333333333333
PROP=44444444-4444-4444-4444-444444444444
psql "$T" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email) values ('$MGR', 'm1@test.invalid'), ('$MGR2', 'm2@test.invalid');
insert into public.organizations (id, name) values ('$ORG', 'Concurrence');
insert into public.memberships (organization_id, user_id, role) values ('$ORG', '$MGR', 'manager'), ('$ORG', '$MGR2', 'manager');
insert into public.properties (id, organization_id, name) values ('$PROP', '$ORG', 'Logement C');
SQL
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1 (obtenu : $2, attendu : $3)"; fail=$((fail+1)); fi; }
as_mgr() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"; }

overlap_race() {
  local label="$1" a="$2" b="$3"
  psql "$T" -qAt -c "delete from public.reservations where property_id = '$PROP'" >/dev/null
  # Session 1 : crée un séjour, garde la transaction ouverte 2 s ; session 2 : séjour chevauchant pendant ce temps
  ( psql "$T" -qAt -c "$(as_mgr $MGR) begin; insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values ('$ORG', '$PROP', $a); select pg_sleep(2); commit;" >/dev/null 2>&1 ) &
  sleep 0.5
  local out
  out=$(psql "$T" -qAt -c "$(as_mgr $MGR2) insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values ('$ORG', '$PROP', $b);" 2>&1 || true)
  wait
  local n
  n=$(psql "$T" -qAt -c "select count(*) from public.reservations where property_id = '$PROP' and status = 'confirmed'")
  echo "$label séjours confirmés = $n ; seconde création : $(echo "$out" | grep -o 'stay_overlap' || echo 'acceptée')" >&2
  echo "$n"
}

if [ "${OLD_OVERLAP:-}" = "1" ]; then
  echo "Reproduction (ancien contrôle, sans verrou) :"
  psql "$T" -q -v ON_ERROR_STOP=1 <<'SQL'
create or replace function public.check_stay_overlap() returns trigger language plpgsql security definer set search_path = '' as $f$
begin
  if new.status <> 'confirmed' then return new; end if;
  if exists (select 1 from public.reservations o where o.organization_id = new.organization_id and o.property_id = new.property_id and o.id <> new.id
               and o.status = 'confirmed' and o.check_in_at < new.check_out_at and o.check_out_at > new.check_in_at) then
    raise exception 'stay_overlap' using errcode = '23P01';
  end if;
  return new;
end $f$;
SQL
  n=$(overlap_race "  ancien" "'2030-01-10 16:00+00', '2030-01-14 11:00+00'" "'2030-01-12 16:00+00', '2030-01-15 11:00+00'" | tail -1)
  echo "  → ancien contrôle : $n séjours qui se chevauchent (défaut reproduit si 2)"
  # Remise de la fonction corrigée (migration 16)
  psql "$T" -q -v ON_ERROR_STOP=1 <<'SQL'
create or replace function public.check_stay_overlap() returns trigger language plpgsql security definer set search_path = '' as $f$
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and new.check_in_at = old.check_in_at and new.check_out_at = old.check_out_at and new.property_id = old.property_id and old.status = 'confirmed' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('stay:' || new.property_id::text, 0));
  if exists (select 1 from public.reservations o where o.organization_id = new.organization_id and o.property_id = new.property_id and o.id <> new.id
               and o.status = 'confirmed' and o.check_in_at < new.check_out_at and o.check_out_at > new.check_in_at) then
    raise exception 'stay_overlap' using errcode = '23P01';
  end if;
  return new;
end $f$;
SQL
fi

echo "1. Deux créations de séjour simultanées sur les mêmes dates :"
n=$(overlap_race "  " "'2030-02-10 16:00+00', '2030-02-14 11:00+00'" "'2030-02-12 16:00+00', '2030-02-15 11:00+00'" | tail -1)
check "un seul séjour enregistré" "$n" "1"

echo "2. Deux créations simultanées sur des dates différentes (pas de faux refus) :"
n=$(overlap_race "  " "'2030-03-10 16:00+00', '2030-03-12 11:00+00'" "'2030-03-12 16:00+00', '2030-03-14 11:00+00'" | tail -1)
check "les deux séjours enregistrés" "$n" "2"

echo "3. Arrivée anticipée confirmée pendant qu'un autre responsable modifie le séjour :"
psql "$T" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL
delete from public.reservations where property_id = '$PROP';
insert into public.guest_guides (organization_id, property_id, enabled) values ('$ORG', '$PROP', true) on conflict do nothing;
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at)
values ('55555555-5555-5555-5555-555555555555', '$ORG', '$PROP', 'Concurrent', '2030-04-10 16:00+00', '2030-04-12 11:00+00');
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source)
values ('66666666-6666-6666-6666-666666666666', '$ORG', '$PROP', '55555555-5555-5555-5555-555555555555', 'early_checkin', '2030-04-10 14:00+00', 'requested', 'guest');
SQL
( psql "$T" -qAt -c "$(as_mgr $MGR2) begin; update public.reservations set check_in_at = '2030-04-10 17:00+00' where id = '55555555-5555-5555-5555-555555555555'; select pg_sleep(2); commit;" >/dev/null 2>&1 ) &
sleep 0.5
out=$(psql "$T" -qAt -c "$(as_mgr $MGR) select public.timing_decide('$ORG', '66666666-6666-6666-6666-666666666666', 'confirm', true, '2030-04-10 16:00+00') ->> 'status';" 2>&1 | tail -1)
wait
check "décision refusée : le séjour a changé entre-temps" "$out" "stay_changed"
st=$(psql "$T" -qAt -c "select s.status || '/' || to_char(r.check_in_at at time zone 'UTC', 'HH24:MI') from public.service_requests s join public.reservations r on r.id = s.reservation_id where s.id = '66666666-6666-6666-6666-666666666666'")
check "demande non confirmée, séjour à l'heure modifiée" "$st" "requested/17:00"

echo "4. Deux confirmations simultanées de la même demande :"
( psql "$T" -qAt -c "$(as_mgr $MGR) begin; select public.timing_decide('$ORG', '66666666-6666-6666-6666-666666666666', 'confirm', true); select pg_sleep(1.5); commit;" >/dev/null 2>&1 ) &
sleep 0.4
out=$(psql "$T" -qAt -c "$(as_mgr $MGR2) select public.timing_decide('$ORG', '66666666-6666-6666-6666-666666666666', 'confirm', true) ->> 'status';" 2>&1 | tail -1)
wait
check "la seconde confirmation est sans effet" "$out" "already"
n=$(psql "$T" -qAt -c "select count(*) from public.service_events where service_id = '66666666-6666-6666-6666-666666666666' and kind = 'status' and status = 'confirmed'")
check "une seule décision enregistrée" "$n" "1"

echo "5. Deux responsables décident en même temps deux demandes différentes du même séjour :"
psql "$T" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source) values
  ('77777777-7777-7777-7777-777777777771', '$ORG', '$PROP', '55555555-5555-5555-5555-555555555555', 'early_checkin', '2030-04-10 13:00+00', 'requested', 'guest'),
  ('77777777-7777-7777-7777-777777777772', '$ORG', '$PROP', '55555555-5555-5555-5555-555555555555', 'early_checkin', '2030-04-10 12:00+00', 'requested', 'guest');
SQL
cur=$(psql "$T" -qAt -c "select check_in_at from public.reservations where id = '55555555-5555-5555-5555-555555555555'")
( psql "$T" -qAt -c "$(as_mgr $MGR) begin; select public.timing_decide('$ORG', '77777777-7777-7777-7777-777777777771', 'confirm', true, '$cur'); select pg_sleep(1.5); commit;" >/dev/null 2>&1 ) &
sleep 0.4
out=$(psql "$T" -qAt -c "$(as_mgr $MGR2) select public.timing_decide('$ORG', '77777777-7777-7777-7777-777777777772', 'confirm', true, '$cur') ->> 'status';" 2>&1 | tail -1)
wait
check "la seconde décision, prise sur l'ancienne heure, est refusée" "$out" "stay_changed"
st=$(psql "$T" -qAt -c "select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = '55555555-5555-5555-5555-555555555555'")
check "le séjour porte l'heure de la décision enregistrée" "$st" "13:00"
st=$(psql "$T" -qAt -c "select string_agg(status, ',' order by start_at) from public.service_requests where id in ('77777777-7777-7777-7777-777777777771', '77777777-7777-7777-7777-777777777772')")
check "une confirmée, l'autre toujours en attente (à redécider sur données à jour)" "$st" "requested,confirmed"
echo "6. Deux envois d'e-mails simultanés (aucun e-mail envoyé deux fois) :"
psql "$T" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.notification_outbox (organization_id, recipient, template) select '$ORG', 'c' || g || '@example.test', 'timing_confirmed' from generate_series(1, 6) g;
SQL
( psql "$T" -qAt -c "begin; select count(*) from public.outbox_claim('$ORG', 4); select pg_sleep(1.5); commit;" > /tmp/claim1_$$ 2>&1 ) &
sleep 0.4
n2=$(psql "$T" -qAt -c "select count(*) from public.outbox_claim('$ORG', 50)" 2>&1 | tail -1)
wait
n1=$(grep -E '^[0-9]+$' /tmp/claim1_$$ | head -1); rm -f /tmp/claim1_$$
check "les deux envois se répartissent les e-mails sans chevauchement (4 + 2)" "$n1+$n2" "4+2"
n=$(psql "$T" -qAt -c "select count(*) from public.notification_outbox where organization_id = '$ORG' and template = 'timing_confirmed' and status = 'pending'")
check "aucun e-mail laissé en attente ni réservé deux fois" "$n" "0"
echo "7. Deux responsables planifient le linge du même séjour en même temps :"
psql "$T" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at)
values ('88888888-8888-8888-8888-888888888888', '$ORG', '$PROP', 'Linge', '2030-06-10 16:00+00', '2030-06-12 11:00+00');
SQL
( psql "$T" -qAt -c "$(as_mgr $MGR) begin; select public.plan_linen_delivery('$ORG', '88888888-8888-8888-8888-888888888888', '2030-06-10 10:00+00', '2030-06-10 16:00+00', 20); select pg_sleep(1.5); commit;" >/dev/null 2>&1 ) &
sleep 0.4
out=$(psql "$T" -qAt -c "$(as_mgr $MGR2) select public.plan_linen_delivery('$ORG', '88888888-8888-8888-8888-888888888888', '2030-06-10 10:00+00', '2030-06-10 16:00+00', 20) ->> 'status';" 2>&1 | tail -1)
wait
check "la seconde demande retrouve la mission existante" "$out" "exists"
n=$(psql "$T" -qAt -c "select count(*) from public.tasks where next_reservation_id = '88888888-8888-8888-8888-888888888888' and type = 'linen_delivery'")
check "une seule livraison de linge" "$n" "1"
echo "Bilan : $pass réussi(s), $fail échec(s)"
[ "$fail" = "0" ]
