-- =====================================================================
-- Migration 19 — règles de mission par type (démarrage anticipé, exigences de fin),
-- dérogation de démarrage tracée, commentaire de fin de mission, boucle de correction
-- complète (agent prévenu de la validation), livraison de linge préparée sans doublon,
-- rétablissement d'horaire refusé une fois l'heure passée.
-- Réversible : ajouts de tables, colonnes et fonctions ; retour arrière décrit dans docs/16.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Règles par type de mission (réglables par l'organisation)
--    start_rule   firm        : intervention impossible avant le début de la plage (sauf dérogation d'un responsable)
--                 recommended : début conseillé ; démarrer plus tôt demande une confirmation de l'agent (tracée)
--    checklist_required : toutes les cases de la checklist du logement cochées pour terminer
--    comment_required   : commentaire de fin de mission obligatoire
--    Les photos obligatoires restent définies point par point dans la checklist du logement.
-- ---------------------------------------------------------------------
create table public.task_type_rules (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type public.task_type not null,
  start_rule text not null check (start_rule in ('firm', 'recommended')),
  checklist_required boolean not null default false,
  comment_required boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, type)
);
alter table public.task_type_rules enable row level security;
revoke all on public.task_type_rules from anon;
grant select, insert, update on public.task_type_rules to authenticated;
create policy task_type_rules_select on public.task_type_rules for select to authenticated using (public.is_member(organization_id));
create policy task_type_rules_insert on public.task_type_rules for insert to authenticated with check (public.is_manager(organization_id));
create policy task_type_rules_update on public.task_type_rules for update to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));

-- Règle effective (réglage de l'organisation, sinon valeur par défaut selon l'usage métier) :
--   ménage après départ, départ accompagné, reprise du linge : après le départ du voyageur → ferme ;
--   accueil, contrôle, livraison de linge, maintenance, autre : début conseillé.
create function public.task_rule(org uuid, t public.task_type) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('start_rule', r.start_rule, 'checklist_required', r.checklist_required, 'comment_required', r.comment_required, 'configured', true)
       from public.task_type_rules r where r.organization_id = org and r.type = t),
    jsonb_build_object('start_rule', case when t in ('turnover', 'check_out', 'linen_pickup') then 'firm' else 'recommended' end,
                       'checklist_required', false, 'comment_required', false, 'configured', false));
$$;
revoke all on function public.task_rule(uuid, public.task_type) from public, anon;
grant execute on function public.task_rule(uuid, public.task_type) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Dérogation de démarrage, commentaire de fin, nouveaux événements
-- ---------------------------------------------------------------------
alter table public.tasks add column early_start_allowed_at timestamptz, add column early_start_allowed_by uuid references auth.users (id) on delete set null,
  add column early_start_reason text check (length(early_start_reason) <= 500);
alter table public.task_reports add column comment text check (length(comment) <= 2000);
alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated', 'auto_validated',
                  'correction_requested', 'cancelled', 'status_changed', 'window_changed', 'early_start_allowed', 'started_early', 'resubmitted'));

create function public.allow_early_start(org uuid, task uuid, reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(reason, ''))) = 0 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status not in ('unassigned', 'assigned') then return 'conflict:' || t.status; end if;
  if t.early_start_allowed_at is not null then return 'already'; end if;
  update public.tasks set early_start_allowed_at = now(), early_start_allowed_by = (select auth.uid()), early_start_reason = left(trim(reason), 500)
   where organization_id = org and id = task;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, 'early_start_allowed', (select auth.uid()), left(trim(reason), 500));
  return 'applied';
