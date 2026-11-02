-- =====================================================================
-- Migration 16 — arrivée anticipée / départ tardif cohérents, absences (conflit ou risque),
-- confidentialité des lieux avant l'ouverture, chevauchement de séjours sous verrou
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Séjours qui se chevauchent : contrôle sous verrou par logement (deux créations simultanées
--    ne peuvent plus passer toutes les deux). Le contrôle relit les séjours après le verrou.
-- ---------------------------------------------------------------------
create or replace function public.check_stay_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and new.check_in_at = old.check_in_at and new.check_out_at = old.check_out_at
     and new.property_id = old.property_id and old.status = 'confirmed' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stay:' || new.property_id::text, 0));
  if exists (select 1 from public.reservations o
             where o.organization_id = new.organization_id and o.property_id = new.property_id and o.id <> new.id
               and o.status = 'confirmed' and o.check_in_at < new.check_out_at and o.check_out_at > new.check_in_at) then
    raise exception 'stay_overlap' using errcode = '23P01';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Absences : conflit confirmé ou risque à examiner
--    - horaire planifié : toute absence qui le chevauche = conflit ;
--    - sans horaire : conflit seulement si le plus long temps libre de la fenêtre (hors absences acceptées)
--      est plus court que la durée prévue ; sinon risque (absence sur une partie de la fenêtre).
-- ---------------------------------------------------------------------
create function public.task_absence_level(org uuid, member uuid, w_start timestamptz, w_end timestamptz, sched timestamptz, duration int) returns text
language plpgsql stable security definer set search_path = '' as $$
declare overlapping boolean;
begin
  select exists (
    select 1 from public.absences a
    join public.memberships m on m.organization_id = a.organization_id and m.user_id = member
    where a.organization_id = org and a.status = 'accepted'
      and ((a.scope = 'member' and a.member_id = member) or (a.scope = 'team' and (a.team_position is null or a.team_position = m.position)))
      and a.starts_at < coalesce(sched + make_interval(mins => duration), w_end)
      and a.ends_at > coalesce(sched, w_start)) into overlapping;
  if not overlapping then return 'none'; end if;
  if sched is not null then return 'conflict'; end if;
  return case when public.free_minutes_of(org, member, w_start, w_end) >= duration then 'risk' else 'conflict' end;
end $$;
revoke all on function public.task_absence_level(uuid, uuid, timestamptz, timestamptz, timestamptz, int) from public, anon, authenticated;

-- Utilisé par l'affectation et la correction de créneau : seul un conflit confirmé est refusé
create or replace function public.task_slot_overlaps_absence(org uuid, member uuid, w_start timestamptz, w_end timestamptz,
                                                             sched timestamptz, duration int) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.task_absence_level(org, member, w_start, w_end, sched, duration) = 'conflict';
$$;

-- Missions affectées touchées par une absence acceptée (alerte équipe) : conflits confirmés et risques comptés
create or replace function public.absence_conflicts(org uuid, absence uuid) returns int
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

-- ---------------------------------------------------------------------
-- 3. Arrivée anticipée / départ tardif : décision explicite, séjour et échéances mis à jour ensemble
-- ---------------------------------------------------------------------
alter table public.service_requests add column timing_previous_at timestamptz, add column timing_applied_at timestamptz;

alter table public.stay_prep_events drop constraint stay_prep_events_kind_check;
alter table public.stay_prep_events add constraint stay_prep_events_kind_check check (kind in (
  'invite_created', 'invite_sent', 'opened', 'guest_saved', 'guest_submitted', 'guest_updated', 'guest_deleted',
  'status_changed', 'status_reverted', 'action_created', 'action_done', 'action_cancelled', 'action_reopened', 'action_forced', 'action_auto_done',
  'mission_cancelled', 'mission_reopened', 'stay_time_changed',
  'item_published', 'item_unpublished',
  'vip_requested', 'vip_guest_reply', 'vip_info_requested', 'vip_accepted', 'vip_refused', 'vip_granted', 'vip_revoked'));

-- Confirmer ou annuler une demande d'horaire ne passe QUE par timing_decide (jamais par la décision générique)
create function public.service_timing_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('early_checkin', 'late_checkout') and coalesce(current_setting('halo.timing_ok', true), '') <> '1' then
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then raise exception 'use_timing_decision' using errcode = '22023'; end if;
    if old.status = 'confirmed' and new.status = 'cancelled' then raise exception 'use_timing_decision' using errcode = '22023'; end if;
    if old.status = 'confirmed' and new.start_at is distinct from old.start_at then raise exception 'use_timing_decision' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke all on function public.service_timing_guard() from public, anon, authenticated;
