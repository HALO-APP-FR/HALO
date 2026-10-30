#!/usr/bin/env bash
# Deux transactions simultanées : acceptation d'une absence et affectation sur le même créneau.
# Attendu : l'affectation attend la fin de l'acceptation puis est REFUSÉE (jamais d'affectation interdite).
# Usage : DB=postgres://postgres:test@127.0.0.1:5432/halo_local supabase/tests/concurrency.sh
set -euo pipefail
DB=${DB:-postgres://postgres:test@127.0.0.1:5432/halo_local}
read -r ORG U P T A < <(psql "$DB" -Atq -F' ' -c "
  with o as (insert into public.organizations (name) values ('QA concurrence ' || now()) returning id),
  u as (insert into auth.users (id, email) values (gen_random_uuid(), 'qa-concurrence-' || floor(random()*1e9) || '@test.invalid') returning id),
  m as (insert into public.memberships (organization_id, user_id, role) select o.id, u.id, 'agent' from o, u returning organization_id, user_id),
  p as (insert into public.properties (organization_id, name) select id, 'QA' from o returning id, organization_id),
  t as (insert into public.tasks (organization_id, property_id, type, window_start, window_end, duration_min)
        select organization_id, id, 'turnover', '2030-01-10 08:00+00', '2030-01-10 12:00+00', 60 from p returning id),
  a as (insert into public.absences (organization_id, scope, member_id, kind, starts_at, ends_at, status, client_id)
        select o.id, 'member', u.id, 'leave', '2030-01-10 00:00+00', '2030-01-11 00:00+00', 'pending', gen_random_uuid() from o, u returning id)
  select (select id from o), (select id from u), (select id from p), (select id from t), (select id from a);")
# Transaction 1 : accepte l'absence et garde la transaction ouverte 3 s
psql "$DB" -q -c "begin; update public.absences set status = 'accepted' where id = '$A'; select pg_sleep(3); commit;" &
sleep 1
# Transaction 2 : affectation pendant ce temps
if psql "$DB" -q -c "update public.tasks set assignee_id = '$U', status = 'assigned' where id = '$T';" 2>/tmp/conc.err; then R=accepted; else R=refused; fi
wait
psql "$DB" -q -c "delete from public.organizations where id = '$ORG'; delete from auth.users where id = '$U';"
echo "affectation simultanée : $R ($(grep -o 'assignee_unavailable' /tmp/conc.err || true))"
[ "$R" = refused ]
