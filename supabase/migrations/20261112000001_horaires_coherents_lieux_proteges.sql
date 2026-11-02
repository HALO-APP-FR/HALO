-- =====================================================================
-- Migration 17 — confirmation d'horaire : toutes les missions liées prises en compte (cause de l'échec
-- « invalid_window » du 2/11), anciennes confirmations incohérentes détectées et résolues par décision,
-- lieux avant ouverture : aucune suggestion automatique ni coordonnée transmise
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Effet prévu sur chaque mission liée (lecture seule, utilisé par la vérification ET par la décision)
--    Arrivée anticipée (missions dont next_reservation_id = séjour, et accueil du séjour) :
--      - ménage / mission de préparation qui tient avant l'heure : l'échéance (fin de fenêtre) passe à l'heure demandée ;
--      - qui ne tient pas : ménage → blocage ; autre mission → risque, mission laissée telle quelle ;
--      - accueil (check_in) : fenêtre décalée avec l'arrivée, sauf créneau planifié (laissé, risque).
--    Départ tardif (missions dont reservation_id = séjour) : symétrique (début de fenêtre, départ accompagné).
--    Un créneau planifié n'est jamais déplacé.
-- ---------------------------------------------------------------------
create function public.timing_effects(org uuid, r public.reservations, early boolean, req timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  with cur as (select case when early then r.check_in_at else r.check_out_at end as at),
  linked as (
    select t.*,
      case
        when early and t.type = 'check_in' and t.reservation_id = r.id then
          case when t.scheduled_start is not null then 'unchanged_scheduled' else 'shift' end
        when early and t.next_reservation_id = r.id then
          case when t.window_end <= req then 'none'
               when t.window_start + make_interval(mins => t.duration_min) > req then case when t.type = 'turnover' then 'blocking' else 'unchanged_cannot_fit' end
               when t.scheduled_start is not null and t.scheduled_start + make_interval(mins => t.duration_min) > req then 'deadline_scheduled_after'
               else 'deadline' end
        when not early and t.type = 'check_out' and t.reservation_id = r.id then
          case when t.scheduled_start is not null then 'unchanged_scheduled' else 'shift' end
        when not early and t.reservation_id = r.id and t.type <> 'check_in' then
          case when t.window_start >= req then 'none'
               when req + make_interval(mins => t.duration_min) > t.window_end then case when t.type = 'turnover' then 'blocking' else 'unchanged_cannot_fit' end
               when t.scheduled_start is not null and t.scheduled_start < req then 'start_scheduled_before'
               else 'start' end
      end as effect
    from public.tasks t
    where t.organization_id = org and t.status not in ('done', 'validated', 'cancelled')
      and ((early and (t.next_reservation_id = r.id or (t.type = 'check_in' and t.reservation_id = r.id)))
        or (not early and t.reservation_id = r.id))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', l.type, 'title', l.title, 'status', l.status, 'assignee_id', l.assignee_id,
           'window_start', l.window_start, 'window_end', l.window_end, 'duration_min', l.duration_min, 'scheduled_start', l.scheduled_start, 'effect', l.effect)
         order by l.window_start), '[]'::jsonb)
  from linked l where l.effect is not null and l.effect <> 'none';
$$;
revoke all on function public.timing_effects(uuid, public.reservations, boolean, timestamptz) from public, anon, authenticated;

