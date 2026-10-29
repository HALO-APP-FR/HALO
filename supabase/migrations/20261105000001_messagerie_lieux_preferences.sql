-- =====================================================================
-- Périmètre opérationnel du 29/10 (migration 10) :
--  A. Absences : une affectation est refusée dès que le créneau RÉEL de la mission (créneau planifié s'il existe,
--     sinon toute sa fenêtre) chevauche une absence acceptée ou une fermeture — y compris en corrigeant le créneau.
--  B. Missions à valider : les responsables sont prévenus à la fin de la mission.
--  C. Messages voyageur : lecture message par message, marquée à l'ouverture de la conversation.
--  D. Préférences de notification par personne et par événement, appliquées par la base ;
--     les urgences (blocage, accès, fuite, dégât, message urgent) ne peuvent pas être coupées.
--  E. Messagerie interne Manager–Agent liée à une mission, un logement ou un séjour.
--  F. Lieux autour du logement : coordonnées du logement, lieux vérifiés par l'équipe et lieux
--     OpenStreetMap (source et date), lus par le voyageur uniquement pour le logement de SON séjour.
-- Uniquement des ajouts ; aucune donnée existante n'est supprimée.
-- =====================================================================

-- A. Absences : chevauchement du créneau réel ------------------------------
-- Créneau réel d'une mission : [planifié ; planifié + durée] si un horaire est fixé, sinon toute la fenêtre.
create function public.task_slot_overlaps_absence(org uuid, member uuid, w_start timestamptz, w_end timestamptz,
                                                  sched timestamptz, duration int) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.absences a
    join public.memberships m on m.organization_id = a.organization_id and m.user_id = member
    where a.organization_id = org and a.status = 'accepted'
      and ((a.scope = 'member' and a.member_id = member) or (a.scope = 'team' and (a.team_position is null or a.team_position = m.position)))
      and a.starts_at < coalesce(sched + make_interval(mins => duration), w_end)
      and a.ends_at > coalesce(sched, w_start));
$$;
revoke all on function public.task_slot_overlaps_absence(uuid, uuid, timestamptz, timestamptz, timestamptz, int) from public, anon, authenticated;

create or replace function public.check_assignee_available() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is null or new.status in ('done', 'validated', 'cancelled') then return new; end if;
  -- Nouvelle affectation, ou horaire planifié modifié pour une personne déjà affectée
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id
     and new.scheduled_start is not distinct from old.scheduled_start then
    return new;
  end if;
  if public.task_slot_overlaps_absence(new.organization_id, new.assignee_id, new.window_start, new.window_end,
                                       new.scheduled_start, new.duration_min) then
    raise exception 'assignee_unavailable' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger tasks_assignee_available on public.tasks;
create trigger tasks_assignee_available before insert or update of assignee_id, scheduled_start on public.tasks
  for each row execute function public.check_assignee_available();

-- Correction de créneau par un responsable : refusée si elle place la personne affectée sur son absence
create or replace function public.set_task_window(org uuid, task uuid, w_start timestamptz, w_end timestamptz, duration int, reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status in ('done', 'validated', 'cancelled') then return 'conflict:' || t.status; end if;
  if duration is null or duration < 5 or duration > 1440 or w_end < w_start + make_interval(mins => duration) then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  if t.assignee_id is not null and public.task_slot_overlaps_absence(org, t.assignee_id, w_start, w_end, null, duration) then
    raise exception 'assignee_unavailable' using errcode = '22023';
  end if;
  perform set_config('halo.reason', left(coalesce(trim(reason), ''), 300), true);
  update public.tasks set window_start = w_start, window_end = w_end, duration_min = duration, duration_locked = true,
    is_auto_generated = false, scheduled_start = null
   where organization_id = org and id = task;
  perform set_config('halo.reason', '', true);
  return 'applied';
end $$;

-- D. Préférences de notification -----------------------------------------
create table public.notification_prefs (
  organization_id uuid not null,
  user_id uuid not null,
  event text not null check (event in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message',
                                       'team_agent_blocker', 'team_absence_requested', 'team_task_to_validate',
                                       'chat_message', 'agent_task_assigned', 'agent_correction_requested')),
  email boolean not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, event),
  foreign key (organization_id, user_id) references public.memberships (organization_id, user_id) on delete cascade
);
alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon;
revoke insert, update, delete on public.notification_prefs from authenticated;
grant select on public.notification_prefs to authenticated;
create policy notification_prefs_select on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()) and public.is_member(organization_id));

