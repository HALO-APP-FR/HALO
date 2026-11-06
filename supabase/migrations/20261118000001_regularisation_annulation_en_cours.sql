-- Migration 23 : mission oubliée — régularisation de fin par un responsable, annulation d'une mission commencée.
-- Aucune donnée existante n'est modifiée : colonnes nouvelles (nullables), contraintes élargies, fonctions remplacées.
--
-- Règles :
--  * la régularisation ne valide jamais : la mission passe « Terminée, à valider » (jamais « Validée »),
--    même si l'organisation clôture d'habitude ce type sans validation ;
--  * les exigences (photos, liste, commentaire) restent dues : la validation les exige toujours ;
--    celles qui manquaient au moment de la régularisation sont figées dans regularized_missing ;
--  * motif obligatoire, auteur et date conservés (colonnes + historique) ;
--  * une réponse tardive (rappel, heure proposée, décision) ne modifie plus une mission régularisée ou annulée.

alter table public.tasks
  add column regularized_at timestamptz,
  add column regularized_by uuid references auth.users (id) on delete set null,
  add column regularized_reason text check (length(regularized_reason) between 3 and 1000),
  add column regularized_missing text[],
  add column cancel_reason text check (length(cancel_reason) between 3 and 1000),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users (id) on delete set null;

alter table public.tasks drop constraint tasks_end_proposal_status_check;
alter table public.tasks add constraint tasks_end_proposal_status_check
  check (end_proposal_status in ('pending', 'accepted', 'rejected', 'superseded'));

alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated', 'auto_validated',
                  'correction_requested', 'cancelled', 'status_changed', 'window_changed', 'early_start_allowed', 'started_early', 'resubmitted',
                  'overrun_continue', 'end_proposed', 'end_accepted', 'end_rejected', 'end_regularized'));

-- Journal : un changement de statut décidé par une fonction dédiée porte son propre libellé et son motif
-- (halo.event / halo.reason, posés pour la seule transaction). Le reste est inchangé (migration 20).
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; origin text; ev text := nullif(current_setting('halo.event', true), ''); why text := nullif(current_setting('halo.reason', true), '');
begin
  if not exists (select 1 from public.organizations where id = new.organization_id)
     or (tg_op = 'UPDATE' and not exists (select 1 from public.tasks where organization_id = new.organization_id and id = new.id)) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.task_events (organization_id, task_id, kind, to_status, actor_id, note)
    values (new.organization_id, new.id, 'created', new.status, (select auth.uid()),
            case when new.is_auto_generated then 'auto' else 'manual' end);
    return new;
  end if;
  if new.status is distinct from old.status then
    k := case
      when ev in ('end_regularized', 'cancelled') then ev
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
            case when new.status = 'to_redo' then new.correction_reason
                 when ev in ('end_regularized', 'cancelled') then why end);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_events (organization_id, task_id, kind, actor_id, note)
    values (new.organization_id, new.id, case when new.assignee_id is null then 'unassigned' else 'assigned' end,
            (select auth.uid()), new.assignee_id::text);
  end if;
  if new.window_start is distinct from old.window_start or new.window_end is distinct from old.window_end
     or new.duration_min is distinct from old.duration_min then
    origin := coalesce(nullif(current_setting('halo.origin', true), ''),
                       case when coalesce(current_setting('halo.timing_sys', true), '') = '1' then 'timing' end,
                       case when not new.is_auto_generated then 'manual' end,
                       'unknown');
    insert into public.task_events (organization_id, task_id, kind, actor_id, note)
    values (new.organization_id, new.id, 'window_changed', case when origin = 'sync' then null else (select auth.uid()) end,
            jsonb_build_object('from', jsonb_build_array(old.window_start, old.window_end, old.duration_min),
                               'to', jsonb_build_array(new.window_start, new.window_end, new.duration_min),
                               'reason', nullif(current_setting('halo.reason', true), ''),
                               'origin', origin)::text);
  end if;
  return new;
end $$;

