-- =====================================================================
-- Brief du 30/10 (migration 11) :
--  A. Notifications : journal « non envoyé (préférence) », événements complets (mission modifiée, absence
--     décidée, conflit d'affectation, séjour modifié), retour aux réglages par défaut.
--  B. Absences : affectations et acceptations d'absence sérialisées par organisation (deux modifications
--     simultanées ne peuvent pas produire une affectation interdite) ; conflits signalés dès l'acceptation.
--  C. Messagerie : une conversation de mission suit l'affectation (nouvel agent ajouté, ancien retiré).
--  D. Recommandations : description, conseil, source « propriétaire », recommandations automatiques
--     désactivables par logement.
-- Réversible : uniquement des ajouts ou des remplacements de fonctions ; retour arrière décrit dans docs/16.
-- =====================================================================

-- A. Notifications ---------------------------------------------------------
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'sent', 'failed', 'not_configured', 'skipped'));

alter table public.notification_prefs drop constraint notification_prefs_event_check;
alter table public.notification_prefs add constraint notification_prefs_event_check
  check (event in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message',
                   'team_agent_blocker', 'team_absence_requested', 'team_task_to_validate', 'team_assignment_conflict',
                   'team_stay_changed', 'chat_message', 'agent_task_assigned', 'agent_task_changed',
                   'agent_correction_requested', 'agent_absence_decided'));

-- Un envoi écarté par la préférence du destinataire reste dans le journal, avec sa raison (jamais « envoyé »)
create function public.outbox_skip(org uuid, rcpt text, loc text, tpl text, data jsonb, service uuid, reservation uuid, incident uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id, incident_id, status, last_error)
  values (org, rcpt, coalesce(loc, 'fr'), tpl, data, service, reservation, incident, 'skipped', 'disabled_by_preference');
