-- =====================================================================
-- HALO — tests d'isolation et de droits du lot 1
-- Exécutés en super-utilisateur ; chaque essai bascule dans le rôle
-- anon / authenticated avec l'identité voulue, comme une vraie requête.
-- Toute ligne en échec fait échouer le script (code de sortie ≠ 0).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create schema t;
grant usage on schema t to anon, authenticated;
create table t.ids (name text primary key, id uuid not null);
create table t.results (n serial, name text, ok boolean, got text);
create table t.brow (tbl text, org text, j jsonb);

create function t.id(k text) returns uuid language sql stable as $$ select id from t.ids where name = k $$;

-- Exécute q comme `who` (null = anonyme). keep=false : tout est annulé ensuite.
create function t.exec(who text, q text, keep boolean default false, is_dml boolean default false)
returns text language plpgsql as $$
declare r text; n bigint;
begin
  begin
    if who is null then
      perform set_config('request.jwt.claim.sub', '', true);
      execute 'set local role anon';
    else
      perform set_config('request.jwt.claim.sub', t.id(who)::text, true);
      execute 'set local role authenticated';
    end if;
    if is_dml then
      execute q; get diagnostics n = row_count; r := n::text;
    else
      execute q into r;
    end if;
    if not keep then raise exception using errcode = 'P0001', message = '__rollback__', detail = coalesce(r, 'null'); end if;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return coalesce(r, 'null');
  exception when others then
    if sqlerrm = '__rollback__' then
      get stacked diagnostics r = pg_exception_detail;
      return r;
    end if;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end $$;

create function t.q(who text, q text) returns text language sql as $$ select t.exec(who, q, false, false) $$;
create function t.dml(who text, q text) returns text language sql as $$ select t.exec(who, q, false, true) $$;
create function t.keep(who text, q text) returns text language sql as $$ select t.exec(who, q, true, false) $$;

create function t.check(name text, got text, ok boolean) returns void language sql as $$
  insert into t.results (name, ok, got) values (name, coalesce(ok, false), got);
$$;
create function t.denied(got text) returns boolean language sql immutable as $$
  select got = '0' or got like 'ERR:42501%'
$$;
create function t.is(name text, got text, expected text) returns void language sql as $$
  select t.check(name, got, got = expected);
$$;
create function t.deny(name text, got text) returns void language sql as $$
  select t.check(name, got, t.denied(got));
$$;
create function t.err(name text, got text, state text) returns void language sql as $$
  select t.check(name, got, got like 'ERR:' || state || '%');
$$;

-- ---------------------------------------------------------------------
-- Données de test : 2 organisations, 9 personnes
-- ---------------------------------------------------------------------
insert into t.ids
select k, gen_random_uuid() from unnest(array[
  'a_owner', 'a_manager', 'a_agent', 'a_agent2', 'b_owner', 'b_manager', 'b_agent', 'dual', 'outsider',
  'A', 'B', 'PA1', 'PA2', 'PB1', 'RA1', 'RB1', 'TA1', 'TA2', 'TA3', 'TA4', 'TA5', 'TB1',
  'roomA', 'roomB', 'itemA', 'itemB', 'bedA', 'bedB']) k;

insert into auth.users (id, email, raw_user_meta_data)
select id, name || '@test.invalid', jsonb_build_object('full_name', name) from t.ids
where name in ('a_owner', 'a_manager', 'a_agent', 'a_agent2', 'b_owner', 'b_manager', 'b_agent', 'dual', 'outsider');

insert into public.organizations (id, name) values (t.id('A'), 'Conciergerie A'), (t.id('B'), 'Conciergerie B');
insert into public.memberships (organization_id, user_id, role) values
  (t.id('A'), t.id('a_owner'), 'owner'), (t.id('A'), t.id('a_manager'), 'manager'),
  (t.id('A'), t.id('a_agent'), 'agent'), (t.id('A'), t.id('a_agent2'), 'agent'),
  (t.id('A'), t.id('dual'), 'agent'),
  (t.id('B'), t.id('b_owner'), 'owner'), (t.id('B'), t.id('b_manager'), 'manager'),
  (t.id('B'), t.id('b_agent'), 'agent'), (t.id('B'), t.id('dual'), 'manager');

insert into public.properties (id, organization_id, name) values
  (t.id('PA1'), t.id('A'), 'A — Canal'), (t.id('PA2'), t.id('A'), 'A — Bastille'), (t.id('PB1'), t.id('B'), 'B — Vieux-Port');
insert into public.property_access (organization_id, property_id, access_type, code) values
  (t.id('A'), t.id('PA1'), 'keypad', 'A-1234'), (t.id('A'), t.id('PA2'), 'key_box', 'A-5678'),
  (t.id('B'), t.id('PB1'), 'keypad', 'B-9999');
insert into public.beds (id, organization_id, property_id, size) values
  (t.id('bedA'), t.id('A'), t.id('PA1'), 'queen'), (t.id('bedB'), t.id('B'), t.id('PB1'), 'king');
insert into public.checklist_rooms (id, organization_id, property_id, name) values
  (t.id('roomA'), t.id('A'), t.id('PA1'), 'Cuisine'), (t.id('roomB'), t.id('B'), t.id('PB1'), 'Cuisine');
insert into public.checklist_items (id, organization_id, room_id, label) values
  (t.id('itemA'), t.id('A'), t.id('roomA'), 'Frigo'), (t.id('itemB'), t.id('B'), t.id('roomB'), 'Frigo');
-- Jeux d'essai historiques (séjours qui se recouvrent) : le contrôle de chevauchement est testé en section 3.8
alter table public.reservations disable trigger reservations_overlap_check;
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values
  (t.id('RA1'), t.id('A'), t.id('PA1'), 'Voyageur A', now() - interval '3 days', now() - interval '1 hour'),
  (t.id('RB1'), t.id('B'), t.id('PB1'), 'Voyageur B', now() - interval '3 days', now() - interval '1 hour');
insert into public.tasks (id, organization_id, property_id, reservation_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TA1'), t.id('A'), t.id('PA1'), t.id('RA1'), 'turnover', 'assigned', t.id('a_agent'), now() - interval '1 hour', now() + interval '3 hours', 90),
  (t.id('TA2'), t.id('A'), t.id('PA2'), null, 'turnover', 'assigned', t.id('a_agent2'), now() - interval '1 hour', now() + interval '3 hours', 90),
  (t.id('TA3'), t.id('A'), t.id('PA1'), null, 'turnover', 'assigned', t.id('a_agent'), now() + interval '3 days', now() + interval '3 days 4 hours', 90),
  (t.id('TA4'), t.id('A'), t.id('PA1'), null, 'turnover', 'cancelled', t.id('a_agent'), now() - interval '1 hour', now() + interval '3 hours', 90),
  (t.id('TA5'), t.id('A'), t.id('PA2'), null, 'inspection', 'assigned', t.id('dual'), now() - interval '1 hour', now() + interval '3 hours', 30),
  (t.id('TB1'), t.id('B'), t.id('PB1'), t.id('RB1'), 'turnover', 'assigned', t.id('b_agent'), now() - interval '1 hour', now() + interval '3 hours', 90);
insert into public.task_reports (task_id, organization_id) values (t.id('TA2'), t.id('A')), (t.id('TB1'), t.id('B'));
insert into public.task_actions (id, organization_id, task_id, user_id, kind, result) values
  (gen_random_uuid(), t.id('A'), t.id('TA2'), t.id('a_agent2'), 'start', 'applied'),
  (gen_random_uuid(), t.id('B'), t.id('TB1'), t.id('b_agent'), 'start', 'applied');
insert into public.access_reveals (organization_id, property_id, task_id, user_id) values
  (t.id('A'), t.id('PA2'), t.id('TA2'), t.id('a_agent2')), (t.id('B'), t.id('PB1'), t.id('TB1'), t.id('b_agent'));
insert into public.invitations (organization_id, role, token_hash) values
  (t.id('A'), 'agent', 'hash-a'), (t.id('B'), 'agent', 'hash-b');

insert into public.files (organization_id, kind, task_id, property_id, path, mime, size_bytes, created_by) values
  (t.id('A'), 'task_photo', t.id('TA1'), t.id('PA1'), t.id('A') || '/task/' || t.id('TA1') || '/fa1.jpg', 'image/jpeg', 1000, t.id('a_agent')),
  (t.id('A'), 'task_photo', t.id('TA2'), t.id('PA2'), t.id('A') || '/task/' || t.id('TA2') || '/fa2.jpg', 'image/jpeg', 1000, t.id('a_agent2')),
  (t.id('A'), 'task_photo', t.id('TA3'), t.id('PA1'), t.id('A') || '/task/' || t.id('TA3') || '/fa3.jpg', 'image/jpeg', 1000, t.id('a_agent')),
  (t.id('A'), 'property_reference', null, t.id('PA1'), t.id('A') || '/property/' || t.id('PA1') || '/ref.jpg', 'image/jpeg', 1000, t.id('a_manager')),
  (t.id('B'), 'task_photo', t.id('TB1'), t.id('PB1'), t.id('B') || '/task/' || t.id('TB1') || '/fb1.jpg', 'image/jpeg', 1000, t.id('b_agent'));
insert into storage.objects (bucket_id, name, owner) select 'org-files', path, created_by from public.files;

insert into t.ids select k, gen_random_uuid() from unnest(array['RA2', 'RB2', 'RA3']) k;
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values
  (t.id('RA2'), t.id('A'), t.id('PA1'), 'Séjour en cours A', now() - interval '1 day', now() + interval '2 days'),
  (t.id('RB2'), t.id('B'), t.id('PB1'), 'Séjour en cours B', now() - interval '1 day', now() + interval '2 days'),
  (t.id('RA3'), t.id('A'), t.id('PA2'), 'Séjour futur A', now() + interval '10 days', now() + interval '13 days');
insert into public.guest_guides (organization_id, property_id, welcome, wifi_password) values
  (t.id('A'), t.id('PA1'), 'Bienvenue au Canal', 'wifi-A'), (t.id('A'), t.id('PA2'), 'Bienvenue à Bastille', 'wifi-A2'),
  (t.id('B'), t.id('PB1'), 'Bienvenue au Vieux-Port', 'wifi-B');
insert into public.guest_links (organization_id, reservation_id, token_hash, valid_from, valid_until) values
  (t.id('A'), t.id('RA2'), 'fixture-a', now() - interval '1 day', now() + interval '2 days'),
  (t.id('B'), t.id('RB2'), 'fixture-b', now() - interval '1 day', now() + interval '2 days');
insert into public.service_requests (id, organization_id, reservation_id, property_id, kind, start_at, source) values
  (gen_random_uuid(), t.id('A'), t.id('RA2'), t.id('PA1'), 'private_chef', now() + interval '1 day', 'guest'),
  (gen_random_uuid(), t.id('B'), t.id('RB2'), t.id('PB1'), 'driver', now() + interval '1 day', 'guest');
insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind)
  select organization_id, id, 'internal_note', 'note interne fixture', 'internal', 'member' from public.service_requests;
insert into public.stay_messages (organization_id, reservation_id, author_kind, body) values
  (t.id('A'), t.id('RA2'), 'guest', 'message A'), (t.id('B'), t.id('RB2'), 'guest', 'message B');
insert into public.notification_outbox (organization_id, recipient, template) values
  (t.id('A'), 'a@guest.test', 'fixture'), (t.id('B'), 'b@guest.test', 'fixture');
insert into public.task_report_versions (organization_id, task_id, checked, rooms) values
  (t.id('A'), t.id('TA2'), '[]', '{}'), (t.id('B'), t.id('TB1'), '[]', '{}');

-- Une ligne témoin par table et par organisation, pour les essais d'écriture croisée
do $$
declare tbl text; o text;
begin
  for tbl in select c.table_name from information_schema.columns c
             join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
             where c.table_schema = 'public' and c.column_name = 'organization_id' loop
    foreach o in array array['A', 'B'] loop
      execute format('insert into t.brow select %L, %L, to_jsonb(x) from public.%I x where organization_id = %L limit 1',
        tbl, o, tbl, t.id(o));
    end loop;
  end loop;
end $$;

