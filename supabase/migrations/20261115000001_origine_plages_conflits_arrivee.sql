-- =====================================================================
-- Migration 20 — origine des plages de mission (une seule source de vérité), recalcul automatique
-- qui ne touche JAMAIS une plage manuelle (appliqué par la base), historique qui dit qui a changé quoi.
-- Cause de la contradiction du 5/11 : le recalcul automatique (après une modification de séjour) et la
-- décision d'horaire écrivaient la plage avec la session du responsable ; l'historique les enregistrait
-- comme « modifiée par un responsable » alors que la mission restait automatique.
-- Réversible : remplacements de fonctions et une fonction ajoutée ; retour arrière dans docs/16.
-- =====================================================================

-- Historique : origine de chaque changement de plage
--   sync    : recalcul automatique d'après les séjours (mission automatique)
--   timing  : décision d'horaire voyageur (arrivée anticipée / départ tardif)
--   manual  : modification par un responsable (la mission devient manuelle, plus recalculée)
--   unknown : ancien changement sans origine connue
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; origin text;
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

-- Recalcul automatique d'une mission : refusé par la base pour une mission manuelle ou terminée
create function public.apply_task_sync(org uuid, task uuid, patch jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not t.is_auto_generated then return 'manual_kept'; end if;
  if t.status in ('done', 'validated', 'cancelled') then return 'closed_kept'; end if;
  perform set_config('halo.origin', 'sync', true);
  update public.tasks set
    window_start = coalesce((patch ->> 'window_start')::timestamptz, window_start),
    window_end = coalesce((patch ->> 'window_end')::timestamptz, window_end),
    duration_min = coalesce((patch ->> 'duration_min')::int, duration_min),
    priority = coalesce((patch ->> 'priority')::public.task_priority, priority),
    next_reservation_id = case when patch ? 'next_reservation_id' then (patch ->> 'next_reservation_id')::uuid else next_reservation_id end,
    guests_count = case when patch ? 'guests_count' then (patch ->> 'guests_count')::int else guests_count end,
    babies = coalesce((patch ->> 'babies')::int, babies),
    pets = coalesce((patch ->> 'pets')::int, pets),
    vip = coalesce((patch ->> 'vip')::boolean, vip)
  where organization_id = org and id = task;
  perform set_config('halo.origin', '', true);
  return 'applied';
end $$;
revoke all on function public.apply_task_sync(uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_task_sync(uuid, uuid, jsonb) to authenticated;
