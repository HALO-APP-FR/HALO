-- =====================================================================
-- Retour de test du 29/10 (phase 1) :
--  A. Validation par type de mission : « toutes les missions » couvre réellement tous les types
--     (dont maintenance / interventions). Le serveur (finish_task) applique le réglage enregistré.
--  B. Créneaux : jamais de mission dont la fenêtre est plus courte que la durée ; séjours qui se
--     chevauchent refusés ; correction du créneau par le responsable, tracée dans l'historique.
--  C. Profil : l'acceptation d'une invitation exige un nom (téléphone facultatif).
--  D. Absences et fermetures d'équipe : demandes, décisions, historique ; une personne absente ne peut
--     pas recevoir une mission qui ne tient pas hors de ses absences (contrôle en base).
-- Réversibilité : uniquement des ajouts (tables, colonnes, fonctions, déclencheurs) ; aucune donnée
-- supprimée. Retour arrière documenté dans docs/16 (supprimer déclencheurs, fonctions et tables ajoutés).
-- =====================================================================

-- A. Validation -----------------------------------------------------------
-- « Toutes les missions » choisi à l'onboarding : tous les types, y compris ceux ajoutés depuis.
update public.organizations
   set validation_task_types = enum_range(null::public.task_type)
 where onboarding #>> '{answers,validation_policy}' = 'all';

-- B. Créneaux -----------------------------------------------------------
alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated', 'auto_validated',
                  'correction_requested', 'cancelled', 'status_changed', 'window_changed'));

-- Fenêtre trop courte pour la durée estimée : refusée à la création et à chaque modification du créneau.
-- (Les lignes existantes ne sont pas bloquées tant que leur créneau ne change pas.)
create function public.check_task_window() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and new.window_start = old.window_start and new.window_end = old.window_end
     and new.duration_min = old.duration_min then
    return new;
  end if;
  if new.window_end < new.window_start + make_interval(mins => new.duration_min) then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger tasks_window_check before insert or update of window_start, window_end, duration_min on public.tasks
  for each row execute function public.check_task_window();

-- Historique : tout changement de créneau (motif facultatif transmis par set_task_window)
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  -- Organisation ou mission en cours de suppression : rien à journaliser (migration 5)
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