end $$;
revoke all on function public.allow_early_start(uuid, uuid, text) from public, anon;
grant execute on function public.allow_early_start(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Démarrage : la règle du type est appliquée par la base, quel que soit le bouton utilisé.
--    Résultats : applied / already / too_early:<début> (ferme) / early_confirm:<début> (conseillé, à confirmer)
--    La reprise après une demande de correction n'est jamais bloquée par la plage.
-- ---------------------------------------------------------------------
drop function public.start_task(uuid, uuid, uuid, timestamptz);
create function public.start_task(org uuid, task uuid, action_id uuid, client_at timestamptz default null, early_ack boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev text; t public.tasks; res text; rule text; early boolean := false;
begin
  select result into prev from public.task_actions where id = action_id and user_id = uid;
  if prev is not null then return prev; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status = 'assigned' and now() < t.window_start and t.early_start_allowed_at is null then
    rule := public.task_rule(org, t.type) ->> 'start_rule';
    if rule = 'firm' then
      -- Refus non enregistré comme action rejouable : l'agent pourra démarrer à l'heure avec le même geste
      return 'too_early:' || to_char(t.window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    elsif not coalesce(early_ack, false) then
      return 'early_confirm:' || to_char(t.window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
    early := true;
  end if;
  if t.status in ('assigned', 'to_redo') then
    update public.tasks set status = 'in_progress',
      previous_work_min = case when t.status = 'to_redo' and t.started_at is not null and t.completed_at is not null
        then previous_work_min + greatest(0, extract(epoch from (t.completed_at - t.started_at))::int / 60) else previous_work_min end,
      started_at = public.plausible_time(client_at), completed_at = null
    where organization_id = org and id = task;
    if early then
      insert into public.task_events (organization_id, task_id, kind, actor_id, note)
      values (org, task, 'started_early', uid, to_char(t.window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    end if;
    res := 'applied';
  elsif t.status = 'in_progress' then res := 'already';
  else res := 'conflict:' || t.status;
  end if;
  insert into public.task_actions (id, organization_id, task_id, user_id, kind, client_at, result)
  values (action_id, org, task, uid, 'start', client_at, res);
  return res;
end $$;
revoke all on function public.start_task(uuid, uuid, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.start_task(uuid, uuid, uuid, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Exigences de fin de mission, calculées par la base (même calcul pour l'écran et pour la fin)
-- ---------------------------------------------------------------------
create function public.task_requirements(org uuid, task uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tasks; rule jsonb; total int := 0; done int := 0; rep public.task_reports; photos int;
begin
  if not (public.is_manager(org) or public.my_task(org, task)) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  rule := public.task_rule(org, t.type);
  select * into rep from public.task_reports where organization_id = org and task_id = task;
  if t.type in ('turnover', 'inspection') then
    select count(*), count(*) filter (where coalesce(rep.checked, '[]'::jsonb) ? i.id::text) into total, done
      from public.checklist_rooms r join public.checklist_items i on i.organization_id = r.organization_id and i.room_id = r.id
     where r.organization_id = org and r.property_id = t.property_id;
  end if;
  photos := public.missing_required_photos(org, task);
  return jsonb_build_object(
    'start_rule', rule ->> 'start_rule',
    'checklist', jsonb_build_object('required', (rule ->> 'checklist_required')::boolean and total > 0, 'total', total, 'done', done),
    'photos_missing', photos,
    'comment', jsonb_build_object('required', (rule ->> 'comment_required')::boolean, 'present', length(trim(coalesce(rep.comment, ''))) > 0),
    'missing', to_jsonb(array_remove(array[
        case when (rule ->> 'checklist_required')::boolean and total > 0 and done < total then 'checklist' end,
        case when photos > 0 then 'photos' end,
        case when (rule ->> 'comment_required')::boolean and length(trim(coalesce(rep.comment, ''))) = 0 then 'comment' end], null)));
end $$;
revoke all on function public.task_requirements(uuid, uuid) from public, anon;
grant execute on function public.task_requirements(uuid, uuid) to authenticated;

-- Fin : 'missing:<liste>' tant qu'une exigence manque (rien n'est perdu, la mission reste en cours)
create or replace function public.finish_task(org uuid, task uuid, action_id uuid, client_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev text; t public.tasks; res text; fin timestamptz; needs boolean; req jsonb;
begin
  select result into prev from public.task_actions where id = action_id and user_id = uid;
  if prev is not null then return prev; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status = 'in_progress' then
    req := public.task_requirements(org, task);
    if jsonb_array_length(req -> 'missing') > 0 then
      -- Non enregistré comme action rejouable : une fois l'exigence remplie, le même geste aboutit
      return 'missing:' || (select string_agg(x, ',') from jsonb_array_elements_text(req -> 'missing') x);
    end if;
    select t.type = any (o.validation_task_types) into needs from public.organizations o where o.id = org;
    fin := greatest(public.plausible_time(client_at), t.started_at);
    update public.tasks set status = case when needs then 'done' else 'validated' end::public.task_status,
      completed_at = fin,
      validated_at = case when needs then null else now() end,
      correction_reason = case when needs then correction_reason else null end
    where organization_id = org and id = task;
    res := 'applied';
  elsif t.status in ('done', 'validated') then res := 'already';
  else res := 'conflict:' || t.status;
  end if;
  insert into public.task_actions (id, organization_id, task_id, user_id, kind, client_at, result)
  values (action_id, org, task, uid, 'finish', client_at, res);
  return res;
end $$;

-- Validation : mêmes exigences (jamais de validation d'une mission incomplète : demander une correction)
create or replace function public.validate_task(org uuid, task uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare st public.task_status; req jsonb;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select status into st from public.tasks where organization_id = org and id = task for update;
  if st is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if st = 'validated' then return 'already'; end if;
  if st <> 'done' then return 'conflict:' || st; end if;
  req := public.task_requirements(org, task);
  if jsonb_array_length(req -> 'missing') > 0 then
    return 'missing:' || (select string_agg(x, ',') from jsonb_array_elements_text(req -> 'missing') x);
  end if;
  update public.tasks set status = 'validated', validated_at = now(), validated_by = (select auth.uid()), correction_reason = null
  where organization_id = org and id = task;
  return 'applied';
end $$;

-- Commentaire de fin de mission (agent affecté, mission ouverte)
create function public.set_task_comment(org uuid, task uuid, body text) returns text
language plpgsql security definer set search_path = '' as $$
declare st public.task_status;
begin
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select status into st from public.tasks where organization_id = org and id = task;
  if st not in ('assigned', 'in_progress', 'to_redo') then return 'conflict:' || st; end if;
  insert into public.task_reports (organization_id, task_id, comment, updated_by, updated_at)
  values (org, task, nullif(left(trim(coalesce(body, '')), 2000), ''), (select auth.uid()), now())
  on conflict (task_id) do update set comment = excluded.comment, updated_by = excluded.updated_by, updated_at = now();
  return 'applied';
end $$;
revoke all on function public.set_task_comment(uuid, uuid, text) from public, anon;
grant execute on function public.set_task_comment(uuid, uuid, text) to authenticated;

-- Journal : une mission renvoyée après correction est « correction renvoyée », pas une première fin
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not exists (select 1 from public.organizations where id = new.organization_id)
     or (tg_op = 'UPDATE' and not exists (select 1 from public.tasks where organization_id = new.organization_id and id = new.id)) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.task_events (organization_id, task_id, kind, to_status, actor_id)
    values (new.organization_id, new.id, 'created', new.status, (select auth.uid()));
    return new;
  end if;
  if new.status is distinct from old.status then
    k := case
      when new.status = 'in_progress' then 'started'
      when new.status = 'done' and exists (select 1 from public.task_events e where e.organization_id = new.organization_id and e.task_id = new.id and e.kind = 'correction_requested') then 'resubmitted'
      when new.status = 'done' then 'submitted'
      when new.status = 'validated' and old.status = 'in_progress' then 'auto_validated'
      when new.status = 'validated' then 'validated'
      when new.status = 'to_redo' then 'correction_requested'
      when new.status = 'cancelled' then 'cancelled'
      else 'status_changed' end;
    insert into public.task_events (organization_id, task_id, kind, from_status, to_status, actor_id, note)
    values (new.organization_id, new.id, k, old.status, new.status, (select auth.uid()),
            case when new.status = 'to_redo' then new.correction_reason end);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_events (organization_id, task_id, kind, actor_id, note)
    values (new.organization_id, new.id, case when new.assignee_id is null then 'unassigned' else 'assigned' end,
            (select auth.uid()), new.assignee_id::text);
  end if;
  if new.window_start is distinct from old.window_start or new.window_end is distinct from old.window_end
     or new.duration_min is distinct from old.duration_min then
    insert into public.task_events (organization_id, task_id, kind, actor_id, note)
    values (new.organization_id, new.id, 'window_changed', (select auth.uid()),
            jsonb_build_object('from', jsonb_build_array(old.window_start, old.window_end, old.duration_min),
                               'to', jsonb_build_array(new.window_start, new.window_end, new.duration_min),
                               'reason', nullif(current_setting('halo.reason', true), ''))::text);
  end if;
  return new;
end $$;

-- Agent prévenu de la validation finale (selon ses préférences)
alter table public.notification_prefs drop constraint if exists notification_prefs_event_check;
alter table public.notification_prefs add constraint notification_prefs_event_check
  check (event in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message',
                   'team_agent_blocker', 'team_absence_requested', 'team_task_to_validate', 'team_assignment_conflict',
                   'team_stay_changed', 'team_prep_submitted', 'team_prep_updated', 'team_vip_requested', 'team_booking_requested', 'team_low_review',
                   'chat_message', 'agent_task_assigned', 'agent_task_changed', 'agent_correction_requested', 'agent_absence_decided', 'agent_task_validated'));

create function public.notify_task_validated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'validated' and old.status = 'done' and new.assignee_id is not null and new.assignee_id is distinct from (select auth.uid()) then
    perform public.queue_member_email(new.organization_id, new.assignee_id, 'agent_task_validated',
      jsonb_build_object('kind', new.type, 'property', (select name from public.properties where organization_id = new.organization_id and id = new.property_id),
                         'path', '/app/missions/' || new.id));
  end if;
  return new;
end $$;
revoke all on function public.notify_task_validated() from public, anon, authenticated;
create trigger tasks_notify_validated after update of status on public.tasks for each row execute function public.notify_task_validated();

-- ---------------------------------------------------------------------
-- 5. Livraison de linge avant une arrivée : préparée par le responsable, jamais en double
-- ---------------------------------------------------------------------
create function public.plan_linen_delivery(org uuid, reservation uuid, w_start timestamptz, w_end timestamptz, duration int,
                                           assignee uuid default null, note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; existing uuid; new_id uuid;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.reservations where organization_id = org and id = reservation;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Deux clics ou deux responsables en même temps : une seule mission
  perform pg_advisory_xact_lock(hashtextextended('linen:' || reservation::text, 0));
  select t.id into existing from public.tasks t
   where t.organization_id = org and t.next_reservation_id = reservation and t.type = 'linen_delivery' and t.status <> 'cancelled' limit 1;
  if existing is not null then return jsonb_build_object('status', 'exists', 'id', existing); end if;
  if duration is null or duration < 5 or duration > 1440 or w_end > r.check_in_at or w_end < w_start + make_interval(mins => duration) then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  insert into public.tasks (organization_id, property_id, next_reservation_id, type, status, is_auto_generated, window_start, window_end, duration_min, assignee_id, notes)
  values (org, r.property_id, reservation, 'linen_delivery', case when assignee is null then 'unassigned' else 'assigned' end::public.task_status, false,
          w_start, w_end, duration, assignee, nullif(left(trim(coalesce(note, '')), 4000), ''))
  returning tasks.id into new_id;
  return jsonb_build_object('status', 'created', 'id', new_id);
end $$;
revoke all on function public.plan_linen_delivery(uuid, uuid, timestamptz, timestamptz, int, uuid, text) from public, anon;
grant execute on function public.plan_linen_delivery(uuid, uuid, timestamptz, timestamptz, int, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Horaire voyageur : une confirmation dont l'heure est déjà passée n'est plus annulée en
--    « rétablissant » l'horaire précédent (le voyageur est peut-être déjà là) — le responsable
--    retire la confirmation sans toucher au séjour, ou modifie le séjour lui-même.
-- ---------------------------------------------------------------------
create or replace function public.timing_restore_allowed(s public.service_requests, r public.reservations) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.timing_previous_at is not null and s.timing_applied_at is not null and r.id is not null
     and (case when s.kind = 'early_checkin' then r.check_in_at else r.check_out_at end) = s.timing_applied_at
     and least(s.timing_applied_at, s.timing_previous_at) > now();
$$;
revoke all on function public.timing_restore_allowed(public.service_requests, public.reservations) from public, anon, authenticated;

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
    -- Heure déjà passée : le rétablissement n'est plus garanti valable ; il faut une décision explicite (ack)
    -- qui retire la confirmation SANS toucher au séjour
    if st = 'applied' and s.timing_applied_at is not null and cur = s.timing_applied_at and not public.timing_restore_allowed(s, r) and s.timing_previous_at is not null then
      if not coalesce(ack, false) then
        perform set_config('halo.timing_sys', '', true);
        return jsonb_build_object('status', 'restore_unsafe', 'previous_at', s.timing_previous_at, 'current_at', cur);
      end if;
    elsif st = 'applied' and public.timing_restore_allowed(s, r) then
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

