-- =====================================================================
-- Incidents et blocages : signalés par un agent (sur sa mission) ou par un voyageur (sur son séjour),
-- traités par l'équipe jusqu'à leur résolution. Ils alimentent le contrôle « logement prêt ».
-- Écriture uniquement par fonctions ; statut jamais modifiable directement.
-- =====================================================================

create table public.incidents (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  reservation_id uuid,
  task_id uuid,
  source text not null check (source in ('agent', 'guest', 'manager')),
  category text not null check (category in ('blocker', 'missing_supplies', 'damage', 'breakdown', 'leak', 'cleanliness', 'missing_item', 'access', 'noise', 'pests', 'other')),
  description text not null check (length(trim(description)) between 3 and 2000),
  urgent boolean not null default false,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  reported_by uuid references auth.users (id) on delete set null,
  taken_by uuid references auth.users (id) on delete set null,
  taken_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution text check (length(resolution) <= 2000),
  -- Message destiné au voyageur (jamais la note de résolution interne)
  guest_message text check (length(guest_message) <= 2000),
  manager_unread boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade
);
create index incidents_open_idx on public.incidents (organization_id, status, created_at desc);
create trigger incidents_org_immutable before update on public.incidents for each row execute function public.forbid_org_change();

alter table public.incidents enable row level security;
revoke all on public.incidents from anon;
grant select on public.incidents to authenticated;
revoke insert, update, delete on public.incidents from authenticated;

-- Managers : tous les incidents de l'organisation. Agent : ceux qu'il a signalés ou ceux de ses missions.
create policy incidents_select on public.incidents for select to authenticated
  using (public.is_manager(organization_id)
         or reported_by = (select auth.uid())
         or (task_id is not null and public.my_task(organization_id, task_id)));

-- Agent (sur sa mission) ou manager : signaler
create function public.report_incident(org uuid, task uuid, i_category text, i_description text, i_urgent boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.tasks; iid uuid;
begin
  if not (public.my_task(org, task) or public.is_manager(org)) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.incidents (organization_id, property_id, reservation_id, task_id, source, category, description, urgent, reported_by)
  values (org, t.property_id, coalesce(t.next_reservation_id, t.reservation_id), t.id,
          case when public.is_manager(org) and t.assignee_id is distinct from (select auth.uid()) then 'manager' else 'agent' end,
          i_category, trim(i_description), coalesce(i_urgent, false), (select auth.uid()))
  returning id into iid;
  return iid;
end $$;

-- Voyageur (par son lien de séjour) : signaler un problème
create function public.guest_report_problem(token text, i_category text, i_description text, i_urgent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reservations; iid uuid;
begin
  r := public.guest_link_stay(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if length(trim(coalesce(i_description, ''))) < 3 then return jsonb_build_object('status', 'empty'); end if;
  if i_category not in ('cleanliness', 'breakdown', 'leak', 'missing_item', 'access', 'noise', 'pests', 'damage', 'other') then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.incidents (organization_id, property_id, reservation_id, source, category, description, urgent)
  values (r.organization_id, r.property_id, r.id, 'guest', i_category, left(trim(i_description), 2000), coalesce(i_urgent, false))
  returning id into iid;
  return jsonb_build_object('status', 'ok', 'id', iid);
end $$;

-- Voyageur : ses problèmes signalés, leur statut et la réponse qui lui est destinée (jamais la note interne)
create function public.guest_problems(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_stay(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  return jsonb_build_object('status', 'ok', 'problems', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'category', i.category, 'description', i.description, 'urgent', i.urgent, 'status', i.status,
      'created_at', i.created_at, 'taken_at', i.taken_at, 'resolved_at', i.resolved_at, 'message', i.guest_message)
      order by i.created_at desc)
    from public.incidents i
    where i.organization_id = r.organization_id and i.reservation_id = r.id and i.source = 'guest'), '[]'::jsonb));
end $$;

-- Équipe : prise en charge
create function public.take_incident(org uuid, incident uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.incidents;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into i from public.incidents where organization_id = org and id = incident for update;
  if i.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.status <> 'open' then return 'conflict:' || i.status; end if;
  update public.incidents set status = 'in_progress', taken_by = (select auth.uid()), taken_at = now(), manager_unread = false where id = i.id;
  return 'applied';
end $$;

-- Équipe : résolution (note interne + message éventuel au voyageur, envoyé par e-mail s'il a une adresse)
create function public.resolve_incident(org uuid, incident uuid, i_resolution text, i_guest_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.incidents; r public.reservations; msg text := nullif(trim(coalesce(i_guest_message, '')), ''); emailed boolean := false;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(i_resolution, ''))) = 0 then raise exception 'resolution_required' using errcode = '22023'; end if;
  select * into i from public.incidents where organization_id = org and id = incident for update;
  if i.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.status = 'resolved' then return jsonb_build_object('status', 'conflict', 'current', i.status); end if;
  update public.incidents set status = 'resolved', resolved_by = (select auth.uid()), resolved_at = now(),
    resolution = left(trim(i_resolution), 2000), guest_message = case when i.source = 'guest' then left(msg, 2000) end,
    manager_unread = false,
    taken_by = coalesce(taken_by, (select auth.uid())), taken_at = coalesce(taken_at, now())
  where id = i.id;
  if i.source = 'guest' and i.reservation_id is not null then
    select * into r from public.reservations where organization_id = org and id = i.reservation_id;
    emailed := public.queue_guest_email(r, 'problem_resolved', jsonb_build_object('message', msg), null);
  end if;
  return jsonb_build_object('status', 'ok', 'email_queued', emailed);
end $$;

create function public.mark_incident_seen(org uuid, incident uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.incidents set manager_unread = false where organization_id = org and id = incident;
end $$;

revoke all on function public.report_incident(uuid, uuid, text, text, boolean), public.guest_report_problem(text, text, text, boolean),
  public.guest_problems(text), public.take_incident(uuid, uuid), public.resolve_incident(uuid, uuid, text, text),
  public.mark_incident_seen(uuid, uuid) from public, anon;
-- Exceptions anonymes : porte d'entrée voyageur, toujours conditionnée par un lien de séjour valide
grant execute on function public.guest_report_problem(text, text, text, boolean), public.guest_problems(text) to anon, authenticated;
grant execute on function public.report_incident(uuid, uuid, text, text, boolean), public.take_incident(uuid, uuid),
  public.resolve_incident(uuid, uuid, text, text), public.mark_incident_seen(uuid, uuid) to authenticated;
