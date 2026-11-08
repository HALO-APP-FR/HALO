-- Migration 24 : revenir au calcul automatique d'une plage fixée par un responsable.
-- Aucune donnée existante n'est modifiée. La plage calculée est proposée par le serveur (même moteur que la
-- synchronisation des séjours) ; la base vérifie le droit, le statut, la cohérence et l'agent (déclencheur
-- d'absence existant), puis historise l'action avec son auteur.

alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated', 'auto_validated',
                  'correction_requested', 'cancelled', 'status_changed', 'window_changed', 'early_start_allowed', 'started_early', 'resubmitted',
                  'overrun_continue', 'end_proposed', 'end_accepted', 'end_rejected', 'end_regularized', 'auto_restored'));

-- Résultat : 'applied' | 'stale' (mission démarrée, terminée ou annulée entre l'aperçu et la confirmation)
-- Erreurs : 42501 (droit), P0002 (introuvable), 22023 invalid_window, et celles du déclencheur d'absence (assignee_unavailable).
create function public.restore_auto_window(org uuid, task uuid, ws timestamptz, we timestamptz, dur integer) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status not in ('unassigned', 'assigned') then return 'stale'; end if;
  if ws is null or we is null or dur is null or dur <= 0 or we <= ws or we - ws < make_interval(mins => dur) then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  perform set_config('halo.origin', 'auto_restore', true);
  update public.tasks set is_auto_generated = true, window_start = ws, window_end = we, duration_min = dur where id = t.id;
  perform set_config('halo.origin', '', true);
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, 'auto_restored', (select auth.uid()),
          jsonb_build_object('from', jsonb_build_array(t.window_start, t.window_end, t.duration_min),
                             'to', jsonb_build_array(ws, we, dur))::text);
  return 'applied';
end $$;
revoke all on function public.restore_auto_window(uuid, uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.restore_auto_window(uuid, uuid, timestamptz, timestamptz, integer) to authenticated;