-- =====================================================================
-- 0. Structure : RLS partout, aucune table sans politique ni verrou
-- =====================================================================
select t.check('RLS activé sur public.' || c.relname, c.relrowsecurity::text, c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

select t.check('RLS activé sur storage.objects', relrowsecurity::text, relrowsecurity)
from pg_class where oid = 'storage.objects'::regclass;

select t.check('bucket org-files privé', public::text, not public) from storage.buckets where id = 'org-files';

select t.check('anon n''a aucun droit sur public.' || c.relname,
  coalesce(string_agg(p.privilege_type, ','), 'aucun'), count(p.privilege_type) = 0)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
left join information_schema.role_table_grants p on p.table_schema = 'public' and p.table_name = c.relname and p.grantee = 'anon'
where n.nspname = 'public' and c.relkind = 'r' group by c.relname;

select t.check('aucune fonction exécutable par anon (hors exception invité) : ' || p.proname, p.proname, false)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  and p.proname not in ('get_guest_stay', 'guest_request_service', 'guest_reply_service', 'guest_send_message', 'guest_report_problem', 'guest_problems', 'guest_places', 'guest_place_favorite', 'guest_save_preparation', 'guest_delete_preparation', 'guest_request_vip', 'guest_reply_vip',
                        'booking_portal', 'booking_submit', 'booking_guest_action', 'review_portal', 'review_submit', 'get_showcase');
select t.is('exceptions anonymes : uniquement la porte d''entrée voyageur (lien de séjour)', (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), 'booking_guest_action,booking_portal,booking_submit,get_guest_stay,get_showcase,guest_delete_preparation,guest_place_favorite,guest_places,guest_problems,guest_reply_service,guest_reply_vip,guest_report_problem,guest_request_service,guest_request_vip,guest_save_preparation,guest_send_message,review_portal,review_submit');

select t.check('fonction security definer avec search_path fixé : ' || p.proname,
  coalesce(array_to_string(p.proconfig, ','), 'aucun'), coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;

-- =====================================================================
-- 1. Cloisonnement : pour CHAQUE table métier, aucune personne d'une
--    organisation (ni anonyme, ni extérieur) ne lit, crée, modifie ou
--    supprime une ligne de l'autre organisation.
-- =====================================================================
do $$
declare
  tname text; victim text; who text; who_list text[]; j jsonb; cols text; vals text; got text; lbl text;
begin
  for tname in select distinct b.tbl from t.brow b order by 1 loop
    foreach victim in array array['A', 'B'] loop
      who_list := case victim
        when 'A' then array['b_owner', 'b_manager', 'b_agent', 'outsider', null]
        else array['a_owner', 'a_manager', 'a_agent', 'a_agent2', 'outsider', null] end;
      select b.j into j from t.brow b where b.tbl = tname and b.org = victim;
      foreach who in array who_list loop
        lbl := format('%s : %s → organisation %s', tname, coalesce(who, 'anonyme'), victim);
        -- lecture
        got := t.q(who, format('select count(*) from public.%I where organization_id = %L', tname, t.id(victim)));
        perform t.deny(lbl || ' : lecture', got);
        -- modification (y compris tentative de rattacher la ligne à son organisation)
        got := t.dml(who, format('update public.%I set organization_id = organization_id where organization_id = %L', tname, t.id(victim)));
        perform t.deny(lbl || ' : modification', got);
        -- suppression
        got := t.dml(who, format('delete from public.%I where organization_id = %L', tname, t.id(victim)));
        perform t.deny(lbl || ' : suppression', got);
        -- création d'une ligne dans l'organisation victime (copie d'une ligne existante, nouvel identifiant)
        if j is not null then
          if j ? 'id' and jsonb_typeof(j -> 'id') = 'string' and tname <> 'access_reveals' then
            j := jsonb_set(j, '{id}', to_jsonb(gen_random_uuid()::text));
          end if;
          select string_agg(quote_ident(column_name), ','), string_agg('r.' || quote_ident(column_name), ',')
            into cols, vals
          from information_schema.columns
          where table_schema = 'public' and table_name = tname and is_identity = 'NO' and is_generated = 'NEVER';
          got := t.dml(who, format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, %L) r',
            tname, cols, vals, tname, j));
          perform t.check(lbl || ' : création', got, got like 'ERR:42501%');
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- Organisations et profils (pas de colonne organization_id)
select t.is('organizations : a_owner ne voit que A', t.q('a_owner', 'select string_agg(name, ''|'') from public.organizations'), 'Conciergerie A');
select t.is('organizations : membre des deux voit A et B', t.q('dual', 'select count(*) from public.organizations'), '2');
select t.is('organizations : extérieur ne voit rien', t.q('outsider', 'select count(*) from public.organizations'), '0');
select t.deny('organizations : a_owner ne modifie pas B', t.dml('a_owner', format('update public.organizations set name = ''pirate'' where id = %L', t.id('B'))));
select t.deny('organizations : a_owner ne supprime pas B', t.dml('a_owner', format('delete from public.organizations where id = %L', t.id('B'))));
select t.deny('organizations : a_owner ne supprime pas A non plus (pas en lot 1)', t.dml('a_owner', format('delete from public.organizations where id = %L', t.id('A'))));
select t.err('organizations : création directe interdite', t.dml('a_owner', 'insert into public.organizations (name) values (''x'')'), '42501');
select t.is('profiles : a_agent voit les 5 membres de A, aucun de B', t.q('a_agent', 'select count(*) from public.profiles'), '5');
select t.is('profiles : extérieur ne voit que lui-même', t.q('outsider', 'select count(*) from public.profiles'), '1');
select t.deny('profiles : a_owner ne modifie pas un profil de B', t.dml('a_owner', format('update public.profiles set full_name = ''x'' where id = %L', t.id('b_agent'))));
select t.deny('profiles : a_owner ne modifie pas le profil de son agent', t.dml('a_owner', format('update public.profiles set full_name = ''x'' where id = %L', t.id('a_agent'))));
select t.deny('profiles : anonyme ne lit rien', t.q(null, 'select count(*) from public.profiles'));

-- Stockage : objets de l'autre organisation
select t.is('storage : a_owner ne voit aucun fichier de B',
  t.q('a_owner', format('select count(*) from storage.objects where name like %L', t.id('B') || '/%')), '0');
select t.is('storage : a_owner voit les 4 fichiers de A',
  t.q('a_owner', format('select count(*) from storage.objects where name like %L', t.id('A') || '/%')), '4');
select t.is('storage : membre des deux (agent en A sans photo, manager en B) ne voit que la photo de B',
  t.q('dual', 'select count(*) from storage.objects'), '1');
select t.err('storage : a_manager ne dépose pas dans B',
  t.dml('a_manager', format('insert into storage.objects (bucket_id, name) values (''org-files'', %L)', t.id('B') || '/task/' || t.id('TB1') || '/x.jpg')), '42501');
select t.deny('storage : a_owner ne supprime pas un fichier de B',
  t.dml('a_owner', format('delete from storage.objects where name like %L', t.id('B') || '/%')));
select t.deny('storage : anonyme ne lit rien', t.q(null, 'select count(*) from storage.objects'));

-- Fonctions métier appelées sur l'autre organisation
select t.err('reveal_access : a_owner sur une mission de B', t.q('a_owner', format('select code from public.reveal_access(%L, %L)', t.id('B'), t.id('TB1'))), '42501');
select t.err('reveal_access : a_owner sur un logement de B', t.q('a_owner', format('select code from public.reveal_access(%L, null, %L)', t.id('B'), t.id('PB1'))), '42501');
select t.err('reveal_access : a_owner passe A avec un logement de B', t.q('a_owner', format('select code from public.reveal_access(%L, null, %L)', t.id('A'), t.id('PB1'))), '42501');
select t.err('reveal_access : a_owner passe A avec une mission de B', t.q('a_owner', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TB1'))), '42501');
select t.err('start_task : a_agent sur une mission de B', t.q('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('B'), t.id('TB1'))), '42501');
select t.err('start_task : b_agent sur une mission de B annoncée en A', t.q('b_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TB1'))), '42501');
select t.err('finish_task : a_agent sur une mission de B', t.q('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('B'), t.id('TB1'))), '42501');
select t.err('save_task_report : a_agent sur une mission de B', t.q('a_agent', format('select public.save_task_report(%L, %L, ''[]'', ''{}'', now())', t.id('B'), t.id('TB1'))), '42501');
select t.err('begin_upload : a_manager vers une mission de B', t.q('a_manager', format('select public.begin_upload(%L, ''task_photo'', ''image/jpeg'', 100, %L)', t.id('B'), t.id('TB1'))), '42501');
select t.err('begin_upload : a_manager mission de B déclarée en A', t.q('a_manager', format('select public.begin_upload(%L, ''task_photo'', ''image/jpeg'', 100, %L)', t.id('A'), t.id('TB1'))), '42501');
select t.err('begin_upload : a_manager logement de B déclaré en A', t.q('a_manager', format('select public.begin_upload(%L, ''property_reference'', ''image/jpeg'', 100, null, %L)', t.id('A'), t.id('PB1'))), '42501');
select t.err('set_property_access : a_manager sur B', t.q('a_manager', format('select public.set_property_access(%L, %L, ''keypad'', ''0000'', null)', t.id('B'), t.id('PB1'))), '42501');
select t.err('set_property_access : fermée (aucun code dans HALO)', t.q('a_manager', format('select public.set_property_access(%L, %L, ''keypad'', ''0000'', null)', t.id('A'), t.id('PB1'))), '42501');
select t.err('create_invitation : a_owner dans B', t.q('a_owner', format('select public.create_invitation(%L, ''owner'')', t.id('B'))), '42501');
select t.err('set_member_role : a_owner dans B', t.q('a_owner', format('select public.set_member_role(%L, %L, ''owner'')', t.id('B'), t.id('b_agent'))), '42501');
select t.err('set_member_role : dual (agent en A, manager en B) dans A', t.q('dual', format('select public.set_member_role(%L, %L, ''owner'')', t.id('A'), t.id('dual'))), '42501');
select t.err('dual : manager en B ne crée pas de logement en A', t.dml('dual', format('insert into public.properties (organization_id, name) values (%L, ''x'')', t.id('A'))), '42501');
select t.is('dual : en A ne voit que sa propre mission', t.q('dual', format('select count(*) from public.tasks where organization_id = %L', t.id('A'))), '1');
select t.is('dual : en B voit toutes les missions (manager)', t.q('dual', format('select count(*) from public.tasks where organization_id = %L', t.id('B'))), '1');

-- Références croisées refusées par les clés composites, même pour un manager légitime de A
select t.err('clé composite : séjour A sur logement B', t.dml('a_manager', format(
  'insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (%L, %L, now(), now() + interval ''1 day'')', t.id('A'), t.id('PB1'))), '23503');
select t.err('clé composite : mission A assignée à un agent de B', t.dml('a_manager', format(
  'insert into public.tasks (organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values (%L, %L, ''turnover'', ''assigned'', %L, now(), now() + interval ''2 hours'', 60)',
  t.id('A'), t.id('PA1'), t.id('b_agent'))), '23503');
select t.err('clé composite : mission A liée à un séjour B', t.dml('a_manager', format(
  'update public.tasks set reservation_id = %L where id = %L', t.id('RB1'), t.id('TA2'))), '23503');
select t.err('clé composite : point de checklist A dans une pièce de B', t.dml('a_manager', format(
  'insert into public.checklist_items (organization_id, room_id, label) values (%L, %L, ''x'')', t.id('A'), t.id('roomB'))), '23503');
select t.err('organization_id immuable : a_owner déplace son logement vers B',
  t.dml('a_owner', format('update public.properties set organization_id = %L where id = %L', t.id('B'), t.id('PA1'))), '42501');
do $$ begin
  begin
    update public.properties set organization_id = t.id('B') where id = t.id('PA1');
    perform t.check('organization_id immuable même pour le super-utilisateur', 'modifié', false);
  exception when others then
    perform t.check('organization_id immuable même pour le super-utilisateur', sqlerrm, sqlerrm = 'organization_id is immutable');
  end;
end $$;

-- =====================================================================
-- 2. Droits à l'intérieur d'une organisation
-- =====================================================================

-- 2.1 Ce que voit un agent : uniquement ce qui sert à SES missions
select t.is('agent : voit ses 2 missions (pas l''annulée, pas celle d''un collègue)', t.q('a_agent', 'select count(*) from public.tasks'), '2');
select t.is('agent : voit seulement le logement de ses missions', t.q('a_agent', 'select string_agg(name, ''|'') from public.properties'), 'A — Canal');
select t.is('agent : voit le séjour lié à sa mission', t.q('a_agent', 'select count(*) from public.reservations'), '1');
select t.is('agent : voit la checklist de ce logement', t.q('a_agent', 'select count(*) from public.checklist_items'), '1');
select t.is('agent : ne voit pas le rapport d''un collègue', t.q('a_agent', 'select count(*) from public.task_reports'), '0');
select t.is('agent : ne voit que ses actions', t.q('a_agent2', 'select count(*) from public.task_actions'), '1');
select t.is('agent : ne voit pas le journal des codes', t.q('a_agent2', 'select count(*) from public.access_reveals'), '0');
select t.is('agent : ne voit pas les invitations', t.q('a_agent', 'select count(*) from public.invitations'), '0');
select t.is('agent : voit ses fichiers et la photo de référence, pas ceux d''un collègue', t.q('a_agent', 'select count(*) from public.files'), '3');
select t.is('agent : idem dans le stockage', t.q('a_agent', 'select count(*) from storage.objects'), '3');
select t.is('agent 2 : ne voit pas la photo de mission de l''agent 1', t.q('a_agent2', format('select count(*) from storage.objects where name like %L', '%/' || t.id('TA1') || '/%')), '0');
select t.is('agent 2 : ne voit pas la photo de référence d''un logement sans mission', t.q('a_agent2', format('select count(*) from storage.objects where name like %L', '%/' || t.id('PA1') || '/%')), '0');

-- 2.2 Un agent ne modifie rien directement
select t.deny('agent : ne modifie pas sa mission directement', t.dml('a_agent', format('update public.tasks set status = ''validated'' where id = %L', t.id('TA1'))));
select t.deny('agent : ne supprime pas sa mission', t.dml('a_agent', format('delete from public.tasks where id = %L', t.id('TA1'))));
select t.err('agent : ne crée pas de mission', t.dml('a_agent', format(
  'insert into public.tasks (organization_id, property_id, type, window_start, window_end, duration_min) values (%L, %L, ''other'', now(), now() + interval ''1 hour'', 30)', t.id('A'), t.id('PA1'))), '42501');
select t.deny('agent : ne modifie pas le logement', t.dml('a_agent', format('update public.properties set name = ''x'' where id = %L', t.id('PA1'))));
select t.deny('agent : ne modifie pas le séjour', t.dml('a_agent', format('update public.reservations set vip = true where id = %L', t.id('RA1'))));
select t.err('agent : n''écrit pas son rapport directement', t.dml('a_agent', format('insert into public.task_reports (task_id, organization_id) values (%L, %L)', t.id('TA1'), t.id('A'))), '42501');
select t.err('agent : ne crée pas de ligne fichier directement', t.dml('a_agent', format(
  'insert into public.files (organization_id, kind, task_id, property_id, path, mime, size_bytes, created_by) values (%L, ''task_photo'', %L, %L, ''x'', ''image/jpeg'', 1, %L)',
  t.id('A'), t.id('TA1'), t.id('PA1'), t.id('a_agent'))), '42501');
select t.deny('agent : ne supprime pas la photo d''un collègue', t.dml('a_agent', format('delete from storage.objects where name like %L', '%/' || t.id('TA2') || '/%')));
select t.deny('agent : ne supprime pas la photo de référence', t.dml('a_agent', format('delete from public.files where kind = ''property_reference''')));

-- 2.3 Codes d'accès
select t.err('codes : lecture directe refusée même au owner', t.q('a_owner', 'select count(*) from public.property_access'), '42501');
select t.err('codes : écriture directe refusée même au owner', t.dml('a_owner', format('update public.property_access set code = ''x'' where property_id = %L', t.id('PA1'))), '42501');
-- Règle produit (29/10) : HALO ne gère aucun code de serrure ; plus aucune consultation possible, même par le manager
select t.err('codes : agent, plus de consultation (aucun code dans HALO)', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA1'))), '42501');
select t.err('codes : agent, mission d''un collègue', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA2'))), '42501');
select t.err('codes : agent, sa mission dans 3 jours (hors fenêtre)', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA3'))), '42501');
select t.err('codes : agent, sa mission annulée', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA4'))), '42501');
select t.err('codes : agent, par logement sans mission', t.q('a_agent', format('select code from public.reveal_access(%L, null, %L)', t.id('A'), t.id('PA1'))), '42501');
select t.err('codes : manager, plus de consultation', t.q('a_manager', format('select code from public.reveal_access(%L, null, %L)', t.id('A'), t.id('PA2'))), '42501');
select t.is('codes : aucune consultation journalisée (fonction fermée)', t.q('a_manager', format('select count(*) from public.access_reveals where task_id = %L', t.id('TA1'))), '0');
select t.err('codes : agent ne change pas un code', t.q('a_agent', format('select public.set_property_access(%L, %L, ''keypad'', ''0000'', null)', t.id('A'), t.id('PA1'))), '42501');
select t.err('codes : manager ne saisit plus de code', t.q('a_manager', format('select public.set_property_access(%L, %L, ''keypad'', ''4321'', null)', t.id('A'), t.id('PA1'))), '42501');
select t.err('codes : extérieur', t.q('outsider', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA1'))), '42501');
select t.err('codes : anonyme', t.q(null, format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA1'))), '42501');

-- 2.4 Fonctions terrain : démarrer, rapport, photo, terminer ; rejouables
select t.is('terrain : démarrer sa mission', t.keep('a_agent', format('select public.start_task(%L, %L, %L)', t.id('A'), t.id('TA1'), '11111111-1111-1111-1111-111111111111')), 'applied');
select t.is('terrain : même action rejouée (hors ligne) = même résultat', t.keep('a_agent', format('select public.start_task(%L, %L, %L)', t.id('A'), t.id('TA1'), '11111111-1111-1111-1111-111111111111')), 'applied');
select t.is('terrain : une seule action enregistrée', (select count(*)::text from public.task_actions where task_id = t.id('TA1')), '1');
select t.is('terrain : nouvelle action démarrer = déjà en cours', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TA1'))), 'already');
select t.err('terrain : un autre agent ne rejoue pas l''identifiant d''action', t.q('a_agent2', format('select public.start_task(%L, %L, %L)', t.id('A'), t.id('TA1'), '11111111-1111-1111-1111-111111111111')), '42501');
select t.is('terrain : rapport enregistré', t.keep('a_agent', format('select public.save_task_report(%L, %L, ''["x"]'', ''{}'', now())', t.id('A'), t.id('TA1'))), 'applied');
select t.is('terrain : rapport plus ancien (appareil resynchronisé) ignoré', t.keep('a_agent', format('select public.save_task_report(%L, %L, ''[]'', ''{}'', now() - interval ''1 hour'')', t.id('A'), t.id('TA1'))), 'stale');
select t.is('terrain : le rapport conservé est le plus récent', (select checked::text from public.task_reports where task_id = t.id('TA1')), '["x"]');
do $$ declare p text; begin
  p := t.keep('a_agent', format('select public.begin_upload(%L, ''task_photo'', ''image/jpeg'', 2000, %L)', t.id('A'), t.id('TA1')));
  perform t.check('terrain : réserver un chemin de photo (chemin construit par la base)', p,
    p like t.id('A') || '/task/' || t.id('TA1') || '/%.jpg');
end $$;
select t.is('terrain : une ligne fichier par réservation', (select count(*)::text from public.files where task_id = t.id('TA1')), '2');
select t.is('terrain : déposer la photo au chemin réservé',
  t.dml('a_agent', format('insert into storage.objects (bucket_id, name) select ''org-files'', path from public.files where task_id = %L and path not like ''%%fa1.jpg''', t.id('TA1'))), '1');
select t.err('terrain : déposer à un chemin non réservé',
  t.dml('a_agent', format('insert into storage.objects (bucket_id, name) values (''org-files'', %L)', t.id('A') || '/task/' || t.id('TA1') || '/invente.jpg')), '42501');
select t.err('terrain : un collègue ne dépose pas au chemin réservé par un autre',
  t.dml('a_agent2', format('insert into storage.objects (bucket_id, name) values (''org-files'', %L)',
    (select path from public.files where task_id = t.id('TA1') and path not like '%fa1.jpg'))), '42501');
select t.err('terrain : un manager de B ne dépose pas au chemin réservé en A',
  t.dml('b_manager', format('insert into storage.objects (bucket_id, name) values (''org-files'', %L)',
    (select path from public.files where task_id = t.id('TA1') and path not like '%fa1.jpg'))), '42501');
select t.err('terrain : type de fichier refusé', t.q('a_agent', format('select public.begin_upload(%L, ''task_photo'', ''application/pdf'', 10, %L)', t.id('A'), t.id('TA1'))), '22023');
select t.err('terrain : photo de référence réservée aux managers', t.q('a_agent', format('select public.begin_upload(%L, ''property_reference'', ''image/jpeg'', 10, null, %L)', t.id('A'), t.id('PA1'))), '42501');
select t.is('terrain : terminer', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid(), now())', t.id('A'), t.id('TA1'))), 'applied');
select t.is('terrain : statut terminé', (select status::text from public.tasks where id = t.id('TA1')), 'done');
select t.is('terrain : rapport verrouillé après la fin', t.q('a_agent', format('select public.save_task_report(%L, %L, ''[]'', ''{}'', now())', t.id('A'), t.id('TA1'))), 'conflict:done');
select t.err('terrain : plus de photo après la fin', t.q('a_agent', format('select public.begin_upload(%L, ''task_photo'', ''image/jpeg'', 10, %L)', t.id('A'), t.id('TA1'))), '42501');
select t.deny('terrain : plus de suppression de photo après la fin', t.dml('a_agent', format('delete from storage.objects where name like %L', '%/' || t.id('TA1') || '/%')));
select t.err('codes : plus de code une fois la mission terminée', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA1'))), '42501');
select t.is('terrain : démarrer une mission terminée = conflit, le serveur garde son état', t.q('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TA1'))), 'conflict:done');
select t.is('terrain : heure d''appareil invraisemblable remplacée par l''heure serveur',
  (select (public.plausible_time(now() - interval '10 days') = now())::text), 'true');

-- 2.5 Réassignation : l'ancien agent perd l'accès immédiatement
select t.is('réassignation : manager réassigne TA3', t.dml('a_manager', format('update public.tasks set assignee_id = %L where id = %L', t.id('a_agent2'), t.id('TA3'))), '1');
update public.tasks set assignee_id = t.id('a_agent2') where id = t.id('TA3');
select t.is('réassignation : l''ancien agent ne voit plus la mission', t.q('a_agent', format('select count(*) from public.tasks where id = %L', t.id('TA3'))), '0');
select t.is('réassignation : ni ses photos', t.q('a_agent', format('select count(*) from storage.objects where name like %L', '%/' || t.id('TA3') || '/%')), '0');
select t.is('réassignation : le nouvel agent les voit', t.q('a_agent2', format('select count(*) from storage.objects where name like %L', '%/' || t.id('TA3') || '/%')), '1');

-- 2.6 Agent désactivé : plus rien
update public.memberships set is_active = false where organization_id = t.id('A') and user_id = t.id('a_agent2');
select t.is('désactivé : ne voit plus aucune mission', t.q('a_agent2', 'select count(*) from public.tasks'), '0');
select t.is('désactivé : ne voit plus aucun fichier', t.q('a_agent2', 'select count(*) from storage.objects'), '0');
select t.err('désactivé : ne lit plus aucun code', t.q('a_agent2', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA2'))), '42501');
update public.memberships set is_active = true where organization_id = t.id('A') and user_id = t.id('a_agent2');

-- 2.7 Rôles et élévation de privilèges
select t.err('rôles : manager ne se nomme pas owner (colonne verrouillée)', t.dml('a_manager', format('update public.memberships set role = ''owner'' where user_id = %L', t.id('a_manager'))), '42501');
select t.err('rôles : manager ne passe pas par la fonction', t.q('a_manager', format('select public.set_member_role(%L, %L, ''owner'')', t.id('A'), t.id('a_agent'))), '42501');
select t.deny('rôles : manager ne modifie pas le owner', t.dml('a_manager', format('update public.memberships set color = ''#000000'' where user_id = %L', t.id('a_owner'))));
select t.is('rôles : manager modifie un agent (couleur, poste)', t.dml('a_manager', format('update public.memberships set color = ''#000000'', position = ''maintenance'' where organization_id = %L and user_id = %L', t.id('A'), t.id('a_agent'))), '1');
select t.deny('rôles : manager ne retire pas un autre manager', t.dml('a_manager', format('delete from public.memberships where user_id = %L and organization_id = %L', t.id('a_owner'), t.id('A'))));
select t.deny('rôles : agent ne modifie pas un collègue', t.dml('a_agent', format('update public.memberships set is_active = false where user_id = %L', t.id('a_agent2'))));
select t.err('rôles : owner ne change pas son propre rôle', t.q('a_owner', format('select public.set_member_role(%L, %L, ''agent'')', t.id('A'), t.id('a_owner'))), '42501');
select t.is('rôles : owner nomme un manager', t.q('a_owner', format('select public.set_member_role(%L, %L, ''manager'')', t.id('A'), t.id('a_agent'))), '');
select t.err('rôles : le dernier owner ne peut pas partir', t.dml('b_owner', format('delete from public.memberships where user_id = %L and organization_id = %L', t.id('b_owner'), t.id('B'))), '42501');
select t.err('rôles : le dernier owner ne peut pas être désactivé', t.dml('b_owner', format('update public.memberships set is_active = false where user_id = %L and organization_id = %L', t.id('b_owner'), t.id('B'))), '42501');
select t.is('rôles : un agent peut quitter une organisation', t.exec('b_agent', format('delete from public.memberships where user_id = %L and organization_id = %L', t.id('b_agent'), t.id('B')), true, true), '1');
select t.err('rôles : personne ne s''ajoute directement à une organisation', t.dml('outsider', format('insert into public.memberships (organization_id, user_id, role) values (%L, %L, ''owner'')', t.id('A'), t.id('outsider'))), '42501');

-- 2.8 Invitations
select t.err('invitations : manager n''invite pas de manager', t.q('a_manager', format('select public.create_invitation(%L, ''manager'')', t.id('A'))), '42501');
select t.err('invitations : agent n''invite personne', t.q('a_agent2', format('select public.create_invitation(%L, ''agent'')', t.id('A'))), '42501');
select t.err('invitations : l''empreinte du jeton n''est pas lisible', t.q('a_owner', 'select count(token_hash) from public.invitations'), '42501');
select t.is('invitations : les autres colonnes sont lisibles par le manager', t.q('a_manager', 'select count(*) from public.invitations'), '1');
do $$
declare tok text; got text;
begin
  tok := t.keep('a_manager', format('select public.create_invitation(%L, ''agent'', null, ''housekeeper'')', t.id('A')));
  perform t.check('invitations : jeton brut renvoyé une fois (64 caractères)', length(tok)::text, length(tok) = 64);
  perform t.check('invitations : jeton jamais stocké en clair', tok,
    not exists (select 1 from public.invitations where token_hash = tok));
  perform t.is('invitations : mauvais jeton refusé', left(t.q('outsider', format('select public.accept_invitation(%L)', tok || 'x')), 9), 'ERR:42501');
  got := t.keep('outsider', format('select public.accept_invitation(%L)', tok));
  perform t.is('invitations : acceptée, rejoint A', got, t.id('A')::text);
  perform t.is('invitations : rejoint comme agent', (select role::text from public.memberships where user_id = t.id('outsider')), 'agent');
  perform t.is('invitations : jeton à usage unique', left(t.q('b_manager', format('select public.accept_invitation(%L)', tok)), 9), 'ERR:42501');
  update public.invitations set expires_at = now() - interval '1 minute' where organization_id = t.id('A') and accepted_at is null;
  tok := t.keep('a_manager', format('select public.create_invitation(%L, ''agent'')', t.id('A')));
  update public.invitations set expires_at = now() - interval '1 minute' where invited_by = t.id('a_manager') and accepted_at is null;
  perform t.is('invitations : jeton expiré refusé', left(t.q('b_manager', format('select public.accept_invitation(%L)', tok)), 9), 'ERR:42501');
end $$;

-- 2.9 Création d'organisation
select t.keep('b_agent', 'select public.create_organization(''Conciergerie C'')');
select t.is('organisation : un utilisateur crée la sienne et en devient owner',
  (select role::text from public.memberships m join public.organizations o on o.id = m.organization_id
   where o.name = 'Conciergerie C' and m.user_id = t.id('b_agent')), 'owner');
select t.is('organisation : il ne voit que C (il a quitté B)', t.q('b_agent', 'select string_agg(name, ''|'') from public.organizations'), 'Conciergerie C');
select t.err('organisation : anonyme ne crée rien', t.q(null, 'select public.create_organization(''X'')'), '42501');


-- =====================================================================
-- 3. Fiches équipe et cycle de fin de mission (migration 2)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['TC1', 'TC2', 'roomA2', 'itemA2']) k;
insert into public.checklist_rooms (id, organization_id, property_id, name) values (t.id('roomA2'), t.id('A'), t.id('PA2'), 'Salle de bain');
insert into public.checklist_items (id, organization_id, room_id, label, photo_required) values (t.id('itemA2'), t.id('A'), t.id('roomA2'), 'Douche', true);
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TC1'), t.id('A'), t.id('PA2'), 'turnover', 'assigned', t.id('a_agent2'), now() - interval '1 hour', now() + interval '3 hours', 60),
  (t.id('TC2'), t.id('A'), t.id('PA2'), 'check_in', 'assigned', t.id('a_agent2'), now() - interval '1 hour', now() + interval '3 hours', 30);

-- 3.1 Type de collaboration : information, modifiable selon les rôles existants
select t.is('collaboration : manager renseigne celle d''un agent', t.dml('a_manager', format('update public.memberships set collaboration = ''freelance'' where organization_id = %L and user_id = %L', t.id('A'), t.id('a_agent2'))), '1');
select t.deny('collaboration : manager ne modifie pas celle du owner', t.dml('a_manager', format('update public.memberships set collaboration = ''freelance'' where user_id = %L', t.id('a_owner'))));
select t.deny('collaboration : agent ne modifie pas la sienne', t.dml('a_agent2', format('update public.memberships set collaboration = ''internal'' where user_id = %L', t.id('a_agent2'))));
select t.deny('collaboration : manager de B ne touche pas A', t.dml('b_manager', format('update public.memberships set collaboration = ''internal'' where organization_id = %L', t.id('A'))));

-- 3.2 Règle de validation : réglée par les managers de l'organisation
select t.deny('règle : agent ne change pas la règle de validation', t.dml('a_agent2', format('update public.organizations set validation_task_types = ''{}'' where id = %L', t.id('A'))));
select t.deny('règle : manager de B ne change pas celle de A', t.dml('b_manager', format('update public.organizations set validation_task_types = ''{}'' where id = %L', t.id('A'))));
select t.is('règle : manager de A la change', t.dml('a_manager', format('update public.organizations set validation_task_types = ''{turnover,inspection}'' where id = %L', t.id('A'))), '1');

-- 3.3 Cycle complet avec photo obligatoire, correction et validation
select t.is('cycle : démarrer', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC1'))), 'applied');
select t.is('cycle : soumission refusée sans la photo obligatoire', t.keep('a_agent2', format('select public.finish_task(%L, %L, %L)', t.id('A'), t.id('TC1'), '22222222-2222-2222-2222-222222222222')), 'missing:photos');
select t.is('cycle : la mission reste en cours', (select status::text from public.tasks where id = t.id('TC1')), 'in_progress');
select t.is('cycle : le refus n''est pas mémorisé (l''action pourra être rejouée)', (select count(*)::text from public.task_actions where id = '22222222-2222-2222-2222-222222222222'), '0');
select t.check('cycle : photo du point obligatoire réservée',
  t.keep('a_agent2', format('select public.begin_upload(%L, ''task_photo'', ''image/jpeg'', 900, %L, null, %L)', t.id('A'), t.id('TC1'), t.id('itemA2'))), true);
select t.is('cycle : réservée mais pas envoyée = toujours refusée', t.q('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC1'))), 'missing:photos');
select t.is('cycle : envoi réel du fichier par l''agent',
  t.exec('a_agent2', format('insert into storage.objects (bucket_id, name) select ''org-files'', path from public.files where task_id = %L and checklist_item_id = %L', t.id('TC1'), t.id('itemA2')), true, true), '1');
select t.is('cycle : même action rejouée, cette fois acceptée', t.keep('a_agent2', format('select public.finish_task(%L, %L, %L)', t.id('A'), t.id('TC1'), '22222222-2222-2222-2222-222222222222')), 'applied');
select t.is('cycle : terminée, à valider (ménage)', (select status::text from public.tasks where id = t.id('TC1')), 'done');
select t.err('cycle : agent ne valide pas', t.q('a_agent2', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC1'))), '42501');
select t.err('cycle : agent ne demande pas de correction', t.q('a_agent2', format('select public.request_correction(%L, %L, ''x'')', t.id('A'), t.id('TC1'))), '42501');
select t.err('cycle : manager de B ne valide pas une mission de A', t.q('b_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC1'))), '42501');
select t.err('cycle : manager de B, mission de A annoncée en B', t.q('b_manager', format('select public.validate_task(%L, %L)', t.id('B'), t.id('TC1'))), 'P0002');
select t.err('cycle : correction sans motif refusée', t.q('a_manager', format('select public.request_correction(%L, %L, ''  '')', t.id('A'), t.id('TC1'))), '22023');
select t.err('cycle : correction directe sans motif refusée', t.dml('a_manager', format('update public.tasks set status = ''to_redo'' where id = %L', t.id('TC1'))), '23514');
select t.is('cycle : correction demandée', t.keep('a_manager', format('select public.request_correction(%L, %L, ''Douche à reprendre'')', t.id('A'), t.id('TC1'))), 'applied');
select t.is('cycle : statut et motif', (select status || ' / ' || correction_reason from public.tasks where id = t.id('TC1')), 'to_redo / Douche à reprendre');
select t.is('cycle : le premier compte rendu est conservé, visible par l''agent', t.q('a_agent2', format('select count(*) from public.task_report_versions where task_id = %L', t.id('TC1'))), '1');
select t.is('cycle : invisible pour un autre agent', t.q('a_agent', format('select count(*) from public.task_report_versions where task_id = %L', t.id('TC1'))), '0');
select t.is('cycle : l''agent reprend', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC1'))), 'applied');
select t.is('cycle : il resoumet', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC1'))), 'applied');
select t.is('cycle : le manager valide', t.keep('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC1'))), 'applied');
select t.is('cycle : validée par le manager', (select status || ' / ' || (validated_by = t.id('a_manager'))::text from public.tasks where id = t.id('TC1')), 'validated / true');
select t.is('cycle : valider deux fois = sans effet (déjà validée)', t.q('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC1'))), 'already');
select t.is('historique : toutes les étapes, dans l''ordre',
  (select string_agg(kind, ',' order by id) from public.task_events where task_id = t.id('TC1')),
  'created,started,submitted,correction_requested,started,resubmitted,validated');
select t.is('historique : auteur de chaque étape',
  (select string_agg(case actor_id when t.id('a_agent2') then 'agent' when t.id('a_manager') then 'manager' else 'système' end, ',' order by id) from public.task_events where task_id = t.id('TC1')),
  'système,agent,agent,manager,agent,agent,manager');
select t.is('historique : motif de correction conservé', (select note from public.task_events where task_id = t.id('TC1') and kind = 'correction_requested'), 'Douche à reprendre');
select t.is('historique : lisible par l''agent de la mission', t.q('a_agent2', format('select count(*) from public.task_events where task_id = %L', t.id('TC1'))), '7');
select t.is('historique : invisible pour un autre agent', t.q('a_agent', format('select count(*) from public.task_events where task_id = %L', t.id('TC1'))), '0');
select t.is('historique : invisible pour l''autre organisation', t.q('b_owner', format('select count(*) from public.task_events where task_id = %L', t.id('TC1'))), '0');
select t.err('historique : personne n''écrit directement', t.dml('a_owner', format('insert into public.task_events (organization_id, task_id, kind) values (%L, %L, ''validated'')', t.id('A'), t.id('TC1'))), '42501');
select t.deny('historique : personne ne l''efface', t.dml('a_owner', format('delete from public.task_events where task_id = %L', t.id('TC1'))));
select t.is('historique : une modification directe du manager est aussi tracée',
  t.dml('a_manager', format('update public.tasks set status = ''cancelled'' where id = %L', t.id('TC2'))) || '/' ||
  (select count(*)::text from public.task_events where task_id = t.id('TC2') and kind = 'cancelled'), '1/0');

-- 3.5 Préférence d'itinéraire : chacun la sienne
select t.is('itinéraire : chacun règle son application par défaut', t.dml('a_agent', format('update public.profiles set maps_app = ''waze'' where id = %L', t.id('a_agent'))), '1');
select t.deny('itinéraire : pas celle d''un collègue', t.dml('a_manager', format('update public.profiles set maps_app = ''waze'' where id = %L', t.id('a_agent'))));
select t.err('itinéraire : valeur inconnue refusée', t.dml('a_agent', format('update public.profiles set maps_app = ''autre'' where id = %L', t.id('a_agent'))), '23514');

-- 3.6 Validation refusée si une preuve exigée manque (même pour un manager)
insert into t.ids values ('TC3', gen_random_uuid());
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TC3'), t.id('A'), t.id('PA2'), 'turnover', 'assigned', t.id('a_agent2'), now() - interval '1 hour', now() + interval '3 hours', 60);
update public.tasks set status = 'done' where id = t.id('TC3');  -- mission arrivée « terminée » sans preuve (ex. ancienne donnée)
select t.is('preuves : validation refusée sans la photo exigée', t.q('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC3'))), 'missing:photos');
select t.is('preuves : la mission reste à valider', (select status::text from public.tasks where id = t.id('TC3')), 'done');
select t.is('preuves : une correction reste possible', t.q('a_manager', format('select public.request_correction(%L, %L, ''Photo de la douche manquante'')', t.id('A'), t.id('TC3'))), 'applied');

-- 3.7 Correction ciblée : l'ancienne preuve reste en historique mais ne compte plus ; une nouvelle photo est exigée
insert into t.ids select k, gen_random_uuid() from unnest(array['PA3', 'roomA3', 'itemA3', 'TC4']) k;
insert into public.properties (id, organization_id, name) values (t.id('PA3'), t.id('A'), 'Logement preuves');
insert into public.checklist_rooms (id, organization_id, property_id, name) values (t.id('roomA3'), t.id('A'), t.id('PA3'), 'Salle de bain');
insert into public.checklist_items (id, organization_id, room_id, label, photo_required) values (t.id('itemA3'), t.id('A'), t.id('roomA3'), 'Douche', true);
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TC4'), t.id('A'), t.id('PA3'), 'turnover', 'assigned', t.id('a_agent2'), now() - interval '1 hour', now() + interval '3 hours', 60);
insert into public.files (organization_id, kind, task_id, property_id, checklist_item_id, room_id, path, mime, size_bytes, created_by)
values (t.id('A'), 'task_photo', t.id('TC4'), t.id('PA3'), t.id('itemA3'), t.id('roomA3'), t.id('A') || '/task/' || t.id('TC4') || '/old.jpg', 'image/jpeg', 10, t.id('a_agent2'));
insert into storage.objects (bucket_id, name, owner) values ('org-files', t.id('A') || '/task/' || t.id('TC4') || '/old.jpg', t.id('a_agent2'));
insert into public.task_reports (task_id, organization_id, checked) values (t.id('TC4'), t.id('A'), jsonb_build_array(t.id('itemA3')::text));
update public.tasks set status = 'done' where id = t.id('TC4');
select t.is('correction ciblée : photo présente avant correction', (select public.missing_required_photos(t.id('A'), t.id('TC4'))::text), '0');
select t.is('correction ciblée : demandée sur la douche', t.keep('a_manager', format('select public.request_correction(%L, %L, ''Refaire la photo de la douche'', array[%L]::uuid[])', t.id('A'), t.id('TC4'), t.id('itemA3'))), 'applied');
select t.is('correction ciblée : l''ancienne photo ne compte plus', (select public.missing_required_photos(t.id('A'), t.id('TC4'))::text), '1');
select t.is('correction ciblée : l''ancienne photo est gardée en historique', (select count(*)::text || '/' || count(superseded_at)::text from public.files where task_id = t.id('TC4')), '1/1');
select t.is('correction ciblée : le point est décoché', (select checked::text from public.task_reports where task_id = t.id('TC4')), '[]');
select t.is('correction ciblée : reprise', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC4'))), 'applied');
select t.is('correction ciblée : terminer refusé sans nouvelle photo', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC4'))), 'missing:photos');
insert into public.files (organization_id, kind, task_id, property_id, checklist_item_id, room_id, path, mime, size_bytes, created_by)
values (t.id('A'), 'task_photo', t.id('TC4'), t.id('PA3'), t.id('itemA3'), t.id('roomA3'), t.id('A') || '/task/' || t.id('TC4') || '/new.jpg', 'image/jpeg', 10, t.id('a_agent2'));
insert into storage.objects (bucket_id, name, owner) values ('org-files', t.id('A') || '/task/' || t.id('TC4') || '/new.jpg', t.id('a_agent2'));
select t.is('correction ciblée : terminée avec la nouvelle photo', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC4'))), 'applied');
select t.err('correction ciblée : un agent ne demande pas de correction', t.q('a_agent2', format('select public.request_correction(%L, %L, ''x'', null)', t.id('A'), t.id('TC4'))), '42501');

-- 3.8 Retour du 29/10 : validation par type, créneaux, profil à l'arrivée, absences et fermetures
insert into t.ids select k, gen_random_uuid() from unnest(array['PV', 'TV2', 'IV', 'RV1', 'newbie', 'TW1', 'TW2', 'TW3', 'TW4', 'ABS1', 'ABS2', 'ABS3']) k;
insert into public.properties (id, organization_id, name) values (t.id('PV'), t.id('A'), 'Logement validation');
-- « Toutes les missions » choisi à l'onboarding avec seulement 3 types enregistrés (cause du défaut observé) : la migration corrige
update public.organizations set onboarding = '{"answers": {"validation_policy": "all"}}', validation_task_types = array['turnover', 'linen_delivery', 'linen_pickup']::public.task_type[] where id = t.id('A');
update public.organizations set validation_task_types = enum_range(null::public.task_type) where onboarding #>> '{answers,validation_policy}' = 'all' and id = t.id('A');
select t.check('validation : « toutes » couvre la maintenance', '', (select 'maintenance' = any (validation_task_types) from public.organizations where id = t.id('A')));
insert into public.incidents (id, organization_id, property_id, source, category, description) values (t.id('IV'), t.id('A'), t.id('PV'), 'manager', 'breakdown', 'Chaudière en panne');
select t.check('validation : intervention créée depuis l''incident', '', t.keep('a_manager', format('select public.create_intervention(%L, %L, %L, now() - interval ''1 hour'', now() + interval ''4 hours'', 60)', t.id('A'), t.id('IV'), t.id('a_agent2'))) ~ '^[0-9a-f-]{36}$');
create function t.iv() returns uuid language sql stable as $$ select follow_up_task_id from public.incidents where id = t.id('IV') $$;
select t.is('validation : démarrée par l''agent', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.iv())), 'applied');
select t.is('validation : terminée par l''agent', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.iv())), 'applied');
select t.is('validation : l''intervention reste « à valider »', (select status::text from public.tasks where id = t.iv()), 'done');
select t.is('validation : l''incident n''est pas résolu automatiquement', (select status from public.incidents where id = t.id('IV')), 'in_progress');
select t.err('validation : l''agent ne valide pas lui-même', t.q('a_agent2', format('select public.validate_task(%L, %L)', t.id('A'), t.iv())), '42501');
select t.deny('validation : l''agent ne passe pas la mission en « validée » directement', t.dml('a_agent2', format('update public.tasks set status = ''validated'' where id = %L', t.iv())));
select t.err('validation : un agent d''une autre organisation ne la termine pas', t.q('b_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.iv())), '42501');
select t.is('validation : correction demandée par le manager', t.keep('a_manager', format('select public.request_correction(%L, %L, ''Joint à refaire'')', t.id('A'), t.iv())), 'applied');
select t.is('validation : rapport précédent conservé', (select count(*)::text from public.task_report_versions where task_id = t.iv()), '1');
select t.is('validation : reprise par l''agent', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.iv())), 'applied');
select t.is('validation : resoumise', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.iv())), 'applied');
select t.is('validation : toujours « à valider » après reprise', (select status::text from public.tasks where id = t.iv()), 'done');
select t.is('validation : validée par le manager', t.keep('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.iv())), 'applied');
-- Type sans validation : clôture directe, tracée
select t.is('validation : le manager retire la maintenance du contrôle', t.dml('a_manager', format('update public.organizations set validation_task_types = array[''turnover'']::public.task_type[] where id = %L', t.id('A'))), '1');
select t.deny('validation : un agent ne change pas le réglage', t.dml('a_agent', format('update public.organizations set validation_task_types = ''{}'' where id = %L', t.id('A'))));
update public.organizations set validation_task_types = array['turnover']::public.task_type[] where id = t.id('A');
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TV2'), t.id('A'), t.id('PV'), 'maintenance', 'assigned', t.id('a_agent2'), now() - interval '1 hour', now() + interval '3 hours', 30);
select t.is('validation : sans contrôle, démarrage', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TV2'))), 'applied');
select t.is('validation : sans contrôle, fin', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TV2'))), 'applied');
select t.is('validation : sans contrôle, validée automatiquement et tracée', (select status::text || '/' || (select kind from public.task_events where task_id = t.id('TV2') order by id desc limit 1) from public.tasks where id = t.id('TV2')), 'validated/auto_validated');

-- Créneaux : jamais de fenêtre plus courte que la durée ; correction tracée
select t.err('créneau : fenêtre de 1 minute refusée', t.q('a_manager', format('insert into public.tasks (organization_id, property_id, type, window_start, window_end, duration_min) values (%L, %L, ''turnover'', now(), now() + interval ''1 minute'', 90)', t.id('A'), t.id('PV'))), '22023');
select t.err('créneau : fenêtre plus courte que la durée refusée', t.q('a_manager', format('insert into public.tasks (organization_id, property_id, type, window_start, window_end, duration_min) values (%L, %L, ''turnover'', now(), now() + interval ''60 minutes'', 90)', t.id('A'), t.id('PV'))), '22023');
insert into public.tasks (id, organization_id, property_id, type, is_auto_generated, window_start, window_end, duration_min) values
  (t.id('TW1'), t.id('A'), t.id('PV'), 'turnover', true, now() + interval '1 day', now() + interval '1 day 5 hours', 90);
select t.is('créneau : corrigé par le manager', t.keep('a_manager', format('select public.set_task_window(%L, %L, now() + interval ''1 day'', now() + interval ''1 day 3 hours'', 120, ''Arrivée avancée'')', t.id('A'), t.id('TW1'))), 'applied');
select t.is('créneau : correction tracée avec son motif', (select note::jsonb ->> 'reason' from public.task_events where task_id = t.id('TW1') and kind = 'window_changed' order by id desc limit 1), 'Arrivée avancée');
select t.is('créneau : mission reprise à la main (plus déplacée par la synchro)', (select is_auto_generated::text || '/' || duration_locked::text from public.tasks where id = t.id('TW1')), 'false/true');
select t.err('créneau : correction incohérente refusée', t.q('a_manager', format('select public.set_task_window(%L, %L, now(), now() + interval ''30 minutes'', 90)', t.id('A'), t.id('TW1'))), '22023');
select t.err('créneau : un agent ne corrige pas', t.q('a_agent', format('select public.set_task_window(%L, %L, now(), now() + interval ''5 hours'', 90)', t.id('A'), t.id('TW1'))), '42501');
select t.err('créneau : une autre organisation ne corrige pas', t.q('b_manager', format('select public.set_task_window(%L, %L, now(), now() + interval ''5 hours'', 90)', t.id('A'), t.id('TW1'))), '42501');
select t.is('créneau : les autres modifications restent possibles', t.dml('a_manager', format('update public.tasks set priority = ''high'' where id = %L', t.id('TW1'))), '1');

-- Séjours qui se chevauchent
alter table public.reservations enable trigger reservations_overlap_check;
insert into public.reservations (id, organization_id, property_id, check_in_at, check_out_at) values (t.id('RV1'), t.id('A'), t.id('PV'), '2027-03-01 15:00+00', '2027-03-05 10:00+00');
select t.err('séjours : chevauchement refusé', t.q('a_manager', format('insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (%L, %L, ''2027-03-04 15:00+00'', ''2027-03-07 10:00+00'')', t.id('A'), t.id('PV'))), '23P01');
select t.is('séjours : arrivée le jour du départ acceptée', t.dml('a_manager', format('insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (%L, %L, ''2027-03-05 15:00+00'', ''2027-03-07 10:00+00'')', t.id('A'), t.id('PV'))), '1');
select t.is('séjours : séjour annulé ignoré', t.dml('a_manager', format('insert into public.reservations (organization_id, property_id, status, check_in_at, check_out_at) values (%L, %L, ''cancelled'', ''2027-03-02 15:00+00'', ''2027-03-03 10:00+00'')', t.id('A'), t.id('PV'))), '1');
insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (t.id('A'), t.id('PV'), '2027-03-05 15:00+00', '2027-03-07 10:00+00');
select t.err('séjours : prolongation qui chevauche refusée', t.dml('a_manager', format('update public.reservations set check_out_at = ''2027-03-06 10:00+00'' where id = %L', t.id('RV1'))), '23P01');
alter table public.reservations disable trigger reservations_overlap_check;

-- Profil à l'arrivée dans l'équipe : nom exigé, téléphone facultatif, aucun droit en plus
insert into auth.users (id, email) values (t.id('newbie'), 'newbie@test.invalid');
create table t.inv (token text);
insert into t.inv select t.keep('a_manager', format('select public.create_invitation(%L, ''agent'', ''housekeeper'')', t.id('A')));
select t.err('profil : invitation acceptée sans nom refusée', t.q('newbie', format('select public.accept_invitation(%L, ''  '')', (select token from t.inv))), '22023');
select t.is('profil : invitation acceptée avec un nom', t.keep('newbie', format('select public.accept_invitation(%L, ''Nadia Benali'', ''+33 6 12 34 56 78'')', (select token from t.inv))), t.id('A')::text);
select t.is('profil : nom et téléphone enregistrés', (select full_name || '/' || phone from public.profiles where id = t.id('newbie')), 'Nadia Benali/+33 6 12 34 56 78');
select t.is('profil : rôle agent, inchangé', (select role::text from public.memberships where organization_id = t.id('A') and user_id = t.id('newbie')), 'agent');
select t.is('profil : visible du manager', t.q('a_manager', format('select full_name from public.profiles where id = %L', t.id('newbie'))), 'Nadia Benali');
select t.is('profil : l''agent modifie son propre profil', t.dml('newbie', format('update public.profiles set phone = ''0612345678'' where id = %L', t.id('newbie'))), '1');
select t.deny('profil : l''agent ne modifie pas le profil d''un collègue', t.dml('newbie', format('update public.profiles set full_name = ''x'' where id = %L', t.id('a_agent'))));

-- Absences et fermetures
insert into public.tasks (id, organization_id, property_id, type, status, window_start, window_end, duration_min) values
  (t.id('TW2'), t.id('A'), t.id('PV'), 'turnover', 'unassigned', '2027-04-10 08:00+00', '2027-04-10 12:00+00', 120),
  (t.id('TW3'), t.id('A'), t.id('PV'), 'turnover', 'unassigned', '2027-04-10 13:00+00', '2027-04-10 17:00+00', 120);
select t.is('absence : demandée par l''agent (en attente)', t.keep('a_agent', format('select public.save_absence(%L, %L, ''member'', %L, ''leave'', ''2027-04-10 07:00+00'', ''2027-04-10 11:00+00'') ->> ''status''', t.id('A'), t.id('ABS1'), t.id('a_agent'))), 'pending');
select t.is('absence : rejouer la demande ne crée pas de doublon', t.keep('a_agent', format('select public.save_absence(%L, %L, ''member'', %L, ''leave'', ''2027-04-10 07:00+00'', ''2027-04-10 11:00+00'') ->> ''replayed''', t.id('A'), t.id('ABS1'), t.id('a_agent'))), 'true');
select t.is('absence : une seule ligne et un seul événement', (select count(*)::text from public.absences where client_id = t.id('ABS1')) || '/' || (select count(*)::text from public.absence_events e join public.absences a on a.id = e.absence_id where a.client_id = t.id('ABS1')), '1/1');
select t.is('absence : responsables prévenus de la demande (une fois)', (select count(*)::text from public.notification_outbox where organization_id = t.id('A') and template = 'team_absence_requested'), '2');
select t.err('absence : un agent ne déclare pas l''absence d''un collègue', t.q('a_agent', format('select public.save_absence(%L, gen_random_uuid(), ''member'', %L, ''leave'', now(), now() + interval ''1 day'')', t.id('A'), t.id('a_agent2'))), '42501');
select t.err('absence : un agent ne ferme pas l''équipe', t.q('a_agent', format('select public.save_absence(%L, gen_random_uuid(), ''team'', null, ''closure'', now(), now() + interval ''1 day'')', t.id('A'))), '42501');
select t.err('absence : période incohérente refusée', t.q('a_manager', format('select public.save_absence(%L, gen_random_uuid(), ''member'', %L, ''leave'', now(), now() - interval ''1 hour'')', t.id('A'), t.id('a_agent'))), '22023');
select t.is('absence : en attente, l''affectation reste possible', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent'), t.id('TW2'))), '1');
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TW4'), t.id('A'), t.id('PV'), 'turnover', 'assigned', t.id('a_agent'), '2027-04-10 07:30+00', '2027-04-10 10:30+00', 60);
select t.err('absence : l''agent ne décide pas', t.q('a_agent', format('select public.decide_absence(%L, (select id from public.absences where client_id = %L), true)', t.id('A'), t.id('ABS1'))), '42501');
select t.is('absence : acceptée par le manager', t.keep('a_manager', format('select public.decide_absence(%L, (select id from public.absences where client_id = %L), true)', t.id('A'), t.id('ABS1'))), 'applied');
select t.is('absence : décider deux fois sans effet', t.keep('a_manager', format('select public.decide_absence(%L, (select id from public.absences where client_id = %L), true)', t.id('A'), t.id('ABS1'))), 'already');
select t.err('absence : nouvelle affectation pendant l''absence refusée', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent'), t.id('TW2'))), '22023');
select t.is('absence : partielle — la mission de l''après-midi reste attribuable', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent'), t.id('TW3'))), '1');
select t.is('absence : temps libre restant le matin (11 h → 12 h)', t.q('a_manager', format('select public.free_minutes(%L, %L, ''2027-04-10 08:00+00'', ''2027-04-10 12:00+00'')', t.id('A'), t.id('a_agent'))), '60');
select t.err('absence : le temps libre d''un collègue n''est pas lisible par un agent', t.q('a_agent2', format('select public.free_minutes(%L, %L, now(), now() + interval ''1 day'')', t.id('A'), t.id('a_agent'))), '42501');
select t.err('absence : ni par une autre organisation', t.q('b_manager', format('select public.free_minutes(%L, %L, now(), now() + interval ''1 day'')', t.id('A'), t.id('a_agent'))), '42501');
-- Mission déjà attribuée avant l'acceptation : jamais réaffectée automatiquement (le conflit est signalé)
select t.is('absence : la mission déjà attribuée n''est pas réaffectée automatiquement', (select assignee_id::text || '/' || status::text from public.tasks where id = t.id('TW4')), t.id('a_agent')::text || '/assigned');
select t.is('absence : elle ne tient plus hors de l''absence (conflit à signaler)', t.q('a_manager', format('select public.free_minutes(%L, %L, ''2027-04-10 07:30+00'', ''2027-04-10 10:30+00'')', t.id('A'), t.id('a_agent'))), '0');
select t.is('absence : annulée par l''agent', t.keep('a_agent', format('select public.cancel_absence(%L, (select id from public.absences where client_id = %L))', t.id('A'), t.id('ABS1'))), 'applied');
select t.is('absence : annulée, elle ne bloque plus', t.q('a_manager', format('select public.free_minutes(%L, %L, ''2027-04-10 08:00+00'', ''2027-04-10 12:00+00'')', t.id('A'), t.id('a_agent'))), '240');
select t.is('absence : historique complet', (select string_agg(e.kind, ',' order by e.id) from public.absence_events e join public.absences a on a.id = e.absence_id where a.client_id = t.id('ABS1')), 'requested,accepted,cancelled');
-- Refus
select t.is('absence : demande d''indisponibilité imprévue', t.keep('a_agent2', format('select public.save_absence(%L, %L, ''member'', %L, ''unavailable'', ''2027-04-10 07:00+00'', ''2027-04-10 20:00+00'', true, ''Imprévu'') ->> ''status''', t.id('A'), t.id('ABS2'), t.id('a_agent2'))), 'pending');
select t.is('absence : refusée', t.keep('a_manager', format('select public.decide_absence(%L, (select id from public.absences where client_id = %L), false)', t.id('A'), t.id('ABS2'))), 'applied');
select t.is('absence : refusée, elle ne bloque pas', t.q('a_manager', format('select public.free_minutes(%L, %L, ''2027-04-10 08:00+00'', ''2027-04-10 12:00+00'')', t.id('A'), t.id('a_agent2'))), '240');
-- Fermeture d'équipe : bloque tout le monde, ne déplace ni ne supprime rien
select t.is('fermeture : enregistrée par le manager', t.keep('a_manager', format('select public.save_absence(%L, %L, ''team'', null, ''closure'', ''2027-04-10 00:00+00'', ''2027-04-11 00:00+00'', false, ''Fermeture annuelle'') ->> ''status''', t.id('A'), t.id('ABS3'))), 'accepted');
select t.is('fermeture : aucun temps libre pour un agent', t.q('a_manager', format('select public.free_minutes(%L, %L, ''2027-04-10 08:00+00'', ''2027-04-10 12:00+00'')', t.id('A'), t.id('a_agent2'))), '0');
select t.err('fermeture : affectation refusée', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent2'), t.id('TW2'))), '22023');
select t.is('fermeture : les missions restent en place', (select count(*)::text from public.tasks where id in (t.id('TW2'), t.id('TW3'), t.id('TW4')) and status <> 'cancelled'), '3');
select t.is('fermeture : visible par les agents de l''organisation', t.q('a_agent2', format('select count(*) from public.absences where client_id = %L', t.id('ABS3'))), '1');
-- Confidentialité et cloisonnement
select t.is('absence : un agent ne voit pas les absences de ses collègues', t.q('a_agent', format('select count(*) from public.absences where client_id = %L', t.id('ABS2'))), '0');
select t.is('absence : ni leur historique', t.q('a_agent', format('select count(*) from public.absence_events e where e.absence_id = (select id from public.absences where client_id = %L)', t.id('ABS2'))), '0');
select t.is('absence : une autre organisation ne voit rien', t.q('b_manager', format('select count(*) from public.absences where organization_id = %L', t.id('A'))), '0');
select t.err('absence : une autre organisation ne décide pas', t.q('b_manager', format('select public.decide_absence(%L, (select id from public.absences where client_id = %L), true)', t.id('A'), t.id('ABS2'))), '42501');
select t.err('absence : une autre organisation n''annule pas', t.q('b_manager', format('select public.cancel_absence(%L, (select id from public.absences where client_id = %L))', t.id('A'), t.id('ABS3'))), '42501');
select t.deny('absence : aucune écriture directe', t.dml('a_manager', format('update public.absences set status = ''cancelled'' where client_id = %L', t.id('ABS3'))));
select t.is('fermeture : annulée', t.keep('a_manager', format('select public.cancel_absence(%L, (select id from public.absences where client_id = %L))', t.id('A'), t.id('ABS3'))), 'applied');
update public.organizations set validation_task_types = array['turnover']::public.task_type[] where id = t.id('A');

-- 3.4 Mission sans validation requise : validée automatiquement à la soumission
select t.is('auto : démarrer un accueil', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC2'))), 'applied');
select t.is('auto : soumettre', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC2'))), 'applied');
select t.is('auto : validée sans passer par le manager', (select status::text from public.tasks where id = t.id('TC2')), 'validated');
select t.is('auto : tracée comme validation automatique', (select kind from public.task_events where task_id = t.id('TC2') order by id desc limit 1), 'auto_validated');

-- =====================================================================
-- 4. Liens invités par séjour (migration 3) — la seule exception anonyme
-- =====================================================================
create table t.tok (name text primary key, token text);
do $$ begin
  insert into t.tok values ('A', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA2'))));
  insert into t.tok values ('B', t.keep('b_manager', format('select public.create_guest_link(%L, %L)', t.id('B'), t.id('RB2'))));
  insert into t.tok values ('A3', t.keep('a_owner', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA3'))));
end $$;
create function t.tk(n text) returns text language sql stable as $$ select token from t.tok where name = n $$;
create function t.guest(tok text, path text default '{status}') returns text language sql as $$
  select t.q(null, format('select public.get_guest_stay(%L) #>> %L', tok, path))
$$;

select t.check('invité : jeton brut renvoyé une fois (64 caractères hexadécimaux)', t.tk('A'), t.tk('A') ~ '^[0-9a-f]{64}$');
select t.is('invité : jeton jamais stocké en clair', (select count(*)::text from public.guest_links where token_hash = t.tk('A')), '0');
select t.is('invité : lien valide pendant le séjour (sans compte)', t.guest(t.tk('A')), 'ok');
select t.is('invité : contenu du séjour concerné uniquement', t.guest(t.tk('A'), '{guide,welcome}'), 'Bienvenue au Canal');
select t.is('invité : réutilisable (deuxième ouverture)', t.guest(t.tk('A')), 'ok');
select t.check('invité : jamais de code d''accès dans la réponse', t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('A'))),
  t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('A'))) not like '%A-1234%' and t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('A'))) not like '%code%');
select t.is('invité : le lien de B ne donne que B', t.guest(t.tk('B'), '{property,name}'), 'B — Vieux-Port');
select t.is('invité : séjour à venir (plus de 72 h) = espace de préparation seulement', t.guest(t.tk('A3')), 'prep');
select t.is('invité : avant la fenêtre, ni livret ni Wi-Fi ni adresse', t.q(null, format('select coalesce(public.get_guest_stay(%L) ->> ''guide'', ''aucun'') || ''/'' || coalesce(public.get_guest_stay(%L) #>> ''{property,address}'', ''aucune'')', t.tk('A3'), t.tk('A3'))), 'aucun/aucune');
select t.check('invité : avant la fenêtre, aucun mot de passe Wi-Fi nulle part', '', position('wifi-A2' in t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('A3')))) = 0);
select t.is('invité : avant la fenêtre, pas de signalement de problème', t.q(null, format('select public.guest_report_problem(%L, ''other'', ''Test avant'', false) ->> ''status''', t.tk('A3'))), 'unavailable');
select t.is('invité : jeton faux = réponse neutre', t.guest(repeat('0', 64)), 'unavailable');
select t.is('invité : jeton vide = réponse neutre', t.guest(''), 'unavailable');
select t.is('invité : jeton mal formé = réponse neutre', t.guest('x'' or 1=1 --'), 'unavailable');
select t.is('invité : la réponse neutre ne contient rien d''autre', t.q(null, format('select public.get_guest_stay(%L)::text', repeat('0', 64))), '{"status": "unavailable"}');
select t.err('invité : aucune lecture directe des liens sans compte', t.q(null, 'select count(*) from public.guest_links'), '42501');
select t.err('invité : aucune lecture des séjours sans compte', t.q(null, 'select count(*) from public.reservations'), '42501');
select t.err('invité : aucune lecture du livret par table sans compte', t.q(null, 'select count(*) from public.guest_guides'), '42501');
select t.err('invité : aucune autre fonction sans compte', t.q(null, format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA2'))), '42501');
select t.err('invité : empreinte du jeton illisible même pour le owner', t.q('a_owner', 'select count(token_hash) from public.guest_links'), '42501');
select t.is('invité : le manager voit le statut', t.q('a_manager', format('select public.guest_link_status(revoked_at, valid_from, valid_until) from public.guest_links where reservation_id = %L and revoked_at is null', t.id('RA2'))), 'active');
select t.is('invité : statut « à venir »', t.q('a_manager', format('select public.guest_link_status(revoked_at, valid_from, valid_until) from public.guest_links where reservation_id = %L and revoked_at is null', t.id('RA3'))), 'upcoming');

-- Droits sur les liens
select t.err('invité : manager de B ne crée pas de lien pour un séjour de A', t.q('b_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA2'))), '42501');
select t.err('invité : manager de B, séjour de A annoncé en B', t.q('b_manager', format('select public.create_guest_link(%L, %L)', t.id('B'), t.id('RA2'))), 'P0002');
select t.err('invité : agent ne crée pas de lien', t.q('a_agent', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA2'))), '42501');
select t.err('invité : manager de B ne révoque pas un lien de A', t.q('b_manager', format('select public.revoke_guest_link(%L, (select id from public.guest_links where reservation_id = %L and revoked_at is null))', t.id('A'), t.id('RA2'))), '42501');
select t.err('invité : manager de B ne prolonge pas un lien de A', t.q('b_manager', format('select public.extend_guest_link(%L, %L, now() + interval ''3 days'')', t.id('A'),
  (select id from public.guest_links where reservation_id = t.id('RA2') and revoked_at is null))), '42501');
select t.err('invité : pas de lien pour un séjour terminé', t.q('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA1'))), '22023');

-- Prolongation (départ tardif), plafonnée
select t.err('invité : prolongation au-delà de 7 jours après le départ refusée', t.q('a_manager', format('select public.extend_guest_link(%L, %L, now() + interval ''30 days'')', t.id('A'),
  (select id from public.guest_links where reservation_id = t.id('RA2') and revoked_at is null))), '22023');
select t.is('invité : prolongation acceptée', t.keep('a_manager', format('select public.extend_guest_link(%L, %L, now() + interval ''3 days'')', t.id('A'),
  (select id from public.guest_links where reservation_id = t.id('RA2') and revoked_at is null))), '');

-- Expiration à l'heure de départ (le temps qui passe est simulé en reculant les dates)
update public.guest_links set valid_from = now() - interval '5 days', valid_until = now() - interval '1 second' where token_hash = encode(extensions.digest(t.tk('B'), 'sha256'), 'hex');
select t.is('invité : expiré après l''heure de départ', t.guest(t.tk('B')), 'unavailable');
select t.is('invité : statut « expiré » pour le manager', t.q('b_manager', format('select public.guest_link_status(revoked_at, valid_from, valid_until) from public.guest_links where reservation_id = %L and revoke_reason is null', t.id('RB2'))), 'expired');

-- Révocation immédiate, puis renouvellement
select t.is('invité : révocation par le manager', t.keep('a_manager', format('select public.revoke_guest_link(%L, (select id from public.guest_links where reservation_id = %L and revoked_at is null))', t.id('A'), t.id('RA2'))), '');
select t.is('invité : lien révoqué = réponse neutre, immédiatement', t.guest(t.tk('A')), 'unavailable');
do $$ begin insert into t.tok values ('A2', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA2')))); end $$;
select t.is('invité : nouveau lien actif', t.guest(t.tk('A2')), 'ok');
do $$ begin insert into t.tok values ('A2b', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA2')))); end $$;
select t.is('invité : renouveler révoque le lien précédent', t.guest(t.tk('A2')), 'unavailable');
select t.is('invité : le lien renouvelé fonctionne', t.guest(t.tk('A2b')), 'ok');

-- Séjour annulé ou livret désactivé
select t.is('invité : séjour annulé', t.dml('a_manager', format('update public.reservations set status = ''cancelled'' where id = %L', t.id('RA2'))) || '/' || t.guest(t.tk('A2b')), '1/ok');
update public.reservations set status = 'cancelled' where id = t.id('RA2');
select t.is('invité : séjour annulé = lien révoqué automatiquement', t.guest(t.tk('A2b')), 'unavailable');
select t.is('invité : motif tracé', (select revoke_reason from public.guest_links where token_hash = encode(extensions.digest(t.tk('A2b'), 'sha256'), 'hex')), 'stay_cancelled');

-- =====================================================================
-- 5. Espace voyageur : prestations, réponses, messages, notifications (migration 4)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['RA4', 'RB4']) k;
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('RA4'), t.id('A'), t.id('PA2'), 'Voyageur A4', 'a4@guest.test', now() - interval '1 day', now() + interval '2 days'),
  (t.id('RB4'), t.id('B'), t.id('PB1'), 'Voyageur B4', null, now() - interval '1 day', now() + interval '2 days');
do $$ begin
  insert into t.tok values ('GA', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RA4'))));
  insert into t.tok values ('GB', t.keep('b_manager', format('select public.create_guest_link(%L, %L)', t.id('B'), t.id('RB4'))));
end $$;
create table t.svc (name text primary key, id uuid);
do $$ begin
  insert into t.svc values ('SA', (t.keep(null, format('select public.guest_request_service(%L, ''private_chef'', now() + interval ''1 day'', 4, ''Dîner'')', t.tk('GA')))::jsonb ->> 'id')::uuid);
  insert into t.svc values ('SB', (t.keep(null, format('select public.guest_request_service(%L, ''driver'', now() + interval ''1 day'', 2, null)', t.tk('GB')))::jsonb ->> 'id')::uuid);
end $$;
create function t.sv(n text) returns uuid language sql stable as $$ select id from t.svc where name = n $$;

select t.check('voyageur : demande créée sans compte, via son lien', t.sv('SA')::text, t.sv('SA') is not null);
select t.is('voyageur : accusé de réception mis en file (adresse connue)', (select count(*)::text from public.notification_outbox where service_id = t.sv('SA') and template = 'service_received'), '1');
select t.is('voyageur : pas d''e-mail sans adresse (rien n''est simulé)', (select count(*)::text from public.notification_outbox where service_id = t.sv('SB') and template not like 'team_%'), '0');
select t.is('équipe : les responsables de B sont prévenus de la demande (adresses de test : échec tracé, jamais « envoyé »)',
  (select string_agg(status || ':' || coalesce(last_error, ''), ',') from public.notification_outbox where service_id = t.sv('SB') and template = 'team_service_requested'),
  'failed:undeliverable_test_address,failed:undeliverable_test_address,failed:undeliverable_test_address');
select t.is('voyageur : sa demande apparaît dans son espace', t.guest(t.tk('GA'), '{services,0,status}'), 'requested');
select t.is('voyageur : il ne voit pas la demande de B', t.q(null, format('select jsonb_array_length(public.get_guest_stay(%L) -> ''services'')', t.tk('GA'))), '1');
select t.is('voyageur : lien faux = aucune création', (t.q(null, format('select public.guest_request_service(%L, ''spa'', now(), 1, null)', repeat('0', 64)))::jsonb ->> 'status'), 'unavailable');
select t.is('voyageur : ne répond pas à la demande d''un autre séjour', (t.q(null, format('select public.guest_reply_service(%L, %L, ''x'')', t.tk('GA'), t.sv('SB')))::jsonb ->> 'status'), 'unavailable');
select t.err('voyageur : aucune lecture directe des demandes sans compte', t.q(null, 'select count(*) from public.service_requests'), '42501');

select t.is('équipe : le manager de A voit la demande, signalée non lue', t.q('a_manager', format('select manager_unread::text from public.service_requests where id = %L', t.sv('SA'))), 'true');
select t.is('équipe : le manager de B ne la voit pas', t.q('b_manager', format('select count(*) from public.service_requests where id = %L', t.sv('SA'))), '0');
select t.is('équipe : un agent non chargé ne la voit pas', t.q('a_agent', format('select count(*) from public.service_requests where id = %L', t.sv('SA'))), '0');
select t.err('équipe : le manager de B ne décide pas pour A', t.q('b_manager', format('select public.decide_service(%L, %L, ''confirmed'')', t.id('A'), t.sv('SA'))), '42501');
select t.err('équipe : un agent ne décide pas', t.q('a_agent', format('select public.decide_service(%L, %L, ''confirmed'')', t.id('A'), t.sv('SA'))), '42501');
select t.err('équipe : statut modifiable seulement par la fonction de décision', t.dml('a_manager', format('update public.service_requests set status = ''confirmed'' where id = %L', t.sv('SA'))), '42501');
select t.err('précisions : la question est obligatoire', t.q('a_manager', format('select public.decide_service(%L, %L, ''info_requested'', ''  '')', t.id('A'), t.sv('SA'))), '22023');
select t.is('précisions : demandées avec une question et une note interne',
  (t.keep('a_manager', format('select public.decide_service(%L, %L, ''info_requested'', ''Des allergies ?'', ''Client exigeant'')', t.id('A'), t.sv('SA')))::jsonb ->> 'email_queued'), 'true');
select t.is('précisions : le voyageur voit la question', t.guest(t.tk('GA'), '{services,0,events,1,body}'), 'Des allergies ?');
select t.check('précisions : la note interne n''apparaît jamais côté voyageur', t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('GA'))),
  t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('GA'))) not like '%Client exigeant%' and t.q(null, format('select public.get_guest_stay(%L)::text', t.tk('GA'))) not like '%note interne%');
select t.is('précisions : la réponse du voyageur revient au dossier', (t.keep(null, format('select public.guest_reply_service(%L, %L, ''Pas d''''arachides'')', t.tk('GA'), t.sv('SA')))::jsonb ->> 'status'), 'ok');
select t.is('précisions : la demande repasse « en cours d''étude », signalée à l''équipe', t.q('a_manager', format('select status || ''/'' || manager_unread from public.service_requests where id = %L', t.sv('SA'))), 'in_review/true');
select t.is('équipe : la réponse du voyageur est dans l''historique', t.q('a_manager', format('select body from public.service_events where service_id = %L and kind = ''guest_message''', t.sv('SA'))), 'Pas d''arachides');
select t.is('acceptation : confirmée', (t.keep('a_manager', format('select public.decide_service(%L, %L, ''confirmed'', ''Réservé pour 20 h'')', t.id('A'), t.sv('SA')))::jsonb ->> 'status'), 'ok');
select t.is('acceptation : le voyageur voit la confirmation', t.guest(t.tk('GA'), '{services,0,status}'), 'confirmed');
select t.is('acceptation : un e-mail par étape, état « en attente » tant qu''il n''est pas parti',
  (select string_agg(template || ':' || status, ',' order by created_at) from public.notification_outbox where service_id = t.sv('SA') and template not like 'team_%'),
  'service_received:pending,service_info_requested:pending,service_confirmed:pending');
select t.is('historique : chaque étape horodatée', t.q('a_manager', format('select string_agg(kind || coalesce('':'' || status, ''''), '','' order by id) from public.service_events where service_id = %L', t.sv('SA'))),
  'created:requested,status:info_requested,internal_note,guest_message,status:in_review,status:confirmed');
select t.err('modification : le manager de B ne modifie pas une demande de A', t.q('b_manager', format('select public.update_service(%L, %L, now() + interval ''3 days'', 4)', t.id('A'), t.sv('SA'))), '42501');
select t.err('modification : un agent ne modifie pas', t.q('a_agent', format('select public.update_service(%L, %L, now() + interval ''3 days'', 4)', t.id('A'), t.sv('SA'))), '42501');
select t.is('modification : le manager déplace la prestation', (t.keep('a_manager', format('select public.update_service(%L, %L, (select start_at + interval ''1 hour'' from public.service_requests where id = %L), 4, ''Décalé à 21 h'')', t.id('A'), t.sv('SA'), t.sv('SA')))::jsonb ->> 'status'), 'ok');
select t.is('modification : le voyageur voit le changement', t.guest(t.tk('GA'), '{services,0,events,-1,body}'), 'Décalé à 21 h');
select t.is('modification : e-mail mis en file', (select count(*)::text from public.notification_outbox where service_id = t.sv('SA') and template = 'service_updated'), '1');
select t.is('transition impossible refusée (confirmée → précisions)', (t.q('a_manager', format('select public.decide_service(%L, %L, ''info_requested'', ''x'')', t.id('A'), t.sv('SA')))::jsonb ->> 'status'), 'conflict');
select t.is('refus : avec motif communicable, sans e-mail faute d''adresse', (t.keep('b_manager', format('select public.decide_service(%L, %L, ''declined'', ''Indisponible à cette date'')', t.id('B'), t.sv('SB')))::jsonb ->> 'email_queued'), 'false');
select t.is('refus : le voyageur de B voit le motif', t.guest(t.tk('GB'), '{services,0,events,1,body}'), 'Indisponible à cette date');

-- Messages du séjour
select t.is('messages : le voyageur écrit à l''équipe', (t.keep(null, format('select public.guest_send_message(%L, ''Le code wifi ne marche pas'')', t.tk('GA')))::jsonb ->> 'status'), 'ok');
select t.is('messages : le manager de A le lit', t.q('a_manager', format('select count(*) from public.stay_messages where reservation_id = %L', t.id('RA4'))), '1');
select t.is('messages : le manager de B ne le voit pas', t.q('b_manager', format('select count(*) from public.stay_messages where reservation_id = %L', t.id('RA4'))), '0');
select t.is('messages : un agent ne le voit pas', t.q('a_agent', format('select count(*) from public.stay_messages where reservation_id = %L', t.id('RA4'))), '0');
select t.is('messages : le manager répond', (t.keep('a_manager', format('select public.reply_stay_message(%L, %L, ''Redémarrez la box'')', t.id('A'), t.id('RA4')))::jsonb ->> 'status'), 'ok');
select t.err('messages : le manager de B ne répond pas au séjour de A', t.q('b_manager', format('select public.reply_stay_message(%L, %L, ''x'')', t.id('A'), t.id('RA4'))), '42501');
select t.is('messages : le voyageur voit la réponse', t.guest(t.tk('GA'), '{messages,1,body}'), 'Redémarrez la box');
select t.is('messages : le voyageur de B ne voit pas ceux de A', t.q(null, format('select jsonb_array_length(public.get_guest_stay(%L) -> ''messages'')', t.tk('GB'))), '0');

-- File d'envoi
select t.err('envoi : personne ne marque un e-mail « envoyé » à la main', t.dml('a_owner', format('update public.notification_outbox set status = ''sent'' where organization_id = %L', t.id('A'))), '42501');
select t.is('envoi : le manager de B ne voit pas la file de A', t.q('b_manager', format('select count(*) from public.notification_outbox where organization_id = %L', t.id('A'))), '0');
update public.notification_outbox set status = 'failed', last_error = 'smtp down' where service_id = t.sv('SA') and template = 'service_confirmed';
select t.err('envoi : le manager de B ne relance pas un envoi de A', t.q('b_manager', format('select public.retry_notification(%L, (select id from public.notification_outbox where service_id = %L and template = ''service_confirmed''))', t.id('A'), t.sv('SA'))), '42501');
select t.is('envoi : le manager de A relance un envoi en échec', t.keep('a_manager', format('select public.retry_notification(%L, (select id from public.notification_outbox where service_id = %L and template = ''service_confirmed''))', t.id('A'), t.sv('SA'))), '');
select t.is('envoi : de nouveau « en attente »', (select status from public.notification_outbox where service_id = t.sv('SA') and template = 'service_confirmed'), 'pending');

-- Incidents : agent sur sa mission, voyageur sur son séjour ; traitement par l'équipe seulement
select t.is('incident : l''agent signale un blocage sur sa mission', (t.keep('a_agent', format('select public.report_incident(%L, %L, ''missing_supplies'', ''Plus de produit vaisselle'', true) is not null', t.id('A'), t.id('TA1')))), 'true');
select t.err('incident : pas sur la mission d''un collègue', t.q('a_agent', format('select public.report_incident(%L, %L, ''other'', ''abc'', false)', t.id('A'), t.id('TA2'))), '42501');
select t.err('incident : pas dans une autre organisation', t.q('b_agent', format('select public.report_incident(%L, %L, ''other'', ''abc'', false)', t.id('A'), t.id('TA1'))), '42501');
select t.err('incident : aucune écriture directe', t.dml('a_manager', format('insert into public.incidents (organization_id, property_id, source, category, description) values (%L, %L, ''manager'', ''other'', ''abc'')', t.id('A'), t.id('PA1'))), '42501');
select t.is('incident : le manager de A le voit', t.q('a_manager', format('select count(*) from public.incidents where organization_id = %L and source = ''agent''', t.id('A'))), '1');
select t.is('incident : le manager de B ne le voit pas', t.q('b_manager', 'select count(*) from public.incidents'), '0');
select t.is('incident : un autre agent de A ne le voit pas', t.q('a_agent2', 'select count(*) from public.incidents'), '0');
select t.is('incident : l''agent voit le sien', t.q('a_agent', 'select count(*) from public.incidents'), '1');
select t.is('problème voyageur : signalé par son lien', (t.keep(null, format('select public.guest_report_problem(%L, ''breakdown'', ''Chauffe-eau en panne'', true)', t.tk('GA')))::jsonb ->> 'status'), 'ok');
select t.is('problème voyageur : catégorie interne refusée', (t.q(null, format('select public.guest_report_problem(%L, ''blocker'', ''abcdef'', false)', t.tk('GA')))::jsonb ->> 'status'), 'invalid');
select t.is('problème voyageur : lien inventé refusé', (t.q(null, format('select public.guest_report_problem(%L, ''other'', ''abcdef'', false)', repeat('e', 64)))::jsonb ->> 'status'), 'unavailable');
select t.is('problème voyageur : il voit le sien', t.q(null, format('select jsonb_array_length(public.guest_problems(%L) -> ''problems'')', t.tk('GA'))), '1');
select t.is('problème voyageur : le voyageur de B ne le voit pas', t.q(null, format('select jsonb_array_length(public.guest_problems(%L) -> ''problems'')', t.tk('GB'))), '0');
select t.is('problème voyageur : jamais l''incident d''un agent', t.q(null, format('select (public.guest_problems(%L))::text like ''%%vaisselle%%''', t.tk('GA'))), 'false');
select t.err('problème voyageur : un agent ne le résout pas', t.q('a_agent', format('select public.resolve_incident(%L, (select id from public.incidents where source = ''guest'' limit 1), ''x'')', t.id('A'))), '42501');
select t.err('problème voyageur : le manager de B ne le résout pas', t.q('b_manager', format('select public.resolve_incident(%L, (select id from public.incidents where organization_id = %L and source = ''guest''), ''x'')', t.id('A'), t.id('A'))), '42501');
select t.is('problème voyageur : pris en charge', t.keep('a_manager', format('select public.take_incident(%L, (select id from public.incidents where organization_id = %L and source = ''guest''))', t.id('A'), t.id('A'))), 'applied');
select t.is('problème voyageur : résolu avec note interne et message', (t.keep('a_manager', format('select public.resolve_incident(%L, (select id from public.incidents where organization_id = %L and source = ''guest''), ''Pièce changée, facture 120 €'', ''Le technicien est passé, l''''eau chaude est revenue.'')', t.id('A'), t.id('A')))::jsonb ->> 'status'), 'ok');
select t.is('problème voyageur : il voit la réponse, jamais la note interne',
  t.q(null, format('select (public.guest_problems(%L))::text like ''%%eau chaude est revenue%%'' and (public.guest_problems(%L))::text not like ''%%facture%%''', t.tk('GA'), t.tk('GA'))), 'true');
select t.is('problème voyageur : e-mail mis en file', (select count(*)::text from public.notification_outbox where template = 'problem_resolved'), '1');

-- Notifications de l'équipe : chaque événement voyageur (et blocage urgent d'agent) crée un envoi traçable
select t.is('équipe : blocage urgent d''agent → responsables prévenus', (select count(*)::text from public.notification_outbox o join public.incidents i on i.id = o.incident_id where i.source = 'agent' and o.template = 'team_agent_blocker'), '2');
select t.is('équipe : problème voyageur → responsables prévenus', (select count(*)::text from public.notification_outbox where template = 'team_guest_problem'), '2');
select t.is('équipe : message voyageur → responsables prévenus', (select count(*)::text from public.notification_outbox where template = 'team_guest_message' and organization_id = t.id('A')), '4');
select t.check('équipe : réponse du voyageur à une question → responsables prévenus', '', (select count(*) from public.notification_outbox where template = 'team_guest_reply' and organization_id = t.id('A')) > 0);
select t.is('équipe : jamais d''agent parmi les destinataires des alertes responsables', (select count(*)::text from public.notification_outbox where template like 'team_%' and (recipient like 'a_agent%' or recipient like 'b_agent%')), '0');
select t.check('équipe : seules les adresses fictives sont en échec', '', not exists (select 1 from public.notification_outbox where template like 'team_%' and status = 'failed' and recipient not like '%.invalid'));
select t.is('voyageur : problème pris en charge → e-mail au voyageur s''il a une adresse', (select count(*)::text from public.notification_outbox where template = 'problem_taken'), '1');
select t.is('équipe : une autre organisation ne voit pas ces envois', t.q('b_manager', format('select count(*) from public.notification_outbox where organization_id = %L', t.id('A'))), '0');

-- Intervention de maintenance suite à un incident
select t.err('intervention : un agent ne la crée pas', t.q('a_agent', format('select public.create_intervention(%L, (select id from public.incidents where organization_id = %L and source = ''agent''), null, now(), now() + interval ''2 hours'', 60)', t.id('A'), t.id('A'))), '42501');
select t.err('intervention : le manager de B ne la crée pas', t.q('b_manager', format('select public.create_intervention(%L, (select id from public.incidents where organization_id = %L and source = ''agent''), null, now(), now() + interval ''2 hours'', 60)', t.id('A'), t.id('A'))), '42501');
select t.err('intervention : pas pour un agent d''une autre organisation', t.q('a_manager', format('select public.create_intervention(%L, (select id from public.incidents where organization_id = %L and source = ''agent''), %L, now(), now() + interval ''2 hours'', 60)', t.id('A'), t.id('A'), t.id('b_agent'))), '22023');
select t.is('intervention : le manager la crée, assignée à son agent', (t.keep('a_manager', format('select public.create_intervention(%L, (select id from public.incidents where organization_id = %L and source = ''agent''), %L, now(), now() + interval ''2 hours'', 60) is not null', t.id('A'), t.id('A'), t.id('a_agent')))), 'true');
select t.is('intervention : mission de maintenance reliée, incident pris en charge', t.q('a_manager', format('select t.type || ''/'' || i.status from public.incidents i join public.tasks t on t.id = i.follow_up_task_id where i.organization_id = %L and i.source = ''agent''', t.id('A'))), 'maintenance/in_progress');
select t.is('intervention : l''agent la voit dans ses missions', t.q('a_agent', 'select count(*) from public.tasks where type = ''maintenance'''), '1');
select t.is('intervention : invisible pour B', t.q('b_manager', 'select count(*) from public.tasks where type = ''maintenance'''), '0');

-- Lien révoqué : plus aucune action voyageur
select t.keep('a_manager', format('select public.revoke_guest_link(%L, (select id from public.guest_links where reservation_id = %L and revoked_at is null))', t.id('A'), t.id('RA4')));
select t.is('révocation : plus de demande possible', (t.q(null, format('select public.guest_request_service(%L, ''spa'', now(), 1, null)', t.tk('GA')))::jsonb ->> 'status'), 'unavailable');
select t.is('révocation : plus de message possible', (t.q(null, format('select public.guest_send_message(%L, ''x'')', t.tk('GA')))::jsonb ->> 'status'), 'unavailable');
select t.is('révocation : plus de réponse possible', (t.q(null, format('select public.guest_reply_service(%L, %L, ''x'')', t.tk('GA'), t.sv('SA')))::jsonb ->> 'status'), 'unavailable');

-- Onboarding : réponses enregistrées par les responsables de l'organisation seulement
select t.is('onboarding : le manager enregistre les réponses', t.dml('a_manager', format('update public.organizations set activity_type = ''concierge'', onboarding = ''{"step": 2}'' where id = %L', t.id('A'))), '1');
select t.deny('onboarding : un agent ne modifie pas l''organisation', t.dml('a_agent', format('update public.organizations set activity_type = ''independent_hotel'' where id = %L', t.id('A'))));
select t.err('onboarding : type d''activité inconnu refusé', t.dml('a_manager', format('update public.organizations set activity_type = ''casino'' where id = %L', t.id('A'))), '23514');

-- =====================================================================
-- Migration 10 : absences sur le créneau réel, missions à valider, lecture des messages,
-- préférences de notification, messagerie interne, lieux autour du logement
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['PX', 'TX1', 'TX2', 'ABSX', 'CHAT1', 'MSG1', 'MSG2', 'PLACE1', 'PLACE2', 'PLACE3', 'PLACE4']) k;
insert into public.properties (id, organization_id, name) values (t.id('PX'), t.id('A'), 'Logement 10');
-- Lien voyageur propre à cette section (les liens des fixtures ont été révoqués plus haut)
insert into t.ids values ('RX', gen_random_uuid());
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at)
values (t.id('RX'), t.id('A'), t.id('PA1'), 'Séjour lieux', now() - interval '1 day', now() + interval '2 days');
insert into public.guest_links (organization_id, reservation_id, token_hash, valid_from, valid_until)
values (t.id('A'), t.id('RX'), encode(extensions.digest('1111111111111111111111111111111111111111111111111111111111111111', 'sha256'), 'hex'), now() - interval '1 day', now() + interval '2 days');
-- Absences : la fenêtre entière compte quand aucun horaire n'est fixé ; l'horaire fixé compte s'il existe
select t.is('créneau réel : congé accepté', t.keep('a_manager', format('select public.save_absence(%L, %L, ''member'', %L, ''leave'', ''2027-06-02 00:00+00'', ''2027-06-03 00:00+00'') ->> ''status''', t.id('A'), t.id('ABSX'), t.id('a_agent2'))), 'accepted');
insert into public.tasks (id, organization_id, property_id, type, window_start, window_end, duration_min) values
  (t.id('TX1'), t.id('A'), t.id('PX'), 'turnover', '2027-06-01 10:00+00', '2027-06-04 10:00+00', 90),
  (t.id('TX2'), t.id('A'), t.id('PX'), 'maintenance', '2027-06-01 10:00+00', '2027-06-04 10:00+00', 60);
-- Migration 16 : sans horaire, une absence d'un jour dans une fenêtre de 3 jours est un RISQUE (il reste du temps libre), pas un conflit
select t.is('risque : fenêtre de 3 jours, congé d''un jour → affectation acceptée (risque signalé)', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent2'), t.id('TX1'))), '1');
select t.is('risque : niveau calculé côté serveur', (select public.task_absence_level(t.id('A'), t.id('a_agent2'), '2027-06-01 10:00+00', '2027-06-04 10:00+00', null, 90)), 'risk');
select t.is('conflit : fenêtre entièrement couverte par le congé', (select public.task_absence_level(t.id('A'), t.id('a_agent2'), '2027-06-02 08:00+00', '2027-06-02 18:00+00', null, 90)), 'conflict');
select t.is('conflit : temps libre restant plus court que la durée', (select public.task_absence_level(t.id('A'), t.id('a_agent2'), '2027-06-01 23:30+00', '2027-06-03 00:30+00', null, 90)), 'conflict');
select t.is('aucun : fenêtre hors congé', (select public.task_absence_level(t.id('A'), t.id('a_agent2'), '2027-06-03 08:00+00', '2027-06-03 18:00+00', null, 90)), 'none');
select t.is('créneau réel : horaire fixé hors congé → affectation acceptée', t.dml('a_manager', format('update public.tasks set scheduled_start = ''2027-06-01 12:00+00'', assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent2'), t.id('TX1'))), '1');
select t.err('créneau réel : horaire fixé pendant le congé → refusé', t.dml('a_manager', format('update public.tasks set scheduled_start = ''2027-06-02 09:00+00'', assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent2'), t.id('TX1'))), '22023');
update public.tasks set scheduled_start = '2027-06-01 12:00+00', assignee_id = t.id('a_agent2'), status = 'assigned' where id = t.id('TX1');
select t.err('créneau réel : déplacer l''horaire d''une mission affectée sur le congé → refusé', t.dml('a_manager', format('update public.tasks set scheduled_start = ''2027-06-02 10:00+00'' where id = %L', t.id('TX1'))), '22023');
select t.err('créneau réel : corriger la fenêtre sur le congé de la personne affectée → refusé', t.q('a_manager', format('select public.set_task_window(%L, %L, ''2027-06-02 08:00+00'', ''2027-06-02 12:00+00'', 90)', t.id('A'), t.id('TX1'))), '22023');
select t.is('créneau réel : corriger la fenêtre hors congé → accepté', t.q('a_manager', format('select public.set_task_window(%L, %L, ''2027-06-03 08:00+00'', ''2027-06-03 12:00+00'', 90)', t.id('A'), t.id('TX1'))), 'applied');

-- Missions à valider : les responsables sont prévenus à la fin, selon leurs préférences
select t.is('préférences : un responsable coupe l''e-mail « mission à valider »', t.keep('a_manager', format('select public.set_notification_pref(%L, ''team_task_to_validate'', false)', t.id('A'))), '');
select t.is('préférences : enregistrée pour lui seul', t.q('a_manager', 'select count(*) from public.notification_prefs'), '1');
select t.is('préférences : invisibles pour les autres', t.q('a_owner', 'select count(*) from public.notification_prefs'), '0');
select t.err('préférences : jamais pour une autre organisation', t.q('b_manager', format('select public.set_notification_pref(%L, ''team_task_to_validate'', false)', t.id('A'))), '42501');
select t.err('préférences : événement inconnu refusé', t.q('a_manager', format('select public.set_notification_pref(%L, ''nimporte'', false)', t.id('A'))), '23514');
update public.tasks set status = 'in_progress', started_at = now() where id = t.id('TX1');
select t.is('à valider : l''agent termine', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TX1'))), 'applied');
select t.is('à valider : la mission attend le responsable', (select status::text from public.tasks where id = t.id('TX1')), 'done');
select t.is('à valider : e-mail au responsable qui le veut, pas à celui qui l''a coupé', (select string_agg(recipient, ',' order by recipient) from public.notification_outbox where template = 'team_task_to_validate' and status <> 'skipped' and payload ->> 'path' = '/app/missions/' || t.id('TX1')), 'a_owner@test.invalid');
select t.is('à valider : le journal dit pourquoi il n''est pas envoyé à l''autre', (select string_agg(recipient || ':' || status || ':' || last_error, ',') from public.notification_outbox where template = 'team_task_to_validate' and status = 'skipped' and payload ->> 'path' = '/app/missions/' || t.id('TX1')), 'a_manager@test.invalid:skipped:disabled_by_preference');
select t.is('à valider : l''agent est prévenu de son affectation', (select count(*)::text from public.notification_outbox where template = 'agent_task_assigned' and payload ->> 'path' = '/app/missions/' || t.id('TX1') and recipient = 'a_agent2@test.invalid'), '1');
-- Urgence : toujours envoyée, même préférence coupée
select t.is('urgence : un responsable coupe les problèmes voyageurs', t.keep('a_owner', format('select public.set_notification_pref(%L, ''team_guest_problem'', false)', t.id('A'))), '');
select t.is('urgence : fuite signalée par le voyageur', t.keep(null, format('select public.guest_report_problem(%L, ''leak'', ''Fuite sous l''''évier'', false) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111')), 'ok');
select t.check('urgence : envoyée malgré la préférence coupée', '', exists (select 1 from public.notification_outbox where template = 'team_guest_problem' and recipient = 'a_owner@test.invalid' and payload ->> 'message' = 'Fuite sous l''évier'));
select t.is('non urgent : bruit signalé', t.keep(null, format('select public.guest_report_problem(%L, ''noise'', ''Bruit voisin'', false) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111')), 'ok');
select t.is('non urgent : préférence respectée (tracée « non envoyé »)', (select string_agg(status, ',') from public.notification_outbox where template = 'team_guest_problem' and recipient = 'a_owner@test.invalid' and payload ->> 'message' = 'Bruit voisin'), 'skipped');

-- Lecture des messages voyageur : message par message, par un responsable de l'organisation seulement
insert into public.stay_messages (organization_id, reservation_id, author_kind, body) values
  (t.id('A'), t.id('RX'), 'guest', 'Bonjour 1'), (t.id('A'), t.id('RX'), 'guest', 'Bonjour 2');
select t.err('lecture : un agent ne marque pas', t.q('a_agent', format('select public.mark_stay_messages_read(%L, %L)', t.id('A'), t.id('RX'))), '42501');
select t.err('lecture : une autre organisation ne marque pas', t.q('b_manager', format('select public.mark_stay_messages_read(%L, %L)', t.id('A'), t.id('RX'))), '42501');
select t.is('lecture : un seul message marqué', t.keep('a_manager', format('select public.mark_stay_messages_read(%L, %L, array[(select id from public.stay_messages where body = ''Bonjour 1'')])', t.id('A'), t.id('RX'))), '1');
select t.is('lecture : l''autre reste non lu', (select string_agg(body, ',') from public.stay_messages where reservation_id = t.id('RX') and author_kind = 'guest' and read_by_team_at is null and body like 'Bonjour%'), 'Bonjour 2');
select t.check('lecture : toute la conversation', '', t.keep('a_manager', format('select public.mark_stay_messages_read(%L, %L)', t.id('A'), t.id('RX')))::int >= 1);
select t.is('lecture : plus aucun non lu', (select count(*)::text from public.stay_messages where reservation_id = t.id('RX') and author_kind = 'guest' and read_by_team_at is null), '0');

-- Messagerie interne
create table t.chat (k text primary key, v jsonb);
insert into t.chat select 'start', t.keep('a_manager', format('select public.start_team_thread(%L, %L, array[%L]::uuid[], ''task'', %L, ''Clé chez le voisin, porte bleue'')', t.id('A'), t.id('MSG1'), t.id('a_agent2'), t.id('TX2')))::jsonb;
create function t.th() returns uuid language sql stable as $$ select (v ->> 'thread')::uuid from t.chat where k = 'start' $$;
select t.check('messagerie : conversation liée à la mission', '', (select context_kind = 'task' and task_id = t.id('TX2') from public.team_threads where id = t.th()));
select t.is('messagerie : rejouer l''envoi ne crée pas de doublon', t.keep('a_manager', format('select public.start_team_thread(%L, %L, array[%L]::uuid[], ''task'', %L, ''Clé chez le voisin, porte bleue'') ->> ''replayed''', t.id('A'), t.id('MSG1'), t.id('a_agent2'), t.id('TX2'))), 'true');
select t.is('messagerie : un seul message', (select count(*)::text from public.team_messages where thread_id = t.th()), '1');
select t.is('messagerie : l''agent destinataire le lit', t.q('a_agent2', format('select body from public.team_messages where thread_id = %L', t.th())), 'Clé chez le voisin, porte bleue');
select t.is('messagerie : un autre agent ne le voit pas', t.q('a_agent', format('select count(*) from public.team_messages where thread_id = %L', t.th())), '0');
select t.is('messagerie : une autre organisation ne voit rien', t.q('b_manager', format('select count(*) from public.team_threads where organization_id = %L', t.id('A'))), '0');
select t.err('messagerie : une autre organisation n''écrit pas', t.q('b_manager', format('select public.post_team_message(%L, %L, gen_random_uuid(), ''intrusion'')', t.id('A'), t.th())), '42501');
select t.err('messagerie : un agent non participant n''écrit pas', t.q('a_agent', format('select public.post_team_message(%L, %L, gen_random_uuid(), ''intrusion'')', t.id('A'), t.th())), '42501');
select t.deny('messagerie : aucune écriture directe', t.dml('a_agent2', format('update public.team_messages set body = ''modifié'' where thread_id = %L', t.th())));
select t.err('messagerie : le voyageur (anonyme) n''a aucun accès', t.q(null, 'select count(*) from public.team_messages'), '42501');
select t.err('messagerie : l''anonyme n''écrit pas', t.q(null, format('select public.post_team_message(%L, %L, gen_random_uuid(), ''x'')', t.id('A'), t.th())), '42501');
select t.check('messagerie : jamais dans l''espace voyageur', '', position('porte bleue' in t.q(null, format('select public.get_guest_stay(%L)::text', '1111111111111111111111111111111111111111111111111111111111111111'))) = 0);
select t.err('messagerie : un agent n''ouvre pas de conversation', t.q('a_agent2', format('select public.start_team_thread(%L, gen_random_uuid(), array[%L]::uuid[], ''property'', %L, ''x'')', t.id('A'), t.id('a_manager'), t.id('PX'))), '42501');
select t.err('messagerie : destinataire d''une autre organisation refusé', t.q('a_manager', format('select public.start_team_thread(%L, gen_random_uuid(), array[%L]::uuid[], ''property'', %L, ''x'')', t.id('A'), t.id('b_agent'), t.id('PX'))), '22023');
select t.err('messagerie : contexte d''une autre organisation refusé', t.q('a_manager', format('select public.start_team_thread(%L, gen_random_uuid(), array[%L]::uuid[], ''property'', %L, ''x'')', t.id('A'), t.id('a_agent2'), t.id('PB1'))), 'P0002');
select t.err('messagerie : sans contexte opérationnel refusé', t.q('a_manager', format('select public.start_team_thread(%L, gen_random_uuid(), array[%L]::uuid[], ''general'', null, ''x'')', t.id('A'), t.id('a_agent2'))), '22023');
select t.check('messagerie : l''agent est prévenu par e-mail', '', exists (select 1 from public.notification_outbox where template = 'chat_message' and recipient = 'a_agent2@test.invalid'));
-- Réponse de l'agent et lecture
select t.is('messagerie : l''agent répond', t.keep('a_agent2', format('select public.post_team_message(%L, %L, %L, ''Bien reçu, j''''y vais'') ->> ''replayed''', t.id('A'), t.th(), t.id('MSG2'))), 'false');
select t.is('messagerie : réponse vue par le manager', t.q('a_manager', format('select count(*) from public.team_messages where thread_id = %L', t.th())), '2');
select t.check('messagerie : non lue pour le manager tant qu''il n''a pas ouvert', '', (select m.last_read_at < (select max(created_at) from public.team_messages where thread_id = t.th() and author_id = t.id('a_agent2')) from public.team_thread_members m where m.thread_id = t.th() and m.user_id = t.id('a_manager')));
select t.is('messagerie : ouverture par le manager', t.keep('a_manager', format('select public.mark_team_thread_read(%L, %L)', t.id('A'), t.th())), '');
select t.check('messagerie : lue ensuite', '', (select m.last_read_at >= (select max(created_at) from public.team_messages where thread_id = t.th()) from public.team_thread_members m where m.thread_id = t.th() and m.user_id = t.id('a_manager')));
select t.is('messagerie : urgent, préférence coupée', t.keep('a_agent2', format('select public.set_notification_pref(%L, ''chat_message'', false)', t.id('A'))), '');
select t.is('messagerie : message urgent', t.keep('a_manager', format('select public.post_team_message(%L, %L, gen_random_uuid(), ''Urgent : alarme'', true) ->> ''replayed''', t.id('A'), t.th())), 'false');
select t.check('messagerie : message urgent quand même envoyé', '', exists (select 1 from public.notification_outbox where template = 'chat_urgent' and recipient = 'a_agent2@test.invalid'));
select t.is('messagerie : message ordinaire', t.keep('a_manager', format('select public.post_team_message(%L, %L, gen_random_uuid(), ''Pour info'') ->> ''replayed''', t.id('A'), t.th())), 'false');
select t.is('messagerie : message ordinaire non envoyé (préférence), tracé', (select string_agg(status, ',') from public.notification_outbox where template = 'chat_message' and recipient = 'a_agent2@test.invalid' and payload ->> 'message' = 'Pour info'), 'skipped');

-- Lieux autour du logement : jamais ceux d'un autre logement, jamais hors périmètre
update public.properties set latitude = 48.8606, longitude = 2.3376 where id = t.id('PA1');
update public.properties set latitude = 43.2965, longitude = 5.3698 where id = t.id('PA2');
insert into public.property_places (id, organization_id, property_id, source, category, name, latitude, longitude, external_id) values
  (t.id('PLACE1'), t.id('A'), t.id('PA1'), 'manager', 'food', 'Café du Canal', 48.8610, 2.3380, null),
  (t.id('PLACE2'), t.id('A'), t.id('PA1'), 'openstreetmap', 'shops', 'Boulangerie OSM', 48.8620, 2.3390, 'node/1'),
  (t.id('PLACE3'), t.id('A'), t.id('PA1'), 'openstreetmap', 'food', 'Trop loin', 48.9500, 2.3376, 'node/2'),
  (t.id('PLACE4'), t.id('A'), t.id('PA2'), 'manager', 'food', 'Bistrot Vieux-Port', 43.2966, 5.3699, null);
select t.is('lieux : le voyageur voit les lieux de SON logement', t.q(null, format('select (select string_agg(x ->> ''name'', '','' order by x ->> ''name'') from jsonb_array_elements(public.guest_places(%L) -> ''places'') x)', '1111111111111111111111111111111111111111111111111111111111111111')), 'Boulangerie OSM,Café du Canal');
select t.check('lieux : lieu vérifié par l''équipe en premier, distance calculée depuis le logement (≈ 53 m)', t.q(null, format('select (public.guest_places(%L) -> ''places'' -> 0)::text', '1111111111111111111111111111111111111111111111111111111111111111')),
  coalesce(nullif(t.q(null, format('select (public.guest_places(%L) -> ''places'' -> 0 ->> ''distance_m'')', '1111111111111111111111111111111111111111111111111111111111111111')), 'null'), '0')::int between 45 and 60
  and t.q(null, format('select (public.guest_places(%L) -> ''places'' -> 0 ->> ''name'')', '1111111111111111111111111111111111111111111111111111111111111111')) = 'Café du Canal');
update public.guest_links set revoked_at = now() where reservation_id = t.id('RA3') and revoked_at is null;
insert into public.guest_links (organization_id, reservation_id, token_hash, valid_from, valid_until)
values (t.id('A'), t.id('RA3'), encode(extensions.digest('2222222222222222222222222222222222222222222222222222222222222222', 'sha256'), 'hex'), now() - interval '1 day', now() + interval '20 days');
select t.is('lieux : un autre séjour, un autre logement : uniquement les siens', t.q(null, 'select (select string_agg(x ->> ''name'', '','') from jsonb_array_elements(public.guest_places(''2222222222222222222222222222222222222222222222222222222222222222'') -> ''places'') x)'), 'Bistrot Vieux-Port');
select t.is('lieux : lien inventé refusé', t.q(null, format('select public.guest_places(%L) ->> ''status''', repeat('0', 64))), 'unavailable');
update public.property_places set hidden = true where id = t.id('PLACE2');
select t.is('lieux : un lieu masqué n''est plus montré', t.q(null, format('select (select string_agg(x ->> ''name'', '','') from jsonb_array_elements(public.guest_places(%L) -> ''places'') x)', '1111111111111111111111111111111111111111111111111111111111111111')), 'Café du Canal');
select t.is('lieux : un agent ne les gère pas', t.q('a_agent', 'select count(*) from public.property_places'), '0');
select t.deny('lieux : un agent n''en ajoute pas', t.dml('a_agent', format('insert into public.property_places (organization_id, property_id, source, category, name) values (%L, %L, ''manager'', ''food'', ''x'')', t.id('A'), t.id('PA1'))));
select t.is('lieux : une autre organisation ne voit rien', t.q('b_manager', format('select count(*) from public.property_places where organization_id = %L', t.id('A'))), '0');
-- Migration 22 : type précis et favoris du voyageur (liés au séjour, soumis au lien)
update public.property_places set kind = 'cafe' where id = t.id('PLACE1');
select t.is('alentours : le type précis est transmis au voyageur', t.q(null, format('select (public.guest_places(%L) -> ''places'' -> 0 ->> ''kind'')', '1111111111111111111111111111111111111111111111111111111111111111')), 'cafe');
select t.err('alentours : type invalide refusé', t.dml('a_manager', format('update public.property_places set kind = ''Pas Valide'' where id = %L', t.id('PLACE1'))), '23514');
select t.is('favoris : ajout par le lien du séjour', t.keep(null, format('select public.guest_place_favorite(%L, %L, true) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111', t.id('PLACE1'))), 'ok');
select t.is('favoris : double ajout', t.keep(null, format('select public.guest_place_favorite(%L, %L, true) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111', t.id('PLACE1'))), 'ok');
select t.is('favoris : sans doublon', (select count(*)::text from public.stay_place_favorites where place_id = t.id('PLACE1')), '1');
select t.is('favoris : relus avec les lieux', t.q(null, format('select public.guest_places(%L) -> ''favorites'' ->> 0', '1111111111111111111111111111111111111111111111111111111111111111')), t.id('PLACE1')::text);
select t.is('favoris : lieu d''un autre logement refusé', t.keep(null, format('select public.guest_place_favorite(%L, %L, true) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111', t.id('PLACE4'))), 'not_found');
select t.is('favoris : lieu masqué refusé', t.keep(null, format('select public.guest_place_favorite(%L, %L, true) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111', t.id('PLACE2'))), 'not_found');
select t.is('favoris : lien inventé refusé', t.keep(null, format('select public.guest_place_favorite(%L, %L, true) ->> ''status''', repeat('0', 64), t.id('PLACE1'))), 'unavailable');
select t.is('favoris : l''autre séjour ne voit pas ces favoris', t.q(null, 'select jsonb_array_length(public.guest_places(''2222222222222222222222222222222222222222222222222222222222222222'') -> ''favorites'')::text'), '0');
select t.is('favoris : le responsable les voit', t.q('a_manager', format('select count(*) from public.stay_place_favorites where organization_id = %L', t.id('A'))), '1');
select t.is('favoris : un agent ne les voit pas', t.q('a_agent', 'select count(*) from public.stay_place_favorites'), '0');
select t.is('favoris : une autre organisation ne les voit pas', t.q('b_manager', 'select count(*) from public.stay_place_favorites'), '0');
select t.err('favoris : aucune lecture anonyme directe', t.q(null, 'select count(*) from public.stay_place_favorites'), '42501');
select t.err('favoris : aucune écriture directe', t.dml('a_manager', format('insert into public.stay_place_favorites (organization_id, reservation_id, place_id) values (%L, %L, %L)', t.id('A'), t.id('RA3'), t.id('PLACE4'))), '42501');
select t.is('favoris : retrait', t.keep(null, format('select public.guest_place_favorite(%L, %L, false) ->> ''status''', '1111111111111111111111111111111111111111111111111111111111111111', t.id('PLACE1'))), 'ok');
select t.is('favoris : retiré pour de bon', (select count(*)::text from public.stay_place_favorites where place_id = t.id('PLACE1')), '0');
select t.deny('lieux : une autre organisation n''en ajoute pas', t.dml('b_manager', format('insert into public.property_places (organization_id, property_id, source, category, name) values (%L, %L, ''manager'', ''food'', ''x'')', t.id('A'), t.id('PA1'))));
select t.is('lieux : le manager en ajoute', t.dml('a_manager', format('insert into public.property_places (organization_id, property_id, source, category, name, address) values (%L, %L, ''manager'', ''services'', ''Pharmacie Élysée'', ''2 rue d''''Été'')', t.id('A'), t.id('PA1'))), '1');
select t.err('lieux : lieu rattaché au logement d''une autre organisation refusé', t.dml('a_manager', format('insert into public.property_places (organization_id, property_id, source, category, name) values (%L, %L, ''manager'', ''food'', ''x'')', t.id('A'), t.id('PB1'))), '23503');

-- =====================================================================
-- Migration 11 : journal « non envoyé », événements complets, absences sérialisées, conversations qui suivent
-- l'affectation, recommandations (source propriétaire, automatiques désactivables)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['TY1', 'TY2', 'ABSY', 'ABSZ', 'MSGY']) k;
select t.is('préférences : retour aux réglages par défaut, pour soi seulement', t.keep('a_manager', format('select public.reset_notification_prefs(%L)', t.id('A'))), '1');
select t.is('préférences : celles d''un autre membre sont intactes', (select count(*)::text from public.notification_prefs where user_id = t.id('a_owner')), '1');
select t.err('préférences : pas de remise à zéro dans une autre organisation', t.q('b_manager', format('select public.reset_notification_prefs(%L)', t.id('A'))), '42501');
-- Conflit signalé dès qu'une absence acceptée touche une mission déjà affectée ; jamais de réaffectation
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TY1'), t.id('A'), t.id('PX'), 'turnover', 'assigned', t.id('a_agent'), '2027-08-10 08:00+00', '2027-08-10 12:00+00', 90);
select t.is('conflit : absence enregistrée par le manager sur une mission affectée', t.keep('a_manager', format('select public.save_absence(%L, %L, ''member'', %L, ''leave'', ''2027-08-10 00:00+00'', ''2027-08-11 00:00+00'') ->> ''status''', t.id('A'), t.id('ABSY'), t.id('a_agent'))), 'accepted');
select t.is('conflit : responsables prévenus avec le nombre de missions touchées', (select string_agg(distinct payload ->> 'count', ',') from public.notification_outbox where organization_id = t.id('A') and template = 'team_assignment_conflict'), '1');
select t.is('conflit : la mission reste affectée (aucune réaffectation automatique)', (select assignee_id::text from public.tasks where id = t.id('TY1')), t.id('a_agent')::text);
-- Décision sur une demande : la personne est prévenue
select t.is('absence : demande de l''agent', t.keep('a_agent2', format('select public.save_absence(%L, %L, ''member'', %L, ''leave'', ''2027-09-01 00:00+00'', ''2027-09-02 00:00+00'') ->> ''status''', t.id('A'), t.id('ABSZ'), t.id('a_agent2'))), 'pending');
select t.is('absence : refusée par le manager', t.keep('a_manager', format('select public.decide_absence(%L, (select id from public.absences where client_id = %L), false)', t.id('A'), t.id('ABSZ'))), 'applied');
select t.is('absence : l''agent est prévenu de la décision', (select payload ->> 'decision' from public.notification_outbox where template = 'agent_absence_decided' and recipient = 'a_agent2@test.invalid' order by created_at desc limit 1), 'refused');
-- Mission modifiée : l'agent affecté est prévenu
update public.tasks set window_end = '2027-08-10 13:00+00' where id = t.id('TY1');
select t.is('mission modifiée : l''agent affecté est prévenu', (select count(*)::text from public.notification_outbox where template = 'agent_task_changed' and recipient = 'a_agent@test.invalid' and payload ->> 'path' = '/app/missions/' || t.id('TY1')), '1');
-- Séjour modifié : les responsables sont prévenus
update public.reservations set check_out_at = check_out_at + interval '1 hour' where id = t.id('RX');
select t.check('séjour modifié : responsables prévenus', '', exists (select 1 from public.notification_outbox where template = 'team_stay_changed' and reservation_id = t.id('RX')));
-- Conversation de mission : suit l'affectation
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TY2'), t.id('A'), t.id('PX'), 'maintenance', 'assigned', t.id('a_agent'), '2027-10-01 08:00+00', '2027-10-01 12:00+00', 60);
select t.check('conversation de mission ouverte avec l''agent affecté', '', t.keep('a_manager', format('select public.start_team_thread(%L, %L, array[%L]::uuid[], ''task'', %L, ''Clés au coffre'') ->> ''thread''', t.id('A'), t.id('MSGY'), t.id('a_agent'), t.id('TY2'))) ~ '^[0-9a-f-]{36}$');
select t.is('l''agent affecté lit la consigne', t.q('a_agent', format('select count(*) from public.team_messages where client_id = %L', t.id('MSGY'))), '1');
update public.tasks set assignee_id = t.id('a_agent2') where id = t.id('TY2');
select t.is('réaffectation : l''ancien agent n''y a plus accès', t.q('a_agent', format('select count(*) from public.team_messages where client_id = %L', t.id('MSGY'))), '0');
select t.is('réaffectation : le nouvel agent la rejoint', t.q('a_agent2', format('select count(*) from public.team_messages where client_id = %L', t.id('MSGY'))), '1');
select t.err('réaffectation : l''ancien agent ne peut plus écrire', t.q('a_agent', format('select public.post_team_message(%L, (select thread_id from public.team_messages where client_id = %L), gen_random_uuid(), ''x'')', t.id('A'), t.id('MSGY'))), '42501');
-- Membre désactivé : plus aucun accès immédiatement
update public.memberships set is_active = false where organization_id = t.id('A') and user_id = t.id('a_agent2');
select t.is('désactivation : plus aucun accès aux conversations', t.q('a_agent2', format('select count(*) from public.team_messages where client_id = %L', t.id('MSGY'))), '0');
update public.memberships set is_active = true where organization_id = t.id('A') and user_id = t.id('a_agent2');
-- Recommandations : propriétaire, description, automatiques désactivables
select t.is('recommandations : conseil du propriétaire ajouté', t.dml('a_manager', format('insert into public.property_places (organization_id, property_id, source, category, name, description) values (%L, %L, ''owner'', ''activities'', ''Marché du dimanche'', ''Produits locaux'')', t.id('A'), t.id('PA1'))), '1');
insert into public.property_places (organization_id, property_id, source, category, name, description) values (t.id('A'), t.id('PA1'), 'owner', 'activities', 'Marché du dimanche', 'Produits locaux');
update public.property_places set hidden = false where id = t.id('PLACE2');
select t.check('recommandations : automatiques visibles par défaut', '', position('Boulangerie OSM' in t.q(null, format('select public.guest_places(%L)::text', repeat('1', 64)))) > 0);
select t.is('recommandations : le manager désactive les automatiques du logement', t.dml('a_manager', format('update public.properties set auto_places = false where id = %L', t.id('PA1'))), '1');
update public.properties set auto_places = false where id = t.id('PA1');
select t.is('recommandations : seules celles de l''équipe et du propriétaire restent', t.q(null, format('select (select string_agg(x ->> ''source'' || '':'' || (x ->> ''name''), '','' order by x ->> ''name'') from jsonb_array_elements(public.guest_places(%L) -> ''places'') x)', repeat('1', 64))), 'manager:Café du Canal,owner:Marché du dimanche');
select t.is('recommandations : la description est transmise', t.q(null, format('select (select x ->> ''description'' from jsonb_array_elements(public.guest_places(%L) -> ''places'') x where x ->> ''name'' = ''Marché du dimanche'')', repeat('1', 64))), 'Produits locaux');
select t.deny('recommandations : un agent ne change pas le réglage du logement', t.dml('a_agent', format('update public.properties set auto_places = true where id = %L', t.id('PA1'))));

-- =====================================================================
-- Migration 12 : vérification explicite des lieux, préparation avant arrivée, VIP
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['RP', 'RPB', 'VC1', 'VC2', 'TZ1', 'ABSW']) k;
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('RP'), t.id('A'), t.id('PA2'), 'Voyageur préparation', 'prep@test.invalid', now() + interval '20 days', now() + interval '25 days'),
  (t.id('RPB'), t.id('B'), t.id('PB1'), 'Voyageur B', null, now() + interval '20 days', now() + interval '22 days');
insert into public.guest_links (organization_id, reservation_id, token_hash, valid_from, valid_until) values
  (t.id('A'), t.id('RP'), encode(extensions.digest(repeat('3', 64), 'sha256'), 'hex'), now() + interval '17 days', now() + interval '25 days'),
  (t.id('B'), t.id('RPB'), encode(extensions.digest(repeat('4', 64), 'sha256'), 'hex'), now() + interval '17 days', now() + interval '22 days');
-- Lieux : « vérifié » seulement après confirmation explicite
select t.is('lieu : simplement saisi, non vérifié', (select coalesce(verified_at::text, 'non') from public.property_places where id = t.id('PLACE1')), 'non');
select t.err('lieu : un agent ne vérifie pas', t.q('a_agent', format('select public.verify_place(%L, %L)', t.id('A'), t.id('PLACE1'))), '42501');
select t.err('lieu : une autre organisation ne vérifie pas', t.q('b_manager', format('select public.verify_place(%L, %L)', t.id('A'), t.id('PLACE1'))), '42501');
select t.check('lieu : vérification par un responsable', '', t.keep('a_manager', format('select public.verify_place(%L, %L)', t.id('A'), t.id('PLACE1'))) not like 'ERR%');
select t.check('lieu : vérifié avec date et personne', '', exists (select 1 from public.property_places where id = t.id('PLACE1') and verified_by = t.id('a_manager') and verified_at is not null));
update public.property_places set note = 'Conseil modifié' where id = t.id('PLACE1');
select t.check('lieu : un conseil modifié garde la vérification', '', (select verified_at is not null from public.property_places where id = t.id('PLACE1')));
update public.property_places set opening_hours = 'Lu-Ve 8:00-18:00' where id = t.id('PLACE1');
select t.check('lieu : horaires modifiés → vérification à renouveler', '', (select verified_at is null from public.property_places where id = t.id('PLACE1')));
-- Créneau d'une mission affectée déplacé sur une absence : conflit signalé
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, window_start, window_end, duration_min) values
  (t.id('TZ1'), t.id('A'), t.id('PX'), 'other', 'assigned', t.id('a_agent'), '2027-11-10 08:00+00', '2027-11-10 12:00+00', 60);
select t.is('créneau : absence acceptée plus tard ce mois-là', t.keep('a_manager', format('select public.save_absence(%L, %L, ''member'', %L, ''leave'', ''2027-11-11 00:00+00'', ''2027-11-12 00:00+00'') ->> ''status''', t.id('A'), t.id('ABSW'), t.id('a_agent'))), 'accepted');
update public.tasks set window_start = '2027-11-11 08:00+00', window_end = '2027-11-11 12:00+00' where id = t.id('TZ1');
select t.check('créneau : déplacement sur l''absence signalé aux responsables (jamais silencieux)', '', exists (select 1 from public.notification_outbox where template = 'team_assignment_conflict' and payload ->> 'path' = '/app/missions/' || t.id('TZ1')));
-- Préparation avant arrivée : accès limité au séjour, aucune information pratique détaillée
select t.is('avant arrivée : espace de préparation', t.keep(null, format('select public.get_guest_stay(%L) ->> ''status''', repeat('3', 64))), 'prep');
select t.is('avant arrivée : questionnaire ouvert', (select questionnaire_status from public.stay_preparations where reservation_id = t.id('RP')), 'opened');
select t.is('avant arrivée : enregistrement d''un brouillon', t.q(null, format('select public.guest_save_preparation(%L, %L::jsonb, false) ->> ''questionnaire_status''', repeat('3', 64),
  '{"interests": ["food", "culture", "pirate"], "style": "romantic", "services": ["restaurant", "spa"], "other": "Anniversaire", "adults": 2, "passport": "X123"}')), 'in_progress');
update public.stay_preparations set answers = answers where false;
select t.is('avant arrivée : brouillon conservé', t.keep(null, format('select public.guest_save_preparation(%L, %L::jsonb, false) ->> ''status''', repeat('3', 64),
  '{"interests": ["food", "culture", "pirate"], "style": "romantic", "services": ["restaurant", "spa"], "other": "Anniversaire", "adults": 2, "passport": "X123"}')), 'ok');
select t.is('avant arrivée : réponses nettoyées (valeurs inconnues et données non prévues écartées)', (select answers::text from public.stay_preparations where reservation_id = t.id('RP')),
  '{"other": "Anniversaire", "style": "romantic", "adults": 2, "services": ["restaurant", "spa"], "interests": ["culture", "food"]}');
select t.is('avant arrivée : envoi', t.keep(null, format('select public.guest_save_preparation(%L, %L::jsonb, true) ->> ''questionnaire_status''', repeat('3', 64),
  '{"interests": ["food", "culture"], "style": "romantic", "services": ["restaurant", "spa"], "other": "Anniversaire", "adults": 2}')), 'submitted');
select t.is('avant arrivée : rejouer l''envoi ne renvoie pas d''alerte', t.keep(null, format('select public.guest_save_preparation(%L, %L::jsonb, true) ->> ''unchanged''', repeat('3', 64),
  '{"interests": ["food", "culture"], "style": "romantic", "services": ["restaurant", "spa"], "other": "Anniversaire", "adults": 2}')), 'true');
select t.is('avant arrivée : responsables prévenus une fois', (select count(*)::text from public.notification_outbox where template = 'team_prep_submitted' and reservation_id = t.id('RP') and status <> 'skipped'), '2');
select t.is('avant arrivée : à examiner par l''équipe', (select needs_review::text from public.stay_preparations where reservation_id = t.id('RP')), 'true');
select t.is('avant arrivée : le voyageur retrouve ses réponses', t.q(null, format('select public.get_guest_stay(%L) #>> ''{preparation,answers,style}''', repeat('3', 64))), 'romantic');
select t.is('avant arrivée : un responsable lit les réponses', t.q('a_manager', format('select answers ->> ''other'' from public.stay_preparations where reservation_id = %L', t.id('RP'))), 'Anniversaire');
select t.is('avant arrivée : un agent ne les lit pas', t.q('a_agent', format('select count(*) from public.stay_preparations where reservation_id = %L', t.id('RP'))), '0');
select t.is('avant arrivée : une autre organisation ne les lit pas', t.q('b_manager', format('select count(*) from public.stay_preparations where reservation_id = %L', t.id('RP'))), '0');
select t.is('avant arrivée : le lien d''un autre séjour ne voit pas ces réponses', t.q(null, format('select coalesce(public.get_guest_stay(%L) #>> ''{preparation,answers,other}'', ''rien'')', repeat('4', 64))), 'rien');
select t.deny('avant arrivée : aucune écriture directe', t.dml('a_manager', format('update public.stay_preparations set prep_status = ''ready'' where reservation_id = %L', t.id('RP'))));
-- Statut et actions de préparation
select t.check('préparation : action indispensable créée', '', t.dml('a_manager', format('insert into public.stay_prep_actions (organization_id, reservation_id, title, blocking, assignee_id) values (%L, %L, ''Réserver le restaurant'', true, %L)', t.id('A'), t.id('RP'), t.id('a_agent'))) = '1');
insert into public.stay_prep_actions (organization_id, reservation_id, title, blocking) values (t.id('A'), t.id('RP'), 'Réserver le restaurant', true);
select t.is('préparation : « prêt » refusé tant qu''une action indispensable est ouverte', t.q('a_manager', format('select public.set_prep_status(%L, %L, ''ready'')', t.id('A'), t.id('RP'))), 'blocking_actions');
update public.stay_prep_actions set status = 'done', done_at = now() where reservation_id = t.id('RP');
select t.is('préparation : prêt une fois l''action faite', t.keep('a_manager', format('select public.set_prep_status(%L, %L, ''ready'')', t.id('A'), t.id('RP'))), 'applied');
select t.is('préparation : rejouer = sans effet', t.keep('a_manager', format('select public.set_prep_status(%L, %L, ''ready'')', t.id('A'), t.id('RP'))), 'already');
select t.err('préparation : un agent ne change pas le statut', t.q('a_agent', format('select public.set_prep_status(%L, %L, ''ready'')', t.id('A'), t.id('RP'))), '42501');
select t.is('préparation : un agent ne voit pas les actions', t.q('a_agent', 'select count(*) from public.stay_prep_actions'), '0');
select t.is('préparation : historique', (select string_agg(kind, ',' order by id) from public.stay_prep_events where reservation_id = t.id('RP')),
  'guest_saved,guest_submitted,action_created,action_done,status_changed');
-- Éléments publiés : seuls ceux publiés sont visibles du voyageur
insert into public.stay_guest_items (organization_id, reservation_id, kind, title, body, published_at) values
  (t.id('A'), t.id('RP'), 'info', 'Restaurant suggéré', 'Le Petit Zinc, à réserver', now()),
  (t.id('A'), t.id('RP'), 'info', 'Brouillon interne', 'Pas encore validé', null);
select t.is('séjour préparé : le voyageur ne voit que le publié', t.q(null, format('select (select string_agg(x ->> ''title'', '','') from jsonb_array_elements(public.get_guest_stay(%L) -> ''prepared'') x)', repeat('3', 64))), 'Restaurant suggéré');
select t.err('séjour préparé : impossible de citer le lieu d''une autre organisation', t.dml('b_manager', format('insert into public.stay_guest_items (organization_id, reservation_id, kind, title, place_id, published_at) values (%L, %L, ''recommendation'', ''x'', %L, now())', t.id('B'), t.id('RPB'), t.id('PLACE1'))), '23503');
select t.deny('séjour préparé : un agent ne publie rien', t.dml('a_agent', format('insert into public.stay_guest_items (organization_id, reservation_id, kind, title) values (%L, %L, ''info'', ''x'')', t.id('A'), t.id('RP'))));
-- Séjour annulé : lien révoqué, préparation annulée
update public.reservations set status = 'cancelled' where id = t.id('RPB');
select t.is('annulation : le lien ne donne plus accès', t.q(null, format('select public.get_guest_stay(%L) ->> ''status''', repeat('4', 64))), 'unavailable');
-- Séjour modifié : le lien suit les nouvelles dates
update public.reservations set check_out_at = now() + interval '26 days' where id = t.id('RP');
select t.check('modification : le lien suit la nouvelle date de départ', '', (select valid_until > now() + interval '25 days 12 hours' from public.guest_links where reservation_id = t.id('RP') and revoked_at is null));
-- Après l'arrivée : réponses verrouillées
update public.reservations set check_in_at = now() - interval '1 hour' where id = t.id('RP');
select t.is('après l''arrivée : réponses verrouillées', t.q(null, format('select public.guest_save_preparation(%L, ''{}''::jsonb, true) ->> ''status''', repeat('3', 64))), 'locked');
update public.reservations set check_in_at = now() + interval '20 days' where id = t.id('RP');
-- VIP
insert into public.vip_criteria (id, organization_id, label, kind, min_stays, editable_by) values
  (t.id('VC1'), t.id('A'), 'Client fidèle (3 séjours)', 'loyalty', 3, 'manager'),
  (t.id('VC2'), t.id('A'), 'Partenaire entreprise', 'partner', null, 'owner');
select t.err('VIP : un critère toujours soumis à validation humaine', t.dml('a_manager', format('insert into public.vip_criteria (organization_id, label, kind, requires_validation) values (%L, ''Auto'', ''loyalty'', false)', t.id('A'))), '23514');
select t.deny('VIP : un manager ne modifie pas un critère réservé au propriétaire', t.dml('a_manager', format('update public.vip_criteria set label = ''x'' where id = %L', t.id('VC2'))));
select t.is('VIP : le propriétaire le modifie', t.dml('a_owner', format('update public.vip_criteria set label = ''Partenaire'' where id = %L', t.id('VC2'))), '1');
select t.deny('VIP : un agent ne crée pas de critère', t.dml('a_agent', format('insert into public.vip_criteria (organization_id, label, kind) values (%L, ''x'', ''manual'')', t.id('A'))));
select t.is('VIP : motifs proposés au voyageur', t.q(null, format('select jsonb_array_length(public.get_guest_stay(%L) #> ''{vip,motifs}'')', repeat('3', 64))), '2');
select t.is('VIP : demande du voyageur', t.keep(null, format('select public.guest_request_vip(%L, %L, ''Troisième séjour chez vous'') ->> ''status''', repeat('3', 64), t.id('VC1'))), 'ok');
select t.is('VIP : rejouer ne crée pas de doublon', t.keep(null, format('select public.guest_request_vip(%L, %L, ''x'') ->> ''replayed''', repeat('3', 64), t.id('VC1'))), 'true');
select t.is('VIP : le voyageur voit « en attente », pas « confirmé »', t.q(null, format('select (public.get_guest_stay(%L) #>> ''{vip,request,status}'') || ''/'' || (public.get_guest_stay(%L) #>> ''{vip,confirmed}'')', repeat('3', 64), repeat('3', 64))), 'pending/false');
select t.check('VIP : responsables prévenus', '', exists (select 1 from public.notification_outbox where template = 'team_vip_requested' and reservation_id = t.id('RP')));
select t.err('VIP : un agent ne décide pas', t.q('a_agent', format('select public.decide_vip(%L, (select id from public.vip_requests where reservation_id = %L), ''accept'', %L)', t.id('A'), t.id('RP'), t.id('VC1'))), '42501');
select t.err('VIP : une autre organisation ne décide pas', t.q('b_manager', format('select public.decide_vip(%L, (select id from public.vip_requests where reservation_id = %L), ''accept'', %L)', t.id('A'), t.id('RP'), t.id('VC1'))), '42501');
select t.is('VIP : une autre organisation ne voit pas la demande', t.q('b_manager', format('select count(*) from public.vip_requests where reservation_id = %L', t.id('RP'))), '0');
select t.is('VIP : indice de fidélité calculé (jamais appliqué seul)', t.q('a_manager', format('select public.loyalty_count(%L, %L)', t.id('A'), t.id('RP'))), '0');
select t.err('VIP : précision sans question refusée', t.q('a_manager', format('select public.decide_vip(%L, (select id from public.vip_requests where reservation_id = %L), ''info'')', t.id('A'), t.id('RP'))), '22023');
select t.is('VIP : précision demandée', t.keep('a_manager', format('select public.decide_vip(%L, (select id from public.vip_requests where reservation_id = %L), ''info'', null, null, ''Pouvez-vous préciser vos dates de séjours précédents ?'')', t.id('A'), t.id('RP'))), 'applied');
select t.is('VIP : le voyageur voit la question', t.q(null, format('select public.get_guest_stay(%L) #>> ''{vip,request,message}''', repeat('3', 64))), 'Pouvez-vous préciser vos dates de séjours précédents ?');
select t.is('VIP : le voyageur répond', t.keep(null, format('select public.guest_reply_vip(%L, ''Été 2025 et printemps 2026'') ->> ''status''', repeat('3', 64))), 'ok');
select t.is('VIP : acceptée', t.keep('a_manager', format('select public.decide_vip(%L, (select id from public.vip_requests where reservation_id = %L), ''accept'', %L, now() + interval ''1 year'', ''Bienvenue !'', ''Vérifié avec l''''historique hors HALO'')', t.id('A'), t.id('RP'), t.id('VC1'))), 'applied');
select t.is('VIP : décider deux fois = sans effet', t.keep('a_manager', format('select public.decide_vip(%L, (select id from public.vip_requests where reservation_id = %L), ''accept'', %L)', t.id('A'), t.id('RP'), t.id('VC1'))), 'already');
select t.is('VIP : voyageur prévenu de la question et de la décision (adresse de test : jamais livrée)', (select count(*)::text from public.notification_outbox where template = 'vip_update' and reservation_id = t.id('RP')), '2');
select t.check('VIP : e-mail sans note interne', '', not exists (select 1 from public.notification_outbox where template = 'vip_update' and payload::text like '%hors HALO%'));
select t.is('VIP : confirmé côté voyageur', t.q(null, format('select public.get_guest_stay(%L) #>> ''{vip,confirmed}''', repeat('3', 64))), 'true');
select t.check('VIP : la note interne n''apparaît jamais côté voyageur', '', position('hors HALO' in t.q(null, format('select public.get_guest_stay(%L)::text', repeat('3', 64)))) = 0);
select t.is('VIP : statut, critère, auteur et échéance enregistrés', (select status || '/' || (criterion_id = t.id('VC1'))::text || '/' || (granted_by = t.id('a_manager'))::text || '/' || (expires_at is not null)::text from public.stay_vip where reservation_id = t.id('RP')), 'active/true/true/true');
select t.is('VIP : préparation renforcée des missions activée', (select vip::text from public.reservations where id = t.id('RP')), 'true');
select t.deny('VIP : aucune écriture directe du statut', t.dml('a_manager', format('update public.stay_vip set status = ''active'' where reservation_id = %L', t.id('RP'))));
select t.is('VIP : un agent ne voit pas le statut', t.q('a_agent', 'select count(*) from public.stay_vip'), '0');
select t.is('VIP : retiré', t.keep('a_manager', format('select public.revoke_vip(%L, %L, ''Erreur de saisie'')', t.id('A'), t.id('RP'))), 'applied');
select t.is('VIP : plus confirmé après retrait', t.q(null, format('select public.get_guest_stay(%L) #>> ''{vip,confirmed}''', repeat('3', 64))), 'false');
select t.err('VIP : attribution sans motif refusée', t.q('a_manager', format('select public.grant_vip(%L, %L, null, null, '''')', t.id('A'), t.id('RP'))), '22023');
select t.is('VIP : attribution documentée', t.keep('a_manager', format('select public.grant_vip(%L, %L, null, now() - interval ''1 day'', ''Partenariat signé'')', t.id('A'), t.id('RP'))), 'applied');
select t.is('VIP : statut expiré = non confirmé', t.q(null, format('select public.get_guest_stay(%L) #>> ''{vip,confirmed}''', repeat('3', 64))), 'false');
select t.err('VIP : une autre organisation n''attribue pas', t.q('b_manager', format('select public.grant_vip(%L, %L, null, null, ''x'')', t.id('A'), t.id('RP'))), '42501');
select t.is('VIP : historique complet', (select string_agg(kind, ',' order by id) from public.stay_prep_events where reservation_id = t.id('RP') and kind like 'vip%'),
  'vip_requested,vip_info_requested,vip_guest_reply,vip_accepted,vip_revoked,vip_granted');
-- Invitation par e-mail : lien contrôlé, jamais conservé pour une adresse non distribuable
select t.err('invitation : un agent n''envoie pas', t.q('a_agent', format('select public.record_prep_invite(%L, %L, %L)', t.id('A'), t.id('RP'), 'https://x.test/fr/s/' || repeat('3', 64))), '42501');
select t.err('invitation : une autre organisation n''envoie pas', t.q('b_manager', format('select public.record_prep_invite(%L, %L, %L)', t.id('A'), t.id('RP'), 'https://x.test/fr/s/' || repeat('3', 64))), '42501');
select t.err('invitation : adresse quelconque refusée', t.q('a_manager', format('select public.record_prep_invite(%L, %L, %L)', t.id('A'), t.id('RP'), 'https://evil.test/phish')), '22023');
select t.is('invitation : mise en envoi', t.keep('a_manager', format('select public.record_prep_invite(%L, %L, %L) ->> ''email_queued''', t.id('A'), t.id('RP'), 'https://x.test/fr/s/' || repeat('3', 64))), 'true');
select t.is('invitation : adresse de test → échec tracé, lien non conservé', (select status || '/' || (payload ? 'url')::text from public.notification_outbox where template = 'prep_invite' and reservation_id = t.id('RP')), 'failed/false');
-- Formule premium : une prestation avec son propre statut, jamais confirmée automatiquement
select t.is('premium : demandée par le voyageur', t.keep(null, format('select public.guest_request_service(%L, ''premium_package'', now() + interval ''21 days'', 2, ''Formule premium'') ->> ''status''', repeat('3', 64))), 'ok');
select t.is('premium : statut « demandée », pas confirmé', (select status from public.service_requests where reservation_id = t.id('RP') and kind = 'premium_package'), 'requested');
select t.is('premium : n''attribue pas le statut VIP', (select vip::text from public.reservations where id = t.id('RP')), 'false');
select t.is('prestation : passée « en cours d''étude » sans e-mail au voyageur', t.keep('a_manager', format('select public.decide_service(%L, (select id from public.service_requests where reservation_id = %L and kind = ''premium_package''), ''in_review'') ->> ''email_queued''', t.id('A'), t.id('RP'))), 'false');


-- =====================================================================
-- Migration 13 : préparation cohérente, import de données, calendriers iCal
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['TP1', 'TP2', 'JOB', 'JOBB', 'SRC']) k;
-- 1.1 Une action indispensable (ré)ouverte retire « Prêt »
select t.is('préparation : séjour prêt au départ', (select prep_status from public.stay_preparations where reservation_id = t.id('RP')), 'ready');
select t.check('préparation : action indispensable ajoutée', '', t.keep('a_manager', format('insert into public.stay_prep_actions (organization_id, reservation_id, title, blocking) values (%L, %L, ''Vérifier la poussette'', true) returning 1', t.id('A'), t.id('RP'))) = '1');
select t.is('préparation : « Prêt » retiré automatiquement', (select prep_status from public.stay_preparations where reservation_id = t.id('RP')), 'in_progress');
select t.check('préparation : retrait historisé', '', exists (select 1 from public.stay_prep_events where reservation_id = t.id('RP') and kind = 'status_reverted' and note = 'Vérifier la poussette'));
update public.stay_prep_actions set status = 'done', done_at = now() where reservation_id = t.id('RP') and title = 'Vérifier la poussette';
select t.is('préparation : de nouveau prêt', t.keep('a_manager', format('select public.set_prep_status(%L, %L, ''ready'')', t.id('A'), t.id('RP'))), 'applied');
select t.is('préparation : action rouverte', t.dml('a_manager', format('update public.stay_prep_actions set status = ''open'' where reservation_id = %L and title = ''Vérifier la poussette''', t.id('RP'))), '1');
update public.stay_prep_actions set status = 'open' where reservation_id = t.id('RP') and title = 'Vérifier la poussette';
select t.is('préparation : réouverture → plus « Prêt »', (select prep_status from public.stay_preparations where reservation_id = t.id('RP')), 'in_progress');
select t.check('préparation : réouverture historisée', '', exists (select 1 from public.stay_prep_events where reservation_id = t.id('RP') and kind = 'action_reopened'));
update public.stay_prep_actions set status = 'cancelled' where reservation_id = t.id('RP') and title = 'Vérifier la poussette';
-- Action liée à une mission : faite seulement si la mission l'est, sauf dérogation motivée
insert into public.tasks (id, organization_id, property_id, next_reservation_id, type, status, title, window_start, window_end, duration_min) values
  (t.id('TP1'), t.id('A'), t.id('PA2'), t.id('RP'), 'other', 'unassigned', 'Table calme', now() + interval '19 days', now() + interval '20 days', 30),
  (t.id('TP2'), t.id('A'), t.id('PA2'), t.id('RP'), 'other', 'assigned', 'Fleurs', now() + interval '19 days', now() + interval '20 days', 30);
insert into public.stay_prep_actions (organization_id, reservation_id, title, blocking, task_id) values
  (t.id('A'), t.id('RP'), 'Préparer table calme', true, t.id('TP1')), (t.id('A'), t.id('RP'), 'Fleurs', false, t.id('TP2'));
select t.err('mission liée non faite : action non close', t.dml('a_manager', format('update public.stay_prep_actions set status = ''done'' where task_id = %L', t.id('TP1'))), 'P0001');
select t.is('mission liée : dérogation motivée acceptée', t.dml('a_manager', format('update public.stay_prep_actions set status = ''done'', override_reason = ''Table réservée par téléphone'' where task_id = %L', t.id('TP1'))), '1');
update public.stay_prep_actions set status = 'done', override_reason = 'Table réservée par téléphone' where task_id = t.id('TP1');
select t.check('mission liée : dérogation historisée', '', exists (select 1 from public.stay_prep_events where reservation_id = t.id('RP') and kind = 'action_forced' and note like '%téléphone%'));
update public.tasks set status = 'validated' where id = t.id('TP2');
select t.is('mission validée → action close automatiquement', (select status from public.stay_prep_actions where task_id = t.id('TP2')), 'done');
update public.tasks set assignee_id = t.id('a_agent'), notes = 'Bouquet blanc, entrée' where id = t.id('TP2');
select t.is('agent : titre et consigne de sa mission lisibles', t.q('a_agent', format('select title || '' / '' || notes from public.tasks where id = %L', t.id('TP2'))), 'Fleurs / Bouquet blanc, entrée');
-- 1.5 Contact de l'équipe disponible dès la préparation (champ urgence du livret)
update public.guest_guides set emergency_phone = '+33 6 00 00 00 00' where property_id = t.id('PA2');
select t.is('avant arrivée : numéro de contact communiqué', t.q(null, format('select public.get_guest_stay(%L) ->> ''contact_phone''', repeat('3', 64))), '+33 6 00 00 00 00');
select t.is('avant arrivée : toujours pas de guide', t.q(null, format('select coalesce(public.get_guest_stay(%L) ->> ''guide'', ''aucun'')', repeat('3', 64))), 'aucun');

alter table public.reservations enable trigger reservations_overlap_check;
-- 2. Import : droits, cloisonnement, exécution, reprise, effets secondaires, annulation
select t.deny('import : un agent ne crée pas d''import', t.dml('a_agent', format('insert into public.import_jobs (organization_id, kinds) values (%L, ''{properties}'')', t.id('A'))));
select t.deny('import : une autre organisation ne crée pas d''import chez A', t.dml('b_manager', format('insert into public.import_jobs (organization_id, kinds) values (%L, ''{properties}'')', t.id('A'))));
select t.is('import : préparation enregistrée par le responsable', t.keep('a_manager', format('insert into public.import_jobs (id, organization_id, kinds, source_software, options) values (%L, %L, ''{properties,stays,team}'', ''Tableur'', ''{"import_guest_emails": false}'') returning 1', t.id('JOB'), t.id('A'))), '1');
select t.is('import : lignes déposées', t.keep('a_manager', format($q$insert into public.import_rows (organization_id, job_id, kind, row_index, raw, data, decision) values
  (%1$L, %2$L, 'properties', 1, '{"Nom": "Studio Import"}', '{"name": "Studio Import", "city": "Lyon", "country": "fr", "timezone": "Europe/Paris", "capacity": 3, "external_ref": "L-1"}', 'create'),
  (%1$L, %2$L, 'properties', 2, '{"Nom": "A — Canal"}', '{"name": "A — Canal"}', 'link'),
  (%1$L, %2$L, 'stays', 1, '{"x": 1}', '{"property_row": 1, "guest_name": "Voyageur importé", "guest_email": "imp@test.invalid", "check_in_at": "2027-06-01T14:00:00Z", "check_out_at": "2027-06-04T09:00:00Z", "adults": 2, "source": "airbnb", "external_ref": "HMX1"}', 'create'),
  (%1$L, %2$L, 'stays', 2, '{"x": 2}', '{"property_row": 1, "check_in_at": "2027-06-02T14:00:00Z", "check_out_at": "2027-06-03T09:00:00Z"}', 'create'),
  (%1$L, %2$L, 'stays', 3, '{"x": 3}', '{"property_id": "%3$s", "check_in_at": "2027-06-02T14:00:00Z", "check_out_at": "2027-06-03T09:00:00Z"}', 'create'),
  (%1$L, %2$L, 'stays', 4, '{"x": 4}', null, 'reject'),
  (%1$L, %2$L, 'team', 1, '{"x": 1}', '{"first_name": "Lina", "last_name": "Import", "email": "lina@test.invalid", "role": "agent", "worker_type": "contractor"}', 'create')
  returning 1$q$, t.id('A'), t.id('JOB'), t.id('PB1'))), '1');
update public.import_rows set match_id = t.id('PA1') where job_id = t.id('JOB') and kind = 'properties' and row_index = 2;
select t.is('import : un agent ne voit pas l''import', t.q('a_agent', 'select count(*) from public.import_jobs'), '0');
select t.is('import : une autre organisation ne voit ni l''import ni ses lignes', t.q('b_manager', format('select (select count(*) from public.import_jobs where id = %L) + (select count(*) from public.import_rows where job_id = %L)', t.id('JOB'), t.id('JOB'))), '0');
select t.deny('import : une autre organisation ne dépose pas de lignes dans l''import de A', t.dml('b_manager', format('insert into public.import_rows (organization_id, job_id, kind, row_index, raw) values (%L, %L, ''stays'', 9, ''{}'')', t.id('A'), t.id('JOB'))));
select t.err('import : pas d''exécution sans analyse', t.q('a_manager', format('select public.run_import(%L, %L)', t.id('A'), t.id('JOB'))), '22023');
select t.is('import : aucune donnée métier créée avant validation', (select count(*)::text from public.properties where name = 'Studio Import'), '0');
select t.is('import : analysé', t.dml('a_manager', format('update public.import_jobs set status = ''analyzed'' where id = %L', t.id('JOB'))), '1');
update public.import_jobs set status = 'analyzed' where id = t.id('JOB');
select t.err('import : une autre organisation n''exécute pas', t.q('b_manager', format('select public.run_import(%L, %L)', t.id('A'), t.id('JOB'))), '42501');
select t.err('import : un agent n''exécute pas', t.q('a_agent', format('select public.run_import(%L, %L)', t.id('A'), t.id('JOB'))), '42501');
create temp table t_out_before as select count(*) as n from public.notification_outbox;
select t.is('import : exécution', t.keep('a_manager', format('select public.run_import(%L, %L) ->> ''created''', t.id('A'), t.id('JOB'))), '3');
select t.is('import : aucun e-mail ni invitation déclenché', (select (count(*) - (select n from t_out_before))::text from public.notification_outbox), '0');
select t.is('import : aucune invitation créée', (select count(*)::text from public.invitations where organization_id = t.id('A') and email = 'lina@test.invalid'), '0');
select t.check('import : logement créé avec provenance, livret et référence', '', exists (select 1 from public.properties p join public.guest_guides g on g.property_id = p.id where p.name = 'Studio Import' and p.import_job_id = t.id('JOB') and p.external_ref = 'L-1' and p.country_code = 'FR'));
select t.check('import : séjour relié au logement du même fichier', '', exists (select 1 from public.reservations r join public.properties p on p.id = r.property_id where p.name = 'Studio Import' and r.guest_name = 'Voyageur importé' and r.external_uid = 'HMX1' and r.source = 'airbnb'));
select t.is('import : e-mail voyageur non importé sans choix explicite', (select coalesce(guest_email, 'aucun') from public.reservations where external_uid = 'HMX1'), 'aucun');
select t.is('import : séjour en chevauchement rejeté avec sa raison', (select status || '/' || message from public.import_rows where job_id = t.id('JOB') and kind = 'stays' and row_index = 2), 'failed/stay_overlap');
select t.is('import : logement d''une autre organisation refusé', (select status || '/' || message from public.import_rows where job_id = t.id('JOB') and kind = 'stays' and row_index = 3), 'failed/property_not_found');
select t.is('import : ligne rejetée distinguée', (select status from public.import_rows where job_id = t.id('JOB') and kind = 'stays' and row_index = 4), 'rejected');
select t.is('import : doublon associé à la fiche existante', (select status || '/' || (target_id = t.id('PA1'))::text from public.import_rows where job_id = t.id('JOB') and kind = 'properties' and row_index = 2), 'linked/true');
select t.is('import : équipe = contact, sans compte', (select count(*)::text from public.team_contacts where import_job_id = t.id('JOB') and invited_at is null), '1');
select t.is('import : rejouer ne crée aucun doublon', t.keep('a_manager', format('select public.run_import(%L, %L) ->> ''status''', t.id('A'), t.id('JOB'))), 'already');
select t.is('import : toujours un seul logement importé', (select count(*)::text from public.properties where name = 'Studio Import'), '1');
select t.deny('import : lignes figées après exécution', t.dml('a_manager', format('update public.import_rows set decision = ''create'' where job_id = %L and kind = ''stays'' and row_index = 4', t.id('JOB'))));
select t.deny('import : rapport non modifiable par le client', t.dml('a_manager', format('update public.import_jobs set report = ''{}'' where id = %L', t.id('JOB'))));
-- Annulation sûre
update public.reservations set notes = 'Modifiée après import' where external_uid = 'HMX1';
select t.is('annulation : aperçu sans effet', t.q('a_manager', format('select jsonb_array_length(public.revert_import(%L, %L, false) -> ''kept'')', t.id('A'), t.id('JOB'))), '2');
select t.check('annulation : séjour modifié depuis conservé avec la raison', '', t.q('a_manager', format('select public.revert_import(%L, %L, false)::text', t.id('A'), t.id('JOB'))) like '%modified_since%');
select t.err('annulation : une autre organisation n''annule pas', t.q('b_manager', format('select public.revert_import(%L, %L, true)', t.id('A'), t.id('JOB'))), '42501');
select t.is('annulation : appliquée sur ce qui est intact', t.keep('a_manager', format('select jsonb_array_length(public.revert_import(%L, %L, true) -> ''removable'')', t.id('A'), t.id('JOB'))), '1');
select t.is('annulation : contact retiré, séjour modifié et son logement conservés', (select count(*)::text from public.team_contacts where import_job_id = t.id('JOB')) || '/' || (select count(*)::text from public.reservations where external_uid = 'HMX1') || '/' || (select count(*)::text from public.properties where name = 'Studio Import'), '0/1/1');
select t.is('import : e-mails des membres invisibles pour une autre organisation', t.q('b_manager', format('select cardinality(public.organization_member_emails(%L))', t.id('A'))), '0');
select t.check('import : e-mails des membres connus du responsable', '', t.q('a_manager', format('select cardinality(public.organization_member_emails(%L))', t.id('A')))::int > 0);
select t.err('purge : réservée au serveur', t.q('a_manager', 'select public.purge_import_rows()'), '42501');
alter table public.reservations disable trigger reservations_overlap_check;

-- 3. Calendriers iCal : adresse protégée, priorité à HALO, conflits arbitrés
select t.err('iCal : un agent n''ajoute pas de calendrier', t.q('a_agent', format('select public.add_ical_source(%L, %L, ''https://www.airbnb.fr/calendar/ical/1.ics?s=secret'', ''Airbnb'', ''airbnb'')', t.id('A'), t.id('PA1'))), '42501');
select t.err('iCal : une autre organisation n''ajoute pas de calendrier chez A', t.q('b_manager', format('select public.add_ical_source(%L, %L, ''https://www.airbnb.fr/calendar/ical/1.ics?s=secret'', ''Airbnb'', ''airbnb'')', t.id('A'), t.id('PA1'))), '42501');
select t.err('iCal : adresse invalide refusée', t.q('a_manager', format('select public.add_ical_source(%L, %L, ''javascript:alert(1)'', ''x'', ''other'')', t.id('A'), t.id('PA1'))), '22023');
update t.ids set id = (t.keep('a_manager', format('select public.add_ical_source(%L, %L, ''https://www.airbnb.fr/calendar/ical/1.ics?s=secret1234'', ''Airbnb'', ''airbnb'')', t.id('A'), t.id('PA1'))))::uuid where name = 'SRC';
select t.is('iCal : adresse jamais relisible directement', t.q('a_manager', 'select count(*) from public.data_source_secrets'), 'ERR:42501:permission denied for table data_source_secrets');
select t.is('iCal : seul un indice est affiché', t.q('a_manager', format('select url_hint from public.data_sources where id = %L', t.id('SRC'))), 'www.airbnb.fr …1234');
select t.is('iCal : une autre organisation ne lit pas l''adresse', t.q('b_manager', format('select coalesce(public.ical_source_url(%L, %L), ''rien'')', t.id('A'), t.id('SRC'))), 'rien');
select t.is('iCal : un agent ne voit pas la source', t.q('a_agent', 'select count(*) from public.data_sources'), '0');
select t.is('iCal : première synchronisation', t.keep('a_manager', format($q$select public.apply_ical_sync(%L, %L, '[{"uid": "ev1@airbnb", "check_in_at": "2027-09-01T14:00:00Z", "check_out_at": "2027-09-05T09:00:00Z", "status": "confirmed"}, {"uid": "ev2@airbnb", "check_in_at": "2027-09-10T14:00:00Z", "check_out_at": "2027-09-12T09:00:00Z", "status": "blocked"}]') ->> 'created'$q$, t.id('A'), t.id('SRC'))), '2');
select t.is('iCal : relancer ne crée rien', t.keep('a_manager', format($q$select public.apply_ical_sync(%L, %L, '[{"uid": "ev1@airbnb", "check_in_at": "2027-09-01T14:00:00Z", "check_out_at": "2027-09-05T09:00:00Z", "status": "confirmed"}, {"uid": "ev2@airbnb", "check_in_at": "2027-09-10T14:00:00Z", "check_out_at": "2027-09-12T09:00:00Z", "status": "blocked"}]') ->> 'unchanged'$q$, t.id('A'), t.id('SRC'))), '2');
update public.reservations set check_out_at = '2027-09-06T09:00:00Z' where external_uid = 'ev1@airbnb';
select t.is('iCal : modification HALO non écrasée → conflit', t.keep('a_manager', format($q$select public.apply_ical_sync(%L, %L, '[{"uid": "ev1@airbnb", "check_in_at": "2027-09-02T14:00:00Z", "check_out_at": "2027-09-05T09:00:00Z", "status": "confirmed"}]') ->> 'conflicts'$q$, t.id('A'), t.id('SRC'))), '1');
select t.is('iCal : séjour HALO intact', (select check_out_at::text from public.reservations where external_uid = 'ev1@airbnb'), '2027-09-06 09:00:00+00');
select t.is('iCal : absent du calendrier = signalé, jamais annulé', (select (select state || '/' || conflict from public.source_events where uid = 'ev2@airbnb') || '/' || status from public.reservations where external_uid = 'ev2@airbnb'), 'conflict/missing_from_feed/blocked');
select t.err('iCal : une autre organisation n''arbitre pas', t.q('b_manager', format('select public.resolve_source_conflict(%L, %L, ''ev1@airbnb'', ''apply_feed'')', t.id('A'), t.id('SRC'))), '42501');
select t.is('iCal : le responsable applique la date du calendrier', t.keep('a_manager', format('select public.resolve_source_conflict(%L, %L, ''ev1@airbnb'', ''apply_feed'')', t.id('A'), t.id('SRC'))), 'applied');
select t.is('iCal : dates du calendrier appliquées', (select check_in_at::text from public.reservations where external_uid = 'ev1@airbnb'), '2027-09-02 14:00:00+00');
select t.is('iCal : erreur de lecture enregistrée', t.keep('a_manager', format('select public.apply_ical_sync(%L, %L, ''[]'', ''unreachable'') ->> ''status''', t.id('A'), t.id('SRC'))), 'error');
select t.is('iCal : dernière réussite conservée malgré l''erreur', (select (last_error = 'unreachable')::text || '/' || (last_success_at is not null)::text from public.data_sources where id = t.id('SRC')), 'true/true');


-- =====================================================================
-- Migration 14 : missions liées, absences (compléments), réservation directe, satisfaction
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['RPAST', 'TPX', 'CL1', 'CL2', 'CL3', 'OWN', 'OWNB', 'TM1', 'ABS9']) k;
-- Mission liée annulée puis rouverte : historique clair, action jamais close en silence
insert into public.tasks (id, organization_id, property_id, next_reservation_id, type, status, title, window_start, window_end, duration_min) values
  (t.id('TPX'), t.id('A'), t.id('PA2'), t.id('RP'), 'other', 'assigned', 'Panier d''accueil', now() + interval '19 days', now() + interval '20 days', 30);
insert into public.stay_prep_actions (organization_id, reservation_id, title, blocking, task_id) values (t.id('A'), t.id('RP'), 'Panier d''accueil', true, t.id('TPX'));
update public.tasks set status = 'cancelled' where id = t.id('TPX');
select t.is('mission liée annulée : action toujours ouverte', (select status from public.stay_prep_actions where task_id = t.id('TPX')), 'open');
select t.check('mission liée annulée : historisée', '', exists (select 1 from public.stay_prep_events where reservation_id = t.id('RP') and kind = 'mission_cancelled' and note = 'Panier d''accueil'));
select t.is('mission annulée : action close sans dérogation possible', t.dml('a_manager', format('update public.stay_prep_actions set status = ''done'' where task_id = %L', t.id('TPX'))), '1');
update public.stay_prep_actions set status = 'cancelled' where task_id = t.id('TPX');
-- Absences : fermeture par poste, mission traversant minuit
update public.memberships set position = 'housekeeper' where organization_id = t.id('A') and user_id = t.id('a_agent');
update public.memberships set position = 'maintenance' where organization_id = t.id('A') and user_id = t.id('a_agent2');
insert into public.tasks (id, organization_id, property_id, type, status, window_start, window_end, scheduled_start, duration_min) values
  (t.id('TM1'), t.id('A'), t.id('PV'), 'turnover', 'unassigned', '2028-01-10 21:00+00', '2028-01-11 03:00+00', '2028-01-10 22:30+00', 120);
select t.is('fermeture du poste « ménage » (après minuit)', t.keep('a_manager', format('select public.save_absence(%L, %L, ''team'', null, ''closure'', ''2028-01-11 00:00+00'', ''2028-01-12 00:00+00'', false, ''Inventaire'', ''housekeeper'') ->> ''status''', t.id('A'), t.id('ABS9'))), 'accepted');
select t.err('minuit : mission de 22 h 30 à 0 h 30 refusée à l''agent ménage', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent'), t.id('TM1'))), '22023');
select t.is('fermeture d''un poste : un autre poste reste attribuable', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent2'), t.id('TM1'))), '1');
select t.is('fermeture annulée', t.keep('a_manager', format('select public.cancel_absence(%L, (select id from public.absences where client_id = %L))', t.id('A'), t.id('ABS9'))), 'applied');
select t.is('après annulation : affectation autorisée', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('a_agent'), t.id('TM1'))), '1');
select t.err('affectation à un membre d''une autre organisation refusée', t.dml('a_manager', format('update public.tasks set assignee_id = %L, status = ''assigned'' where id = %L', t.id('b_agent'), t.id('TM1'))), '23503');

-- Réservation directe
update public.data_sources set last_error = null, last_sync_at = now(), last_success_at = now() where property_id = t.id('PA1');
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('RPAST'), t.id('A'), t.id('PA1'), 'Ancien voyageur', 'ancien@test.invalid', now() - interval '30 days', now() - interval '26 days');
select t.err('demande de séjour : un agent ne crée pas de lien', t.q('a_agent', format('select public.create_booking_link(%L, %L)', t.id('A'), t.id('RPAST'))), '42501');
select t.err('demande de séjour : une autre organisation non plus', t.q('b_manager', format('select public.create_booking_link(%L, %L)', t.id('A'), t.id('RPAST'))), '42501');
create temp table t_tok (k text primary key, v text);
insert into t_tok values ('book', t.keep('a_manager', format('select public.create_booking_link(%L, %L)', t.id('A'), t.id('RPAST'))));
select t.is('demande de séjour : lien de 64 caractères, haché en base', (select length(v)::text from t_tok where k = 'book') || '/' || (select count(*)::text from public.booking_links where token_hash = encode(extensions.digest((select v from t_tok where k = 'book'), 'sha256'), 'hex')), '64/1');
select t.is('demande de séjour : l''ancien lien de séjour ne donne rien', t.q(null, format('select public.booking_portal(%L) ->> ''status''', repeat('3', 64))), 'unavailable');
select t.is('portail : logement connu, sans adresse ni nom d''autres voyageurs', t.q(null, format('select (public.booking_portal(%L) #>> ''{property,name}'') || ''/'' || coalesce(public.booking_portal(%L) #>> ''{property,address}'', ''sans adresse'')', (select v from t_tok where k = 'book'), (select v from t_tok where k = 'book'))), 'A — Canal/sans adresse');
select t.check('portail : aucune donnée de l''ancien séjour au-delà du prénom', '', position('ancien@test.invalid' in t.q(null, format('select public.booking_portal(%L)::text', (select v from t_tok where k = 'book')))) = 0);
select t.is('demande : envoyée', t.keep(null, format('select public.booking_submit(%L, %L, current_date + 100, current_date + 104, 2, 0, 0, ''Ancien voyageur'', ''ancien@test.invalid'', null, ''Même logement svp'') ->> ''status''', (select v from t_tok where k = 'book'), t.id('CL1'))), 'ok');
select t.is('demande : double envoi = une seule demande', t.keep(null, format('select public.booking_submit(%L, %L, current_date + 100, current_date + 104, 2, 0, 0, ''Ancien voyageur'', ''ancien@test.invalid'', null, null) ->> ''replayed''', (select v from t_tok where k = 'book'), t.id('CL1'))), 'true');
select t.is('demande : dates passées refusées', t.q(null, format('select public.booking_submit(%L, gen_random_uuid(), current_date - 3, current_date + 1, 2, 0, 0, ''x'', ''x@test.invalid'', null, null) ->> ''status''', (select v from t_tok where k = 'book'))), 'invalid_dates');
select t.check('demande : équipe prévenue', '', exists (select 1 from public.notification_outbox where organization_id = t.id('A') and template = 'team_booking_requested'));
select t.is('demande : un agent ne la voit pas', t.q('a_agent', 'select count(*) from public.booking_requests'), '0');
select t.is('demande : une autre organisation ne la voit pas', t.q('b_manager', format('select count(*) from public.booking_requests where organization_id = %L', t.id('A'))), '0');
select t.deny('demande : aucune écriture directe', t.dml('a_manager', format('update public.booking_requests set status = ''confirmed'' where client_id = %L', t.id('CL1'))));
select t.is('confirmation impossible sans offre acceptée', t.q('a_manager', format('select public.booking_confirm(%L, (select id from public.booking_requests where client_id = %L)) ->> ''status''', t.id('A'), t.id('CL1'))), 'not_accepted');
select t.err('offre incohérente refusée (total ≠ prix + frais)', t.q('a_manager', format($q$select public.booking_decide(%L, (select id from public.booking_requests where client_id = %L), 'offer', 'Voici notre offre', null, '{"price": 400, "fees": 50, "total": 500, "conditions": "Paiement à l''arrivée"}')$q$, t.id('A'), t.id('CL1'))), '22023');
select t.is('offre envoyée', t.keep('a_manager', format($q$select public.booking_decide(%L, (select id from public.booking_requests where client_id = %L), 'offer', 'Voici notre offre', 'Client fidèle, remise 5 %%', '{"price": 400, "fees": 50, "total": 450, "currency": "EUR", "conditions": "Paiement à l''arrivée, annulation gratuite 7 jours avant"}') ->> 'status'$q$, t.id('A'), t.id('CL1'))), 'applied');
select t.check('voyageur : voit l''offre, jamais la note interne', '', t.q(null, format('select public.booking_portal(%L)::text', (select v from t_tok where k = 'book'))) like '%"total": 450%' and position('remise' in t.q(null, format('select public.booking_portal(%L)::text', (select v from t_tok where k = 'book')))) = 0);
select t.is('voyageur : accepte l''offre', t.keep(null, format('select public.booking_guest_action(%L, %L, ''accept'') ->> ''status''', (select v from t_tok where k = 'book'), (select id from public.booking_requests where client_id = t.id('CL1')))), 'ok');
select t.is('voyageur : un autre lien n''agit pas sur cette demande', t.q(null, format('select public.booking_guest_action(%L, %L, ''cancel'') ->> ''status''', repeat('3', 64), (select id from public.booking_requests where client_id = t.id('CL1')))), 'unavailable');
-- Deux demandes sur les mêmes dates : la seconde confirmation est refusée
select t.is('seconde demande sur les mêmes dates', t.keep(null, format('select public.booking_submit(%L, %L, current_date + 101, current_date + 103, 2, 0, 0, ''Autre'', ''autre@test.invalid'', null, null) ->> ''status''', (select v from t_tok where k = 'book'), t.id('CL2'))), 'ok');
update public.booking_requests set status = 'accepted', offer = '{"price": 300, "fees": 0, "total": 300, "conditions": "x"}' where client_id = t.id('CL2');
select t.is('confirmation : un séjour créé', t.keep('a_manager', format('select public.booking_confirm(%L, (select id from public.booking_requests where client_id = %L)) ->> ''status''', t.id('A'), t.id('CL1'))), 'applied');
select t.is('confirmation rejouée : sans effet', t.keep('a_manager', format('select public.booking_confirm(%L, (select id from public.booking_requests where client_id = %L)) ->> ''status''', t.id('A'), t.id('CL1'))), 'already');
select t.is('un seul séjour, relié à l''ancien et à la demande', (select count(*)::text from public.reservations where origin_request_id = (select id from public.booking_requests where client_id = t.id('CL1')) and previous_reservation_id = t.id('RPAST') and property_id = t.id('PA1')), '1');
select t.is('conflit : la seconde demande n''est pas confirmée', t.keep('a_manager', format('select public.booking_confirm(%L, (select id from public.booking_requests where client_id = %L)) ->> ''status''', t.id('A'), t.id('CL2'))), 'dates_unavailable');
select t.is('conflit : refus tracé', (select count(*)::text from public.booking_request_events where request_id = (select id from public.booking_requests where client_id = t.id('CL2')) and kind = 'confirm_refused'), '1');
-- Calendrier externe en échec : confirmation signalée, puis acceptée explicitement
insert into public.data_sources (organization_id, kind, property_id, platform, last_sync_at, last_error) values (t.id('A'), 'ical', t.id('PA1'), 'airbnb', now(), 'unreachable');
update public.booking_requests set status = 'accepted', check_in = current_date + 200, check_out = current_date + 202, offer = '{"check_in": null, "price": 300, "fees": 0, "total": 300, "conditions": "x"}' where client_id = t.id('CL2');
select t.is('calendrier en échec : confirmation suspendue', t.keep('a_manager', format('select public.booking_confirm(%L, (select id from public.booking_requests where client_id = %L)) ->> ''status''', t.id('A'), t.id('CL2'))), 'stale_calendars');
select t.is('calendrier en échec : confirmé après acceptation explicite', t.keep('a_manager', format('select public.booking_confirm(%L, (select id from public.booking_requests where client_id = %L), true) ->> ''status''', t.id('A'), t.id('CL2'))), 'applied');
select t.check('calendrier en échec : décision tracée', '', exists (select 1 from public.booking_request_events where request_id = (select id from public.booking_requests where client_id = t.id('CL2')) and visibility = 'internal' and body like 'Calendriers non à jour%'));
select t.is('lien révoqué : plus d''accès', t.keep('a_manager', format('select public.revoke_booking_link(%L, (select id from public.booking_links where reservation_id = %L and revoked_at is null))', t.id('A'), t.id('RPAST'))) || '/' || t.q(null, format('select public.booking_portal(%L) ->> ''status''', (select v from t_tok where k = 'book'))), 'applied/unavailable');

-- Satisfaction
select t.err('avis : pas de lien avant la fin du séjour', t.q('a_manager', format('select public.create_review_link(%L, ''guest'', %L)', t.id('A'), t.id('RP'))), '22023');
insert into t_tok values ('rev', t.keep('a_manager', format('select public.create_review_link(%L, ''guest'', %L)', t.id('A'), t.id('RPAST'))));
select t.err('avis : un agent ne crée pas de lien', t.q('a_agent', format('select public.create_review_link(%L, ''guest'', %L)', t.id('A'), t.id('RPAST'))), '42501');
select t.is('avis : questionnaire limité au séjour', t.q(null, format('select public.review_portal(%L) #>> ''{stay,property}''', (select v from t_tok where k = 'rev'))), 'A — Canal');
select t.is('avis : note hors bornes refusée', t.q(null, format('select public.review_submit(%L, 6, ''{}'', null, null, null, false) ->> ''status''', (select v from t_tok where k = 'rev'))), 'invalid');
select t.is('avis : note faible déposée', t.keep(null, format($q$select public.review_submit(%L, 2, '{"cleanliness": 1, "checkin": "", "pirate": 5}', 'Salle de bain sale', false, 'Ancien voyageur', false) ->> 'status'$q$, (select v from t_tok where k = 'rev'))), 'ok');
select t.is('avis : questions sans réponse distinguées, valeurs inconnues écartées', (select ratings::text from public.reviews where reservation_id = t.id('RPAST')), '{"cleanliness": 1}');
select t.is('avis : vérifié (séjour connu) et à traiter', (select verified::text || '/' || follow_status from public.reviews where reservation_id = t.id('RPAST')), 'true/to_handle');
select t.check('avis faible : équipe alertée', '', exists (select 1 from public.notification_outbox where organization_id = t.id('A') and template = 'team_low_review'));
select t.is('avis : un seul par séjour (modification, pas de doublon)', t.keep(null, format('select public.review_submit(%L, 3, ''{}'', ''Salle de bain à revoir'', true, null, true) ->> ''updated''', (select v from t_tok where k = 'rev'))) || '/' || (select count(*)::text from public.reviews where reservation_id = t.id('RPAST')), 'true/1');
select t.err('avis : second lien impossible une fois l''avis déposé', t.q('a_manager', format('select public.create_review_link(%L, ''guest'', %L)', t.id('A'), t.id('RPAST'))), '22023');
select t.deny('avis : le responsable ne modifie pas la note', t.dml('a_manager', format('update public.reviews set overall = 5 where reservation_id = %L', t.id('RPAST'))));
select t.is('avis : un agent ne voit pas les avis', t.q('a_agent', 'select count(*) from public.reviews'), '0');
select t.is('avis : une autre organisation non plus', t.q('b_manager', format('select count(*) from public.reviews where organization_id = %L', t.id('A'))), '0');
select t.is('suivi : traité avec incident', t.keep('a_manager', format('select public.review_follow(%L, (select id from public.reviews where reservation_id = %L), ''handled'', ''Ménage refait'', true) ->> ''status''', t.id('A'), t.id('RPAST'))), 'applied');
select t.check('suivi : incident créé sur le bon logement, sans agent désigné', '', exists (select 1 from public.incidents i join public.reviews r on r.incident_id = i.id where r.reservation_id = t.id('RPAST') and i.property_id = t.id('PA1') and i.taken_by is null));
select t.err('suivi : une autre organisation ne suit pas', t.q('b_manager', format('select public.review_follow(%L, (select id from public.reviews where reservation_id = %L), ''handled'')', t.id('A'), t.id('RPAST'))), '42501');
-- Propriétaires
insert into public.property_owners (id, organization_id, name, email) values (t.id('OWN'), t.id('A'), 'Propriétaire A', 'prop@test.invalid'), (t.id('OWNB'), t.id('B'), 'Propriétaire B', null);
select t.err('avis propriétaire : refusé sans logement géré', t.q('a_manager', format('select public.create_review_link(%L, ''owner'', %L)', t.id('A'), t.id('OWN'))), '22023');
select t.err('relation : impossible de relier le logement d''une autre organisation', t.dml('b_manager', format('insert into public.owner_properties (organization_id, owner_id, property_id) values (%L, %L, %L)', t.id('B'), t.id('OWNB'), t.id('PA1'))), '23503');
insert into public.owner_properties (organization_id, owner_id, property_id) values (t.id('A'), t.id('OWN'), t.id('PA1'));
insert into t_tok values ('own', t.keep('a_manager', format('select public.create_review_link(%L, ''owner'', %L)', t.id('A'), t.id('OWN'))));
select t.is('avis propriétaire : déposé', t.keep(null, format($q$select public.review_submit(%L, 5, '{"reactivity": 5, "transparency": 4}', 'Équipe réactive', true, 'M. P.', true) ->> 'status'$q$, (select v from t_tok where k = 'own'))), 'ok');
select t.is('avis propriétaire : distinct, rattaché au propriétaire', (select kind || '/' || (owner_id = t.id('OWN'))::text from public.reviews where owner_id = t.id('OWN')), 'owner/true');
select t.check('importé : ajouté', '', t.keep('a_manager', format('select public.add_imported_review(%L, ''guest'', 4, ''Bien'', ''Airbnb'', current_date - 40)', t.id('A'))) not like 'ERR%');
select t.is('importé : jamais vérifié, provenance conservée', (select verified::text || '/' || imported_from from public.reviews where organization_id = t.id('A') and source = 'imported'), 'false/Airbnb');
select t.is('score : avis vérifiés seulement, avec leur nombre', t.q('a_manager', format('select public.satisfaction_score(%L, ''guest'', 12) ->> ''count''', t.id('A'))), 'ERR:42501:permission denied for function satisfaction_score');
-- Vitrine
select t.err('vitrine : témoignage sans consentement refusé', t.q('a_manager', format('select public.save_showcase(%L, ''conciergerie-a'', ''A'', null, null, null, 12, true, true, array[(select id from public.reviews where source = ''imported'' and organization_id = %L limit 1)])', t.id('A'), t.id('A'))), '22023');
select t.is('vitrine : enregistrée avec un témoignage consenti', t.keep('a_manager', format('select public.save_showcase(%L, ''conciergerie-a'', ''Conciergerie A'', ''Intro'', ''Ménage'', ''contact@test.invalid'', 12, true, true, array[(select id from public.reviews where reservation_id = %L)]) ->> ''status''', t.id('A'), t.id('RPAST'))), 'applied');
select t.is('vitrine : invisible avant publication', t.q(null, 'select public.get_showcase(''conciergerie-a'') ->> ''status'''), 'unavailable');
select t.err('vitrine : un agent ne publie pas', t.q('a_agent', format('select public.publish_showcase(%L, true)', t.id('A'))), '42501');
select t.is('vitrine : publiée', t.keep('a_manager', format('select public.publish_showcase(%L, true)', t.id('A'))), 'applied');
select t.is('vitrine : score voyageurs = toutes les notes vérifiées (aucune exclusion)', t.q(null, 'select (public.get_showcase(''conciergerie-a'') #>> ''{guest,count}'') || ''/'' || (public.get_showcase(''conciergerie-a'') #>> ''{guest,average}'')'), '1/3.0');
select t.check('vitrine : aucune adresse ni e-mail', '', position('test.invalid' in replace(t.q(null, 'select public.get_showcase(''conciergerie-a'')::text'), 'contact@test.invalid', '')) = 0);
select t.is('vitrine : retrait du consentement → témoignage retiré', t.keep(null, format('select public.review_submit(%L, 3, ''{}'', ''Salle de bain à revoir'', true, null, false) ->> ''status''', (select v from t_tok where k = 'rev'))) || '/' || t.q(null, 'select jsonb_array_length(public.get_showcase(''conciergerie-a'') -> ''testimonials'')'), 'ok/0');
select t.is('vitrine : une autre organisation ne modifie pas celle de A', t.q('b_manager', format('select public.publish_showcase(%L, false)', t.id('A'))), 'ERR:42501:not_allowed');

-- =====================================================================
-- 15. Scénario opérationnel et note du service (migration 15)
-- =====================================================================
insert into t.ids values ('RPAST2', gen_random_uuid()), ('RFUT15', gen_random_uuid());
-- =====================================================================
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('RPAST2'), t.id('A'), t.id('PA1'), 'Voyageur critère', 'critere@test.invalid', now() - interval '400 days', now() - interval '397 days');
insert into t_tok values ('rev2', t.keep('a_manager', format('select public.create_review_link(%L, ''guest'', %L)', t.id('A'), t.id('RPAST2'))));
select t.is('service : note hors bornes refusée', t.q(null, format('select public.review_submit(%L, 4, ''{}'', null, null, null, false, 7) ->> ''status''', (select v from t_tok where k = 'rev2'))), 'invalid');
select t.is('critère faible : avis 4/5 avec propreté 2/5 déposé', t.keep(null, format($q$select public.review_submit(%L, 4, '{"cleanliness": 2}', null, true, null, false, 5) ->> 'status'$q$, (select v from t_tok where k = 'rev2'))), 'ok');
select t.is('critère faible : à traiter, critère et note du service enregistrés', (select follow_status || '/' || coalesce(low_reason, '-') || '/' || coalesce(service_overall::text, '-') from public.reviews where reservation_id = t.id('RPAST2')), 'to_handle/cleanliness/5');
select t.check('critère faible : équipe alertée avec le critère', '', exists (select 1 from public.notification_outbox where organization_id = t.id('A') and template = 'team_low_review' and payload ->> 'criterion' = 'cleanliness'));
select t.is('ancien avis : aucune note de service inventée', (select coalesce(service_overall::text, 'vide') from public.reviews where reservation_id = t.id('RPAST')), 'vide');
select t.is('propriétaire : pas de note de service (la note porte sur la gestion)', (select coalesce(service_overall::text, 'vide') from public.reviews where owner_id = t.id('OWN')), 'vide');
select t.is('vitrine : score du service séparé (1 réponse)', t.q(null, 'select (public.get_showcase(''conciergerie-a'') #>> ''{service,count}'') || ''/'' || (public.get_showcase(''conciergerie-a'') #>> ''{service,average}'')'), '1/5.0');
select t.is('vitrine : score du séjour : toutes les notes vérifiées', t.q(null, 'select (public.get_showcase(''conciergerie-a'') #>> ''{guest,count}'') || ''/'' || (public.get_showcase(''conciergerie-a'') #>> ''{guest,average}'')'), '2/3.5');
select t.is('linge : l''agent signale un manque sur sa mission', t.keep('a_agent', format('select public.report_incident(%L, %L, ''linen'', ''Il manque deux housses de couette'', false) is not null', t.id('A'), t.id('TA1'))), 'true');
select t.check('linge : incident rattaché au logement et à la mission', '', exists (select 1 from public.incidents where organization_id = t.id('A') and category = 'linen' and task_id = t.id('TA1') and property_id = (select property_id from public.tasks where id = t.id('TA1'))));
select t.is('retard : signalé par l''agent', t.keep('a_agent', format('select public.report_incident(%L, %L, ''delay'', ''Retard de 30 min'', false) is not null', t.id('A'), t.id('TA1'))), 'true');
select t.check('linge : une autre organisation ne signale pas sur la mission', '', t.q('b_manager', format('select public.report_incident(%L, %L, ''linen'', ''x'', false)', t.id('A'), t.id('TA1'))) like 'ERR%');
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('RFUT15'), t.id('A'), t.id('PA1'), 'Voyageur anticipé', 'anticipe@test.invalid', now() + interval '500 days', now() + interval '503 days');
insert into t_tok values ('early', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('RFUT15'))));
select t.is('arrivée anticipée : demande enregistrée', t.keep(null, format('select public.guest_request_service(%L, ''early_checkin'', now() + interval ''500 days'', 2, ''Vers 13 h'')', (select v from t_tok where k = 'early')))::jsonb ->> 'status', 'ok');
select t.is('arrivée anticipée : jamais confirmée automatiquement', (select status::text from public.service_requests where kind = 'early_checkin' and reservation_id = t.id('RFUT15')), 'requested');

