-- Migration 21 : mission trop longue ou oubliée, décision « l'incident est-il résolu ? » après une intervention validée.
-- Aucune donnée existante n'est modifiée : colonnes nouvelles, nullables ou avec valeur par défaut.

-- A. Délai d'alerte du responsable après la durée estimée (minutes), réglable par organisation
alter table public.organizations add column overrun_alert_min int not null default 30 check (overrun_alert_min between 0 and 720);

-- B. Mission en cours au-delà de sa durée estimée
--   overrun_ack_at : dernière réponse « Oui, je continue » de l'agent (le temps n'est jamais arrêté automatiquement)
--   end_proposed_at : heure de fin réelle proposée par l'agent (oubli), à valider par un responsable
--   reported_end_at : heure de fin retenue après validation (completed_at reste l'heure à laquelle l'agent a terminé dans HALO)
alter table public.tasks
  add column overrun_ack_at timestamptz,
  add column end_proposed_at timestamptz,
  add column end_proposed_note text check (length(end_proposed_note) <= 500),
  add column end_proposal_status text check (end_proposal_status in ('pending', 'accepted', 'rejected')),
  add column reported_end_at timestamptz;

alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated', 'auto_validated',
                  'correction_requested', 'cancelled', 'status_changed', 'window_changed', 'early_start_allowed', 'started_early', 'resubmitted',
                  'overrun_continue', 'end_proposed', 'end_accepted', 'end_rejected'));

-- « Oui, je continue » : uniquement l'agent affecté, mission en cours. Idempotent à la minute près (double appui, renvoi hors ligne).
create function public.task_overrun_continue(org uuid, task uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status <> 'in_progress' then return 'stale'; end if;
  if t.overrun_ack_at is not null and t.overrun_ack_at > now() - interval '1 minute' then return 'already'; end if;
  update public.tasks set overrun_ack_at = now() where id = t.id;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, 'overrun_continue', (select auth.uid()), null);
  return 'applied';
end $$;
revoke all on function public.task_overrun_continue(uuid, uuid) from public, anon;
grant execute on function public.task_overrun_continue(uuid, uuid) to authenticated;

-- Heure de fin antérieure (oubli) : proposée par l'agent affecté, entre le démarrage réel et maintenant.
-- Ne change ni le statut ni completed_at ; un responsable accepte ou refuse.
create function public.propose_task_end(org uuid, task uuid, ended_at timestamptz, note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status not in ('in_progress', 'done') or t.started_at is null then return 'stale'; end if;
  if ended_at is null or ended_at <= t.started_at or ended_at > now() + interval '1 minute' then
    raise exception 'invalid_end' using errcode = '22023';
  end if;
  update public.tasks set end_proposed_at = ended_at, end_proposed_note = nullif(left(trim(coalesce(note, '')), 500), ''),
    end_proposal_status = 'pending' where id = t.id;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, 'end_proposed', (select auth.uid()), to_char(ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  return 'applied';
end $$;
revoke all on function public.propose_task_end(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.propose_task_end(uuid, uuid, timestamptz, text) to authenticated;

create function public.decide_task_end(org uuid, task uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.end_proposal_status is distinct from 'pending' then return 'stale'; end if;
  update public.tasks set end_proposal_status = case when accept then 'accepted' else 'rejected' end,
    reported_end_at = case when accept then t.end_proposed_at else reported_end_at end
  where id = t.id;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, case when accept then 'end_accepted' else 'end_rejected' end, (select auth.uid()),
          to_char(t.end_proposed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  return 'applied';
end $$;
revoke all on function public.decide_task_end(uuid, uuid, boolean) from public, anon;
grant execute on function public.decide_task_end(uuid, uuid, boolean) to authenticated;

-- Délai d'alerte : responsable uniquement
create function public.set_overrun_alert(org uuid, minutes int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if minutes is null or minutes < 0 or minutes > 720 then raise exception 'invalid' using errcode = '22023'; end if;
  update public.organizations set overrun_alert_min = minutes where id = org;
end $$;
revoke all on function public.set_overrun_alert(uuid, int) from public, anon;
grant execute on function public.set_overrun_alert(uuid, int) to authenticated;

-- C. Incident après intervention validée : le responsable peut décider de le laisser ouvert (sans le résoudre).
-- La question réapparaît si une nouvelle intervention est validée ensuite.
alter table public.incidents add column kept_open_at timestamptz, add column kept_open_by uuid references auth.users (id) on delete set null;

create function public.keep_incident_open(org uuid, incident uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.incidents;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into i from public.incidents where organization_id = org and id = incident for update;
  if i.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.status = 'resolved' then return 'stale'; end if;
  update public.incidents set kept_open_at = now(), kept_open_by = (select auth.uid()) where id = i.id;
  return 'applied';
end $$;
revoke all on function public.keep_incident_open(uuid, uuid) from public, anon;
grant execute on function public.keep_incident_open(uuid, uuid) to authenticated;