$$;
revoke all on function public.outbox_skip(uuid, text, text, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated;

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
    else
      perform public.outbox_skip(org, m.email, m.locale, tpl, data, service, reservation, incident);
    end if;
  end loop;
  return n;
end $$;

create or replace function public.queue_member_email(org uuid, member uuid, tpl text, data jsonb, critical boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select u.email, p.locale into m from public.memberships ms
    join auth.users u on u.id = ms.user_id join public.profiles p on p.id = ms.user_id
   where ms.organization_id = org and ms.user_id = member and ms.is_active;
  if m.email is null then return false; end if;
  if not public.wants_email(org, member, tpl, critical) then
    perform public.outbox_skip(org, m.email, m.locale, tpl, data, null, null, null);
    return false;
  end if;
  perform public.outbox_insert(org, m.email, m.locale, tpl, data, null, null, null);
  return true;
end $$;

-- Retour aux réglages par défaut (toutes les notifications par e-mail) : uniquement pour soi
create function public.reset_notification_prefs(org uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.notification_prefs where organization_id = org and user_id = (select auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.reset_notification_prefs(uuid) from public, anon;
grant execute on function public.reset_notification_prefs(uuid) to authenticated;

-- B. Absences : sérialisation et conflits ------------------------------------
create function public.lock_assignments(org uuid) returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('halo-assignments-' || org::text));
$$;
revoke all on function public.lock_assignments(uuid) from public, anon, authenticated;

create or replace function public.check_assignee_available() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is null or new.status in ('done', 'validated', 'cancelled') then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id
     and new.scheduled_start is not distinct from old.scheduled_start then
    return new;
  end if;
  -- Attend une éventuelle acceptation d'absence en cours, puis contrôle sur les données validées
  perform public.lock_assignments(new.organization_id);
  if public.task_slot_overlaps_absence(new.organization_id, new.assignee_id, new.window_start, new.window_end,
                                       new.scheduled_start, new.duration_min) then
    raise exception 'assignee_unavailable' using errcode = '22023';
  end if;
  return new;
end $$;

-- Absence acceptée (créée par un responsable ou acceptée) : missions déjà affectées qui la chevauchent
create function public.absence_conflicts(org uuid, absence uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tasks t
  join public.absences a on a.organization_id = t.organization_id and a.id = absence
  join public.memberships m on m.organization_id = t.organization_id and m.user_id = t.assignee_id
  where t.organization_id = org and t.assignee_id is not null and t.status in ('assigned', 'in_progress', 'to_redo')
    and t.window_end > now()
    and ((a.scope = 'member' and a.member_id = t.assignee_id) or (a.scope = 'team' and (a.team_position is null or a.team_position = m.position)))
    and a.starts_at < coalesce(t.scheduled_start + make_interval(mins => t.duration_min), t.window_end)
    and a.ends_at > coalesce(t.scheduled_start, t.window_start);
$$;
revoke all on function public.absence_conflicts(uuid, uuid) from public, anon, authenticated;

create function public.on_absence_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; who text;
begin
  if not exists (select 1 from public.organizations where id = new.organization_id) then return new; end if;
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    -- Sérialise avec les affectations en cours (voir check_assignee_available)
    perform public.lock_assignments(new.organization_id);
    n := public.absence_conflicts(new.organization_id, new.id);
    if n > 0 then
      select full_name into who from public.profiles where id = new.member_id;
      perform public.queue_team_email(new.organization_id, 'team_assignment_conflict',
        jsonb_build_object('member', coalesce(who, '—'), 'count', n, 'path', '/app/team'), null, null, null);
    end if;
  end if;
  -- La personne concernée est prévenue de la décision sur SA demande
  if tg_op = 'UPDATE' and new.member_id is not null and old.status = 'pending' and new.status in ('accepted', 'refused') then
    perform public.queue_member_email(new.organization_id, new.member_id, 'agent_absence_decided',
      jsonb_build_object('decision', new.status, 'path', '/app/profile'));
  end if;
  return new;
end $$;
revoke all on function public.on_absence_change() from public, anon, authenticated;
create trigger absences_change after insert or update on public.absences for each row execute function public.on_absence_change();

-- Missions : modifiée ou annulée → l'agent affecté est prévenu ; conversation de mission qui suit l'affectation
create or replace function public.notify_task_change() returns trigger
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
  if tg_op = 'UPDATE' and new.assignee_id is not null and new.assignee_id is not distinct from old.assignee_id
     and old.status not in ('done', 'validated', 'cancelled')
     and (new.status = 'cancelled' or new.window_start is distinct from old.window_start or new.window_end is distinct from old.window_end
          or new.scheduled_start is distinct from old.scheduled_start) then
    perform public.queue_member_email(new.organization_id, new.assignee_id, 'agent_task_changed',
      jsonb_build_object('kind', new.type, 'property', pname, 'cancelled', new.status = 'cancelled', 'path', '/app/missions/' || new.id));
  end if;
  if new.status = 'to_redo' and tg_op = 'UPDATE' and old.status is distinct from 'to_redo' and new.assignee_id is not null then
    perform public.queue_member_email(new.organization_id, new.assignee_id, 'agent_correction_requested',
      jsonb_build_object('kind', new.type, 'property', pname, 'message', new.correction_reason, 'path', '/app/missions/' || new.id));
  end if;
  -- C. Conversations de la mission : l'agent qui n'est plus affecté n'y a plus accès, le nouveau les rejoint
  if tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id then
    if old.assignee_id is not null then
      delete from public.team_thread_members tm using public.team_threads th
       where th.organization_id = new.organization_id and th.task_id = new.id and tm.thread_id = th.id and tm.user_id = old.assignee_id
         and not exists (select 1 from public.memberships ms where ms.organization_id = new.organization_id and ms.user_id = old.assignee_id and ms.role in ('owner', 'manager'));
    end if;
    if new.assignee_id is not null then
      insert into public.team_thread_members (organization_id, thread_id, user_id)
      select new.organization_id, th.id, new.assignee_id from public.team_threads th
       where th.organization_id = new.organization_id and th.task_id = new.id
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

-- Séjour modifié (dates, annulation) : les responsables sont prévenus
create function public.notify_stay_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pname text;
begin
  if new.check_in_at is not distinct from old.check_in_at and new.check_out_at is not distinct from old.check_out_at
     and new.status is not distinct from old.status then
    return new;
  end if;
  select name into pname from public.properties where organization_id = new.organization_id and id = new.property_id;
  perform public.queue_team_email(new.organization_id, 'team_stay_changed',
    jsonb_build_object('guest', new.guest_name, 'property', pname, 'cancelled', new.status = 'cancelled', 'path', '/app/stays/' || new.id),
    null, new.id, null);
  return new;
end $$;
revoke all on function public.notify_stay_change() from public, anon, authenticated;
create trigger reservations_notify after update on public.reservations for each row execute function public.notify_stay_change();

-- D. Recommandations ------------------------------------------------------
alter table public.properties add column auto_places boolean not null default true;
alter table public.property_places add column description text check (length(description) <= 300);
alter table public.property_places drop constraint property_places_source_check;
alter table public.property_places add constraint property_places_source_check check (source in ('manager', 'owner', 'openstreetmap'));

-- Voyageur : lieux du logement de SON séjour ; les lieux automatiques seulement si le logement les accepte
create or replace function public.guest_places(token text) returns jsonb
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
        'description', x.description, 'address', x.address, 'lat', x.latitude, 'lng', x.longitude, 'opening_hours', x.opening_hours,
        'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at,
        'distance_m', case when p.latitude is not null and x.latitude is not null
                           then round(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude)) end)
        order by (x.source <> 'openstreetmap') desc, case when p.latitude is not null and x.latitude is not null then public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) end nulls last)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and (x.source <> 'openstreetmap' or p.auto_places)
        and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000)), '[]'::jsonb));
end $$;
