-- =====================================================================
-- Migration 18 — horaires confirmés successivement (une seule heure applicable, confirmations
-- remplacées explicites et réversibles), libellés d'historique fidèles, effets détaillés sur les
-- actions, notifications d'horaire à jour sans doublon, lieux et recommandations sans position précise
-- avant l'ouverture des informations pratiques.
-- Réversible : ajouts de colonnes et de fonctions, remplacements de fonctions ; retour arrière dans docs/16.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Confirmation remplacée par une décision ultérieure : lien explicite, jamais de suppression
-- ---------------------------------------------------------------------
alter table public.service_requests add column superseded_by uuid, add column superseded_at timestamptz;
alter table public.service_requests add constraint service_requests_superseded_fk
  foreign key (organization_id, superseded_by) references public.service_requests (organization_id, id) on delete set null (superseded_by);

-- Événement d'horaire visible du voyageur (remplacé, appliqué au séjour, rétabli), avec l'heure concernée
alter table public.service_events add column ref_at timestamptz;
alter table public.service_events drop constraint service_events_kind_check;
alter table public.service_events add constraint service_events_kind_check
  check (kind in ('created', 'status', 'guest_message', 'team_message', 'internal_note', 'updated', 'timing'));

-- État d'une demande d'horaire (règle métier unique, utilisée partout) :
--   pending        demande en attente ;
--   applied        confirmée ET heure du séjour = heure confirmée : c'est l'horaire applicable ;
--   superseded     confirmée puis remplacée par une confirmation ultérieure encore valable ;
--   covered        confirmée, le séjour a été modifié autrement mais la promesse reste tenue
--                  (arrivée encore plus tôt / départ encore plus tard) ;
--   contradiction  confirmée, promesse non tenue par le séjour : intervention du responsable ;
--   declined / cancelled / done / no_stay.
create function public.timing_state(s public.service_requests, r public.reservations) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when s.kind not in ('early_checkin', 'late_checkout') then null
    when s.status in ('requested', 'in_review', 'info_requested') then 'pending'
    when s.status <> 'confirmed' then s.status
    when r.id is null then 'no_stay'
    when s.start_at = case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end then 'applied'
    when s.superseded_by is not null and exists (select 1 from public.service_requests b
           where b.organization_id = s.organization_id and b.id = s.superseded_by and b.status = 'confirmed') then 'superseded'
    when (s.kind = 'early_checkin' and r.check_in_at < s.start_at) or (s.kind = 'late_checkout' and r.check_out_at > s.start_at) then 'covered'
    else 'contradiction' end;
$$;
revoke all on function public.timing_state(public.service_requests, public.reservations) from public, anon, authenticated;

-- États de toutes les demandes d'horaire (responsables) : liste, fiche séjour, fiche demande
create function public.timing_states(org uuid, reservation uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('service', s.id, 'reservation', s.reservation_id, 'state', public.timing_state(s, r),
           'stay_at', case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end,
           'superseded_by', s.superseded_by, 'superseded_by_at', (select b.start_at from public.service_requests b where b.organization_id = org and b.id = s.superseded_by))), '[]'::jsonb)
  from public.service_requests s
  left join public.reservations r on r.organization_id = s.organization_id and r.id = s.reservation_id
  where s.organization_id = org and public.is_manager(org) and s.kind in ('early_checkin', 'late_checkout')
    and (reservation is null or s.reservation_id = reservation);
$$;
revoke all on function public.timing_states(uuid, uuid) from public, anon;
grant execute on function public.timing_states(uuid, uuid) to authenticated;