-- =====================================================================
-- 16. Arrivée anticipée cohérente, lieux avant ouverture, matrice d'accès (migration 16)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['P16', 'R16P', 'R16', 'T16', 'ACT16', 'PL16N', 'PL16F', 'R16Z']) k;
insert into public.properties (id, organization_id, name, latitude, longitude) values (t.id('P16'), t.id('A'), 'Logement 16', 48.8584, 2.2945);
insert into public.guest_guides (organization_id, property_id, enabled) values (t.id('A'), t.id('P16'), true);
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('R16P'), t.id('A'), t.id('P16'), 'Sortant 16', null, '2027-10-07 16:00+00', '2027-10-10 11:00+00'),
  (t.id('R16'), t.id('A'), t.id('P16'), 'Arrivant 16', 'arrivant16@test.invalid', '2027-10-10 16:00+00', '2027-10-13 11:00+00');
insert into public.tasks (id, organization_id, property_id, type, status, reservation_id, next_reservation_id, window_start, window_end, duration_min) values
  (t.id('T16'), t.id('A'), t.id('P16'), 'turnover', 'unassigned', t.id('R16P'), t.id('R16'), '2027-10-10 11:00+00', '2027-10-10 16:00+00', 90);
insert into public.stay_prep_actions (id, organization_id, reservation_id, title, kind, blocking, due_at, task_id) values
  (t.id('ACT16'), t.id('A'), t.id('R16'), 'Ménage avant arrivée', 'task', true, '2027-10-10 16:00+00', t.id('T16'));