create function public.set_notification_pref(org uuid, ev text, by_email boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.notification_prefs (organization_id, user_id, event, email)
  values (org, (select auth.uid()), ev, by_email)
  on conflict (organization_id, user_id, event) do update set email = excluded.email, updated_at = now();
end $$;
revoke all on function public.set_notification_pref(uuid, text, boolean) from public, anon;
grant execute on function public.set_notification_pref(uuid, text, boolean) to authenticated;

-- E-mail voulu ? Par défaut oui ; une alerte critique part toujours, quelle que soit la préférence.
create function public.wants_email(org uuid, member uuid, tpl text, critical boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select critical or coalesce((select email from public.notification_prefs
                               where organization_id = org and user_id = member
                                 and event = case when tpl = 'chat_urgent' then 'chat_message' else tpl end), true);
$$;
revoke all on function public.wants_email(uuid, uuid, text, boolean) from public, anon, authenticated;

-- Responsables prévenus, selon leurs préférences (le champ « critical » du contenu force l'envoi)
create or replace function public.queue_team_email(org uuid, tpl text, data jsonb, service uuid, reservation uuid, incident uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare m record; n int := 0; crit boolean := coalesce((data ->> 'critical')::boolean, false);
begin
  for m in
    select ms.user_id, u.email, p.locale from public.memberships ms
    join auth.users u on u.id = ms.user_id
    join public.profiles p on p.id = ms.user_id
    where ms.organization_id = org and ms.is_active and ms.role in ('owner', 'manager') and u.email is not null
  loop
    if public.wants_email(org, m.user_id, tpl, crit) then
      perform public.outbox_insert(org, m.email, m.locale, tpl, data, service, reservation, incident);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Une personne précise (agent : affectation, correction, message), selon ses préférences
create function public.queue_member_email(org uuid, member uuid, tpl text, data jsonb, critical boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select u.email, p.locale into m from public.memberships ms
    join auth.users u on u.id = ms.user_id join public.profiles p on p.id = ms.user_id
   where ms.organization_id = org and ms.user_id = member and ms.is_active;
  if m.email is null or not public.wants_email(org, member, tpl, critical) then return false; end if;
  perform public.outbox_insert(org, m.email, m.locale, tpl, data, null, null, null);
  return true;
end $$;
revoke all on function public.queue_member_email(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;

-- Incidents : une urgence (blocage, accès, fuite, dégât ou signalée urgente) est toujours envoyée
create or replace function public.notify_team() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pname text; gname text; res uuid;
begin
  if tg_table_name = 'service_requests' then
    if new.source <> 'guest' then return new; end if;
    select name into pname from public.properties where organization_id = new.organization_id and id = new.property_id;
    select guest_name into gname from public.reservations where organization_id = new.organization_id and id = new.reservation_id;
    perform public.queue_team_email(new.organization_id, 'team_service_requested',
      jsonb_build_object('kind', new.kind, 'start_at', new.start_at, 'property', pname, 'guest', gname, 'path', '/app/services/' || new.id),
      new.id, new.reservation_id, null);
  elsif tg_table_name = 'service_events' then
    if new.kind <> 'guest_message' then return new; end if;
    select reservation_id into res from public.service_requests where organization_id = new.organization_id and id = new.service_id;
    perform public.queue_team_email(new.organization_id, 'team_guest_reply',
      jsonb_build_object('message', new.body, 'path', '/app/services/' || new.service_id), new.service_id, res, null);
  elsif tg_table_name = 'incidents' then
    if not (new.source = 'guest' or (new.source = 'agent' and new.urgent)) then return new; end if;
    select name into pname from public.properties where organization_id = new.organization_id and id = new.property_id;
    perform public.queue_team_email(new.organization_id, case when new.source = 'guest' then 'team_guest_problem' else 'team_agent_blocker' end,
      jsonb_build_object('message', new.description, 'property', pname, 'urgent', new.urgent, 'path', '/app/incidents',
        'critical', new.urgent or new.category in ('blocker', 'access', 'leak', 'damage')),
      null, new.reservation_id, new.id);
  elsif tg_table_name = 'stay_messages' then
    if new.author_kind <> 'guest' then return new; end if;
    select r.guest_name, p.name into gname, pname from public.reservations r join public.properties p on p.organization_id = r.organization_id and p.id = r.property_id
     where r.organization_id = new.organization_id and r.id = new.reservation_id;
    perform public.queue_team_email(new.organization_id, 'team_guest_message',
      jsonb_build_object('message', new.body, 'guest', gname, 'property', pname, 'path', '/app/stays/' || new.reservation_id),
      null, new.reservation_id, null);
  end if;
  return new;
end $$;

-- B. Missions : à valider (responsables), affectée et correction demandée (agent) -----------
create function public.notify_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pname text;
begin
  if not exists (select 1 from public.organizations where id = new.organization_id) then return new; end if;
  select name into pname from public.properties where organization_id = new.organization_id and id = new.property_id;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    perform public.queue_team_email(new.organization_id, 'team_task_to_validate',
      jsonb_build_object('kind', new.type, 'property', pname, 'member', (select full_name from public.profiles where id = new.assignee_id),
                         'path', '/app/missions/' || new.id), null, null, null);
  end if;
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) and new.status not in ('done', 'validated', 'cancelled') then
    perform public.queue_member_email(new.organization_id, new.assignee_id, 'agent_task_assigned',
      jsonb_build_object('kind', new.type, 'property', pname, 'path', '/app/missions/' || new.id));
  end if;
  if new.status = 'to_redo' and tg_op = 'UPDATE' and old.status is distinct from 'to_redo' and new.assignee_id is not null then
    perform public.queue_member_email(new.organization_id, new.assignee_id, 'agent_correction_requested',
      jsonb_build_object('kind', new.type, 'property', pname, 'message', new.correction_reason, 'path', '/app/missions/' || new.id));
  end if;
  return new;
end $$;
revoke all on function public.notify_task_change() from public, anon, authenticated;
create trigger tasks_notify after insert or update on public.tasks for each row execute function public.notify_task_change();

-- C. Messages voyageur : lus à l'ouverture (tous ou ceux affichés) ----------------
create function public.mark_stay_messages_read(org uuid, reservation uuid, ids bigint[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.stay_messages set read_by_team_at = now()
   where organization_id = org and reservation_id = reservation and author_kind = 'guest' and read_by_team_at is null
     and (ids is null or id = any (ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_stay_messages_read(uuid, uuid, bigint[]) from public, anon;
grant execute on function public.mark_stay_messages_read(uuid, uuid, bigint[]) to authenticated;

-- E. Messagerie interne ----------------------------------------------------
create table public.team_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Toujours liée à une opération : mission, logement ou séjour (jamais un chat générique)
  context_kind text not null check (context_kind in ('task', 'property', 'reservation')),
  task_id uuid,
  property_id uuid,
  reservation_id uuid,
  -- Libellé figé à la création : l'agent retrouve le contexte sans accès aux séjours
  context_label text not null check (length(context_label) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((context_kind = 'task') = (task_id is not null)),
  check (context_kind <> 'property' or property_id is not null),
  check ((context_kind = 'reservation') = (reservation_id is not null)),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade,
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade
);
create index team_threads_task_idx on public.team_threads (organization_id, task_id);

create table public.team_thread_members (
  organization_id uuid not null,
  thread_id uuid not null,
  user_id uuid not null,
  last_read_at timestamptz,
  primary key (thread_id, user_id),
  foreign key (organization_id, thread_id) references public.team_threads (organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references public.memberships (organization_id, user_id) on delete cascade
);
create index team_thread_members_user_idx on public.team_thread_members (organization_id, user_id);

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  thread_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 4000),
  urgent boolean not null default false,
  -- Identifiant de l'écran : un renvoi après coupure réseau ne crée pas de doublon
  client_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, client_id),
  foreign key (organization_id, thread_id) references public.team_threads (organization_id, id) on delete cascade
);
create index team_messages_thread_idx on public.team_messages (organization_id, thread_id, created_at);

-- Accès : participant actif de la conversation, ou responsable de l'organisation. Jamais l'anonyme (voyageur).
create function public.can_read_thread(org uuid, thread uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_manager(org) or (public.is_member(org) and exists (
    select 1 from public.team_thread_members where organization_id = org and thread_id = thread and user_id = (select auth.uid())));
$$;
revoke all on function public.can_read_thread(uuid, uuid) from public, anon;
grant execute on function public.can_read_thread(uuid, uuid) to authenticated;

alter table public.team_threads enable row level security;
alter table public.team_thread_members enable row level security;
alter table public.team_messages enable row level security;
revoke all on public.team_threads, public.team_thread_members, public.team_messages from anon;
revoke insert, update, delete on public.team_threads, public.team_thread_members, public.team_messages from authenticated;
grant select on public.team_threads, public.team_thread_members, public.team_messages to authenticated;
create policy team_threads_select on public.team_threads for select to authenticated using (public.can_read_thread(organization_id, id));
create policy team_thread_members_select on public.team_thread_members for select to authenticated using (public.can_read_thread(organization_id, thread_id));
create policy team_messages_select on public.team_messages for select to authenticated using (public.can_read_thread(organization_id, thread_id));

-- Nouvelle conversation (responsable) : destinataires de l'organisation, contexte vérifié, premier message
create function public.start_team_thread(org uuid, client uuid, recipients uuid[], ctx_kind text, ctx_id uuid, body text, is_urgent boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev public.team_messages; tid uuid; label text; tsk public.tasks; prop uuid; res uuid; r uuid; n int := 0;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into prev from public.team_messages where organization_id = org and client_id = client;
  if prev.id is not null then return jsonb_build_object('thread', prev.thread_id, 'message', prev.id, 'replayed', true); end if;
  if length(trim(coalesce(body, ''))) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  if recipients is null or cardinality(recipients) = 0 then raise exception 'no_recipient' using errcode = '22023'; end if;
  if ctx_kind = 'task' then
    select * into tsk from public.tasks where organization_id = org and id = ctx_id;
    if tsk.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    prop := tsk.property_id;
    select coalesce(nullif(tsk.title, '') || ' · ', '') || p.name into label from public.properties p where p.organization_id = org and p.id = tsk.property_id;
  elsif ctx_kind = 'property' then
    select id, name into prop, label from public.properties where organization_id = org and id = ctx_id;
    if prop is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  elsif ctx_kind = 'reservation' then
    select r2.id, r2.property_id, p.name || ' · ' || to_char(r2.check_in_at at time zone p.timezone, 'DD/MM') || '→' || to_char(r2.check_out_at at time zone p.timezone, 'DD/MM')
      into res, prop, label from public.reservations r2 join public.properties p on p.organization_id = r2.organization_id and p.id = r2.property_id
     where r2.organization_id = org and r2.id = ctx_id;
    if res is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  else
    raise exception 'invalid_context' using errcode = '22023';
  end if;
  insert into public.team_threads (organization_id, context_kind, task_id, property_id, reservation_id, context_label, created_by)
  values (org, ctx_kind, case when ctx_kind = 'task' then ctx_id end, prop, case when ctx_kind = 'reservation' then ctx_id end, left(label, 200), uid)
  returning id into tid;
  insert into public.team_thread_members (organization_id, thread_id, user_id, last_read_at) values (org, tid, uid, now());
  foreach r in array recipients loop
    if r <> uid then
      if not exists (select 1 from public.memberships where organization_id = org and user_id = r and is_active) then
        raise exception 'not_member' using errcode = '22023';
      end if;
      insert into public.team_thread_members (organization_id, thread_id, user_id) values (org, tid, r) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  if n = 0 then raise exception 'no_recipient' using errcode = '22023'; end if;
  return public.post_team_message(org, tid, client, body, is_urgent) || jsonb_build_object('thread', tid);
end $$;

-- Message dans une conversation (participant ou responsable). Idempotent par client_id.
create function public.post_team_message(org uuid, thread uuid, client uuid, body text, is_urgent boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev public.team_messages; mid uuid; th public.team_threads; m record; author text;
begin
  if not public.can_read_thread(org, thread) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into prev from public.team_messages where organization_id = org and client_id = client;
  if prev.id is not null then return jsonb_build_object('message', prev.id, 'at', prev.created_at, 'replayed', true); end if;
  if length(trim(coalesce(body, ''))) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  select * into th from public.team_threads where organization_id = org and id = thread;
  -- Un responsable qui écrit dans une conversation la rejoint
  insert into public.team_thread_members (organization_id, thread_id, user_id, last_read_at) values (org, thread, uid, now())
  on conflict (thread_id, user_id) do update set last_read_at = now();
  insert into public.team_messages (organization_id, thread_id, author_id, body, urgent, client_id)
  values (org, thread, uid, left(trim(body), 4000), coalesce(is_urgent, false), client)
  returning id into mid;
  update public.team_threads set last_message_at = now() where id = thread;
  select full_name into author from public.profiles where id = uid;
  -- Les autres participants sont prévenus par e-mail selon leurs préférences ; l'urgence part toujours
  for m in select user_id from public.team_thread_members where organization_id = org and thread_id = thread and user_id <> uid loop
    perform public.queue_member_email(org, m.user_id, case when is_urgent then 'chat_urgent' else 'chat_message' end,
      jsonb_build_object('member', author, 'property', th.context_label, 'message', left(trim(body), 500), 'path', '/app/messages/' || thread),
      coalesce(is_urgent, false));
  end loop;
  return jsonb_build_object('message', mid, 'at', now(), 'replayed', false);
end $$;

create function public.mark_team_thread_read(org uuid, thread uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_read_thread(org, thread) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.team_thread_members set last_read_at = now()
   where organization_id = org and thread_id = thread and user_id = (select auth.uid());
end $$;

revoke all on function public.start_team_thread(uuid, uuid, uuid[], text, uuid, text, boolean),
  public.post_team_message(uuid, uuid, uuid, text, boolean), public.mark_team_thread_read(uuid, uuid) from public, anon;
grant execute on function public.start_team_thread(uuid, uuid, uuid[], text, uuid, text, boolean),
  public.post_team_message(uuid, uuid, uuid, text, boolean), public.mark_team_thread_read(uuid, uuid) to authenticated;

-- F. Lieux autour du logement ---------------------------------------------
alter table public.properties
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add column geo_source text check (geo_source in ('manager', 'openstreetmap')),
  add column geo_updated_at timestamptz;

create table public.property_places (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  property_id uuid not null,
  -- 'manager' : ajouté et vérifié par l'équipe ; 'openstreetmap' : importé, avec la date des données
  source text not null check (source in ('manager', 'openstreetmap')),
  external_id text,
  category text not null check (category in ('food', 'shops', 'transport', 'activities', 'services')),
  name text not null check (length(trim(name)) between 1 and 160),
  address text check (length(address) <= 300),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  opening_hours text check (length(opening_hours) <= 300),
  phone text check (length(phone) <= 40),
  website text check (length(website) <= 300),
  note text check (length(note) <= 500),
  hidden boolean not null default false,
  source_updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_id, source, external_id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);
create index property_places_idx on public.property_places (organization_id, property_id);
alter table public.property_places enable row level security;
revoke all on public.property_places from anon;
grant select, insert, update, delete on public.property_places to authenticated;
create policy property_places_select on public.property_places for select to authenticated using (public.is_manager(organization_id));
create policy property_places_insert on public.property_places for insert to authenticated with check (public.is_manager(organization_id));
create policy property_places_update on public.property_places for update to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy property_places_delete on public.property_places for delete to authenticated using (public.is_manager(organization_id));

-- Distance en mètres (haversine)
create function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;
revoke all on function public.distance_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision) to authenticated;

-- Voyageur : uniquement les lieux du logement de SON séjour, visibles, dans un rayon de 3 km s'ils sont localisés
create function public.guest_places(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations; p public.properties;
begin
  r := public.guest_link_stay(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  return jsonb_build_object('status', 'ok',
    'property', jsonb_build_object('name', p.name, 'address', p.address_line, 'postal_code', p.postal_code, 'city', p.city,
      'country_code', p.country_code, 'lat', p.latitude, 'lng', p.longitude),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'name', x.name,
        'address', x.address, 'lat', x.latitude, 'lng', x.longitude, 'opening_hours', x.opening_hours, 'phone', x.phone,
        'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at,
        'distance_m', case when p.latitude is not null and x.latitude is not null
                           then round(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude)) end)
        order by (x.source = 'manager') desc, case when p.latitude is not null and x.latitude is not null then public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) end nulls last)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000)), '[]'::jsonb));
end $$;
revoke all on function public.guest_places(text) from public;
grant execute on function public.guest_places(text) to anon, authenticated;