-- Correction du créneau par le responsable : la mission devient « reprise à la main »
-- (la synchronisation ne la déplace plus et ne la recrée pas).
create function public.set_task_window(org uuid, task uuid, w_start timestamptz, w_end timestamptz, duration int, reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare st public.task_status;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select status into st from public.tasks where organization_id = org and id = task for update;
  if st is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if st in ('done', 'validated', 'cancelled') then return 'conflict:' || st; end if;
  if duration is null or duration < 5 or duration > 1440 or w_end < w_start + make_interval(mins => duration) then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  perform set_config('halo.reason', left(coalesce(trim(reason), ''), 300), true);
  update public.tasks set window_start = w_start, window_end = w_end, duration_min = duration, duration_locked = true,
    is_auto_generated = false
   where organization_id = org and id = task;
  perform set_config('halo.reason', '', true);
  return 'applied';
end $$;
revoke all on function public.set_task_window(uuid, uuid, timestamptz, timestamptz, int, text) from public, anon;
grant execute on function public.set_task_window(uuid, uuid, timestamptz, timestamptz, int, text) to authenticated;

-- Séjours confirmés qui se chevauchent dans un même logement : refusés (nouveaux ou modifiés)
create function public.check_stay_overlap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and new.check_in_at = old.check_in_at and new.check_out_at = old.check_out_at
     and new.property_id = old.property_id and old.status = 'confirmed' then
    return new;
  end if;
  if exists (select 1 from public.reservations o
             where o.organization_id = new.organization_id and o.property_id = new.property_id and o.id <> new.id
               and o.status = 'confirmed' and o.check_in_at < new.check_out_at and o.check_out_at > new.check_in_at) then
    raise exception 'stay_overlap' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function public.check_stay_overlap() from public, anon, authenticated;
create trigger reservations_overlap_check before insert or update on public.reservations
  for each row execute function public.check_stay_overlap();

-- C. Profil à l'arrivée dans l'équipe -----------------------------------
create function public.accept_invitation(raw_token text, member_name text, member_phone text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if length(trim(coalesce(member_name, ''))) = 0 then raise exception 'name_required' using errcode = '22023'; end if;
  update public.profiles set full_name = left(trim(member_name), 120),
    phone = coalesce(nullif(left(trim(coalesce(member_phone, '')), 32), ''), phone), updated_at = now()
   where id = uid;
  -- Mêmes contrôles que l'acceptation simple (jeton haché, usage unique, expiration, déjà membre)
  return public.accept_invitation(raw_token);
end $$;
revoke all on function public.accept_invitation(text, text, text) from public, anon;
grant execute on function public.accept_invitation(text, text, text) to authenticated;

-- D. Absences et fermetures ---------------------------------------------
create table public.absences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 'member' : une personne ; 'team' : toute l'équipe, ou tous les membres d'un poste (fermeture, congés collectifs)
  scope text not null check (scope in ('member', 'team')),
  member_id uuid,
  team_position public.staff_position,
  kind text not null check (kind in ('leave', 'unavailable', 'closure')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unplanned boolean not null default false,
  -- Motif court et facultatif (jamais de détail médical) : visible du responsable et de la personne concernée
  reason text check (length(reason) <= 200),
  status text not null check (status in ('pending', 'accepted', 'refused', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((scope = 'member') = (member_id is not null)),
  check (scope = 'team' or team_position is null),
  unique (organization_id, id),
  unique (organization_id, client_id),
  foreign key (organization_id, member_id) references public.memberships (organization_id, user_id) on delete cascade
);
create index absences_period_idx on public.absences (organization_id, starts_at, ends_at) where status in ('pending', 'accepted');

create table public.absence_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  absence_id uuid not null,
  kind text not null check (kind in ('requested', 'created', 'accepted', 'refused', 'cancelled')),
  actor_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now(),
  foreign key (organization_id, absence_id) references public.absences (organization_id, id) on delete cascade
);

alter table public.absences enable row level security;
alter table public.absence_events enable row level security;
revoke all on public.absences, public.absence_events from anon;
revoke insert, update, delete on public.absences, public.absence_events from authenticated;
grant select on public.absences, public.absence_events to authenticated;
-- Responsables : tout ; agent : ses propres absences et les fermetures d'équipe de son organisation
create policy absences_select on public.absences for select to authenticated
  using (public.is_manager(organization_id)
         or (public.is_member(organization_id) and (member_id = (select auth.uid()) or scope = 'team')));
create policy absence_events_select on public.absence_events for select to authenticated
  using (public.is_manager(organization_id)
         or exists (select 1 from public.absences a where a.organization_id = absence_events.organization_id
                    and a.id = absence_events.absence_id and a.member_id = (select auth.uid()) and public.is_member(a.organization_id)));

-- Créer (responsable : acceptée d'office) ou demander (agent : pour lui-même, en attente).
-- Idempotent : un même client_id renvoie l'absence déjà enregistrée, sans doublon.
create function public.save_absence(org uuid, client uuid, a_scope text, a_member uuid, a_kind text,
                                    a_start timestamptz, a_end timestamptz, a_unplanned boolean default false,
                                    a_reason text default null, a_position public.staff_position default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mgr boolean := public.is_manager(org); prev public.absences; aid uuid; st text;
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into prev from public.absences where organization_id = org and client_id = client;
  if prev.id is not null then return jsonb_build_object('id', prev.id, 'status', prev.status, 'replayed', true); end if;
  if a_end is null or a_start is null or a_end <= a_start then raise exception 'invalid_period' using errcode = '22023'; end if;
  if a_scope = 'team' then
    if not mgr then raise exception 'not_allowed' using errcode = '42501'; end if;
    a_member := null;
  elsif a_scope = 'member' then
    if not mgr and a_member is distinct from uid then raise exception 'not_allowed' using errcode = '42501'; end if;
    if not exists (select 1 from public.memberships where organization_id = org and user_id = a_member and is_active) then
      raise exception 'not_member' using errcode = '22023';
    end if;
    if a_kind = 'closure' then raise exception 'invalid_kind' using errcode = '22023'; end if;
    a_position := null;
  else
    raise exception 'invalid_scope' using errcode = '22023';
  end if;
  st := case when mgr then 'accepted' else 'pending' end;
  insert into public.absences (organization_id, scope, member_id, team_position, kind, starts_at, ends_at, unplanned, reason,
                               status, created_by, decided_by, decided_at, client_id)
  values (org, a_scope, a_member, a_position, a_kind, a_start, a_end, coalesce(a_unplanned, false),
          nullif(left(trim(coalesce(a_reason, '')), 200), ''), st, uid,
          case when mgr then uid end, case when mgr then now() end, client)
  returning id into aid;
  insert into public.absence_events (organization_id, absence_id, kind, actor_id)
  values (org, aid, case when mgr then 'created' else 'requested' end, uid);
  -- Demande d'un agent : les responsables sont prévenus (état d'envoi traçable dans le journal)
  if not mgr then
    perform public.queue_team_email(org, 'team_absence_requested',
      jsonb_build_object('member', (select full_name from public.profiles where id = uid), 'path', '/app/team'), null, null, null);
  end if;
  return jsonb_build_object('id', aid, 'status', st, 'replayed', false);
end $$;

-- Accepter / refuser une demande : responsable uniquement, demande en attente uniquement (rejouer = sans effet)
create function public.decide_absence(org uuid, absence uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.absences;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into a from public.absences where organization_id = org and id = absence for update;
  if a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status <> 'pending' then return case when a.status = (case when accept then 'accepted' else 'refused' end) then 'already' else 'conflict:' || a.status end; end if;
  update public.absences set status = case when accept then 'accepted' else 'refused' end, decided_by = (select auth.uid()),
    decided_at = now(), updated_at = now() where id = a.id;
  insert into public.absence_events (organization_id, absence_id, kind, actor_id)
  values (org, a.id, case when accept then 'accepted' else 'refused' end, (select auth.uid()));
  return 'applied';
end $$;

-- Annuler : le responsable, ou la personne concernée pour sa propre absence
create function public.cancel_absence(org uuid, absence uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.absences;
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into a from public.absences where organization_id = org and id = absence for update;
  if a.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.is_manager(org) and a.member_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.status = 'cancelled' then return 'already'; end if;
  if a.status = 'refused' then return 'conflict:refused'; end if;
  update public.absences set status = 'cancelled', updated_at = now() where id = a.id;
  insert into public.absence_events (organization_id, absence_id, kind, actor_id) values (org, a.id, 'cancelled', (select auth.uid()));
  return 'applied';
end $$;

revoke all on function public.save_absence(uuid, uuid, text, uuid, text, timestamptz, timestamptz, boolean, text, public.staff_position),
  public.decide_absence(uuid, uuid, boolean), public.cancel_absence(uuid, uuid) from public, anon;
grant execute on function public.save_absence(uuid, uuid, text, uuid, text, timestamptz, timestamptz, boolean, text, public.staff_position),
  public.decide_absence(uuid, uuid, boolean), public.cancel_absence(uuid, uuid) to authenticated;

-- Plus long temps libre (minutes) d'un membre dans une fenêtre, hors absences ACCEPTÉES
-- (les siennes et les fermetures d'équipe qui le concernent). Une absence partielle ne retire que sa durée.
create function public.free_minutes_of(org uuid, member uuid, w_start timestamptz, w_end timestamptz) returns int
language plpgsql stable security definer set search_path = '' as $$
declare cur timestamptz := w_start; best interval := interval '0'; a record; pos public.staff_position;
begin
  select position into pos from public.memberships where organization_id = org and user_id = member;
  for a in
    select greatest(starts_at, w_start) s, least(ends_at, w_end) e from public.absences
     where organization_id = org and status = 'accepted' and starts_at < w_end and ends_at > w_start
       and ((scope = 'member' and member_id = member) or (scope = 'team' and (team_position is null or team_position = pos)))
     order by 1
  loop
    if a.s > cur then best := greatest(best, a.s - cur); end if;
    cur := greatest(cur, a.e);
  end loop;
  if w_end > cur then best := greatest(best, w_end - cur); end if;
  return floor(extract(epoch from best) / 60)::int;
end $$;
revoke all on function public.free_minutes_of(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Version exposée : disponibilités d'autrui réservées aux responsables (ou à la personne elle-même)
create function public.free_minutes(org uuid, member uuid, w_start timestamptz, w_end timestamptz) returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_manager(org) or (member = (select auth.uid()) and public.is_member(org))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return public.free_minutes_of(org, member, w_start, w_end);
end $$;
revoke all on function public.free_minutes(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.free_minutes(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Nouvelle affectation : refusée si la mission ne tient pas en dehors des absences de la personne.
-- Une absence enregistrée APRÈS l'affectation ne modifie rien : le conflit est signalé au responsable.
create function public.check_assignee_available() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is null or new.status in ('done', 'validated', 'cancelled') then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if public.free_minutes_of(new.organization_id, new.assignee_id, new.window_start, new.window_end) < new.duration_min then
    raise exception 'assignee_unavailable' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.check_assignee_available(), public.check_task_window() from public, anon, authenticated;
create trigger tasks_assignee_available before insert or update of assignee_id on public.tasks
  for each row execute function public.check_assignee_available();
