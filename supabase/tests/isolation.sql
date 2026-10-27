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

select t.check('aucune fonction exécutable par anon : ' || p.proname, p.proname, false)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

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
select t.err('set_property_access : a_manager logement de B déclaré en A', t.q('a_manager', format('select public.set_property_access(%L, %L, ''keypad'', ''0000'', null)', t.id('A'), t.id('PB1'))), 'P0002');
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
select t.is('codes : agent, sa mission en cours', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA1'))), 'A-1234');
select t.err('codes : agent, mission d''un collègue', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA2'))), '42501');
select t.err('codes : agent, sa mission dans 3 jours (hors fenêtre)', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA3'))), '42501');
select t.err('codes : agent, sa mission annulée', t.q('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA4'))), '42501');
select t.err('codes : agent, par logement sans mission', t.q('a_agent', format('select code from public.reveal_access(%L, null, %L)', t.id('A'), t.id('PA1'))), '42501');
select t.is('codes : manager, par logement', t.q('a_manager', format('select code from public.reveal_access(%L, null, %L)', t.id('A'), t.id('PA2'))), 'A-5678');
select t.is('codes : chaque consultation est journalisée',
  t.keep('a_agent', format('select code from public.reveal_access(%L, %L)', t.id('A'), t.id('TA1'))) || '/' ||
  t.q('a_manager', format('select count(*) from public.access_reveals where task_id = %L and user_id = %L', t.id('TA1'), t.id('a_agent'))), 'A-1234/1');
select t.err('codes : agent ne change pas un code', t.q('a_agent', format('select public.set_property_access(%L, %L, ''keypad'', ''0000'', null)', t.id('A'), t.id('PA1'))), '42501');
select t.is('codes : manager change un code', t.q('a_manager', format('select public.set_property_access(%L, %L, ''keypad'', ''4321'', null)', t.id('A'), t.id('PA1'))), '');
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

-- 3.4 Mission sans validation requise : validée automatiquement à la soumission
select t.is('auto : démarrer un accueil', t.keep('a_agent2', format('select public.start_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC2'))), 'applied');
select t.is('auto : soumettre', t.keep('a_agent2', format('select public.finish_task(%L, %L, gen_random_uuid())', t.id('A'), t.id('TC2'))), 'applied');
select t.is('auto : validée sans passer par le manager', (select status::text from public.tasks where id = t.id('TC2')), 'validated');
select t.is('auto : tracée comme validation automatique', (select kind from public.task_events where task_id = t.id('TC2') order by id desc limit 1), 'auto_validated');

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
