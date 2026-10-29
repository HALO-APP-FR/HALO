-- =====================================================================
-- Retour de test du 29/10 :
--  1. Nouvelle preuve exigée après une demande de correction (l'ancienne photo est gardée en historique).
--  2. Codes de serrure : HALO n'en gère aucun ; les fonctions d'accès aux codes sont fermées.
--  3. Notifications de l'équipe : chaque demande, problème ou message d'un voyageur (et chaque blocage
--     urgent d'un agent) prévient les responsables par e-mail, avec un état d'envoi traçable.
--     Une adresse fictive (comptes de test) n'est jamais comptée « envoyée ».
-- =====================================================================

-- 1. Preuves remplacées --------------------------------------------------
alter table public.files add column superseded_at timestamptz;

create or replace function public.missing_required_photos(org uuid, task uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tasks t
  join public.checklist_rooms r on r.organization_id = t.organization_id and r.property_id = t.property_id
  join public.checklist_items i on i.organization_id = r.organization_id and i.room_id = r.id and i.photo_required
  where t.organization_id = org and t.id = task and t.type in ('turnover', 'inspection')
    and not exists (select 1 from public.files f
                    join storage.objects o on o.bucket_id = 'org-files' and o.name = f.path
                    where f.organization_id = org and f.task_id = task and f.checklist_item_id = i.id
                      -- une photo écartée par une demande de correction ne compte plus
                      and f.superseded_at is null);
$$;
revoke all on function public.missing_required_photos(uuid, uuid) from public, anon;

-- Correction : motif obligatoire ; les points désignés doivent être refaits avec une NOUVELLE photo
drop function public.request_correction(uuid, uuid, text);
create function public.request_correction(org uuid, task uuid, reason text, redo_items uuid[] default null) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; rep public.task_reports;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(reason, ''))) = 0 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status not in ('done', 'validated') then return 'conflict:' || t.status; end if;
  select * into rep from public.task_reports where organization_id = org and task_id = task;
  insert into public.task_report_versions (organization_id, task_id, checked, rooms, started_at, completed_at, archived_by)
  values (org, task, coalesce(rep.checked, '[]'::jsonb), coalesce(rep.rooms, '{}'::jsonb), t.started_at, t.completed_at, (select auth.uid()));
  if redo_items is not null and cardinality(redo_items) > 0 then
    -- Ancienne preuve conservée (historique) mais plus valable pour la reprise
    update public.files set superseded_at = now()
     where organization_id = org and task_id = task and checklist_item_id = any (redo_items) and superseded_at is null;
    -- Les points concernés sont à refaire : décochés
    update public.task_reports set checked = coalesce((select jsonb_agg(x) from jsonb_array_elements(checked) x
                                                        where not (x #>> '{}') = any (select unnest(redo_items)::text)), '[]'::jsonb),
      updated_at = now()
     where organization_id = org and task_id = task;
  end if;
  update public.tasks set status = 'to_redo', correction_reason = left(trim(reason), 2000),
    validated_at = null, validated_by = null
  where organization_id = org and id = task;
  return 'applied';
end $$;
revoke all on function public.request_correction(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.request_correction(uuid, uuid, text, uuid[]) to authenticated;

-- 2. Codes de serrure : aucun accès depuis l'application ------------------
revoke execute on function public.reveal_access(uuid, uuid, uuid) from authenticated;
revoke execute on function public.set_property_access(uuid, uuid, public.access_type, text, text) from authenticated;

-- 3. Notifications ----------------------------------------------------------
alter table public.notification_outbox add column incident_id uuid;

-- Adresse non distribuable (comptes de test) : tracée en échec, jamais « envoyée »
create function public.outbox_insert(org uuid, rcpt text, loc text, tpl text, data jsonb, service uuid, reservation uuid, incident uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if rcpt ~* '\.invalid$' then
    insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id, incident_id, status, last_error)
    values (org, rcpt, coalesce(loc, 'fr'), tpl, data, service, reservation, incident, 'failed', 'undeliverable_test_address');
  else
    insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id, incident_id)
    values (org, rcpt, coalesce(loc, 'fr'), tpl, data, service, reservation, incident);
  end if;
end $$;
revoke all on function public.outbox_insert(uuid, text, text, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.queue_guest_email(r public.reservations, tpl text, data jsonb, service uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if r.guest_email is null then return false; end if;
  perform public.outbox_insert(r.organization_id, r.guest_email, r.guest_locale, tpl, data, service, r.id, null);
  return true;
end $$;
revoke all on function public.queue_guest_email(public.reservations, text, jsonb, uuid) from public, anon, authenticated;

-- Responsables (propriétaire, managers) actifs de l'organisation, chacun dans sa langue
create function public.queue_team_email(org uuid, tpl text, data jsonb, service uuid, reservation uuid, incident uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare m record; n int := 0;
begin
  for m in
    select u.email, p.locale from public.memberships ms
    join auth.users u on u.id = ms.user_id
    join public.profiles p on p.id = ms.user_id
    where ms.organization_id = org and ms.is_active and ms.role in ('owner', 'manager') and u.email is not null
  loop
    perform public.outbox_insert(org, m.email, m.locale, tpl, data, service, reservation, incident);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.queue_team_email(uuid, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated;

create function public.notify_team() returns trigger
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
      jsonb_build_object('message', new.description, 'property', pname, 'urgent', new.urgent, 'path', '/app/incidents'),
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
revoke all on function public.notify_team() from public, anon, authenticated;

create trigger service_requests_notify_team after insert on public.service_requests for each row execute function public.notify_team();
create trigger service_events_notify_team after insert on public.service_events for each row execute function public.notify_team();
create trigger incidents_notify_team after insert on public.incidents for each row execute function public.notify_team();
create trigger stay_messages_notify_team after insert on public.stay_messages for each row execute function public.notify_team();

-- Voyageur prévenu quand son problème est pris en charge (la résolution l'est déjà)
create function public.notify_guest_problem_taken() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  if new.source = 'guest' and old.status = 'open' and new.status = 'in_progress' and new.reservation_id is not null then
    select * into r from public.reservations where organization_id = new.organization_id and id = new.reservation_id;
    if r.guest_email is not null then
      perform public.outbox_insert(r.organization_id, r.guest_email, r.guest_locale, 'problem_taken', '{}'::jsonb, null, r.id, new.id);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.notify_guest_problem_taken() from public, anon, authenticated;
create trigger incidents_notify_guest after update on public.incidents for each row execute function public.notify_guest_problem_taken();