create trigger service_requests_timing_guard before update on public.service_requests for each row execute function public.service_timing_guard();

-- Contraintes connues avant décision (lecture seule) : faits, risques, points non vérifiés
create function public.timing_check(org uuid, service uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; k public.tasks; risks jsonb := '[]'::jsonb; blocking jsonb := '[]'::jsonb;
        cur timestamptz; req timestamptz; acts jsonb; early boolean;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service;
  if s.id is null or s.kind not in ('early_checkin', 'late_checkout') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.reservations where organization_id = org and id = s.reservation_id;
  if r.id is null then return jsonb_build_object('status', 'no_stay'); end if;
  early := s.kind = 'early_checkin';
  req := s.start_at;
  cur := case when early then r.check_in_at else r.check_out_at end;
  if (early and req >= cur) or (not early and req <= cur) then
    return jsonb_build_object('status', 'ok', 'kind', s.kind, 'requested_at', req, 'current_at', cur, 'change', false, 'risks', risks, 'blocking', blocking);
  end if;
  -- Ménage concerné : celui avant l'arrivée (arrivée anticipée) ou celui après le départ (départ tardif)
  select * into k from public.tasks
   where organization_id = org and type = 'turnover' and status <> 'cancelled'
     and ((early and next_reservation_id = r.id) or (not early and reservation_id = r.id))
   order by created_at desc limit 1;
  if k.id is null then
    risks := risks || '["no_cleaning"]'::jsonb;
  elsif k.status not in ('done', 'validated') then
    if early and k.window_start + make_interval(mins => k.duration_min) > req then blocking := blocking || '["cleaning_cannot_fit"]'::jsonb; end if;
    if not early and req + make_interval(mins => k.duration_min) > k.window_end then blocking := blocking || '["cleaning_cannot_fit"]'::jsonb; end if;
    if k.assignee_id is null then risks := risks || '["cleaning_unassigned"]'::jsonb; end if;
    if k.scheduled_start is not null and early and k.scheduled_start + make_interval(mins => k.duration_min) > req then risks := risks || '["cleaning_scheduled_after"]'::jsonb; end if;
    if k.scheduled_start is not null and not early and k.scheduled_start < req then risks := risks || '["cleaning_scheduled_before"]'::jsonb; end if;
    -- Affecté sans horaire planifié : rien ne garantit qu'il sera fait avant l'horaire demandé
    if k.status <> 'done' and k.assignee_id is not null and k.scheduled_start is null then risks := risks || '["cleaning_not_planned"]'::jsonb; end if;
  end if;
  -- Actions indispensables encore ouvertes, dont l'échéance tombe après l'horaire demandé (ou sans échéance)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at, 'task_status', (select status from public.tasks t where t.id = a.task_id))), '[]'::jsonb)
    into acts from public.stay_prep_actions a
   where a.organization_id = org and a.reservation_id = r.id and a.status = 'open' and a.blocking and early and (a.due_at is null or a.due_at > req);
  if jsonb_array_length(acts) > 0 then risks := risks || '["prep_actions_open"]'::jsonb; end if;
  return jsonb_build_object('status', 'ok', 'kind', s.kind, 'requested_at', req, 'current_at', cur, 'change', true,
    'cleaning', case when k.id is null then null else jsonb_build_object('id', k.id, 'status', k.status, 'assignee_id', k.assignee_id, 'window_start', k.window_start,
                 'window_end', k.window_end, 'duration_min', k.duration_min, 'scheduled_start', k.scheduled_start) end,
    'actions', acts, 'risks', risks, 'blocking', blocking,
    -- Jamais vérifié par HALO : à confirmer par l'équipe
    'unverified', '["linen", "access", "owner_rules"]'::jsonb);
end $$;
revoke all on function public.timing_check(uuid, uuid) from public, anon;
grant execute on function public.timing_check(uuid, uuid) to authenticated;