-- Régularisation de fin (responsable) : mission en cours, heure retenue entre le démarrage réel et maintenant,
-- motif obligatoire. Résultat : 'applied' | 'stale' (plus en cours) ; erreurs 22023 : invalid_end, reason_required.
create function public.regularize_task_end(org uuid, task uuid, ended_at timestamptz, reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; why text := nullif(left(trim(coalesce(reason, '')), 1000), ''); req jsonb; miss text[];
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status <> 'in_progress' or t.started_at is null then return 'stale'; end if;
  if why is null or length(why) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  if ended_at is null or ended_at <= t.started_at or ended_at > now() + interval '1 minute' then
    raise exception 'invalid_end' using errcode = '22023';
  end if;
  req := public.task_requirements(org, task);
  select coalesce(array_agg(x), '{}') into miss from jsonb_array_elements_text(req -> 'missing') x;
  perform set_config('halo.event', 'end_regularized', true);
  perform set_config('halo.reason', why, true);
  update public.tasks set status = 'done', completed_at = ended_at, reported_end_at = ended_at,
    regularized_at = now(), regularized_by = (select auth.uid()), regularized_reason = why, regularized_missing = miss,
    end_proposal_status = case when end_proposal_status = 'pending' then 'superseded' else end_proposal_status end
  where id = t.id;
  perform set_config('halo.event', '', true);
  perform set_config('halo.reason', '', true);
  return 'applied';
end $$;
revoke all on function public.regularize_task_end(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.regularize_task_end(uuid, uuid, timestamptz, text) to authenticated;

-- Annulation avec motif (responsable), y compris d'une mission commencée. Jamais une mission terminée ou validée.
-- Le motif est obligatoire pour une mission en cours (facultatif sinon). Une proposition d'heure en attente devient sans objet.
create function public.cancel_task(org uuid, task uuid, reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; why text := nullif(left(trim(coalesce(reason, '')), 1000), '');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status = 'cancelled' then return 'already'; end if;
  if t.status not in ('unassigned', 'assigned', 'to_redo', 'in_progress') then return 'conflict:' || t.status; end if;
  if t.status = 'in_progress' and (why is null or length(why) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if why is not null and length(why) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  perform set_config('halo.event', 'cancelled', true);
  perform set_config('halo.reason', coalesce(why, ''), true);
  update public.tasks set status = 'cancelled', is_auto_generated = false,
    cancel_reason = why, cancelled_at = now(), cancelled_by = (select auth.uid()),
    end_proposal_status = case when end_proposal_status = 'pending' then 'superseded' else end_proposal_status end
  where id = t.id;
  perform set_config('halo.event', '', true);
  perform set_config('halo.reason', '', true);
  return 'applied';
end $$;
revoke all on function public.cancel_task(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_task(uuid, uuid, text) to authenticated;

-- Décision sur une heure proposée : sans effet si la mission a été annulée ou régularisée entre-temps
create or replace function public.decide_task_end(org uuid, task uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.end_proposal_status is distinct from 'pending' or t.status = 'cancelled' or t.regularized_at is not null then return 'stale'; end if;
  update public.tasks set end_proposal_status = case when accept then 'accepted' else 'rejected' end,
    reported_end_at = case when accept then t.end_proposed_at else reported_end_at end
  where id = t.id;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, case when accept then 'end_accepted' else 'end_rejected' end, (select auth.uid()),
          to_char(t.end_proposed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  return 'applied';
end $$;

-- Heure proposée par l'agent : refusée (« périmée ») une fois la mission régularisée par un responsable
create or replace function public.propose_task_end(org uuid, task uuid, ended_at timestamptz, note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null or t.assignee_id is distinct from (select auth.uid()) or t.status not in ('in_progress', 'done') or t.started_at is null
     or t.regularized_at is not null then return 'stale'; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if ended_at is null or ended_at <= t.started_at or ended_at > now() + interval '1 minute' then
    raise exception 'invalid_end' using errcode = '22023';
  end if;
  update public.tasks set end_proposed_at = ended_at, end_proposed_note = nullif(left(trim(coalesce(note, '')), 500), ''),
    end_proposal_status = 'pending' where id = t.id;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, 'end_proposed', (select auth.uid()), to_char(ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  return 'applied';
end $$;