create or replace function public.timing_check(org uuid, service uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; risks jsonb := '[]'::jsonb; blocking jsonb := '[]'::jsonb;
        cur timestamptz; req timestamptz; acts jsonb; early boolean; fx jsonb; k public.tasks; legacy boolean;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service;
  if s.id is null or s.kind not in ('early_checkin', 'late_checkout') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.reservations where organization_id = org and id = s.reservation_id;
  if r.id is null then return jsonb_build_object('status', 'no_stay'); end if;
  early := s.kind = 'early_checkin';
  req := s.start_at;
  cur := case when early then r.check_in_at else r.check_out_at end;
    -- Confirmée mais le séjour indique une autre heure (confirmation antérieure à la décision dédiée, ou séjour modifié depuis)
  legacy := s.status = 'confirmed' and cur <> req;
  if (early and req >= cur) or (not early and req <= cur) then
    return jsonb_build_object('status', 'ok', 'kind', s.kind, 'requested_at', req, 'current_at', cur, 'change', false, 'legacy_mismatch', legacy,
      'risks', risks, 'blocking', blocking, 'tasks', '[]'::jsonb, 'actions', '[]'::jsonb);
  end if;
  fx := public.timing_effects(org, r, early, req);
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'effect' = 'blocking') then blocking := blocking || '["cleaning_cannot_fit"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'effect' = 'unchanged_cannot_fit') then risks := risks || '["mission_cannot_fit"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'effect' in ('deadline_scheduled_after', 'start_scheduled_before', 'unchanged_scheduled')) then risks := risks || '["mission_scheduled"]'::jsonb; end if;
  -- Ménage principal : absent, non attribué, attribué sans créneau
  select * into k from public.tasks
   where organization_id = org and type = 'turnover' and status <> 'cancelled'
     and ((early and next_reservation_id = r.id) or (not early and reservation_id = r.id))
   order by created_at desc limit 1;
  if k.id is null then risks := risks || '["no_cleaning"]'::jsonb;
  elsif k.status not in ('done', 'validated') then
    if k.assignee_id is null then risks := risks || '["cleaning_unassigned"]'::jsonb;
    elsif k.scheduled_start is null then risks := risks || '["cleaning_not_planned"]'::jsonb; end if;
  end if;
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'type' <> 'turnover' and e ->> 'type' not in ('check_in', 'check_out') and (e ->> 'assignee_id') is null) then
    risks := risks || '["mission_unassigned"]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at, 'task_status', (select status from public.tasks t where t.id = a.task_id))), '[]'::jsonb)
    into acts from public.stay_prep_actions a
   where a.organization_id = org and a.reservation_id = r.id and a.status = 'open' and a.blocking and early and (a.due_at is null or a.due_at > req);
  if jsonb_array_length(acts) > 0 then risks := risks || '["prep_actions_open"]'::jsonb; end if;
  return jsonb_build_object('status', 'ok', 'kind', s.kind, 'requested_at', req, 'current_at', cur, 'change', true, 'legacy_mismatch', legacy,
    'cleaning', case when k.id is null then null else jsonb_build_object('id', k.id, 'status', k.status, 'assignee_id', k.assignee_id, 'window_start', k.window_start,
                 'window_end', k.window_end, 'duration_min', k.duration_min, 'scheduled_start', k.scheduled_start) end,
    'tasks', fx, 'actions', acts, 'risks', risks, 'blocking', blocking,
    'unverified', '["linen", "access", "owner_rules"]'::jsonb);
end $$;