-- Garde-fou : statut, heure confirmée, remplacement et horaire appliqué ne changent que par la décision dédiée
create or replace function public.service_timing_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sys boolean := coalesce(current_setting('halo.timing_ok', true), '') = '1' or coalesce(current_setting('halo.timing_sys', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    if (new.superseded_by is not null or new.timing_applied_at is not null or new.timing_previous_at is not null) and not sys then
      raise exception 'use_timing_decision' using errcode = '22023';
    end if;
  elsif not sys and (new.superseded_by is distinct from old.superseded_by or new.timing_applied_at is distinct from old.timing_applied_at
                     or new.timing_previous_at is distinct from old.timing_previous_at) then
    raise exception 'use_timing_decision' using errcode = '22023';
  end if;
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

-- ---------------------------------------------------------------------
-- 2. Application d'un horaire : séjour, missions, échéances, puis confirmations antérieures remplacées
-- ---------------------------------------------------------------------
create or replace function public.timing_apply(org uuid, s public.service_requests, r public.reservations, early boolean, req timestamptz, uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur timestamptz := case when early then r.check_in_at else r.check_out_at end; fx jsonb; e jsonb; delta interval := req - cur; o record;
begin
  perform set_config('halo.timing_sys', '1', true);
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
  end loop;
  if early then
    update public.stay_prep_actions set due_at = req where organization_id = org and reservation_id = r.id and status = 'open' and due_at = cur;
  end if;
  insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
  values (org, r.id, 'stay_time_changed', uid, (case when early then 'check_in:' else 'check_out:' end) || to_char(cur at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || '>' || to_char(req at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
  update public.service_requests set timing_previous_at = cur, timing_applied_at = req, superseded_by = null, superseded_at = null where id = s.id;
  -- Les autres confirmations du même type pour ce séjour ne sont plus l'horaire applicable : remplacées (historique conservé)
  for o in select id from public.service_requests
            where organization_id = org and reservation_id = r.id and kind = s.kind and status = 'confirmed' and id <> s.id and superseded_by is null loop
    update public.service_requests set superseded_by = s.id, superseded_at = now(), guest_unread = true where id = o.id;
    insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind, author_id, ref_at)
    values (org, o.id, 'timing', 'superseded', 'guest', 'member', uid, req);
  end loop;
  perform set_config('halo.timing_sys', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 3. Vérification avant décision : état, effets sur chaque mission ET chaque action, inconnues
-- ---------------------------------------------------------------------
create or replace function public.timing_check(org uuid, service uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; risks jsonb := '[]'::jsonb; blocking jsonb := '[]'::jsonb;
        cur timestamptz; req timestamptz; acts jsonb; early boolean; fx jsonb; k public.tasks; st text; inc jsonb; done_actions int;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service;
  if s.id is null or s.kind not in ('early_checkin', 'late_checkout') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.reservations where organization_id = org and id = s.reservation_id;
  if r.id is null then return jsonb_build_object('status', 'no_stay'); end if;
  early := s.kind = 'early_checkin';
  req := s.start_at;
  cur := case when early then r.check_in_at else r.check_out_at end;
  st := public.timing_state(s, r);
  if (early and req >= cur) or (not early and req <= cur) then
    return jsonb_build_object('status', 'ok', 'kind', s.kind, 'requested_at', req, 'current_at', cur, 'change', false,
      'state', st, 'legacy_mismatch', st = 'contradiction',
      'superseded_by', s.superseded_by, 'superseded_by_at', (select b.start_at from public.service_requests b where b.organization_id = org and b.id = s.superseded_by),
      -- Rien à modifier : l'heure applicable est déjà égale ou plus favorable que la demande
      'no_change', case when req = cur then 'same_time' else 'already_better' end,
      'risks', risks, 'blocking', blocking, 'tasks', '[]'::jsonb, 'actions', '[]'::jsonb);
  end if;
  fx := public.timing_effects(org, r, early, req);
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'effect' = 'blocking') then blocking := blocking || '["cleaning_cannot_fit"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'effect' = 'unchanged_cannot_fit') then risks := risks || '["mission_cannot_fit"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'effect' in ('deadline_scheduled_after', 'start_scheduled_before', 'unchanged_scheduled')) then risks := risks || '["mission_scheduled"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(fx) e where e ->> 'status' in ('in_progress', 'to_redo')) then risks := risks || '["mission_in_progress"]'::jsonb; end if;
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
  -- Actions indispensables ouvertes : effet réel selon l'échéance renseignée (ou son absence)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at,
           'task_status', (select status from public.tasks t where t.id = a.task_id),
           'effect', case when a.due_at is null then 'no_due' when a.due_at = cur then 'due_moved' when a.due_at > req then 'due_after' else 'due_before' end)
           order by a.due_at nulls last), '[]'::jsonb)
    into acts from public.stay_prep_actions a
   where a.organization_id = org and a.reservation_id = r.id and a.status = 'open' and a.blocking and early;
  select count(*) into done_actions from public.stay_prep_actions a
   where a.organization_id = org and a.reservation_id = r.id and a.blocking and a.status <> 'open' and early;
  if exists (select 1 from jsonb_array_elements(acts) a where a ->> 'effect' in ('due_moved', 'due_after')) then risks := risks || '["prep_actions_late"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(acts) a where a ->> 'effect' = 'no_due') then risks := risks || '["prep_actions_no_due"]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(acts) a where a ->> 'effect' = 'due_before') then risks := risks || '["prep_actions_open"]'::jsonb; end if;
  -- Incidents et problèmes de linge ouverts sur le logement : signalés (HALO ne sait pas s'ils seront réglés à temps)
  select jsonb_build_object('open', count(*) filter (where i.category <> 'linen'), 'linen', count(*) filter (where i.category = 'linen'))
    into inc from public.incidents i where i.organization_id = org and i.property_id = r.property_id and i.status in ('open', 'in_progress');
  if (inc ->> 'open')::int > 0 then risks := risks || '["incidents_open"]'::jsonb; end if;
  if (inc ->> 'linen')::int > 0 then risks := risks || '["linen_issue_open"]'::jsonb; end if;
  return jsonb_build_object('status', 'ok', 'kind', s.kind, 'requested_at', req, 'current_at', cur, 'change', true,
    'state', st, 'legacy_mismatch', st = 'contradiction',
    'cleaning', case when k.id is null then null else jsonb_build_object('id', k.id, 'status', k.status, 'assignee_id', k.assignee_id, 'window_start', k.window_start,
                 'window_end', k.window_end, 'duration_min', k.duration_min, 'scheduled_start', k.scheduled_start) end,
    'tasks', fx, 'actions', acts, 'done_actions', done_actions, 'incidents', inc, 'risks', risks, 'blocking', blocking,
    'unverified', '["linen_stock", "access", "owner_rules", "travel"]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Décision : confirmer, appliquer une confirmation contradictoire, retirer / annuler
-- ---------------------------------------------------------------------
create or replace function public.timing_decide(org uuid, service uuid, act text, ack boolean default false, expected_at timestamptz default null,
                                     guest_message text default null, internal_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; chk jsonb; early boolean; cur timestamptz; uid uuid := (select auth.uid());
        note text; res jsonb; st text; restored boolean := false; after_at timestamptz; o record; tz text;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service for update;
  if s.id is null or s.kind not in ('early_checkin', 'late_checkout') then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Verrou du séjour : deux décisions sur deux demandes du même séjour passent l'une après l'autre
  select * into r from public.reservations where organization_id = org and id = s.reservation_id for update;
  early := s.kind = 'early_checkin';
  if r.id is not null then cur := case when early then r.check_in_at else r.check_out_at end; end if;
  st := public.timing_state(s, r);
  select timezone into tz from public.properties where organization_id = org and id = s.property_id;

  if act in ('confirm', 'apply_legacy') then
    if act = 'confirm' and s.status = 'confirmed' then return jsonb_build_object('status', 'already'); end if;
    if act = 'confirm' and s.status not in ('requested', 'in_review', 'info_requested') then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
    if act = 'apply_legacy' and st = 'superseded' then return jsonb_build_object('status', 'superseded'); end if;
    if act = 'apply_legacy' and st is distinct from 'contradiction' then return jsonb_build_object('status', 'already'); end if;
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
    after_at := case when (chk ->> 'change')::boolean then s.start_at else cur end;
    if act = 'apply_legacy' then
      insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind, author_id)
      values (org, s.id, 'internal_note', left(concat_ws(E'\n', 'Confirmation contradictoire appliquée au séjour.', note), 2000), 'internal', 'member', uid);
      -- Côté voyageur : une information d'horaire (pas une nouvelle demande), puis le message éventuel de l'équipe
      insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind, author_id, ref_at)
      values (org, s.id, 'timing', 'applied', 'guest', 'member', uid, after_at);
      if nullif(trim(coalesce(guest_message, '')), '') is not null then
        insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind, author_id)
        values (org, s.id, 'team_message', left(trim(guest_message), 2000), 'guest', 'member', uid);
      end if;
      update public.service_requests set guest_unread = true where id = s.id;
      perform public.timing_email(org, s, r, 'timing_updated', after_at, tz, guest_message);
      return jsonb_build_object('status', 'applied', 'changed', (chk ->> 'change')::boolean, 'property', s.property_id, 'stay_at', after_at);
    end if;
    perform set_config('halo.timing_ok', '1', true);
    res := public.decide_service(org, service, 'confirmed', guest_message, note);
    perform set_config('halo.timing_ok', '', true);
    perform public.timing_email_retarget(org, s, r, 'confirmed', after_at, tz);
    return jsonb_build_object('status', 'applied', 'changed', (chk ->> 'change')::boolean, 'risks_accepted', chk -> 'risks', 'property', s.property_id,
                              'email_queued', res -> 'email_queued', 'stay_at', after_at);

  elsif act = 'cancel' then
    if s.status = 'cancelled' then return jsonb_build_object('status', 'already'); end if;
    if s.status <> 'confirmed' then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
    perform set_config('halo.timing_sys', '1', true);
    -- Retour à l'horaire précédent seulement si l'horaire du séjour est toujours celui que cette décision a appliqué ;
    -- sinon (séjour modifié depuis, confirmation remplacée ou jamais appliquée) le séjour n'est pas touché
    if st = 'applied' and s.timing_applied_at is not null and cur = s.timing_applied_at then
      begin
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
        perform set_config('halo.timing_sys', '', true);
        return jsonb_build_object('status', 'not_feasible', 'check', jsonb_build_object('blocking', '["stay_overlap"]'::jsonb));
      end;
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
      values (org, r.id, 'stay_time_changed', uid, (case when early then 'check_in:' else 'check_out:' end) || to_char(s.timing_applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || '>' || to_char(s.timing_previous_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
      restored := true;
    end if;
    after_at := case when r.id is null then null when restored then s.timing_previous_at else cur end;
    if s.superseded_by is not null then
      -- Confirmation déjà remplacée : la retirer de la chaîne (la suivante reviendra, si on l'annule, à l'horaire d'avant celle-ci)
      update public.service_requests set timing_previous_at = s.timing_previous_at
       where organization_id = org and id = s.superseded_by and s.timing_applied_at is not null and timing_previous_at = s.timing_applied_at;
      update public.service_requests set superseded_by = s.superseded_by where organization_id = org and superseded_by = s.id;
    else
      -- Les confirmations que celle-ci avait remplacées redeviennent examinées selon l'horaire réel du séjour
      for o in select id from public.service_requests where organization_id = org and superseded_by = s.id loop
        update public.service_requests set superseded_by = null, superseded_at = null, guest_unread = true where id = o.id;
        insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind, author_id, ref_at)
        values (org, o.id, 'timing', 'reinstated', 'guest', 'member', uid, after_at);
      end loop;
    end if;
    perform set_config('halo.timing_sys', '', true);
    perform set_config('halo.timing_ok', '1', true);
    res := public.decide_service(org, service, 'cancelled', guest_message, internal_note);
    perform set_config('halo.timing_ok', '', true);
    if r.id is not null then perform public.timing_email_retarget(org, s, r, 'cancelled', after_at, tz); end if;
    return jsonb_build_object('status', 'applied', 'restored', restored, 'property', s.property_id, 'stay_at', after_at);
  end if;
  raise exception 'invalid' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------
-- 5. E-mails d'horaire : l'heure applicable figure dans le message ; un e-mail encore en attente et
--    devenu obsolète (décision plus récente sur le même séjour) n'est jamais envoyé
-- ---------------------------------------------------------------------
create function public.timing_email_obsolete(org uuid, reservation uuid) returns void
language sql security definer set search_path = '' as $$
  update public.notification_outbox set status = 'skipped', last_error = 'superseded_by_newer_decision'
   where organization_id = org and reservation_id = reservation and status = 'pending' and template like 'timing\_%' and created_at < now();
$$;
revoke all on function public.timing_email_obsolete(uuid, uuid) from public, anon, authenticated;

create function public.timing_email(org uuid, s public.service_requests, r public.reservations, tpl text, at timestamptz, tz text, msg text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.timing_email_obsolete(org, r.id);
  perform public.queue_guest_email(r, tpl, jsonb_build_object('kind', s.kind, 'stay_at', at, 'tz', coalesce(tz, 'UTC'),
    'message', nullif(trim(coalesce(msg, '')), '')), s.id);
end $$;
revoke all on function public.timing_email(uuid, public.service_requests, public.reservations, text, timestamptz, text, text) from public, anon, authenticated;

-- L'e-mail générique mis en file par decide_service devient un e-mail d'horaire précisant l'heure applicable
create function public.timing_email_retarget(org uuid, s public.service_requests, r public.reservations, new_status text, at timestamptz, tz text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.timing_email_obsolete(org, r.id);
  update public.notification_outbox
     set template = 'timing_' || new_status, payload = payload || jsonb_build_object('stay_at', at, 'tz', coalesce(tz, 'UTC'))
   where organization_id = org and service_id = s.id and template = 'service_' || new_status and created_at = now();
end $$;
revoke all on function public.timing_email_retarget(uuid, public.service_requests, public.reservations, text, timestamptz, text) from public, anon, authenticated;

-- Envoi : chaque e-mail en attente est réservé par un seul envoi (deux traitements simultanés ne l'envoient pas deux fois).
-- Un e-mail réservé et jamais terminé (coupure) redevient disponible après 10 minutes.
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'not_configured', 'skipped'));
alter table public.notification_outbox add column claimed_at timestamptz;

create function public.outbox_claim(org uuid, n int default 20) returns setof public.notification_outbox
language sql security definer set search_path = '' as $$
  update public.notification_outbox o set status = 'sending', claimed_at = now()
   where o.id in (select x.id from public.notification_outbox x
                   where (x.status = 'pending' or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes'))
                     and (org is null or x.organization_id = org)
                   order by x.created_at limit greatest(1, least(n, 50)) for update skip locked)
  returning o.*;
$$;
revoke all on function public.outbox_claim(uuid, int) from public, anon, authenticated;
grant execute on function public.outbox_claim(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- 6. Alertes : seulement les vraies contradictions (une confirmation remplacée n'est pas une anomalie)
-- ---------------------------------------------------------------------
create or replace function public.timing_inconsistencies(org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('service', s.id, 'reservation', r.id, 'kind', s.kind, 'guest_name', r.guest_name,
           'confirmed_at', s.start_at, 'stay_at', case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end) order by s.start_at), '[]'::jsonb)
  from public.service_requests s join public.reservations r on r.organization_id = s.organization_id and r.id = s.reservation_id
  where s.organization_id = org and public.is_manager(org) and s.kind in ('early_checkin', 'late_checkout') and s.status = 'confirmed'
    and r.status = 'confirmed' and r.check_out_at > now() - interval '1 day'
    and public.timing_state(s, r) = 'contradiction';
$$;

-- ---------------------------------------------------------------------
-- 7. Données existantes (aucune suppression, aucune modification de séjour) :
--    pour chaque séjour, si UNE confirmation est l'horaire applicable (heure confirmée = heure du séjour,
--    appliquée par la décision dédiée), les autres confirmations du même type, décidées AVANT son application,
--    sont marquées « remplacées » (événement voyageur + note interne). Cas ambigus laissés tels quels :
--    aucune confirmation applicable, plusieurs candidates, ou confirmation décidée après l'application.
-- ---------------------------------------------------------------------
do $$
declare o record; owner record; n int;
begin
  perform set_config('halo.timing_sys', '1', true);
  for o in
    select s.*, r.check_in_at, r.check_out_at from public.service_requests s
    join public.reservations r on r.organization_id = s.organization_id and r.id = s.reservation_id
    where s.kind in ('early_checkin', 'late_checkout') and s.status = 'confirmed' and s.superseded_by is null
      and s.start_at <> case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end
  loop
    select count(*) into n from public.service_requests a
     where a.organization_id = o.organization_id and a.reservation_id = o.reservation_id and a.kind = o.kind and a.status = 'confirmed'
       and a.id <> o.id and a.timing_applied_at is not null
       and a.start_at = case when o.kind = 'early_checkin' then o.check_in_at else o.check_out_at end;
    if n <> 1 then continue; end if;
    select a.id, a.start_at, (select max(e.at) from public.service_events e where e.organization_id = a.organization_id and e.service_id = a.id
                               and ((e.kind = 'status' and e.status = 'confirmed') or e.kind = 'internal_note')) as applied_at
      into owner from public.service_requests a
     where a.organization_id = o.organization_id and a.reservation_id = o.reservation_id and a.kind = o.kind and a.status = 'confirmed'
       and a.id <> o.id and a.timing_applied_at is not null
       and a.start_at = case when o.kind = 'early_checkin' then o.check_in_at else o.check_out_at end;
    if owner.applied_at is null or owner.applied_at <= (select max(e.at) from public.service_events e where e.organization_id = o.organization_id
                                                         and e.service_id = o.id and e.kind = 'status' and e.status = 'confirmed') then
      continue;
    end if;
    update public.service_requests set superseded_by = owner.id, superseded_at = now(), guest_unread = true where id = o.id;
    insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind, ref_at)
    values (o.organization_id, o.id, 'timing', 'superseded', 'guest', 'system', owner.start_at);
    insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind)
    values (o.organization_id, o.id, 'internal_note', 'Migration 18 : marquée « remplacée » par la confirmation ultérieure ' || owner.id || ' (aucune autre donnée modifiée).', 'internal', 'system');
  end loop;
  perform set_config('halo.timing_sys', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. Espace voyageur : état de chaque demande d'horaire, heure des événements d'horaire ;
--    recommandations publiées sans coordonnées ni adresse proche avant l'ouverture des informations pratiques
-- ---------------------------------------------------------------------
-- Adresse d'un lieu montrée avant l'ouverture seulement si sa distance au logement est connue et ≥ 300 m
create function public.guest_place_address_ok(p public.properties, x public.property_places) returns boolean
language sql stable security definer set search_path = '' as $$
  select p.latitude is not null and x.latitude is not null and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) >= 300;
$$;
revoke all on function public.guest_place_address_ok(public.properties, public.property_places) from public, anon, authenticated;

create or replace function public.get_guest_stay(token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reservations; l public.guest_links; p public.properties; g public.guest_guides; seen timestamptz; full_access boolean;
  pr public.stay_preparations; q public.vip_requests; v public.stay_vip; base jsonb;
  unavailable constant jsonb := jsonb_build_object('status', 'unavailable');
begin
  r := public.guest_link_any(token);
  if r.id is null then return unavailable; end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into l from public.guest_links where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  select * into g from public.guest_guides where organization_id = p.organization_id and property_id = p.id;
  if g.property_id is null or not g.enabled then return unavailable; end if;
  seen := l.last_opened_at;
  update public.guest_links set last_opened_at = now() where id = l.id;
  insert into public.stay_preparations (organization_id, reservation_id, questionnaire_status, opened_at)
  values (r.organization_id, r.id, 'opened', now())
  on conflict (organization_id, reservation_id) do update set
    opened_at = coalesce(public.stay_preparations.opened_at, now()),
    questionnaire_status = case when public.stay_preparations.questionnaire_status = 'not_started' then 'opened' else public.stay_preparations.questionnaire_status end;
  select * into pr from public.stay_preparations where organization_id = r.organization_id and reservation_id = r.id;
  select * into q from public.vip_requests where organization_id = r.organization_id and reservation_id = r.id order by created_at desc limit 1;
  select * into v from public.stay_vip where organization_id = r.organization_id and reservation_id = r.id;
  update public.service_requests set guest_unread = false where organization_id = r.organization_id and reservation_id = r.id and guest_unread;
  update public.stay_messages set read_by_guest_at = now() where organization_id = r.organization_id and reservation_id = r.id and author_kind = 'member' and read_by_guest_at is null;
  base := jsonb_build_object(
    'status', case when full_access then 'ok' else 'prep' end,
    'previously_opened_at', seen,
    'organization', (select jsonb_build_object('name', o.name, 'services_offered', to_jsonb(o.services_offered), 'prep_questions', to_jsonb(o.prep_questions)) from public.organizations o where o.id = r.organization_id),
    'property', jsonb_build_object('name', p.name, 'city', p.city, 'timezone', p.timezone,
      'check_in_time', p.default_check_in, 'check_out_time', p.default_check_out),
    'stay', jsonb_build_object('guest_name', r.guest_name, 'check_in_at', r.check_in_at, 'check_out_at', r.check_out_at,
      'adults', r.adults, 'children', r.children, 'babies', r.babies, 'link_valid_until', l.valid_until, 'details_from', l.valid_from,
      'guest_locale', r.guest_locale),
    'contact_phone', nullif(trim(coalesce(g.emergency_phone, '')), ''),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'start_at', s.start_at, 'people', s.people, 'details', s.details, 'status', s.status,
        'created_at', s.created_at,
        'timing_state', public.timing_state(s, r),
        'superseded_by_at', (select b.start_at from public.service_requests b where b.organization_id = s.organization_id and b.id = s.superseded_by),
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'status', e.status, 'body', e.body, 'author', e.author_kind, 'at', e.at, 'ref_at', e.ref_at) order by e.at, e.id)
                            from public.service_events e
                            where e.organization_id = s.organization_id and e.service_id = s.id and e.visibility = 'guest'), '[]'::jsonb))
        order by s.created_at desc)
      from public.service_requests s where s.organization_id = r.organization_id and s.reservation_id = r.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author_kind, 'body', m.body, 'at', m.created_at) order by m.created_at)
      from public.stay_messages m where m.organization_id = r.organization_id and m.reservation_id = r.id), '[]'::jsonb),
    'preparation', jsonb_build_object('questionnaire_status', pr.questionnaire_status, 'answers', pr.answers, 'updated_at', pr.guest_updated_at,
      'editable', now() < r.check_in_at),
    'prepared', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'title', i.title, 'body', i.body, 'url', i.url, 'published_at', i.published_at,
        'place', case when x.id is null then null else jsonb_build_object('category', x.category,
          'address', case when full_access or public.guest_place_address_ok(p, x) then x.address end,
          'lat', case when full_access then x.latitude end, 'lng', case when full_access then x.longitude end, 'source', x.source) end)
        order by i.published_at)
      from public.stay_guest_items i left join public.property_places x on x.id = i.place_id and x.organization_id = i.organization_id
      where i.organization_id = r.organization_id and i.reservation_id = r.id and i.published_at is not null), '[]'::jsonb),
    'vip', jsonb_build_object(
      'motifs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label) order by c.label) from public.vip_criteria c
                          where c.organization_id = r.organization_id and c.active and c.guest_visible), '[]'::jsonb),
      'request', case when q.id is null then null else jsonb_build_object('status', q.status, 'message', q.guest_message, 'created_at', q.created_at, 'decided_at', q.decided_at) end,
      'confirmed', coalesce(v.status = 'active' and (v.expires_at is null or v.expires_at > now()), false)));
  if not full_access then return base; end if;
  return base || jsonb_build_object(
    'property', (base -> 'property') || jsonb_build_object('address', p.address_line),
    'guide', jsonb_build_object('welcome', g.welcome, 'wifi_name', g.wifi_name, 'wifi_password', g.wifi_password,
      'house_rules', g.house_rules, 'checkout_instructions', g.checkout_instructions, 'parking', g.parking,
      'trash', g.trash, 'emergency_phone', g.emergency_phone, 'recommendations', g.recommendations));
