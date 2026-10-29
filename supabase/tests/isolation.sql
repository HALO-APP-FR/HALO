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
  and p.proname not in ('get_guest_stay', 'guest_request_service', 'guest_reply_service', 'guest_send_message', 'guest_report_problem', 'guest_problems');
select t.is('exceptions anonymes : uniquement la porte d''entrée voyageur (lien de séjour)', (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), 'get_guest_stay,guest_problems,guest_reply_service,guest_report_problem,guest_request_service,guest_send_message');

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
select t.is('cycle : soumission refusée sans la photo obligatoire', t.keep('a_agent2', format('select public.finish_task(%L, %L, %L)', t.id('A'), t.id('TC1'), '22222222-2222-2222-2222-222222222222')), 'missing_photos');
select t.is('cycle : la mission reste en cours', (select status::text from public.tasks where id = t.id('TC1')), 'in_progress');
select t.is('cycle : le refus n''est pas mémorisé (l''action pourra être rejouée)', (select count(*)::text from public.task_actions where id = '22222222-2222-2222-2222-222222222222'), '0');
select t.check('cycle : photo du point obligatoire réservée',
  t.keep('a_agent2', format('select public.begin_upload(%L, ''task_photo'', ''image/jpeg'', 900, %L, null, %L)', t.id('A'), t.id('TC1'), t.id('itemA2'))), true);
select t.is('cycle : réservée mais pas envoyée = toujours refusée', t.q('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC1'))), 'missing_photos');
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
select t.is('cycle : valider deux fois = conflit sans effet', t.q('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC1'))), 'conflict:validated');
select t.is('historique : toutes les étapes, dans l''ordre',
  (select string_agg(kind, ',' order by id) from public.task_events where task_id = t.id('TC1')),
  'created,started,submitted,correction_requested,started,submitted,validated');
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
select t.is('preuves : validation refusée sans la photo exigée', t.q('a_manager', format('select public.validate_task(%L, %L)', t.id('A'), t.id('TC3'))), 'missing_photos');
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
select t.is('correction ciblée : terminer refusé sans nouvelle photo', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC4'))), 'missing_photos');
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
select t.is('invité : séjour à venir (plus de 72 h) = réponse neutre', t.guest(t.tk('A3')), 'unavailable');
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
select t.is('précisions : la demande repasse « à traiter », signalée à l''équipe', t.q('a_manager', format('select status || ''/'' || manager_unread from public.service_requests where id = %L', t.sv('SA'))), 'requested/true');
select t.is('équipe : la réponse du voyageur est dans l''historique', t.q('a_manager', format('select body from public.service_events where service_id = %L and kind = ''guest_message''', t.sv('SA'))), 'Pas d''arachides');
select t.is('acceptation : confirmée', (t.keep('a_manager', format('select public.decide_service(%L, %L, ''confirmed'', ''Réservé pour 20 h'')', t.id('A'), t.sv('SA')))::jsonb ->> 'status'), 'ok');
select t.is('acceptation : le voyageur voit la confirmation', t.guest(t.tk('GA'), '{services,0,status}'), 'confirmed');
select t.is('acceptation : un e-mail par étape, état « en attente » tant qu''il n''est pas parti',
  (select string_agg(template || ':' || status, ',' order by created_at) from public.notification_outbox where service_id = t.sv('SA') and template not like 'team_%'),
  'service_received:pending,service_info_requested:pending,service_confirmed:pending');
select t.is('historique : chaque étape horodatée', t.q('a_manager', format('select string_agg(kind || coalesce('':'' || status, ''''), '','' order by id) from public.service_events where service_id = %L', t.sv('SA'))),
  'created:requested,status:info_requested,internal_note,guest_message,status:requested,status:confirmed');
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
select t.is('équipe : jamais d''agent parmi les destinataires', (select count(*)::text from public.notification_outbox where recipient like 'a_agent%' or recipient like 'b_agent%'), '0');
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