-- Application de l'horaire (séjour + missions liées + échéances), commune à la confirmation et à la résolution d'une ancienne confirmation
create function public.timing_apply(org uuid, s public.service_requests, r public.reservations, early boolean, req timestamptz, uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur timestamptz := case when early then r.check_in_at else r.check_out_at end; fx jsonb; e jsonb; delta interval := req - cur;
begin
  fx := public.timing_effects(org, r, early, req);
  if early then update public.reservations set check_in_at = req where id = r.id;
  else update public.reservations set check_out_at = req where id = r.id; end if;
  for e in select * from jsonb_array_elements(fx) loop
    if e ->> 'effect' in ('deadline', 'deadline_scheduled_after') then
      update public.tasks set window_end = req where organization_id = org and id = (e ->> 'id')::uuid;
    elsif e ->> 'effect' in ('start', 'start_scheduled_before') then
      update public.tasks set window_start = req where organization_id = org and id = (e ->> 'id')::uuid;
    elsif e ->> 'effect' = 'shift' then
      update public.tasks set window_start = window_start + delta, window_end = window_end + delta where organization_id = org and id = (e ->> 'id')::uuid;
    end if;
    -- unchanged_scheduled / unchanged_cannot_fit : mission laissée telle quelle (signalée avant la décision)
  end loop;
  if early then
    update public.stay_prep_actions set due_at = req where organization_id = org and reservation_id = r.id and status = 'open' and due_at = cur;
  end if;
  insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
  values (org, r.id, 'stay_time_changed', uid, (case when early then 'check_in:' else 'check_out:' end) || to_char(cur at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || '>' || to_char(req at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
  update public.service_requests set timing_previous_at = cur, timing_applied_at = req where id = s.id;
end $$;
revoke all on function public.timing_apply(uuid, public.service_requests, public.reservations, boolean, timestamptz, uuid) from public, anon, authenticated;

drop function public.timing_decide(uuid, uuid, text, boolean, timestamptz, text, text);
create function public.timing_decide(org uuid, service uuid, act text, ack boolean default false, expected_at timestamptz default null,
                                     guest_message text default null, internal_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; chk jsonb; early boolean; cur timestamptz; uid uuid := (select auth.uid());
        note text; res jsonb; fx jsonb; e jsonb;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service for update;
  if s.id is null or s.kind not in ('early_checkin', 'late_checkout') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.reservations where organization_id = org and id = s.reservation_id for update;
  early := s.kind = 'early_checkin';
  if r.id is not null then cur := case when early then r.check_in_at else r.check_out_at end; end if;

  if act in ('confirm', 'apply_legacy') then
    if act = 'confirm' and s.status = 'confirmed' then return jsonb_build_object('status', 'already'); end if;
    if act = 'confirm' and s.status not in ('requested', 'in_review', 'info_requested') then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
    if act = 'apply_legacy' and not (s.status = 'confirmed' and r.id is not null and cur <> s.start_at) then return jsonb_build_object('status', 'already'); end if;
    if r.id is null then return jsonb_build_object('status', 'no_stay'); end if;
    if expected_at is not null and expected_at <> cur then return jsonb_build_object('status', 'stay_changed', 'current_at', cur); end if;
    chk := public.timing_check(org, service);
    if jsonb_array_length(chk -> 'blocking') > 0 then return jsonb_build_object('status', 'not_feasible', 'check', chk); end if;
    if jsonb_array_length(chk -> 'risks') > 0 and not coalesce(ack, false) then return jsonb_build_object('status', 'risks', 'check', chk); end if;
    if (chk ->> 'change')::boolean then
      begin
        perform public.timing_apply(org, s, r, early, s.start_at, uid);
      exception when sqlstate '23P01' then
        return jsonb_build_object('status', 'not_feasible', 'check', chk || jsonb_build_object('blocking', '["stay_overlap"]'::jsonb));
      end;
    end if;
    note := nullif(trim(coalesce(internal_note, '')), '');
    if jsonb_array_length(chk -> 'risks') > 0 then
      note := concat_ws(E'\n', note, 'Confirmé en connaissance de cause : ' || (select string_agg(x, ', ') from jsonb_array_elements_text(chk -> 'risks') x));
    end if;
    if act = 'apply_legacy' then
      -- Ancienne confirmation : la décision de l'appliquer au séjour est tracée (aucun nouvel e-mail de statut)
      insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind, author_id)
      values (org, s.id, 'internal_note', left(concat_ws(E'\n', 'Ancienne confirmation appliquée au séjour.', note), 2000), 'internal', 'member', uid);
      if nullif(trim(coalesce(guest_message, '')), '') is not null then
        insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind, author_id)
        values (org, s.id, 'team_message', left(trim(guest_message), 2000), 'guest', 'member', uid);
        update public.service_requests set guest_unread = true where id = s.id;
      end if;
      return jsonb_build_object('status', 'applied', 'changed', (chk ->> 'change')::boolean, 'property', s.property_id);
    end if;
    perform set_config('halo.timing_ok', '1', true);
    res := public.decide_service(org, service, 'confirmed', guest_message, note);
    perform set_config('halo.timing_ok', '', true);
    return jsonb_build_object('status', 'applied', 'changed', (chk ->> 'change')::boolean, 'risks_accepted', chk -> 'risks', 'property', s.property_id, 'email_queued', res -> 'email_queued');
  elsif act = 'cancel' then
    if s.status = 'cancelled' then return jsonb_build_object('status', 'already'); end if;
    if s.status <> 'confirmed' then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
    -- Horaire jamais appliqué au séjour (ou séjour modifié depuis) : on retire la confirmation sans toucher au séjour
    if s.timing_applied_at is not null and r.id is not null and cur = s.timing_applied_at then
      -- Retour à l'horaire précédent par le même calcul (missions décalées dans l'autre sens)
      begin
        fx := public.timing_effects(org, r, early, s.timing_previous_at);
        if early then update public.reservations set check_in_at = s.timing_previous_at where id = r.id;
        else update public.reservations set check_out_at = s.timing_previous_at where id = r.id; end if;
        update public.tasks set window_end = s.timing_previous_at
         where organization_id = org and early and next_reservation_id = r.id and status not in ('done', 'validated', 'cancelled') and window_end = s.timing_applied_at;
        update public.tasks set window_start = s.timing_previous_at
         where organization_id = org and not early and reservation_id = r.id and type <> 'check_out' and status not in ('done', 'validated', 'cancelled') and window_start = s.timing_applied_at;
        update public.tasks set window_start = window_start + (s.timing_previous_at - s.timing_applied_at), window_end = window_end + (s.timing_previous_at - s.timing_applied_at)
         where organization_id = org and reservation_id = r.id and scheduled_start is null and status not in ('done', 'validated', 'cancelled')
           and type = case when early then 'check_in' else 'check_out' end::public.task_type;
        update public.stay_prep_actions set due_at = s.timing_previous_at where organization_id = org and reservation_id = r.id and status = 'open' and due_at = s.timing_applied_at;
      exception when sqlstate '23P01' then
        return jsonb_build_object('status', 'not_feasible', 'check', jsonb_build_object('blocking', '["stay_overlap"]'::jsonb));
      end;
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
      values (org, r.id, 'stay_time_changed', uid, (case when early then 'check_in:' else 'check_out:' end) || to_char(s.timing_applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || '>' || to_char(s.timing_previous_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
    end if;
    perform set_config('halo.timing_ok', '1', true);
    res := public.decide_service(org, service, 'cancelled', guest_message, internal_note);
    perform set_config('halo.timing_ok', '', true);
    return jsonb_build_object('status', 'applied', 'restored', s.timing_applied_at is not null and cur = s.timing_applied_at, 'property', s.property_id);
  end if;
  raise exception 'invalid' using errcode = '22023';
end $$;
revoke all on function public.timing_decide(uuid, uuid, text, boolean, timestamptz, text, text) from public, anon;
grant execute on function public.timing_decide(uuid, uuid, text, boolean, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Anciennes confirmations incohérentes (horaire confirmé ≠ horaire du séjour) : listées, jamais corrigées seules
-- ---------------------------------------------------------------------
create function public.timing_inconsistencies(org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('service', s.id, 'reservation', r.id, 'kind', s.kind, 'guest_name', r.guest_name,
           'confirmed_at', s.start_at, 'stay_at', case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end) order by s.start_at), '[]'::jsonb)
  from public.service_requests s join public.reservations r on r.organization_id = s.organization_id and r.id = s.reservation_id
  where s.organization_id = org and public.is_manager(org) and s.kind in ('early_checkin', 'late_checkout') and s.status = 'confirmed'
    and r.status = 'confirmed' and r.check_out_at > now() - interval '1 day'
    and s.start_at <> case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end
    and (s.timing_applied_at is null or s.timing_applied_at <> case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end);
$$;
revoke all on function public.timing_inconsistencies(uuid) from public, anon;
grant execute on function public.timing_inconsistencies(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Lieux avant l'ouverture : seulement la sélection de l'équipe et du propriétaire, sans coordonnées.
--    Les suggestions automatiques (nombreuses, centrées sur le logement) ne sont plus transmises : leur
--    répartition et le « vide » laissé par les lieux proches masqués permettraient de situer le logement.
-- ---------------------------------------------------------------------
create or replace function public.guest_places(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations; p public.properties; full_access boolean; near_hidden int := 0; auto_hidden int := 0;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  if not full_access then
    select count(*) filter (where x.source = 'openstreetmap'),
           count(*) filter (where x.source <> 'openstreetmap' and p.latitude is not null and x.latitude is not null
                              and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) < 300)
      into auto_hidden, near_hidden
      from public.property_places x
     where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden and (x.source <> 'openstreetmap' or p.auto_places)
       and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000);
  end if;
  return jsonb_build_object('status', 'ok', 'full', full_access, 'near_hidden', near_hidden, 'auto_hidden', auto_hidden,
    'property', jsonb_build_object('name', p.name, 'address', case when full_access then p.address_line end,
      'postal_code', case when full_access then p.postal_code end, 'city', p.city, 'country_code', p.country_code,
      'lat', case when full_access then p.latitude end, 'lng', case when full_access then p.longitude end),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'name', x.name,
        'description', x.description, 'address', x.address,
        'lat', case when full_access then x.latitude end, 'lng', case when full_access then x.longitude end,
        'opening_hours', x.opening_hours, 'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at, 'created_at', x.created_at, 'verified_at', x.verified_at,
        'distance_m', case when full_access and p.latitude is not null and x.latitude is not null
                           then round(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude)) end,
        'distance_band', case when not full_access and p.latitude is not null and x.latitude is not null
                              then least(3, greatest(1, ceil(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) / 1000.0)))::int end)
        order by (x.source <> 'openstreetmap') desc,
                 case when full_access and p.latitude is not null and x.latitude is not null then public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) end nulls last,
                 x.name)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and (x.source <> 'openstreetmap' or p.auto_places)
        and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000)
        and (full_access or (x.source <> 'openstreetmap'
             and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) >= 300)))), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 4. Garde-fou aussi à la création : une demande d'horaire ne naît jamais « confirmée »
-- ---------------------------------------------------------------------
create or replace function public.service_timing_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('early_checkin', 'late_checkout') and coalesce(current_setting('halo.timing_ok', true), '') <> '1' then
    if tg_op = 'INSERT' then
      if new.status not in ('requested', 'in_review', 'info_requested') then raise exception 'use_timing_decision' using errcode = '22023'; end if;
      return new;
    end if;
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then raise exception 'use_timing_decision' using errcode = '22023'; end if;
    if old.status = 'confirmed' and new.status = 'cancelled' then raise exception 'use_timing_decision' using errcode = '22023'; end if;
    if old.status = 'confirmed' and new.start_at is distinct from old.start_at then raise exception 'use_timing_decision' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
drop trigger service_requests_timing_guard on public.service_requests;
create trigger service_requests_timing_guard before insert or update on public.service_requests for each row execute function public.service_timing_guard();