insert into t_tok values ('g16', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R16'))));
select t.is('arrivée anticipée 14 h : demande enregistrée', t.keep(null, format('select public.guest_request_service(%L, ''early_checkin'', ''2027-10-10 14:00+00'', 2, null)', (select v from t_tok where k = 'g16')))::jsonb ->> 'status', 'ok');
insert into t.ids select 'SV16', (select id from public.service_requests where reservation_id = t.id('R16') and kind = 'early_checkin');
select t.err('arrivée anticipée : la décision générique ne peut pas confirmer', t.q('a_manager', format('select public.decide_service(%L, %L, ''confirmed'')', t.id('A'), t.id('SV16'))), '22023');
select t.is('contraintes : ménage non attribué + action indispensable ouverte, aucun blocage dur', t.q('a_manager', format('select (public.timing_check(%L, %L) -> ''risks'')::text || ''/'' || (public.timing_check(%L, %L) -> ''blocking'')::text', t.id('A'), t.id('SV16'), t.id('A'), t.id('SV16'))), '["cleaning_unassigned", "prep_actions_late"]/[]');
select t.is('contraintes : points non vérifiés listés', t.q('a_manager', format('select (public.timing_check(%L, %L) -> ''unverified'')::text', t.id('A'), t.id('SV16'))), '["linen_stock", "access", "owner_rules", "travel"]');
select t.is('confirmation sans décision explicite : refusée, séjour inchangé', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'') ->> ''status''', t.id('A'), t.id('SV16'))) || '/' || (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R16')), 'risks/16:00');
select t.is('séjour modifié depuis l''affichage : décision refusée', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'', true, ''2027-10-10 17:00+00'') ->> ''status''', t.id('A'), t.id('SV16'))), 'stay_changed');
select t.err('un agent ne décide pas', t.q('a_agent', format('select public.timing_decide(%L, %L, ''confirm'', true)', t.id('A'), t.id('SV16'))), '42501');
select t.err('une autre organisation ne décide pas', t.q('b_manager', format('select public.timing_decide(%L, %L, ''confirm'', true)', t.id('A'), t.id('SV16'))), '42501');
select t.is('confirmation en connaissance de cause', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'', true, ''2027-10-10 16:00+00'', ''Arrivée à 14 h confirmée'') ->> ''status''', t.id('A'), t.id('SV16'))), 'applied');
select t.is('cohérence : séjour 14 h, échéance du ménage 14 h, action 14 h, demande confirmée',
  (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R16')) || '/' ||
  (select to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T16')) || '/' ||
  (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where id = t.id('ACT16')) || '/' ||
  (select status from public.service_requests where id = t.id('SV16')), '14:00/14:00/14:00/confirmed');
select t.check('historique : changement d''heure tracé', '', exists (select 1 from public.stay_prep_events where reservation_id = t.id('R16') and kind = 'stay_time_changed'));
select t.check('historique : risques acceptés notés (interne)', '', exists (select 1 from public.service_events where service_id = t.id('SV16') and visibility = 'internal' and body like 'Confirmé en connaissance de cause%prep_actions_late%'));
select t.is('voyageur : son espace affiche l''arrivée à 14 h', t.q(null, format('select coalesce(public.get_guest_stay(%L) ->> ''status'', ''-'') || ''/'' || coalesce(to_char((public.get_guest_stay(%L) #>> ''{stay,check_in_at}'')::timestamptz at time zone ''UTC'', ''HH24:MI''), ''-'')', (select v from t_tok where k = 'g16'), (select v from t_tok where k = 'g16'))), 'prep/14:00');
select t.is('confirmer deux fois : sans effet', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'', true) ->> ''status''', t.id('A'), t.id('SV16'))), 'already');
select t.err('modifier l''heure d''une demande confirmée hors décision : refusé', t.dml('a_manager', format('update public.service_requests set start_at = ''2027-10-10 13:00+00'' where id = %L', t.id('SV16'))), '22023');
select t.is('annulation : acceptée', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''cancel'') ->> ''status''', t.id('A'), t.id('SV16'))), 'applied');
select t.is('annulation : horaire et échéances rétablis', (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R16')) || '/' ||
  (select to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T16')) || '/' || (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where id = t.id('ACT16')), '16:00/16:00/16:00');
-- Ménage impossible avant l'horaire demandé (départ précédent à 11 h + 1 h 30) : refus ferme
select t.is('arrivée à 12 h : demande enregistrée', t.keep(null, format('select public.guest_request_service(%L, ''early_checkin'', ''2027-10-10 12:00+00'', 2, null)', (select v from t_tok where k = 'g16')))::jsonb ->> 'status', 'ok');
select t.is('arrivée à 12 h : impossible même avec accord', t.keep('a_manager', format('select public.timing_decide(%L, (select id from public.service_requests where reservation_id = %L and kind = ''early_checkin'' and status = ''requested''), ''confirm'', true) ->> ''status''', t.id('A'), t.id('R16'))), 'not_feasible');
select t.is('arrivée à 12 h : séjour inchangé', (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R16')), '16:00');
-- Ménage déjà planifié à 15 h : risque explicite, créneau jamais déplacé
update public.tasks set assignee_id = t.id('a_agent'), status = 'assigned', scheduled_start = '2027-10-10 15:00+00' where id = t.id('T16');
update public.service_requests set status = 'declined' where reservation_id = t.id('R16') and kind = 'early_checkin' and status = 'requested';
select t.is('arrivée à 14 h (2) : demande enregistrée', t.keep(null, format('select public.guest_request_service(%L, ''early_checkin'', ''2027-10-10 14:00+00'', 2, null)', (select v from t_tok where k = 'g16')))::jsonb ->> 'status', 'ok');
select t.is('ménage planifié après 14 h : risque signalé', t.q('a_manager', format('select (public.timing_check(%L, (select id from public.service_requests where reservation_id = %L and kind = ''early_checkin'' and status = ''requested'')) -> ''risks'')::text', t.id('A'), t.id('R16'))), '["mission_scheduled", "prep_actions_late"]');
select t.is('confirmé : l''horaire planifié du ménage n''est pas déplacé', t.keep('a_manager', format('select public.timing_decide(%L, (select id from public.service_requests where reservation_id = %L and kind = ''early_checkin'' and status = ''requested''), ''confirm'', true) ->> ''status''', t.id('A'), t.id('R16'))) || '/' || (select to_char(scheduled_start at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T16')), 'applied/15:00');
select t.check('agent informé du changement d''échéance', '', exists (select 1 from public.notification_outbox where organization_id = t.id('A') and template = 'agent_task_changed' and payload ->> 'path' = '/app/missions/' || t.id('T16')));

-- Lieux avant l'ouverture : rien qui localise le logement
insert into public.property_places (id, organization_id, property_id, source, category, name, latitude, longitude) values
  (t.id('PL16N'), t.id('A'), t.id('P16'), 'manager', 'activities', 'Lieu public au même endroit', 48.8584, 2.2945),
  (t.id('PL16F'), t.id('A'), t.id('P16'), 'manager', 'food', 'Bistrot à 1,5 km', 48.8710, 2.2995);
select t.is('avant ouverture : lieu au même endroit retenu, compté', t.q(null, format('select (public.guest_places(%L) ->> ''near_hidden'') || ''/'' || jsonb_array_length(public.guest_places(%L) -> ''places'')', (select v from t_tok where k = 'g16'), (select v from t_tok where k = 'g16'))), '1/1');
select t.is('avant ouverture : ni distance exacte ni coordonnées du logement', t.q(null, format('select coalesce(public.guest_places(%L) #>> ''{places,0,distance_m}'', ''-'') || ''/'' || (public.guest_places(%L) #>> ''{places,0,distance_band}'') || ''/'' || coalesce(public.guest_places(%L) #>> ''{property,lat}'', ''-'')', (select v from t_tok where k = 'g16'), (select v from t_tok where k = 'g16'), (select v from t_tok where k = 'g16'))), '-/2/-');
-- Dans la fenêtre habituelle (lien de séjour en cours) : tout est visible
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R16Z'), t.id('A'), t.id('P16'), 'En cours 16', now() - interval '1 day', now() + interval '1 day');
insert into t_tok values ('g16z', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R16Z'))));
select t.is('pendant le séjour : lieux proches et distances exactes visibles', t.q(null, format('select (public.guest_places(%L) ->> ''near_hidden'') || ''/'' || jsonb_array_length(public.guest_places(%L) -> ''places'') || ''/'' || (public.guest_places(%L) #>> ''{places,0,distance_m}'')', (select v from t_tok where k = 'g16z'), (select v from t_tok where k = 'g16z'), (select v from t_tok where k = 'g16z'))), '0/2/0');

-- Matrice d'accès serveur : lecture, création, modification, suppression par rôle et organisation
select t.is('matrice : anonyme ne lit aucun séjour', t.q(null, 'select count(*) from public.reservations'), 'ERR:42501:permission denied for table reservations');
select t.is('matrice : anonyme ne lit aucune mission', t.q(null, 'select count(*) from public.tasks'), 'ERR:42501:permission denied for table tasks');
select t.is('matrice : agent ne lit pas un séjour sans mission pour lui', t.q('a_agent', format('select count(*) from public.reservations where id = %L', t.id('R16Z'))), '0');
select t.deny('matrice : agent ne crée pas de séjour', t.dml('a_agent', format('insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (%L, %L, ''2028-01-01'', ''2028-01-02'')', t.id('A'), t.id('P16'))));
select t.deny('matrice : agent ne modifie pas un logement', t.dml('a_agent', format('update public.properties set name = ''x'' where id = %L', t.id('P16'))));
select t.deny('matrice : agent ne supprime pas une mission', t.dml('a_agent', format('delete from public.tasks where id = %L', t.id('T16'))));
select t.is('matrice : autre organisation ne lit ni séjour ni mission ni logement', t.q('b_manager', format('select (select count(*) from public.reservations where id = %L) + (select count(*) from public.tasks where id = %L) + (select count(*) from public.properties where id = %L)', t.id('R16'), t.id('T16'), t.id('P16'))), '0');
select t.deny('matrice : autre organisation ne crée pas de séjour chez A', t.dml('b_manager', format('insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (%L, %L, ''2028-01-01'', ''2028-01-02'')', t.id('A'), t.id('P16'))));
select t.deny('matrice : autre organisation ne modifie pas un séjour de A', t.dml('b_manager', format('update public.reservations set guest_name = ''x'' where id = %L', t.id('R16'))));
select t.deny('matrice : autre organisation ne supprime pas un logement de A', t.dml('b_manager', format('delete from public.properties where id = %L', t.id('P16'))));
select t.deny('matrice : autre organisation ne supprime pas une mission de A', t.dml('b_manager', format('delete from public.tasks where id = %L', t.id('T16'))));
select t.deny('matrice : autre organisation ne modifie pas une demande voyageur de A', t.dml('b_manager', format('update public.service_requests set status = ''declined'' where id = %L', t.id('SV16'))));
select t.is('matrice : le responsable de A modifie son séjour', t.dml('a_manager', format('update public.reservations set guest_name = ''Arrivant 16 bis'' where id = %L', t.id('R16'))), '1');
alter table public.reservations enable trigger reservations_overlap_check;
select t.err('matrice : séjour chevauchant refusé (même pour le responsable)', t.dml('a_manager', format('insert into public.reservations (organization_id, property_id, check_in_at, check_out_at) values (%L, %L, ''2027-10-11 10:00+00'', ''2027-10-12 10:00+00'')', t.id('A'), t.id('P16'))), '23P01');
alter table public.reservations disable trigger reservations_overlap_check;

-- =====================================================================
-- 17. Horaire : missions liées (cause du 2/11), anciennes confirmations, lieux avant ouverture (migration 17)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['P17', 'R17P', 'R17', 'T17C', 'T17M', 'T17I', 'SV17', 'R17L', 'SV17L']) k;
insert into public.properties (id, organization_id, name, latitude, longitude) values (t.id('P17'), t.id('A'), 'Logement 17', 43.6045, 1.4440);
insert into public.guest_guides (organization_id, property_id, enabled) values (t.id('A'), t.id('P17'), true);
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values
  (t.id('R17P'), t.id('A'), t.id('P17'), 'Sortant 17', '2027-11-17 16:00+00', '2027-11-20 10:00+00'),
  (t.id('R17'), t.id('A'), t.id('P17'), 'QA Guest 17', '2027-11-20 16:00+00', '2027-11-23 10:00+00');
-- Configuration du retest : ménage, mission de préparation (non attribuée) liée à une action indispensable, accueil
insert into public.tasks (id, organization_id, property_id, type, status, reservation_id, next_reservation_id, title, window_start, window_end, duration_min) values
  (t.id('T17C'), t.id('A'), t.id('P17'), 'turnover', 'unassigned', t.id('R17P'), t.id('R17'), null, '2027-11-20 10:00+00', '2027-11-20 16:00+00', 90),
  (t.id('T17M'), t.id('A'), t.id('P17'), 'other', 'unassigned', null, t.id('R17'), 'Préparer la table VIP', '2027-11-20 13:30+00', '2027-11-20 16:00+00', 60),
  (t.id('T17I'), t.id('A'), t.id('P17'), 'check_in', 'unassigned', t.id('R17'), null, null, '2027-11-20 15:30+00', '2027-11-20 18:00+00', 30);
insert into public.stay_prep_actions (organization_id, reservation_id, title, kind, blocking, due_at, task_id) values
  (t.id('A'), t.id('R17'), 'Table VIP', 'task', true, '2027-11-20 16:00+00', t.id('T17M'));
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source) values
  (t.id('SV17'), t.id('A'), t.id('P17'), t.id('R17'), 'early_checkin', '2027-11-20 13:00+00', 'requested', 'guest');
select t.is('2/11 : effets prévus par mission (ménage échéance, préparation laissée, accueil décalé)',
  t.q('a_manager', format('select string_agg((e ->> ''type'') || '':'' || (e ->> ''effect''), '','' order by e ->> ''type'') from jsonb_array_elements(public.timing_check(%L, %L) -> ''tasks'') e', t.id('A'), t.id('SV17'))),
  'check_in:shift,other:unchanged_cannot_fit,turnover:deadline');
select t.is('2/11 : risques listés, aucun blocage', t.q('a_manager', format('select (public.timing_check(%L, %L) -> ''risks'')::text || ''/'' || (public.timing_check(%L, %L) -> ''blocking'')::text', t.id('A'), t.id('SV17'), t.id('A'), t.id('SV17'))),
  '["mission_cannot_fit", "cleaning_unassigned", "mission_unassigned", "prep_actions_late"]/[]');
select t.is('2/11 : confirmation avec accord — plus d''erreur invalid_window', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'', true, ''2027-11-20 16:00+00'') ->> ''status''', t.id('A'), t.id('SV17'))), 'applied');
select t.is('2/11 : séjour 13 h, ménage avant 13 h, préparation inchangée, accueil 12:30-15:00, action 13 h',
  (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R17')) || '/' ||
  (select to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T17C')) || '/' ||
  (select to_char(window_start at time zone 'UTC', 'HH24:MI') || '-' || to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T17M')) || '/' ||
  (select to_char(window_start at time zone 'UTC', 'HH24:MI') || '-' || to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T17I')) || '/' ||
  (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where reservation_id = t.id('R17')),
  '13:00/13:00/13:30-16:00/12:30-15:00/13:00');
select t.is('2/11 : annulation — tout revient à 16 h (accueil compris)', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''cancel'') ->> ''status''', t.id('A'), t.id('SV17'))), 'applied');
select t.is('2/11 : après annulation', (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R17')) || '/' ||
  (select to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T17C')) || '/' ||
  (select to_char(window_start at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T17I')) || '/' ||
  (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where reservation_id = t.id('R17')), '16:00/16:00/15:30/16:00');
-- Accueil déjà planifié : jamais déplacé, risque signalé
update public.tasks set scheduled_start = '2027-11-20 15:45+00' where id = t.id('T17I');
insert into public.service_requests (organization_id, property_id, reservation_id, kind, start_at, status, source) values (t.id('A'), t.id('P17'), t.id('R17'), 'early_checkin', '2027-11-20 14:00+00', 'requested', 'guest');
select t.check('accueil planifié : risque « mission planifiée »', '', (t.q('a_manager', format('select public.timing_check(%L, (select id from public.service_requests where reservation_id = %L and status = ''requested''))::text', t.id('A'), t.id('R17')))) like '%mission_scheduled%');
select t.is('accueil planifié : confirmé, créneau laissé à 15:45', t.keep('a_manager', format('select public.timing_decide(%L, (select id from public.service_requests where reservation_id = %L and status = ''requested''), ''confirm'', true) ->> ''status''', t.id('A'), t.id('R17'))) || '/' || (select to_char(scheduled_start at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T17I')), 'applied/15:45');

-- Ancienne confirmation incohérente (avant migration 16) : détectée, jamais corrigée seule, résolue par décision tracée
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R17L'), t.id('A'), t.id('P17'), 'Ancien horaire', '2027-12-10 16:00+00', '2027-12-12 10:00+00');
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source) values (t.id('SV17L'), t.id('A'), t.id('P17'), t.id('R17L'), 'early_checkin', '2027-12-10 14:00+00', 'requested', 'guest');
alter table public.service_requests disable trigger service_requests_timing_guard;
update public.service_requests set status = 'confirmed' where id = t.id('SV17L');
alter table public.service_requests enable trigger service_requests_timing_guard;
select t.is('incohérence : détectée (14 h confirmé, séjour 16 h)', t.q('a_manager', format('select count(*) from jsonb_array_elements(public.timing_inconsistencies(%L)) e where e ->> ''service'' = %L', t.id('A'), t.id('SV17L'))), '1');
select t.is('incohérence : invisible pour un agent', t.q('a_agent', format('select jsonb_array_length(public.timing_inconsistencies(%L))', t.id('A'))), '0');
select t.is('incohérence : signalée dans la vérification', t.q('a_manager', format('select public.timing_check(%L, %L) ->> ''legacy_mismatch''', t.id('A'), t.id('SV17L'))), 'true');
select t.is('incohérence : rien n''est modifié tant que personne ne décide', (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R17L')), '16:00');
select t.err('garde-fou : une demande d''horaire ne peut pas être créée « confirmée »', t.dml('a_manager', format('insert into public.service_requests (organization_id, property_id, reservation_id, kind, start_at, status, source) values (%L, %L, %L, ''early_checkin'', ''2027-12-10 13:00+00'', ''confirmed'', ''manager'')', t.id('A'), t.id('P17'), t.id('R17L'))), '22023');
select t.is('résolution : appliquer l''ancienne confirmation (accord explicite)', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''apply_legacy'', true, null, ''Votre arrivée à 14 h est bien confirmée.'') ->> ''status''', t.id('A'), t.id('SV17L'))), 'applied');
select t.is('résolution : séjour à 14 h, plus d''incohérence, décision tracée',
  (select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id('R17L')) || '/' ||
  t.q('a_manager', format('select count(*) from jsonb_array_elements(public.timing_inconsistencies(%L)) e where e ->> ''service'' = %L', t.id('A'), t.id('SV17L'))) || '/' ||
  (select count(*)::text from public.service_events where service_id = t.id('SV17L') and body like 'Confirmation contradictoire appliquée%'), '14:00/0/1');

-- Lieux avant ouverture : aucune suggestion automatique, aucune coordonnée transmise (deux localisations)
insert into public.property_places (organization_id, property_id, source, external_id, category, name, latitude, longitude) values
  (t.id('A'), t.id('P17'), 'openstreetmap', 'node/17001', 'food', 'Auto proche', 43.6050, 1.4445),
  (t.id('A'), t.id('P17'), 'openstreetmap', 'node/17002', 'food', 'Auto loin', 43.6150, 1.4540);
insert into public.property_places (organization_id, property_id, source, category, name, latitude, longitude, address) values
  (t.id('A'), t.id('P17'), 'manager', 'food', 'Choix équipe à 1,5 km', 43.6170, 1.4500, '1 rue Fictive, Toulouse'),
  (t.id('A'), t.id('P17'), 'manager', 'food', 'Choix équipe sans coordonnées', null, null, null);
update public.properties set auto_places = true where id = t.id('P17');
insert into t_tok values ('g17', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R17'))));
select t.is('avant ouverture (Toulouse) : seulement la sélection de l''équipe, suggestions comptées',
  t.q(null, format('select jsonb_array_length(public.guest_places(%L) -> ''places'') || ''/'' || (public.guest_places(%L) ->> ''auto_hidden'')', (select v from t_tok where k = 'g17'), (select v from t_tok where k = 'g17'))), '2/2');
select t.check('avant ouverture : aucune coordonnée ni distance exacte dans les données transmises', '',
  not exists (select 1 from jsonb_array_elements(public.guest_places((select v from t_tok where k = 'g17')) -> 'places') e where (e ->> 'lat') is not null or (e ->> 'lng') is not null or (e ->> 'distance_m') is not null)
  and (public.guest_places((select v from t_tok where k = 'g17')) #>> '{property,lat}') is null);
select t.check('avant ouverture : les coordonnées du logement n''apparaissent nulle part', '',
  position('43.6045' in public.guest_places((select v from t_tok where k = 'g17'))::text) = 0 and position('1.444' in public.guest_places((select v from t_tok where k = 'g17'))::text) = 0);

-- =====================================================================
-- 18. Horaires confirmés successivement, effets détaillés, historique voyageur, e-mails, lieux (migration 18)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['P18', 'R18P', 'R18', 'T18C', 'A18D', 'A18N', 'A18F', 'A18X', 'R18B', 'R18N', 'P18R', 'R18R', 'P18X', 'R18X', 'R18Z',
  'PL18H', 'PL18F', 'PL18U', 'PL18R1', 'PL18R2', 'PL18X']) k;
insert into public.properties (id, organization_id, name, latitude, longitude, timezone) values (t.id('P18'), t.id('A'), 'Logement 18 (dense)', 48.8530, 2.3499, 'Europe/Paris');
insert into public.guest_guides (organization_id, property_id, enabled) values (t.id('A'), t.id('P18'), true);
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('R18P'), t.id('A'), t.id('P18'), 'Sortant 18', null, '2028-01-07 15:00+00', '2028-01-10 09:00+00'),
  (t.id('R18'), t.id('A'), t.id('P18'), 'QA Guest 18', 'qa18@test.invalid', '2028-01-10 15:00+00', '2028-01-13 09:00+00');
insert into public.tasks (id, organization_id, property_id, type, status, reservation_id, next_reservation_id, window_start, window_end, duration_min) values
  (t.id('T18C'), t.id('A'), t.id('P18'), 'turnover', 'unassigned', t.id('R18P'), t.id('R18'), '2028-01-10 09:00+00', '2028-01-10 15:00+00', 90);
-- Actions indispensables : échéance = arrivée actuelle, sans échéance, plus tardive, déjà terminée
insert into public.stay_prep_actions (id, organization_id, reservation_id, title, kind, blocking, due_at, status) values
  (t.id('A18D'), t.id('A'), t.id('R18'), 'Fleurs', 'task', true, '2028-01-10 15:00+00', 'open'),
  (t.id('A18N'), t.id('A'), t.id('R18'), 'Lit bébé', 'task', true, null, 'open'),
  (t.id('A18F'), t.id('A'), t.id('R18'), 'Champagne', 'task', true, '2028-01-10 17:00+00', 'open'),
  (t.id('A18X'), t.id('A'), t.id('R18'), 'Clés', 'task', true, '2028-01-09 12:00+00', 'done');
insert into public.incidents (organization_id, property_id, source, category, description, status) values (t.id('A'), t.id('P18'), 'manager', 'linen', 'Draps manquants (fictif)', 'open');
insert into t_tok values ('g18', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R18'))));
create function t.in18(k text default 'R18') returns text language sql as $$ select to_char(check_in_at at time zone 'UTC', 'HH24:MI') from public.reservations where id = t.id(k) $$;
create function t.ask18(k text, at text) returns uuid language plpgsql as $$
declare res jsonb := t.keep(null, format('select public.guest_request_service(%L, ''early_checkin'', %L, 2, null)', (select v from t_tok where t_tok.k = 'g18'), at))::jsonb;
begin
  return (select id from public.service_requests where reservation_id = t.id(k) and kind = 'early_checkin' and start_at = at::timestamptz order by created_at desc limit 1);
end $$;
create function t.dec18(svc uuid, act text, ack boolean default true, expected text default null, msg text default null, who text default 'a_manager') returns text language sql as $$
  select t.keep(who, format('select public.timing_decide(%L, %L, %L, %L, %L, %L) ->> ''status''', t.id('A'), svc, act, ack, expected, msg))
$$;
create function t.st18(svc uuid) returns text language sql as $$
  select t.q('a_manager', format('select e ->> ''state'' from jsonb_array_elements(public.timing_states(%L)) e where e ->> ''service'' = %L', t.id('A'), svc))
$$;
create function t.alert18() returns text language sql as $$
  select t.q('a_manager', format('select count(*) from jsonb_array_elements(public.timing_inconsistencies(%L)) e where e ->> ''reservation'' in (%L, %L)', t.id('A'), t.id('R18'), t.id('R18B')))
$$;
create function t.guest18(svc uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.get_guest_stay((select v from t_tok where k = 'g18')) -> 'services') e where e ->> 'id' = svc::text
$$;

-- (1) Effets détaillés avant décision : actions selon leur échéance réelle, incidents, inconnues
insert into t.ids values ('S18A', t.ask18('R18', '2028-01-10 14:00+00'));
select t.is('effets : action à l''heure actuelle avancée, sans échéance signalée telle quelle, plus tardive laissée',
  t.q('a_manager', format('select string_agg((a ->> ''title'') || '':'' || (a ->> ''effect''), '','' order by a ->> ''title'') from jsonb_array_elements(public.timing_check(%L, %L) -> ''actions'') a', t.id('A'), t.id('S18A'))),
  'Champagne:due_after,Fleurs:due_moved,Lit bébé:no_due');
select t.is('effets : action déjà terminée comptée à part, linge ouvert signalé',
  t.q('a_manager', format('select (public.timing_check(%L, %L) ->> ''done_actions'') || ''/'' || (public.timing_check(%L, %L) #>> ''{incidents,linen}'')', t.id('A'), t.id('S18A'), t.id('A'), t.id('S18A'))), '1/1');
select t.is('effets : risques nommés selon la donnée réelle (pas d''« échéance plus tardive » sans date)',
  t.q('a_manager', format('select (public.timing_check(%L, %L) -> ''risks'')::text', t.id('A'), t.id('S18A'))),
  '["cleaning_unassigned", "prep_actions_late", "prep_actions_no_due", "linen_issue_open"]');
select t.is('décision 14 h sans accord : refusée', t.dec18(t.id('S18A'), 'confirm', false), 'risks');
select t.is('décision 14 h avec accord : appliquée', t.dec18(t.id('S18A'), 'confirm', true, '2028-01-10 15:00+00'), 'applied');
select t.is('après 14 h : séjour 14 h ; Fleurs 14 h ; Lit bébé sans échéance ; Champagne 17 h inchangé ; tout reste ouvert',
  t.in18() || '/' || (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where id = t.id('A18D')) || '/' ||
  coalesce((select due_at::text from public.stay_prep_actions where id = t.id('A18N')), 'aucune') || '/' ||
  (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where id = t.id('A18F')) || '/' ||
  (select count(*)::text from public.stay_prep_actions where reservation_id = t.id('R18') and status = 'open'), '14:00/14:00/aucune/17:00/3');
select t.is('confirmer en connaissance de cause ne rend pas le logement « prêt »',
  coalesce((select prep_status from public.stay_preparations where reservation_id = t.id('R18')), 'to_prepare') || '/' || (select status::text from public.tasks where id = t.id('T18C')), 'to_prepare/unassigned');
select t.is('état 14 h : horaire applicable', t.st18(t.id('S18A')), 'applied');

-- (2) Nouvelle demande 12 h confirmée : une seule heure applicable, la précédente « remplacée » (pas une anomalie)
insert into t.ids values ('S18B', t.ask18('R18', '2028-01-10 12:00+00'));
select t.is('12 h : appliquée', t.dec18(t.id('S18B'), 'confirm', true, '2028-01-10 14:00+00'), 'applied');
select t.is('12 h : séjour 12 h, ménage avant 12 h', t.in18() || '/' || (select to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T18C')), '12:00/12:00');
select t.is('12 h : la confirmation 14 h est « remplacée », la 12 h applicable', t.st18(t.id('S18A')) || '/' || t.st18(t.id('S18B')), 'superseded/applied');
select t.is('12 h : aucune fausse alerte « horaires contradictoires »', t.alert18(), '0');
select t.is('12 h : vérification de la 14 h — pas de contradiction, remplacée par 12 h',
  t.q('a_manager', format('select (public.timing_check(%L, %L) ->> ''legacy_mismatch'') || ''/'' || to_char((public.timing_check(%L, %L) ->> ''superseded_by_at'')::timestamptz at time zone ''UTC'', ''HH24:MI'')', t.id('A'), t.id('S18A'), t.id('A'), t.id('S18A'))), 'false/12:00');
select t.is('voyageur : 14 h « remplacée » par 12 h, 12 h applicable',
  (t.guest18(t.id('S18A')) ->> 'timing_state') || '/' || to_char((t.guest18(t.id('S18A')) ->> 'superseded_by_at')::timestamptz at time zone 'UTC', 'HH24:MI') || '/' || (t.guest18(t.id('S18B')) ->> 'timing_state'), 'superseded/12:00/applied');
select t.is('voyageur : historique de la 14 h — événement d''horaire « remplacé » avec l''heure, pas une demande',
  (select string_agg((e ->> 'kind') || ':' || coalesce(e ->> 'status', '-'), ',') from jsonb_array_elements(t.guest18(t.id('S18A')) -> 'events') e), 'created:requested,status:confirmed,timing:superseded');
select t.is('appliquer une confirmation remplacée : refusé, séjour inchangé', t.dec18(t.id('S18A'), 'apply_legacy') || '/' || t.in18(), 'superseded/12:00');
select t.is('double envoi de la même décision : sans effet', t.dec18(t.id('S18B'), 'confirm'), 'already');

-- (3) Annulation de la 12 h : retour à 14 h, la 14 h redevient l'horaire applicable (tracé)
select t.is('annulation 12 h : appliquée', t.dec18(t.id('S18B'), 'cancel'), 'applied');
select t.is('annulation 12 h : séjour, ménage et action reviennent à 14 h', t.in18() || '/' || (select to_char(window_end at time zone 'UTC', 'HH24:MI') from public.tasks where id = t.id('T18C')) || '/' || (select to_char(due_at at time zone 'UTC', 'HH24:MI') from public.stay_prep_actions where id = t.id('A18D')), '14:00/14:00/14:00');
select t.is('annulation 12 h : 14 h applicable de nouveau, 12 h annulée', t.st18(t.id('S18A')) || '/' || t.st18(t.id('S18B')), 'applied/cancelled');
select t.check('annulation 12 h : événement voyageur « rétabli » sur la 14 h', '', exists (select 1 from public.service_events where service_id = t.id('S18A') and kind = 'timing' and status = 'reinstated' and visibility = 'guest' and ref_at = '2028-01-10 14:00+00'));

-- (4) Retirer une confirmation remplacée : la chaîne reste juste (l'annulation suivante revient à l'heure d'avant)
insert into t.ids values ('S18C', t.ask18('R18', '2028-01-10 11:30+00'));
select t.is('11 h 30 : appliquée', t.dec18(t.id('S18C'), 'confirm', true), 'applied');
select t.is('retirer la 14 h remplacée : séjour inchangé (11 h 30)', t.dec18(t.id('S18A'), 'cancel') || '/' || t.in18(), 'applied/11:30');
select t.is('chaîne : annuler la 11 h 30 revient à 15 h (horaire d''avant la 14 h retirée)', t.dec18(t.id('S18C'), 'cancel') || '/' || t.in18(), 'applied/15:00');

-- (5) Séjour modifié indépendamment après une confirmation : vraie contradiction ; annulation sans écraser le changement
insert into t.ids values ('S18D', t.ask18('R18', '2028-01-10 13:00+00'));
select t.is('13 h : appliquée', t.dec18(t.id('S18D'), 'confirm', true), 'applied');
update public.reservations set check_in_at = '2028-01-10 15:30+00' where id = t.id('R18');
select t.is('séjour repoussé à 15 h 30 hors décision : contradiction signalée (1 alerte)', t.st18(t.id('S18D')) || '/' || t.alert18(), 'contradiction/1');
select t.is('annuler la 13 h : séjour laissé à 15 h 30 (changement plus récent non écrasé), plus d''alerte', t.dec18(t.id('S18D'), 'cancel') || '/' || t.in18() || '/' || t.alert18(), 'applied/15:30/0');
-- Séjour avancé hors décision : promesse tenue (« couverte »), pas d'alerte
insert into t.ids values ('S18E', t.ask18('R18', '2028-01-10 14:30+00'));
select t.is('14 h 30 : appliquée', t.dec18(t.id('S18E'), 'confirm', true), 'applied');
update public.reservations set check_in_at = '2028-01-10 13:30+00' where id = t.id('R18');
select t.is('séjour avancé à 13 h 30 hors décision : « couverte », aucune alerte', t.st18(t.id('S18E')) || '/' || t.alert18(), 'covered/0');
select t.is('voyageur : note « couverte »', t.guest18(t.id('S18E')) ->> 'timing_state', 'covered');

-- (6) Deux demandes en attente pour le même séjour
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R18B'), t.id('A'), t.id('P18'), 'QA 18 B', '2028-02-10 15:00+00', '2028-02-12 09:00+00');
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source) values
  (gen_random_uuid(), t.id('A'), t.id('P18'), t.id('R18B'), 'early_checkin', '2028-02-10 12:00+00', 'requested', 'guest'),
  (gen_random_uuid(), t.id('A'), t.id('P18'), t.id('R18B'), 'early_checkin', '2028-02-10 13:00+00', 'requested', 'guest');
insert into t.ids select 'S18F', id from public.service_requests where reservation_id = t.id('R18B') and start_at = '2028-02-10 12:00+00';
insert into t.ids select 'S18G', id from public.service_requests where reservation_id = t.id('R18B') and start_at = '2028-02-10 13:00+00';
select t.is('deux en attente : 12 h confirmée', t.dec18(t.id('S18F'), 'confirm', true, '2028-02-10 15:00+00'), 'applied');
select t.is('deux en attente : la 13 h ne change rien (séjour déjà plus tôt)',
  t.q('a_manager', format('select (public.timing_check(%L, %L) ->> ''change'') || ''/'' || (public.timing_check(%L, %L) ->> ''no_change'')', t.id('A'), t.id('S18G'), t.id('A'), t.id('S18G'))), 'false/already_better');
select t.is('deux en attente : 13 h confirmée avec l''ancienne heure attendue (15 h) — refusée, séjour modifié', t.dec18(t.id('S18G'), 'confirm', true, '2028-02-10 15:00+00'), 'stay_changed');
select t.is('deux en attente : 13 h confirmée sur données à jour — séjour reste 12 h, 13 h « couverte »', t.dec18(t.id('S18G'), 'confirm', true, '2028-02-10 12:00+00') || '/' || t.in18('R18B') || '/' || t.st18(t.id('S18G')), 'applied/12:00/covered');

-- (7) Droits et isolation
select t.is('états : un agent ne voit rien', t.q('a_agent', format('select jsonb_array_length(public.timing_states(%L))', t.id('A'))), '0');
select t.is('états : une autre organisation ne voit rien', t.q('b_manager', format('select jsonb_array_length(public.timing_states(%L))', t.id('A'))), '0');
select t.err('décision : agent refusé', t.q('a_agent', format('select public.timing_decide(%L, %L, ''cancel'')', t.id('A'), t.id('S18F'))), '42501');
select t.err('décision : autre organisation refusée', t.q('b_manager', format('select public.timing_decide(%L, %L, ''cancel'')', t.id('A'), t.id('S18F'))), '42501');
select t.err('décision : autre organisation avec son propre identifiant d''organisation — demande introuvable', t.q('b_manager', format('select public.timing_decide(%L, %L, ''cancel'')', t.id('B'), t.id('S18F'))), 'P0002');
select t.deny('remplacement : impossible à écrire directement', t.dml('a_manager', format('update public.service_requests set superseded_by = %L where id = %L', t.id('S18F'), t.id('S18G'))));
select t.deny('horaire appliqué : impossible à écrire directement', t.dml('a_manager', format('update public.service_requests set timing_applied_at = now() where id = %L', t.id('S18G'))));
select t.err('création avec remplacement préétabli : refusée', t.dml('a_manager', format('insert into public.service_requests (organization_id, property_id, reservation_id, kind, start_at, status, source, superseded_by) values (%L, %L, %L, ''early_checkin'', ''2028-02-10 11:00+00'', ''requested'', ''manager'', %L)', t.id('A'), t.id('P18'), t.id('R18B'), t.id('S18F'))), '22023');

-- (8) Historique voyageur : libellés fidèles, notes internes jamais transmises
update public.reservations set check_in_at = '2028-02-10 14:00+00' where id = t.id('R18B');
select t.is('séjour B repoussé hors décision : deux vraies contradictions', t.alert18(), '2');
insert into t_tok values ('g18bb', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R18B'))));
select t.is('régularisation avec message : appliquée', t.dec18(t.id('S18F'), 'apply_legacy', true, null, 'Votre arrivée à 12 h est bien confirmée.'), 'applied');
select t.is('régularisation : séjour 12 h, la 13 h remplacée, plus aucune alerte', t.in18('R18B') || '/' || t.st18(t.id('S18G')) || '/' || t.alert18(), '12:00/superseded/0');
select t.is('voyageur : régularisation = information d''horaire + message de l''équipe (jamais « demandée »)',
  (select string_agg((e ->> 'kind') || ':' || coalesce(e ->> 'status', '-'), ',') from jsonb_array_elements((select e from jsonb_array_elements(public.get_guest_stay((select v from t_tok where k = 'g18bb')) -> 'services') e where e ->> 'id' = t.id('S18F')::text) -> 'events') e),
  'status:confirmed,timing:applied,team_message:-');
select t.check('voyageur : aucune note interne dans les données transmises', '',
  position('connaissance de cause' in public.get_guest_stay((select v from t_tok where k = 'g18'))::text) = 0
  and position('Confirmation contradictoire' in public.get_guest_stay((select v from t_tok where k = 'g18bb'))::text) = 0
  and position('internal' in public.get_guest_stay((select v from t_tok where k = 'g18bb'))::text) = 0);

-- (9) E-mails d'horaire : heure applicable incluse, message obsolète jamais envoyé, un seul destinataire
insert into public.reservations (id, organization_id, property_id, guest_name, guest_email, check_in_at, check_out_at) values
  (t.id('R18N'), t.id('A'), t.id('P18'), 'QA 18 N', 'qa18n@example.test', '2028-03-10 15:00+00', '2028-03-12 09:00+00');
insert into public.service_requests (organization_id, property_id, reservation_id, kind, start_at, status, source) values (t.id('A'), t.id('P18'), t.id('R18N'), 'early_checkin', '2028-03-10 13:00+00', 'requested', 'guest');
insert into t.ids select 'S18N', id from public.service_requests where reservation_id = t.id('R18N');
select t.is('e-mail : confirmation 13 h', t.dec18(t.id('S18N'), 'confirm', true), 'applied');
select t.is('e-mail : « horaire confirmé » en attente avec l''heure applicable (13 h, fuseau du logement)',
  (select template || '/' || status || '/' || to_char((payload ->> 'stay_at')::timestamptz at time zone 'UTC', 'HH24:MI') || '/' || (payload ->> 'tz') from public.notification_outbox where service_id = t.id('S18N') order by created_at desc limit 1), 'timing_confirmed/pending/13:00/Europe/Paris');
select t.is('e-mail : annulation', t.dec18(t.id('S18N'), 'cancel'), 'applied');
select t.is('e-mail : la confirmation devenue obsolète n''est pas envoyée, l''annulation porte l''heure rétablie (15 h)',
  (select string_agg(template || ':' || status || ':' || coalesce(last_error, '-') || ':' || to_char((payload ->> 'stay_at')::timestamptz at time zone 'UTC', 'HH24:MI'), ',' order by template desc) from public.notification_outbox where service_id = t.id('S18N')),
  'timing_confirmed:skipped:superseded_by_newer_decision:13:00,timing_cancelled:pending:-:15:00');
select t.is('e-mail : voyageur seul destinataire des e-mails d''horaire, aucun e-mail générique en double, e-mails d''équipe aux seuls responsables de A',
  (select count(distinct recipient) filter (where template like 'timing\_%')::text || '/' || count(*) filter (where template like 'service\_%')::text || '/' || count(*) filter (where template like 'team\_%' and recipient not in (select u.email from public.memberships m join auth.users u on u.id = m.user_id where m.organization_id = t.id('A') and m.role in ('owner', 'manager')))::text from public.notification_outbox where service_id = t.id('S18N')), '1/0/0');
select t.err('envoi : la réservation d''e-mails est interdite aux comptes', t.q('a_manager', 'select count(*) from public.outbox_claim(null, 1)'), '42501');
select t.is('envoi : un e-mail réservé une fois ne l''est pas une seconde fois (pas de doublon)',
  (select count(*)::text from public.outbox_claim(t.id('A'), 50) c where c.service_id = t.id('S18N')) || '/' || (select count(*)::text from public.outbox_claim(t.id('A'), 50) c where c.service_id = t.id('S18N')), '1/0');
update public.notification_outbox set status = 'failed', last_error = 'test' where service_id = t.id('S18N') and status = 'sending';
select t.check('relance par un responsable : acceptée', '', t.keep('a_manager', format('select public.retry_notification(%L, (select id from public.notification_outbox where service_id = %L and status = ''failed'' and template like ''timing_%%''))::text', t.id('A'), t.id('S18N'))) not like 'ERR%');
select t.is('relance : l''e-mail redevient « en attente », une seule fois', (select count(*)::text from public.notification_outbox where service_id = t.id('S18N') and status = 'pending'), '1');

-- (10) Lieux et recommandations avant l'ouverture : zone dense, lieu sur le logement, sans coordonnées, rurale, sans position
insert into public.property_places (id, organization_id, property_id, source, category, name, latitude, longitude, address) values
  (t.id('PL18H'), t.id('A'), t.id('P18'), 'manager', 'activities', 'Musée au pied de l''immeuble', 48.8531, 2.3500, '1 place Fictive, Paris'),
  (t.id('PL18F'), t.id('A'), t.id('P18'), 'owner', 'food', 'Bistrot du propriétaire', 48.8640, 2.3499, '20 rue Fictive, Paris'),
  (t.id('PL18U'), t.id('A'), t.id('P18'), 'manager', 'food', 'Boulangerie (sans coordonnées)', null, null, '3 rue Fictive, Paris');
insert into public.stay_guest_items (organization_id, reservation_id, kind, place_id, title, published_at) values
  (t.id('A'), t.id('R18'), 'recommendation', t.id('PL18H'), 'Le musée en bas', now()),
  (t.id('A'), t.id('R18'), 'recommendation', t.id('PL18F'), 'Le bistrot', now());
select t.is('dense : lieu sur le logement retenu, lieu sans coordonnées listé sans adresse, lieu à 1,2 km avec adresse et tranche',
  t.q(null, format('select (public.guest_places(%L) ->> ''near_hidden'') || ''|'' || (select string_agg((e ->> ''name'') || '':'' || coalesce(e ->> ''address'', ''-'') || '':'' || coalesce(e ->> ''distance_band'', ''-''), '','' order by e ->> ''name'') from jsonb_array_elements(public.guest_places(%L) -> ''places'') e)', (select v from t_tok where k = 'g18'), (select v from t_tok where k = 'g18'))),
  '1|Bistrot du propriétaire:20 rue Fictive, Paris:2,Boulangerie (sans coordonnées):-:-');
select t.is('recommandations publiées avant ouverture : ni coordonnées, ni adresse du lieu au pied du logement',
  (select string_agg(coalesce(e #>> '{place,address}', '-') || ':' || coalesce(e #>> '{place,lat}', '-'), ',' order by e ->> 'title') from jsonb_array_elements(public.get_guest_stay((select v from t_tok where k = 'g18')) -> 'prepared') e),
  '20 rue Fictive, Paris:-,-:-');
select t.check('avant ouverture : les coordonnées du logement n''apparaissent dans aucune donnée transmise', '',
  position('48.853' in public.guest_places((select v from t_tok where k = 'g18'))::text) = 0 and position('2.349' in public.guest_places((select v from t_tok where k = 'g18'))::text) = 0
  and position('48.853' in public.get_guest_stay((select v from t_tok where k = 'g18'))::text) = 0 and position('2.35' in public.get_guest_stay((select v from t_tok where k = 'g18'))::text) = 0);
-- Zone rurale : lieu à 2,5 km (tranche 3), lieu à 5 km exclu
insert into public.properties (id, organization_id, name, latitude, longitude) values (t.id('P18R'), t.id('A'), 'Ferme 18', 45.9000, 6.1000);
insert into public.guest_guides (organization_id, property_id, enabled) values (t.id('A'), t.id('P18R'), true);
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R18R'), t.id('A'), t.id('P18R'), 'Rural 18', '2028-04-10 15:00+00', '2028-04-12 09:00+00');
insert into public.property_places (id, organization_id, property_id, source, category, name, latitude, longitude, address) values
  (t.id('PL18R1'), t.id('A'), t.id('P18R'), 'manager', 'food', 'Auberge à 2,5 km', 45.9225, 6.1000, 'Le Bourg'),
  (t.id('PL18R2'), t.id('A'), t.id('P18R'), 'manager', 'food', 'Ville à 5 km', 45.9450, 6.1000, 'Centre');
insert into t_tok values ('g18r', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R18R'))));
select t.is('rural : seul le lieu à 2,5 km (tranche 3), sans coordonnées', t.q(null, format('select string_agg((e ->> ''name'') || '':'' || (e ->> ''distance_band'') || '':'' || coalesce(e ->> ''lat'', ''-''), '','') from jsonb_array_elements(public.guest_places(%L) -> ''places'') e', (select v from t_tok where k = 'g18r'))), 'Auberge à 2,5 km:3:-');
-- Logement sans coordonnées : lieux listés sans adresse ni distance
insert into public.properties (id, organization_id, name) values (t.id('P18X'), t.id('A'), 'Sans position 18');
insert into public.guest_guides (organization_id, property_id, enabled) values (t.id('A'), t.id('P18X'), true);
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R18X'), t.id('A'), t.id('P18X'), 'Sans position', '2028-05-10 15:00+00', '2028-05-12 09:00+00');
insert into public.property_places (id, organization_id, property_id, source, category, name, latitude, longitude, address) values (t.id('PL18X'), t.id('A'), t.id('P18X'), 'manager', 'food', 'Café', 45.0, 5.0, '9 rue Fictive');
insert into t_tok values ('g18x', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R18X'))));
select t.is('logement sans coordonnées : lieu listé sans adresse ni distance', t.q(null, format('select (e ->> ''name'') || '':'' || coalesce(e ->> ''address'', ''-'') || '':'' || coalesce(e ->> ''distance_band'', ''-'') from jsonb_array_elements(public.guest_places(%L) -> ''places'') e', (select v from t_tok where k = 'g18x'))), 'Café:-:-');

-- (11) Liens voyageur : ouverture suit l'horaire, remplacement, révocation, séjour annulé
select t.is('ouverture des informations pratiques : 72 h avant l''arrivée applicable (13 h 30)', (select to_char(valid_from at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.guest_links where reservation_id = t.id('R18') and revoked_at is null), '2028-01-07 13:30');
insert into t_tok values ('g18b', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R18'))));
select t.is('nouveau lien : l''ancien devient indisponible, le nouveau fonctionne', t.q(null, format('select (public.get_guest_stay(%L) ->> ''status'') || ''/'' || (public.get_guest_stay(%L) ->> ''status'') || ''/'' || (public.guest_places(%L) ->> ''status'')', (select v from t_tok where k = 'g18'), (select v from t_tok where k = 'g18b'), (select v from t_tok where k = 'g18'))), 'unavailable/prep/unavailable');
update public.guest_links set revoked_at = now(), revoke_reason = 'manual' where reservation_id = t.id('R18') and revoked_at is null;
select t.is('lien révoqué : indisponible (séjour et lieux)', t.q(null, format('select (public.get_guest_stay(%L) ->> ''status'') || ''/'' || (public.guest_places(%L) ->> ''status'')', (select v from t_tok where k = 'g18b'), (select v from t_tok where k = 'g18b'))), 'unavailable/unavailable');
update public.reservations set status = 'cancelled' where id = t.id('R18R');
select t.is('séjour annulé : lien indisponible', t.q(null, format('select public.get_guest_stay(%L) ->> ''status''', (select v from t_tok where k = 'g18r'))), 'unavailable');
-- Pendant le séjour : adresses, coordonnées et distances exactes visibles
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R18Z'), t.id('A'), t.id('P18X'), 'En cours 18', now() - interval '1 day', now() + interval '1 day');
insert into t_tok values ('g18z', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R18Z'))));
select t.is('après ouverture : adresse et coordonnées du lieu visibles', t.q(null, format('select (public.guest_places(%L) #>> ''{places,0,address}'') || ''/'' || (public.guest_places(%L) #>> ''{places,0,lat}'')', (select v from t_tok where k = 'g18z'), (select v from t_tok where k = 'g18z'))), '9 rue Fictive/45');
update public.reservations set check_out_at = now() - interval '1 hour', check_in_at = now() - interval '2 days' where id = t.id('R18Z');
select t.is('séjour terminé (lien expiré) : indisponible', t.q(null, format('select public.get_guest_stay(%L) ->> ''status''', (select v from t_tok where k = 'g18z'))), 'unavailable');


-- =====================================================================
-- 19. Règles de mission : démarrage anticipé, exigences de fin, correction, linge, rétablissement d'horaire (migration 19)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['P19', 'R19', 'T19C', 'T19L', 'T19O', 'T19K', 'CR19', 'CI19a', 'CI19b', 'R19T', 'SV19', 'R19B']) k;
insert into public.properties (id, organization_id, name, timezone) values (t.id('P19'), t.id('A'), 'Logement 19', 'Europe/Paris');
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values
  (t.id('R19'), t.id('A'), t.id('P19'), 'QA 19', now() + interval '3 days', now() + interval '5 days');
insert into public.checklist_rooms (id, organization_id, property_id, name) values (t.id('CR19'), t.id('A'), t.id('P19'), 'Séjour');
insert into public.checklist_items (id, organization_id, room_id, label) values (t.id('CI19a'), t.id('A'), t.id('CR19'), 'Sol'), (t.id('CI19b'), t.id('A'), t.id('CR19'), 'Vitres');
-- Ménage (règle ferme), livraison de linge (conseillée), autre mission (fenêtre déjà ouverte), contrôle (checklist)
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, next_reservation_id, window_start, window_end, duration_min) values
  (t.id('T19C'), t.id('A'), t.id('P19'), 'turnover', 'assigned', t.id('a_agent'), t.id('R19'), now() + interval '1 day', now() + interval '3 days', 90),
  (t.id('T19L'), t.id('A'), t.id('P19'), 'linen_delivery', 'assigned', t.id('a_agent'), t.id('R19'), now() + interval '1 day', now() + interval '3 days', 20),
  (t.id('T19O'), t.id('A'), t.id('P19'), 'other', 'assigned', t.id('a_agent'), null, now() - interval '1 hour', now() + interval '1 day', 30),
  (t.id('T19K'), t.id('A'), t.id('P19'), 'inspection', 'assigned', t.id('a_agent'), t.id('R19'), now() - interval '1 hour', now() + interval '2 days', 30);

-- (1) Démarrage : règle appliquée par la base, quel que soit le bouton
select t.is('règle par défaut : ménage ferme, linge conseillé', t.q('a_agent', format('select (public.task_rule(%L, ''turnover'') ->> ''start_rule'') || ''/'' || (public.task_rule(%L, ''linen_delivery'') ->> ''start_rule'')', t.id('A'), t.id('A'))), 'firm/recommended');
select t.check('ménage avant la plage : refusé avec l''heure à partir de laquelle démarrer', '', t.keep('a_agent', format('select public.start_task(%L, %L, ''19000000-0000-0000-0000-000000000001'')', t.id('A'), t.id('T19C'))) like 'too_early:%');
select t.is('ménage refusé : mission toujours « attribuée », geste non enregistré (rejouable à l''heure)', (select status::text from public.tasks where id = t.id('T19C')) || '/' || (select count(*)::text from public.task_actions where id = '19000000-0000-0000-0000-000000000001'), 'assigned/0');
select t.check('ménage : même refus même en confirmant le démarrage anticipé (contrainte ferme)', '', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid(), null, true)', t.id('A'), t.id('T19C'))) like 'too_early:%');
select t.err('dérogation : un agent ne peut pas l''accorder', t.q('a_agent', format('select public.allow_early_start(%L, %L, ''je suis là'')', t.id('A'), t.id('T19C'))), '42501');
select t.err('dérogation : motif obligatoire', t.q('a_manager', format('select public.allow_early_start(%L, %L, ''  '')', t.id('A'), t.id('T19C'))), '22023');
select t.err('dérogation : autre organisation refusée', t.q('b_manager', format('select public.allow_early_start(%L, %L, ''x'')', t.id('A'), t.id('T19C'))), '42501');
select t.is('dérogation : accordée par le responsable avec motif', t.keep('a_manager', format('select public.allow_early_start(%L, %L, ''Voyageur précédent parti plus tôt (fictif)'')', t.id('A'), t.id('T19C'))), 'applied');
select t.is('dérogation : tracée dans l''historique avec le motif', (select note from public.task_events where task_id = t.id('T19C') and kind = 'early_start_allowed'), 'Voyageur précédent parti plus tôt (fictif)');
select t.is('dérogation : l''agent peut démarrer', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19C'))), 'applied');
select t.check('linge avant l''heure conseillée : confirmation demandée', '', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19L'))) like 'early_confirm:%');
select t.is('linge : démarrage anticipé confirmé', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid(), null, true)', t.id('A'), t.id('T19L'))), 'applied');
select t.is('linge : tracé « démarrée en avance »', (select count(*)::text from public.task_events where task_id = t.id('T19L') and kind = 'started_early'), '1');
select t.is('plage déjà ouverte : démarrage direct', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19O'))), 'applied');
select t.err('démarrage : autre agent refusé', t.q('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19K'))), '42501');
select t.err('démarrage : autre organisation refusée', t.q('b_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19K'))), '42501');
-- Règle de l'organisation : linge rendu ferme
select t.deny('règles : un agent ne les modifie pas', t.dml('a_agent', format('insert into public.task_type_rules (organization_id, type, start_rule) values (%L, ''maintenance'', ''firm'')', t.id('A'))));
select t.is('règles : le responsable les modifie', t.dml('a_manager', format('insert into public.task_type_rules (organization_id, type, start_rule, checklist_required, comment_required) values (%L, ''inspection'', ''recommended'', true, true)', t.id('A'))), '1');
insert into public.task_type_rules (organization_id, type, start_rule, checklist_required, comment_required) values (t.id('A'), 'inspection', 'recommended', true, true);
select t.is('règles : invisibles pour une autre organisation', t.q('b_manager', format('select count(*) from public.task_type_rules where organization_id = %L', t.id('A'))), '0');

-- (2) Fin : exigences appliquées par la base
select t.is('fin sans exigence (autre mission) : acceptée', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19O'))), 'applied');
select t.is('contrôle : démarré', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19K'))), 'applied');
select t.is('checklist et commentaire obligatoires manquants : fin refusée, liste précise', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19K'))), 'missing:checklist,comment');
select t.is('fin refusée : la mission reste en cours', (select status::text from public.tasks where id = t.id('T19K')), 'in_progress');
insert into public.task_reports (organization_id, task_id, checked) values (t.id('A'), t.id('T19K'), jsonb_build_array(t.id('CI19a')::text));
select t.is('exigences (agent) : 1 case sur 2, commentaire absent', t.q('a_agent', format('select (public.task_requirements(%L, %L) #>> ''{checklist,done}'') || ''/'' || (public.task_requirements(%L, %L) #>> ''{checklist,total}'') || ''/'' || (public.task_requirements(%L, %L) ->> ''missing'')', t.id('A'), t.id('T19K'), t.id('A'), t.id('T19K'), t.id('A'), t.id('T19K'))), '1/2/["checklist", "comment"]');
select t.err('exigences : invisibles pour un autre agent', t.q('a_agent2', format('select public.task_requirements(%L, %L)', t.id('A'), t.id('T19K'))), '42501');
select t.is('commentaire enregistré par l''agent', t.keep('a_agent', format('select public.set_task_comment(%L, %L, ''RAS, fictif'')', t.id('A'), t.id('T19K'))), 'applied');
select t.is('commentaire : la saisie précédente (case cochée) est conservée', (select checked::text from public.task_reports where task_id = t.id('T19K')), jsonb_build_array(t.id('CI19a')::text)::text);
select t.is('checklist encore incomplète : refus', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19K'))), 'missing:checklist');
update public.task_reports set checked = jsonb_build_array(t.id('CI19a')::text, t.id('CI19b')::text) where task_id = t.id('T19K');
select t.is('toutes les exigences remplies : fin acceptée', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19K'))), 'applied');
select t.err('commentaire : impossible sur la mission d''un autre', t.q('a_agent2', format('select public.set_task_comment(%L, %L, ''x'')', t.id('A'), t.id('T19K'))), '42501');

-- (3) Boucle de correction : renvoi tracé, agent prévenu de la validation finale
update public.organizations set validation_task_types = array['linen_delivery']::public.task_type[] where id = t.id('A');
select t.is('linge terminé', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19L'))), 'applied');
select t.is('linge : à valider (pas « prêt »)', (select status::text from public.tasks where id = t.id('T19L')), 'done');
select t.is('correction demandée avec motif', t.keep('a_manager', format('select public.request_correction(%L, %L, ''Il manque un jeu de serviettes (fictif)'')', t.id('A'), t.id('T19L'))), 'applied');
select t.is('agent : voit le statut et le motif', t.q('a_agent', format('select status || ''/'' || correction_reason from public.tasks where id = %L', t.id('T19L'))), 'to_redo/Il manque un jeu de serviettes (fictif)');
select t.is('reprise : jamais bloquée par la plage', t.keep('a_agent', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19L'))), 'applied');
select t.is('correction renvoyée', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T19L'))), 'applied');
select t.is('correction renvoyée : motif conservé pour le responsable', (select status::text || '/' || correction_reason from public.tasks where id = t.id('T19L')), 'done/Il manque un jeu de serviettes (fictif)');
select t.is('historique : « correction renvoyée », lisible par l''agent', t.q('a_agent', format('select string_agg(kind, '','' order by id) from public.task_events where task_id = %L and kind in (''started_early'', ''submitted'', ''correction_requested'', ''resubmitted'')', t.id('T19L'))), 'started_early,submitted,correction_requested,resubmitted');
select t.is('validation finale', t.keep('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('T19L'))), 'applied');
select t.is('double validation : sans effet', t.keep('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('T19L'))), 'already');
select t.is('agent prévenu de la validation (une seule fois)', (select count(*)::text from public.notification_outbox where organization_id = t.id('A') and template = 'agent_task_validated' and payload ->> 'path' = '/app/missions/' || t.id('T19L')), '1');

-- (4) Livraison de linge préparée : une seule mission, même en relançant
select t.err('linge : un agent ne planifie pas', t.q('a_agent', format('select public.plan_linen_delivery(%L, %L, now(), now() + interval ''1 day'', 20)', t.id('A'), t.id('R19'))), '42501');
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R19B'), t.id('A'), t.id('P19'), 'QA 19 B', now() + interval '10 days', now() + interval '12 days');
select t.err('linge : échéance après l''arrivée refusée', t.q('a_manager', format('select public.plan_linen_delivery(%L, %L, now(), now() + interval ''11 days'', 20)', t.id('A'), t.id('R19B'))), '22023');
select t.is('linge : créée', t.keep('a_manager', format('select public.plan_linen_delivery(%L, %L, now() + interval ''9 days'', now() + interval ''9 days 12 hours'', 20, %L) ->> ''status''', t.id('A'), t.id('R19B'), t.id('a_agent'))), 'created');
select t.is('linge : relancer ne crée pas de doublon', t.keep('a_manager', format('select public.plan_linen_delivery(%L, %L, now() + interval ''9 days'', now() + interval ''9 days 12 hours'', 20) ->> ''status''', t.id('A'), t.id('R19B'))), 'exists');
select t.is('linge : une seule mission, attribuée', (select count(*)::text || '/' || min(status::text) from public.tasks where next_reservation_id = t.id('R19B') and type = 'linen_delivery'), '1/assigned');
select t.err('linge : autre organisation refusée', t.q('b_manager', format('select public.plan_linen_delivery(%L, %L, now(), now() + interval ''1 day'', 20)', t.id('A'), t.id('R19B'))), '42501');

-- (5) Rétablissement d'horaire : refusé sans décision explicite une fois l'heure passée
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values (t.id('R19T'), t.id('A'), t.id('P19'), 'QA 19 T', now() + interval '2 hours', now() + interval '3 days');
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source) values (t.id('SV19'), t.id('A'), t.id('P19'), t.id('R19T'), 'early_checkin', now() - interval '30 minutes', 'requested', 'guest');
select t.is('arrivée anticipée déjà passée : confirmée', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'', true) ->> ''status''', t.id('A'), t.id('SV19'))), 'applied');
select t.is('annulation après l''heure : rétablissement non garanti, décision demandée', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''cancel'') ->> ''status''', t.id('A'), t.id('SV19'))), 'restore_unsafe');
select t.is('annulation confirmée : confirmation retirée sans rétablir', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''cancel'', true) ->> ''restored''', t.id('A'), t.id('SV19'))), 'false');
select t.is('annulation confirmée : demande annulée, séjour non modifié', (select status from public.service_requests where id = t.id('SV19')) || '/' || ((select check_in_at from public.reservations where id = t.id('R19T')) < now())::text, 'cancelled/true');

-- (6) Liens voyageur : deux séjours, deux liens indépendants
insert into public.guest_guides (organization_id, property_id, enabled) values (t.id('A'), t.id('P19'), true);
insert into t_tok values ('g19a', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R19'))));
insert into t_tok values ('g19b', t.keep('a_manager', format('select public.create_guest_link(%L, %L)', t.id('A'), t.id('R19B'))));
select t.is('deux liens : chacun ne voit que son séjour', t.q(null, format('select (public.get_guest_stay(%L) #>> ''{stay,guest_name}'') || ''/'' || (public.get_guest_stay(%L) #>> ''{stay,guest_name}'')', (select v from t_tok where k = 'g19a'), (select v from t_tok where k = 'g19b'))), 'QA 19/QA 19 B');
update public.guest_links set revoked_at = now(), revoke_reason = 'manual' where reservation_id = t.id('R19') and revoked_at is null;
select t.is('révocation du lien A : le lien B reste valable', t.q(null, format('select (public.get_guest_stay(%L) ->> ''status'') || ''/'' || (public.get_guest_stay(%L) ->> ''status'')', (select v from t_tok where k = 'g19a'), (select v from t_tok where k = 'g19b'))), 'unavailable/prep');
select t.is('lien voyageur : jamais d''accès direct aux tables', t.q(null, 'select count(*) from public.tasks'), 'ERR:42501:permission denied for table tasks');


-- =====================================================================
-- 20. Origine des plages (une source de vérité), recalcul qui épargne les plages manuelles, photos par point (migration 20)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['P20', 'R20A', 'R20B', 'T20A', 'T20M', 'CR20', 'I20a', 'I20b', 'T20P', 'SV20']) k;
insert into public.properties (id, organization_id, name, timezone) values (t.id('P20'), t.id('A'), 'Logement 20', 'Europe/Paris');
insert into public.reservations (id, organization_id, property_id, guest_name, check_in_at, check_out_at) values
  (t.id('R20A'), t.id('A'), t.id('P20'), 'QA 20 A', '2028-11-20 15:00+00', '2028-11-22 09:00+00'),
  (t.id('R20B'), t.id('A'), t.id('P20'), 'QA 20 B', '2028-12-10 15:00+00', '2028-12-12 09:00+00');
insert into public.tasks (id, organization_id, property_id, type, status, reservation_id, next_reservation_id, is_auto_generated, window_start, window_end, duration_min) values
  (t.id('T20A'), t.id('A'), t.id('P20'), 'turnover', 'unassigned', t.id('R20A'), t.id('R20B'), true, '2028-11-22 09:00+00', '2028-12-10 15:00+00', 90),
  (t.id('T20M'), t.id('A'), t.id('P20'), 'other', 'unassigned', null, t.id('R20B'), false, '2028-12-10 13:00+00', '2028-12-10 17:00+00', 30);
select t.is('création : origine enregistrée (automatique / manuelle)', (select string_agg(note, ',' order by note) from public.task_events where task_id in (t.id('T20A'), t.id('T20M')) and kind = 'created'), 'auto,manual');
-- Recalcul automatique (séjour suivant avancé) : mission automatique mise à jour, origine « sync », sans auteur
select t.is('recalcul : mission automatique mise à jour', t.keep('a_manager', format('select public.apply_task_sync(%L, %L, ''{"window_end": "2028-12-09T15:00:00Z"}'')', t.id('A'), t.id('T20A'))), 'applied');
select t.is('recalcul : historique « recalcul automatique », sans auteur', (select (note::jsonb ->> 'origin') || '/' || coalesce(actor_id::text, 'aucun') from public.task_events where task_id = t.id('T20A') and kind = 'window_changed' order by id desc limit 1), 'sync/aucun');
select t.is('recalcul : la mission reste automatique', (select is_auto_generated::text from public.tasks where id = t.id('T20A')), 'true');
-- Plage manuelle : jamais modifiée par le recalcul, même par appel direct
select t.is('recalcul : plage manuelle conservée', t.keep('a_manager', format('select public.apply_task_sync(%L, %L, ''{"window_end": "2028-12-09T15:00:00Z"}'')', t.id('A'), t.id('T20M'))) || '/' || (select to_char(window_end at time zone 'UTC', 'MM-DD HH24:MI') from public.tasks where id = t.id('T20M')), 'manual_kept/12-10 17:00');
select t.err('recalcul : un agent ne peut pas l''appeler', t.q('a_agent', format('select public.apply_task_sync(%L, %L, ''{}'')', t.id('A'), t.id('T20A'))), '42501');
select t.err('recalcul : une autre organisation non plus', t.q('b_manager', format('select public.apply_task_sync(%L, %L, ''{}'')', t.id('A'), t.id('T20A'))), '42501');
-- Modification par un responsable : la mission devient manuelle, origine « manual », avec auteur et motif
select t.is('modification manuelle : appliquée', t.keep('a_manager', format('select public.set_task_window(%L, %L, ''2028-11-23 09:00+00'', ''2028-12-09 12:00+00'', 90, ''Clés disponibles le 23 (fictif)'')', t.id('A'), t.id('T20A'))), 'applied');
select t.is('modification manuelle : mission manuelle, historique avec origine et motif', (select is_auto_generated::text from public.tasks where id = t.id('T20A')) || '/' || (select (note::jsonb ->> 'origin') || '/' || (note::jsonb ->> 'reason') || '/' || (actor_id = t.id('a_manager'))::text from public.task_events where task_id = t.id('T20A') and kind = 'window_changed' order by id desc limit 1), 'false/manual/Clés disponibles le 23 (fictif)/true');
select t.is('après modification manuelle : le recalcul ne la touche plus', t.keep('a_manager', format('select public.apply_task_sync(%L, %L, ''{"window_end": "2028-12-01T15:00:00Z"}'')', t.id('A'), t.id('T20A'))), 'manual_kept');
-- Décision d'horaire voyageur : origine « timing »
insert into public.tasks (id, organization_id, property_id, type, status, next_reservation_id, is_auto_generated, window_start, window_end, duration_min) values
  (t.id('T20P'), t.id('A'), t.id('P20'), 'turnover', 'unassigned', t.id('R20B'), true, '2028-12-08 09:00+00', '2028-12-10 15:00+00', 90);
insert into public.service_requests (id, organization_id, property_id, reservation_id, kind, start_at, status, source) values (t.id('SV20'), t.id('A'), t.id('P20'), t.id('R20B'), 'early_checkin', '2028-12-10 13:00+00', 'requested', 'guest');
select t.is('décision d''horaire : appliquée', t.keep('a_manager', format('select public.timing_decide(%L, %L, ''confirm'', true) ->> ''status''', t.id('A'), t.id('SV20'))), 'applied');
select t.is('décision d''horaire : historique « ajustée par une décision d''horaire »', (select note::jsonb ->> 'origin' from public.task_events where task_id = t.id('T20P') and kind = 'window_changed' order by id desc limit 1), 'timing');

-- Photos obligatoires : chaque point exige SA photo ; photo générale, mauvais point ou envoi échoué ne comptent pas
insert into t.ids select k, gen_random_uuid() from unnest(array['T20F', 'F20a', 'F20g', 'F20x', 'F20b']) k;
insert into public.checklist_rooms (id, organization_id, property_id, name) values (t.id('CR20'), t.id('A'), t.id('P20'), 'Salle d''eau');
insert into public.checklist_items (id, organization_id, room_id, label, photo_required) values (t.id('I20a'), t.id('A'), t.id('CR20'), 'Douche', true), (t.id('I20b'), t.id('A'), t.id('CR20'), 'Lavabo', true);
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, is_auto_generated, window_start, window_end, duration_min, started_at) values
  (t.id('T20F'), t.id('A'), t.id('P20'), 'turnover', 'in_progress', t.id('a_agent'), false, now() - interval '2 hours', now() + interval '2 hours', 60, now() - interval '1 hour');
select t.is('photos : 2 exigées, aucune → refus', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T20F'))), 'missing:photos');
insert into public.files (id, organization_id, kind, task_id, property_id, checklist_item_id, path, mime, size_bytes, created_by) values
  (t.id('F20a'), t.id('A'), 'task_photo', t.id('T20F'), t.id('P20'), t.id('I20a'), t.id('A') || '/task/' || t.id('T20F') || '/a.jpg', 'image/jpeg', 10, t.id('a_agent')),
  (t.id('F20g'), t.id('A'), 'task_photo', t.id('T20F'), t.id('P20'), null, t.id('A') || '/task/' || t.id('T20F') || '/g.jpg', 'image/jpeg', 10, t.id('a_agent')),
  -- Envoi échoué : métadonnée créée, fichier jamais déposé
  (t.id('F20x'), t.id('A'), 'task_photo', t.id('T20F'), t.id('P20'), t.id('I20b'), t.id('A') || '/task/' || t.id('T20F') || '/x.jpg', 'image/jpeg', 10, t.id('a_agent'));
insert into storage.objects (bucket_id, name, owner) values ('org-files', t.id('A') || '/task/' || t.id('T20F') || '/a.jpg', t.id('a_agent')), ('org-files', t.id('A') || '/task/' || t.id('T20F') || '/g.jpg', t.id('a_agent'));
select t.is('photos : la photo du point « Douche » et une photo générale ne couvrent pas « Lavabo » ; l''envoi échoué ne compte pas', t.q('a_agent', format('select public.missing_required_photos(%L, %L)', t.id('A'), t.id('T20F'))), '1');
select t.is('photos : fin toujours refusée, mission en cours', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T20F'))), 'missing:photos');
insert into public.files (id, organization_id, kind, task_id, property_id, checklist_item_id, path, mime, size_bytes, created_by) values
  (t.id('F20b'), t.id('A'), 'task_photo', t.id('T20F'), t.id('P20'), t.id('I20b'), t.id('A') || '/task/' || t.id('T20F') || '/b.jpg', 'image/jpeg', 10, t.id('a_agent'));
insert into storage.objects (bucket_id, name, owner) values ('org-files', t.id('A') || '/task/' || t.id('T20F') || '/b.jpg', t.id('a_agent'));
select t.is('photos : toutes présentes → fin acceptée', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('T20F'))), 'applied');
select t.is('photos : le responsable voit les preuves', t.q('a_manager', format('select count(*) from public.files where task_id = %L', t.id('T20F'))), '4');
select t.deny('photos : un autre agent ne les voit pas', t.q('a_agent2', format('select count(*) from public.files where task_id = %L', t.id('T20F'))));
select t.deny('photos : une autre organisation ne les voit pas', t.q('b_manager', format('select count(*) from public.files where task_id = %L', t.id('T20F'))));
select t.deny('photos : objets de stockage invisibles pour une autre organisation', t.q('b_manager', format('select count(*) from storage.objects where name like %L', t.id('A') || '/task/' || t.id('T20F') || '/%')));
select t.err('validation : un agent ne valide pas sa propre mission', t.q('a_agent', format('select public.validate_task(%L, %L)', t.id('A'), t.id('T20F'))), '42501');


-- =====================================================================
-- 21. Mission trop longue, heure de fin proposée, incident laissé ouvert
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['T21', 'I21']) k;
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, is_auto_generated, window_start, window_end, duration_min, started_at) values
  (t.id('T21'), t.id('A'), t.id('P20'), 'maintenance', 'in_progress', t.id('a_agent'), false, now() - interval '4 hours', now() + interval '4 hours', 60, now() - interval '2 hours');
select t.is('dépassement : un autre agent ne répond pas à la place (rappel périmé, rien d''enregistré)', t.keep('a_agent2', format('select public.task_overrun_continue(%L, %L)', t.id('A'), t.id('T21'))), 'stale');
select t.is('dépassement : rien n''a été enregistré pour l''autre agent', (select count(*)::text from public.task_events where task_id = t.id('T21') and kind = 'overrun_continue'), '0');
select t.err('dépassement : une autre organisation non plus', t.q('b_manager', format('select public.task_overrun_continue(%L, %L)', t.id('A'), t.id('T21'))), '42501');
select t.is('dépassement : « Oui, je continue » enregistré', t.keep('a_agent', format('select public.task_overrun_continue(%L, %L)', t.id('A'), t.id('T21'))), 'applied');
select t.is('dépassement : double appui sans doublon', t.keep('a_agent', format('select public.task_overrun_continue(%L, %L)', t.id('A'), t.id('T21'))), 'already');
select t.is('dépassement : une seule trace, auteur = agent ; mission toujours en cours (le temps n''est pas arrêté)', (select count(*)::text || '/' || bool_and(actor_id = t.id('a_agent'))::text from public.task_events where task_id = t.id('T21') and kind = 'overrun_continue') || '/' || (select status::text || '/' || (completed_at is null)::text from public.tasks where id = t.id('T21')), '1/true/in_progress/true');
select t.err('heure de fin : avant le démarrage → refusée', t.q('a_agent', format('select public.propose_task_end(%L, %L, now() - interval ''3 hours'', null)', t.id('A'), t.id('T21'))), '22023');
select t.err('heure de fin : dans le futur → refusée', t.q('a_agent', format('select public.propose_task_end(%L, %L, now() + interval ''1 hour'', null)', t.id('A'), t.id('T21'))), '22023');
select t.is('heure de fin : un autre agent ne peut pas la proposer (périmé, rien d''enregistré)', t.keep('a_agent2', format('select public.propose_task_end(%L, %L, now() - interval ''1 hour'', null)', t.id('A'), t.id('T21'))), 'stale');
select t.is('heure de fin : proposée par l''agent affecté', t.keep('a_agent', format('select public.propose_task_end(%L, %L, now() - interval ''50 minutes'', ''Oubli de terminer (fictif)'')', t.id('A'), t.id('T21'))), 'applied');
select t.is('heure de fin : en attente, statut et fin réelle inchangés', (select end_proposal_status || '/' || status::text || '/' || (reported_end_at is null)::text from public.tasks where id = t.id('T21')), 'pending/in_progress/true');
select t.err('heure de fin : l''agent ne valide pas sa propre proposition', t.q('a_agent', format('select public.decide_task_end(%L, %L, true)', t.id('A'), t.id('T21'))), '42501');
select t.err('heure de fin : une autre organisation ne décide pas', t.q('b_manager', format('select public.decide_task_end(%L, %L, true)', t.id('A'), t.id('T21'))), '42501');
select t.is('heure de fin : acceptée par un responsable', t.keep('a_manager', format('select public.decide_task_end(%L, %L, true)', t.id('A'), t.id('T21'))), 'applied');
select t.is('heure de fin : retenue = proposée, historique complet', (select (reported_end_at = end_proposed_at)::text || '/' || end_proposal_status from public.tasks where id = t.id('T21')) || '/' || (select string_agg(kind, ',' order by id) from public.task_events where task_id = t.id('T21') and kind like 'end_%'), 'true/accepted/end_proposed,end_accepted');
select t.is('heure de fin : seconde décision sans effet', t.keep('a_manager', format('select public.decide_task_end(%L, %L, false)', t.id('A'), t.id('T21'))), 'stale');
select t.deny('dépassement : un autre agent ne voit pas la mission', t.q('a_agent2', format('select count(*) from public.tasks where id = %L', t.id('T21'))));
select t.err('délai d''alerte : réservé aux responsables', t.q('a_agent', format('select public.set_overrun_alert(%L, 45)', t.id('A'))), '42501');
select t.err('délai d''alerte : valeur hors bornes refusée', t.q('a_manager', format('select public.set_overrun_alert(%L, -5)', t.id('A'))), '22023');
select t.keep('a_manager', format('select public.set_overrun_alert(%L, 45)', t.id('A')));
select t.is('délai d''alerte : enregistré', (select overrun_alert_min::text from public.organizations where id = t.id('A')), '45');
insert into public.incidents (id, organization_id, property_id, source, category, description, status) values (t.id('I21'), t.id('A'), t.id('P20'), 'agent', 'leak', 'Fuite sous l''évier (fictif)', 'in_progress');
select t.err('incident laissé ouvert : un agent ne décide pas', t.q('a_agent', format('select public.keep_incident_open(%L, %L)', t.id('A'), t.id('I21'))), '42501');
select t.err('incident laissé ouvert : une autre organisation non plus', t.q('b_manager', format('select public.keep_incident_open(%L, %L)', t.id('A'), t.id('I21'))), '42501');
select t.is('incident laissé ouvert : décision enregistrée', t.keep('a_manager', format('select public.keep_incident_open(%L, %L)', t.id('A'), t.id('I21'))), 'applied');
select t.is('incident laissé ouvert : toujours ouvert, décision datée', (select status || '/' || (kept_open_at is not null)::text || '/' || (kept_open_by = t.id('a_manager'))::text from public.incidents where id = t.id('I21')), 'in_progress/true/true');
select t.err('incident : aucune écriture directe de la décision', t.dml('a_manager', format('update public.incidents set kept_open_at = null where id = %L', t.id('I21'))), '42501');

-- =====================================================================
-- 23. Mission oubliée : régularisation par un responsable, annulation d'une mission commencée (migration 23)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['T23', 'T23C', 'T23U', 'T23D']) k;
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, is_auto_generated, window_start, window_end, duration_min, started_at) values
  (t.id('T23'), t.id('A'), t.id('P20'), 'turnover', 'in_progress', t.id('a_agent'), false, now() - interval '6 hours', now() + interval '2 hours', 60, now() - interval '5 hours'),
  (t.id('T23C'), t.id('A'), t.id('P20'), 'maintenance', 'in_progress', t.id('a_agent'), false, now() - interval '6 hours', now() + interval '2 hours', 60, now() - interval '4 hours');
insert into public.tasks (id, organization_id, property_id, type, status, is_auto_generated, window_start, window_end, duration_min) values
  (t.id('T23U'), t.id('A'), t.id('P20'), 'maintenance', 'unassigned', false, now() + interval '1 day', now() + interval '2 days', 60);
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, is_auto_generated, window_start, window_end, duration_min, started_at, completed_at) values
  (t.id('T23D'), t.id('A'), t.id('P20'), 'maintenance', 'done', t.id('a_agent'), false, now() - interval '6 hours', now() + interval '2 hours', 60, now() - interval '4 hours', now() - interval '3 hours');
select t.keep('a_agent', format('select public.propose_task_end(%L, %L, now() - interval ''4 hours'', ''Oubli (fictif)'')', t.id('A'), t.id('T23')));
select t.err('régularisation : l''agent ne régularise pas', t.q('a_agent', format('select public.regularize_task_end(%L, %L, now() - interval ''4 hours'', ''motif'')', t.id('A'), t.id('T23'))), '42501');
select t.err('régularisation : une autre organisation non plus', t.q('b_manager', format('select public.regularize_task_end(%L, %L, now() - interval ''4 hours'', ''motif'')', t.id('A'), t.id('T23'))), '42501');
select t.err('régularisation : motif obligatoire', t.q('a_manager', format('select public.regularize_task_end(%L, %L, now() - interval ''4 hours'', ''  '')', t.id('A'), t.id('T23'))), '22023');
select t.err('régularisation : heure avant le démarrage refusée', t.q('a_manager', format('select public.regularize_task_end(%L, %L, now() - interval ''6 hours'', ''motif'')', t.id('A'), t.id('T23'))), '22023');
select t.err('régularisation : heure future refusée', t.q('a_manager', format('select public.regularize_task_end(%L, %L, now() + interval ''1 hour'', ''motif'')', t.id('A'), t.id('T23'))), '22023');
select t.is('régularisation : appliquée', t.keep('a_manager', format('select public.regularize_task_end(%L, %L, now() - interval ''3 hours 50 minutes'', ''Agent injoignable, fin constatée (fictif)'')', t.id('A'), t.id('T23'))), 'applied');
select t.is('régularisation : « à valider », jamais validée ; fin retenue ; auteur, motif, date ; proposition sans objet',
  (select status::text || '/' || (validated_at is null)::text || '/' || (completed_at = reported_end_at)::text || '/' || (regularized_by = t.id('a_manager'))::text || '/' || regularized_reason || '/' || (regularized_at is not null)::text || '/' || end_proposal_status || '/' || (regularized_missing is not null)::text from public.tasks where id = t.id('T23')),
  'done/true/true/true/Agent injoignable, fin constatée (fictif)/true/superseded/true');
select t.is('régularisation : historique explicite (motif, auteur), pas de « terminée par l''agent »',
  (select count(*) filter (where kind = 'end_regularized' and note = 'Agent injoignable, fin constatée (fictif)' and actor_id = t.id('a_manager'))::text || '/' || count(*) filter (where kind in ('submitted', 'resubmitted'))::text from public.task_events where task_id = t.id('T23')), '1/0');
select t.is('régularisation : réponse tardive au rappel sans effet', t.keep('a_agent', format('select public.task_overrun_continue(%L, %L)', t.id('A'), t.id('T23'))), 'stale');
select t.is('régularisation : heure proposée après coup sans effet', t.keep('a_agent', format('select public.propose_task_end(%L, %L, now() - interval ''2 hours'', null)', t.id('A'), t.id('T23'))), 'stale');
select t.is('régularisation : décision tardive sur l''ancienne proposition sans effet', t.keep('a_manager', format('select public.decide_task_end(%L, %L, true)', t.id('A'), t.id('T23'))), 'stale');
select t.is('régularisation : « Terminer » de l''agent ne change rien', t.keep('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid(), now())', t.id('A'), t.id('T23'))), 'already');
select t.is('régularisation : seconde régularisation sans effet', t.keep('a_manager', format('select public.regularize_task_end(%L, %L, now() - interval ''1 hour'', ''autre'')', t.id('A'), t.id('T23'))), 'stale');
select t.is('régularisation : fin retenue inchangée par les réponses tardives', (select (reported_end_at < now() - interval '3 hours 45 minutes')::text || '/' || status::text from public.tasks where id = t.id('T23')), 'true/done');
select t.is('régularisation : la validation exige toujours les preuves manquantes',
  (select case when cardinality(regularized_missing) > 0 then 'preuves manquantes' else 'complet' end from public.tasks where id = t.id('T23')) || '/' ||
  (select case when r like 'missing:%' then 'preuves manquantes' else 'complet' end from (select t.keep('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('T23'))) r) x),
  (select case when cardinality(regularized_missing) > 0 then 'preuves manquantes' else 'complet' end from public.tasks where id = t.id('T23')) || '/' || (select case when cardinality(regularized_missing) > 0 then 'preuves manquantes' else 'complet' end from public.tasks where id = t.id('T23')));
select t.err('annulation commencée : l''agent ne peut pas', t.q('a_agent', format('select public.cancel_task(%L, %L, ''motif'')', t.id('A'), t.id('T23C'))), '42501');
select t.err('annulation commencée : une autre organisation non plus', t.q('b_manager', format('select public.cancel_task(%L, %L, ''motif'')', t.id('A'), t.id('T23C'))), '42501');
select t.err('annulation commencée : motif obligatoire', t.q('a_manager', format('select public.cancel_task(%L, %L, null)', t.id('A'), t.id('T23C'))), '22023');
select t.is('annulation commencée : appliquée', t.keep('a_manager', format('select public.cancel_task(%L, %L, ''Intervention inutile, logement non loué (fictif)'')', t.id('A'), t.id('T23C'))), 'applied');
select t.is('annulation commencée : statut, motif, auteur, historique',
  (select status::text || '/' || cancel_reason || '/' || (cancelled_by = t.id('a_manager'))::text from public.tasks where id = t.id('T23C')) || '/' ||
  (select count(*)::text from public.task_events where task_id = t.id('T23C') and kind = 'cancelled' and note = 'Intervention inutile, logement non loué (fictif)'),
  'cancelled/Intervention inutile, logement non loué (fictif)/true/1');
select t.is('annulation commencée : réponse tardive de l''agent sans effet', t.keep('a_agent', format('select public.task_overrun_continue(%L, %L)', t.id('A'), t.id('T23C'))), 'stale');
select t.err('annulation commencée : « Terminer » refusé (mission annulée, plus accessible à l''agent)', t.q('a_agent', format('select public.finish_task(%L, %L, gen_random_uuid(), now())', t.id('A'), t.id('T23C'))), '42501');
select t.is('annulation : mission non commencée sans motif', t.keep('a_manager', format('select public.cancel_task(%L, %L, null)', t.id('A'), t.id('T23U'))), 'applied');
select t.is('annulation : jamais une mission terminée', t.keep('a_manager', format('select public.cancel_task(%L, %L, ''motif'')', t.id('A'), t.id('T23D'))), 'conflict:done');

-- =====================================================================
-- 24. Revenir au calcul automatique (migration 24)
-- =====================================================================
insert into t.ids select k, gen_random_uuid() from unnest(array['T24', 'T24S']) k;
insert into public.tasks (id, organization_id, property_id, type, status, is_auto_generated, window_start, window_end, duration_min) values
  (t.id('T24'), t.id('A'), t.id('P20'), 'turnover', 'unassigned', false, now() + interval '3 days', now() + interval '3 days 5 hours', 90);
insert into public.tasks (id, organization_id, property_id, type, status, assignee_id, is_auto_generated, window_start, window_end, duration_min, started_at) values
  (t.id('T24S'), t.id('A'), t.id('P20'), 'turnover', 'in_progress', t.id('a_agent'), false, now() - interval '1 hour', now() + interval '3 hours', 60, now() - interval '30 minutes');
select t.err('calcul automatique : l''agent ne peut pas', t.q('a_agent', format('select public.restore_auto_window(%L, %L, now() + interval ''3 days'', now() + interval ''3 days 4 hours'', 90)', t.id('A'), t.id('T24'))), '42501');
select t.err('calcul automatique : une autre organisation non plus', t.q('b_manager', format('select public.restore_auto_window(%L, %L, now() + interval ''3 days'', now() + interval ''3 days 4 hours'', 90)', t.id('A'), t.id('T24'))), '42501');
select t.err('calcul automatique : plage plus courte que la durée refusée', t.q('a_manager', format('select public.restore_auto_window(%L, %L, now() + interval ''3 days'', now() + interval ''3 days 1 hour'', 90)', t.id('A'), t.id('T24'))), '22023');
select t.is('calcul automatique : appliqué', t.keep('a_manager', format('select public.restore_auto_window(%L, %L, now() + interval ''3 days 1 hour'', now() + interval ''3 days 4 hours'', 90)', t.id('A'), t.id('T24'))), 'applied');
select t.is('calcul automatique : mode automatique, plage retenue',
  (select is_auto_generated::text || '/' || (window_end - window_start)::text from public.tasks where id = t.id('T24')), 'true/03:00:00');
select t.is('calcul automatique : historisé avec son auteur et l''origine',
  (select count(*) filter (where kind = 'auto_restored' and actor_id = t.id('a_manager'))::text || '/' ||
          count(*) filter (where kind = 'window_changed' and note::jsonb ->> 'origin' = 'auto_restore')::text from public.task_events where task_id = t.id('T24')), '1/1');
select t.is('calcul automatique : jamais sur une mission commencée', t.keep('a_manager', format('select public.restore_auto_window(%L, %L, now(), now() + interval ''3 hours'', 60)', t.id('A'), t.id('T24S'))), 'stale');

-- Suppression d'une organisation (fermeture de compte) : le journal des missions ne bloque pas la cascade
select t.check('suppression : l''organisation A a des missions assignées', '', (select count(*) from public.tasks where organization_id = t.id('A') and assignee_id is not null) > 0);
do $$ declare n int; begin
  delete from public.organizations where id = t.id('A');
  get diagnostics n = row_count;
  perform t.check('suppression : une organisation avec missions assignées se supprime entièrement', n::text, n = 1);
exception when others then
  perform t.check('suppression : une organisation avec missions assignées se supprime entièrement', sqlerrm, false);
end $$;
select t.is('suppression : plus aucune mission ni événement de A', (select count(*)::text from public.tasks where organization_id = t.id('A')) || '/' || (select count(*)::text from public.task_events where organization_id = t.id('A')), '0/0');

-- =====================================================================
-- Bilan
-- =====================================================================
\o
\pset footer off
select count(*) filter (where ok) as "réussis", count(*) filter (where not ok) as "échoués" from t.results;
select name as "ÉCHEC", got from t.results where not ok order by n;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'Tests d''isolation en échec'; end if;
end $$;