create function public.timing_decide(org uuid, service uuid, act text, ack boolean default false, expected_at timestamptz default null,
                                     guest_message text default null, internal_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; chk jsonb; early boolean; cur timestamptz; req timestamptz; uid uuid := (select auth.uid());
        note text; res jsonb;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service for update;
  if s.id is null or s.kind not in ('early_checkin', 'late_checkout') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.reservations where organization_id = org and id = s.reservation_id for update;
  early := s.kind = 'early_checkin';
  if act = 'confirm' then
    if s.status = 'confirmed' then return jsonb_build_object('status', 'already'); end if;
    if s.status not in ('requested', 'in_review', 'info_requested') then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
    if r.id is null then return jsonb_build_object('status', 'no_stay'); end if;
    cur := case when early then r.check_in_at else r.check_out_at end;
    -- Séjour modifié depuis l'affichage de la page : on ne décide pas sur des données périmées
    if expected_at is not null and expected_at <> cur then return jsonb_build_object('status', 'stay_changed', 'current_at', cur); end if;
    chk := public.timing_check(org, service);
    if jsonb_array_length(chk -> 'blocking') > 0 then return jsonb_build_object('status', 'not_feasible', 'check', chk); end if;
    if jsonb_array_length(chk -> 'risks') > 0 and not coalesce(ack, false) then return jsonb_build_object('status', 'risks', 'check', chk); end if;
    req := s.start_at;
    if (chk ->> 'change')::boolean then
      begin
        if early then update public.reservations set check_in_at = req where id = r.id;
        else update public.reservations set check_out_at = req where id = r.id; end if;
      exception when sqlstate '23P01' then
        return jsonb_build_object('status', 'not_feasible', 'check', chk || jsonb_build_object('blocking', '["stay_overlap"]'::jsonb));
      end;
      -- Échéances opérationnelles : la fin de fenêtre du ménage suit l'arrivée (jamais l'horaire planifié, qui reste tel quel)
      if early then
        update public.tasks set window_end = req
         where organization_id = org and next_reservation_id = r.id and status not in ('done', 'validated', 'cancelled') and window_end > req;
        update public.stay_prep_actions set due_at = req
         where organization_id = org and reservation_id = r.id and status = 'open' and due_at = cur;
      else
        update public.tasks set window_start = req
         where organization_id = org and reservation_id = r.id and status not in ('done', 'validated', 'cancelled') and window_start < req;
      end if;
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
      values (org, r.id, 'stay_time_changed', uid, (case when early then 'check_in:' else 'check_out:' end) || to_char(cur at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || '>' || to_char(req at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
      update public.service_requests set timing_previous_at = cur, timing_applied_at = req where id = s.id;
    end if;
    note := nullif(trim(coalesce(internal_note, '')), '');
    if jsonb_array_length(chk -> 'risks') > 0 then
      note := concat_ws(E'\n', note, 'Confirmé en connaissance de cause : ' || (select string_agg(x, ', ') from jsonb_array_elements_text(chk -> 'risks') x));
    end if;
    perform set_config('halo.timing_ok', '1', true);
    res := public.decide_service(org, service, 'confirmed', guest_message, note);
    perform set_config('halo.timing_ok', '', true);
    return jsonb_build_object('status', 'applied', 'changed', (chk ->> 'change')::boolean, 'risks_accepted', chk -> 'risks', 'property', s.property_id, 'email_queued', res -> 'email_queued');
  elsif act = 'cancel' then
    if s.status = 'cancelled' then return jsonb_build_object('status', 'already'); end if;
    if s.status <> 'confirmed' then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
    -- Retour à l'horaire précédent seulement si le séjour n'a pas été modifié depuis
    if s.timing_applied_at is not null and r.id is not null then
      cur := case when early then r.check_in_at else r.check_out_at end;
      if cur <> s.timing_applied_at then return jsonb_build_object('status', 'stay_changed', 'current_at', cur); end if;
      begin
        if early then update public.reservations set check_in_at = s.timing_previous_at where id = r.id;
        else update public.reservations set check_out_at = s.timing_previous_at where id = r.id; end if;
      exception when sqlstate '23P01' then
        return jsonb_build_object('status', 'not_feasible', 'check', jsonb_build_object('blocking', '["stay_overlap"]'::jsonb));
      end;
      -- Échéances remises comme avant (seulement celles que la confirmation avait déplacées)
      if early then
        update public.tasks set window_end = s.timing_previous_at
         where organization_id = org and next_reservation_id = r.id and status not in ('done', 'validated', 'cancelled') and window_end = s.timing_applied_at;
        update public.stay_prep_actions set due_at = s.timing_previous_at
         where organization_id = org and reservation_id = r.id and status = 'open' and due_at = s.timing_applied_at;
      else
        update public.tasks set window_start = s.timing_previous_at
         where organization_id = org and reservation_id = r.id and status not in ('done', 'validated', 'cancelled') and window_start = s.timing_applied_at;
      end if;
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
      values (org, r.id, 'stay_time_changed', uid, (case when early then 'check_in:' else 'check_out:' end) || to_char(s.timing_applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || '>' || to_char(s.timing_previous_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
    end if;
    perform set_config('halo.timing_ok', '1', true);
    res := public.decide_service(org, service, 'cancelled', guest_message, internal_note);
    perform set_config('halo.timing_ok', '', true);
    return jsonb_build_object('status', 'applied', 'restored', s.timing_applied_at is not null, 'property', s.property_id);
  end if;
  raise exception 'invalid' using errcode = '22023';
end $$;
revoke all on function public.timing_decide(uuid, uuid, text, boolean, timestamptz, text, text) from public, anon;
grant execute on function public.timing_decide(uuid, uuid, text, boolean, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Lieux avant l'ouverture des informations pratiques : aucune donnée permettant de localiser le logement
--    - pas de distance exacte (tranche « moins de 1 km », « 1 à 2 km », « 2 à 3 km ») ;
--    - lieux à moins de 300 m du logement retenus jusqu'à l'ouverture (seul leur nombre est indiqué) ;
--    - ordre alphabétique (l'ordre par distance trahirait la position) ; lieux sans coordonnées inchangés.
-- ---------------------------------------------------------------------
create or replace function public.guest_places(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations; p public.properties; full_access boolean; near_hidden int := 0;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  if not full_access and p.latitude is not null then
    select count(*) into near_hidden from public.property_places x
     where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden and (x.source <> 'openstreetmap' or p.auto_places)
       and x.latitude is not null and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) < 300;
  end if;
  return jsonb_build_object('status', 'ok', 'full', full_access, 'near_hidden', near_hidden,
    'property', jsonb_build_object('name', p.name, 'address', case when full_access then p.address_line end,
      'postal_code', case when full_access then p.postal_code end, 'city', p.city, 'country_code', p.country_code,
      'lat', case when full_access then p.latitude end, 'lng', case when full_access then p.longitude end),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'name', x.name,
        'description', x.description, 'address', x.address, 'lat', x.latitude, 'lng', x.longitude, 'opening_hours', x.opening_hours,
        'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at, 'created_at', x.created_at, 'verified_at', x.verified_at,
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
        and (full_access or x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) >= 300)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 5. Demande de séjour : double envoi simultané sans erreur (identifiant d'envoi déjà utilisé = même demande)
-- ---------------------------------------------------------------------
create or replace function public.booking_submit(token text, client uuid, d_in date, d_out date, n_adults int, n_children int, n_babies int,
                                      c_name text, c_email text, c_phone text, msg text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.booking_links; r public.reservations; prev public.booking_requests; rid uuid; busy boolean;
begin
  l := public.booking_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into prev from public.booking_requests where organization_id = l.organization_id and client_id = client;
  if prev.id is not null then return jsonb_build_object('status', 'ok', 'id', prev.id, 'replayed', true); end if;
  if d_in is null or d_out is null or d_out <= d_in or d_in < current_date then return jsonb_build_object('status', 'invalid_dates'); end if;
  if (select count(*) from public.booking_requests where organization_id = l.organization_id and link_id = l.id and status in ('received', 'in_review', 'info_requested', 'offer_sent', 'accepted')) >= 3 then
    return jsonb_build_object('status', 'too_many');
  end if;
  select * into r from public.reservations where organization_id = l.organization_id and id = l.reservation_id;
  busy := public.dates_conflict(l.organization_id, r.property_id, d_in, d_out);
  insert into public.booking_requests (organization_id, link_id, client_id, origin_reservation_id, property_id, check_in, check_out, adults, children, babies,
                                       contact_name, contact_email, contact_phone, message)
  values (l.organization_id, l.id, client, r.id, r.property_id, d_in, d_out, greatest(coalesce(n_adults, 1), 1), coalesce(n_children, 0), coalesce(n_babies, 0),
          left(trim(c_name), 120), lower(trim(c_email)), nullif(left(trim(coalesce(c_phone, '')), 40), ''), nullif(left(trim(coalesce(msg, '')), 2000), ''))
  on conflict (organization_id, client_id) do nothing
  returning id into rid;
  -- Double envoi simultané (double clic) : la seconde requête retrouve la première, sans erreur ni doublon
  if rid is null then
    select id into rid from public.booking_requests where organization_id = l.organization_id and client_id = client;
    return jsonb_build_object('status', 'ok', 'id', rid, 'replayed', true);
  end if;
  insert into public.booking_request_events (organization_id, request_id, kind) values (l.organization_id, rid, 'received');
  perform public.queue_team_email(l.organization_id, 'team_booking_requested',
    jsonb_build_object('guest', left(trim(c_name), 120), 'property', (select name from public.properties where id = r.property_id), 'path', '/app/bookings/' || rid), null, null, null);
  return jsonb_build_object('status', 'ok', 'id', rid, 'replayed', false, 'known_conflict', busy);
end $$;