end $$;

-- Lieux avant l'ouverture : adresse seulement si la distance est connue et ≥ 300 m (sinon nom et catégorie)
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
        'description', x.description, 'address', case when full_access or public.guest_place_address_ok(p, x) then x.address end,
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
-- 9. Lien voyageur : un séjour raccourci dont la fin est déjà passée ferme aussi le lien
--    (auparavant le lien gardait son ancienne date de fin dans ce cas)
-- ---------------------------------------------------------------------
create or replace function public.guest_links_follow_stay() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'confirmed' and old.status = 'confirmed' then
    update public.guest_links set revoked_at = now(), revoke_reason = 'stay_cancelled'
     where organization_id = new.organization_id and reservation_id = new.id and revoked_at is null;
    update public.stay_preparations set prep_status = 'cancelled', prep_updated_at = now()
     where organization_id = new.organization_id and reservation_id = new.id;
  elsif new.check_in_at is distinct from old.check_in_at or new.check_out_at is distinct from old.check_out_at then
    update public.guest_links set valid_from = new.check_in_at - interval '72 hours', valid_until = new.check_out_at
     where organization_id = new.organization_id and reservation_id = new.id and revoked_at is null
       and (new.check_out_at > now() or valid_until > new.check_out_at);
  end if;
  return new;
end $$;
