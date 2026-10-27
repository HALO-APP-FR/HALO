-- =====================================================================
-- HALO — Lot 1 (suite) : fiches équipe et cycle de fin de mission
--  * type de collaboration (information, aucun droit) ;
--  * cycle : assigned (À faire) → in_progress (En cours) → done (Terminée,
--    à valider) → validated (Validée) ; to_redo = Correction demandée ;
--  * validation manager configurable par type de mission ;
--  * photos obligatoires vérifiées par la base à la soumission ;
--  * historique : chaque changement de statut est journalisé avec son auteur ;
--  * le compte rendu soumis est conservé avant toute correction.
-- =====================================================================

-- ---------- Fiches équipe ----------
create type public.collaboration as enum ('internal', 'freelance', 'partner_company');
alter table public.memberships add column collaboration public.collaboration;
grant update (collaboration) on public.memberships to authenticated;

-- ---------- Règle de validation (par organisation) ----------
-- Types de mission qui attendent une validation manager après soumission.
-- Les autres sont validées automatiquement à la soumission (pas de goulot).
alter table public.organizations
  add column validation_task_types public.task_type[] not null default array['turnover']::public.task_type[];

-- ---------- Missions ----------
alter table public.tasks add column correction_reason text check (length(correction_reason) <= 2000);

-- Historique immuable des changements importants
create table public.task_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  task_id uuid not null,
  kind text not null check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated',
                                     'auto_validated', 'correction_requested', 'cancelled', 'status_changed')),
  from_status public.task_status,
  to_status public.task_status,
  actor_id uuid references auth.users (id) on delete set null,
  note text,
  at timestamptz not null default now(),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade
);
create index task_events_task_idx on public.task_events (organization_id, task_id, at);

-- Comptes rendus soumis, conservés avant une demande de correction
create table public.task_report_versions (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  task_id uuid not null,
  checked jsonb not null,
  rooms jsonb not null,
  started_at timestamptz,
  completed_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz not null default now(),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade
);

create trigger task_events_org_immutable before update on public.task_events for each row execute function public.forbid_org_change();
create trigger task_report_versions_org_immutable before update on public.task_report_versions for each row execute function public.forbid_org_change();

alter table public.task_events enable row level security;
alter table public.task_report_versions enable row level security;
revoke all on public.task_events, public.task_report_versions from anon;
grant select on public.task_events, public.task_report_versions to authenticated;
revoke insert, update, delete on public.task_events, public.task_report_versions from authenticated;

create policy task_events_select on public.task_events for select to authenticated
  using (public.is_manager(organization_id) or public.my_task(organization_id, task_id));
create policy task_report_versions_select on public.task_report_versions for select to authenticated
  using (public.is_manager(organization_id) or public.my_task(organization_id, task_id));

-- Journal automatique : tout changement de statut ou d'assignation, d'où qu'il vienne
-- (fonctions terrain ou modification directe par un manager), avec son auteur.
create function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
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
  return new;
end $$;
create trigger tasks_log after insert or update on public.tasks for each row execute function public.log_task_change();

-- Un agent n'a jamais d'UPDATE direct sur les missions (déjà garanti par la RLS) ;
-- un manager ne peut pas contourner la règle « motif obligatoire » d'une correction.
alter table public.tasks add constraint tasks_correction_reason_required
  check (status <> 'to_redo' or length(trim(coalesce(correction_reason, ''))) > 0) not valid;

-- Photos obligatoires manquantes pour une mission (points de checklist « photo exigée »).
-- La checklist du logement s'applique aux ménages et aux contrôles uniquement.
create function public.missing_required_photos(org uuid, task uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.tasks t
  join public.checklist_rooms r on r.organization_id = t.organization_id and r.property_id = t.property_id
  join public.checklist_items i on i.organization_id = r.organization_id and i.room_id = r.id and i.photo_required
  where t.organization_id = org and t.id = task and t.type in ('turnover', 'inspection')
    -- Une réservation d'emplacement ne suffit pas : le fichier doit être réellement déposé
    and not exists (select 1 from public.files f
                    join storage.objects o on o.bucket_id = 'org-files' and o.name = f.path
                    where f.organization_id = org and f.task_id = task and f.checklist_item_id = i.id);
$$;
revoke all on function public.missing_required_photos(uuid, uuid) from public, anon;
revoke all on function public.log_task_change() from public, anon, authenticated;

-- Soumettre : in_progress → done (à valider) ou validated (si le type ne demande pas de validation).
-- Refus sans effet si des photos obligatoires manquent (rien n'est enregistré : la même action
-- pourra être rejouée une fois les photos envoyées).
create or replace function public.finish_task(org uuid, task uuid, action_id uuid, client_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev text; t public.tasks; res text; fin timestamptz; needs boolean;
begin
  select result into prev from public.task_actions where id = action_id and user_id = uid;
  if prev is not null then return prev; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status = 'in_progress' then
    if public.missing_required_photos(org, task) > 0 then return 'missing_photos'; end if;
    select t.type = any (o.validation_task_types) into needs from public.organizations o where o.id = org;
    fin := greatest(public.plausible_time(client_at), t.started_at);
    update public.tasks set status = case when needs then 'done' else 'validated' end::public.task_status,
      completed_at = fin,
      validated_at = case when needs then null else now() end,
      correction_reason = null
    where organization_id = org and id = task;
    res := 'applied';
  elsif t.status in ('done', 'validated') then res := 'already';
  else res := 'conflict:' || t.status;
  end if;
  insert into public.task_actions (id, organization_id, task_id, user_id, kind, client_at, result)
  values (action_id, org, task, uid, 'finish', client_at, res);
  return res;
end $$;

-- Valider : manager, mission soumise uniquement.
create function public.validate_task(org uuid, task uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare st public.task_status;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select status into st from public.tasks where organization_id = org and id = task for update;
  if st is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if st <> 'done' then return 'conflict:' || st; end if;
  -- Jamais de validation silencieuse d'une mission sans ses preuves : il faut demander une correction
  if public.missing_required_photos(org, task) > 0 then return 'missing_photos'; end if;
  update public.tasks set status = 'validated', validated_at = now(), validated_by = (select auth.uid())
  where organization_id = org and id = task;
  return 'applied';
end $$;

-- Demander une correction : manager, motif obligatoire ; le compte rendu soumis est archivé,
-- la mission redevient exploitable par l'agent (Correction demandée → il la reprend).
create function public.request_correction(org uuid, task uuid, reason text) returns text
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
  update public.tasks set status = 'to_redo', correction_reason = left(trim(reason), 2000),
    validated_at = null, validated_by = null
  where organization_id = org and id = task;
  return 'applied';
end $$;

revoke all on function public.validate_task(uuid, uuid), public.request_correction(uuid, uuid, text) from public, anon;
grant execute on function public.validate_task(uuid, uuid), public.request_correction(uuid, uuid, text) to authenticated;

-- ---------- Préférence d'itinéraire (par personne) ----------
-- Application ouverte par défaut par le bouton « Itinéraire » ; null = demander à chaque fois.
alter table public.profiles add column maps_app text check (maps_app in ('apple', 'google', 'waze'));
