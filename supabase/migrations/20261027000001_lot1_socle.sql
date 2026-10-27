-- =====================================================================
-- HALO — Lot 1 : socle multi-organisation
-- Authentification (profils), organisations, membres, invitations,
-- logements, accès (codes), couchages, checklists, séjours, missions,
-- rapports, fichiers privés, journal des consultations de codes.
--
-- Principes :
--  * chaque ligne métier porte organization_id ;
--  * les références internes utilisent des clés composites
--    (organization_id, id) : impossible de relier deux organisations ;
--  * RLS activé sur toutes les tables, politiques séparées par opération ;
--  * les agents n'écrivent jamais directement : fonctions dédiées ;
--  * les codes d'accès ne sont lisibles par aucune requête directe :
--    uniquement via reveal_access(), journalisée ;
--  * les fichiers : une ligne `files` créée par begin_upload() avant
--    l'envoi, et le stockage n'autorise que les chemins enregistrés.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'manager', 'agent');
create type public.staff_position as enum ('housekeeper', 'inspector', 'maintenance', 'laundry', 'concierge', 'driver', 'chef', 'other');
create type public.access_type as enum ('key_box', 'keypad', 'smart_lock', 'in_person', 'other');
create type public.bed_size as enum ('single', 'double', 'queen', 'king', 'sofa_bed');
create type public.reservation_source as enum ('manual', 'airbnb', 'booking', 'vrbo', 'other');
create type public.reservation_status as enum ('confirmed', 'cancelled', 'blocked');
create type public.task_type as enum ('turnover', 'check_in', 'check_out', 'linen_delivery', 'linen_pickup', 'inspection', 'other');
create type public.task_status as enum ('unassigned', 'assigned', 'in_progress', 'done', 'to_redo', 'validated', 'cancelled');
create type public.task_priority as enum ('normal', 'high', 'urgent');
create type public.file_kind as enum ('task_photo', 'property_reference');

-- ---------------------------------------------------------------------
-- Profils (1-1 avec auth.users, créés automatiquement)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 120),
  phone text check (length(phone) <= 32),
  locale text not null default 'fr' check (locale in ('fr', 'en', 'es', 'pt', 'it', 'de')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Organisations et membres
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  country_code char(2) not null default 'FR',
  timezone text not null default 'Europe/Paris',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  position public.staff_position,
  color text not null default '#0055FF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text check (length(email) <= 254),
  role public.member_role not null default 'agent',
  position public.staff_position,
  token_hash text not null unique,           -- sha256 du jeton ; le jeton brut n'est jamais stocké
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- ---------------------------------------------------------------------
-- Logements
-- ---------------------------------------------------------------------
create table public.properties (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  address_line text,
  area text,
  city text not null default '',
  postal_code text,
  country_code char(2) not null default 'FR',
  timezone text not null default 'Europe/Paris',
  capacity int not null default 2 check (capacity between 0 and 100),
  default_check_in time not null default '16:00',
  default_check_out time not null default '11:00',
  cleaning_duration_min int not null default 90 check (cleaning_duration_min between 5 and 1440),
  learn_duration boolean not null default true,
  check_in_service boolean not null default false,
  check_out_service boolean not null default false,
  instructions text,                           -- consignes terrain (sans codes)
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- Codes d'accès : table séparée, AUCUN accès direct (ni lecture ni écriture).
create table public.property_access (
  organization_id uuid not null,
  property_id uuid not null,
  access_type public.access_type not null default 'key_box',
  code text check (length(code) <= 200),
  instructions text check (length(instructions) <= 2000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (property_id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);

-- Journal : qui a vu quel code, quand, pour quelle mission.
create table public.access_reveals (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  task_id uuid,
  user_id uuid not null references auth.users (id) on delete cascade,
  revealed_at timestamptz not null default now(),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);

create table public.beds (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  property_id uuid not null,
  size public.bed_size not null,
  label text,
  sort int not null default 0,
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);

create table public.checklist_rooms (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  property_id uuid not null,
  name text not null check (length(name) between 1 and 80),
  sort int not null default 0,
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);

create table public.checklist_items (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  room_id uuid not null,
  label text not null check (length(label) between 1 and 200),
  photo_required boolean not null default false,
  sort int not null default 0,
  unique (organization_id, id),
  foreign key (organization_id, room_id) references public.checklist_rooms (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Séjours
-- ---------------------------------------------------------------------
create table public.reservations (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  property_id uuid not null,
  source public.reservation_source not null default 'manual',
  external_uid text,
  guest_name text check (length(guest_name) <= 120),
  adults int not null default 0 check (adults between 0 and 100),
  children int not null default 0 check (children between 0 and 100),
  babies int not null default 0 check (babies between 0 and 20),
  pets int not null default 0 check (pets between 0 and 20),
  check_in_at timestamptz not null,
  check_out_at timestamptz not null,
  status public.reservation_status not null default 'confirmed',
  vip boolean not null default false,
  notes text check (length(notes) <= 4000),
  departed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out_at > check_in_at),
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);
create unique index reservations_external_uid on public.reservations (organization_id, property_id, external_uid) where external_uid is not null;

-- ---------------------------------------------------------------------
-- Missions
-- ---------------------------------------------------------------------
create table public.tasks (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  property_id uuid not null,
  reservation_id uuid,
  next_reservation_id uuid,
  type public.task_type not null,
  status public.task_status not null default 'unassigned',
  priority public.task_priority not null default 'normal',
  is_auto_generated boolean not null default false,
  title text check (length(title) <= 200),
  window_start timestamptz not null,
  window_end timestamptz not null,
  scheduled_start timestamptz,
  duration_min int not null check (duration_min between 5 and 1440),
  duration_locked boolean not null default false,
  assignee_id uuid,
  guests_count int,
  babies int not null default 0,
  pets int not null default 0,
  vip boolean not null default false,
  notes text check (length(notes) <= 4000),
  started_at timestamptz,
  completed_at timestamptz,
  previous_work_min int not null default 0 check (previous_work_min >= 0),
  validated_at timestamptz,
  validated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end > window_start),
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete set null (reservation_id),
  foreign key (organization_id, next_reservation_id) references public.reservations (organization_id, id) on delete set null (next_reservation_id),
  -- l'assigné doit être membre de LA MÊME organisation
  foreign key (organization_id, assignee_id) references public.memberships (organization_id, user_id) on delete set null (assignee_id)
);
create index tasks_assignee_idx on public.tasks (organization_id, assignee_id, window_start);
create index tasks_property_idx on public.tasks (organization_id, property_id, window_start);

create table public.task_reports (
  task_id uuid not null primary key,
  organization_id uuid not null,
  checked jsonb not null default '[]'::jsonb check (jsonb_typeof(checked) = 'array'),
  rooms jsonb not null default '{}'::jsonb check (jsonb_typeof(rooms) = 'object'),
  client_updated_at timestamptz,             -- horodatage de l'appareil (synchro hors ligne)
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade
);

-- Actions terrain rejouables (hors ligne) : idempotence par identifiant client.
create table public.task_actions (
  id uuid primary key,                       -- généré par l'appareil
  organization_id uuid not null,
  task_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('start', 'finish', 'report')),
  client_at timestamptz,
  applied_at timestamptz not null default now(),
  result text not null,
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Fichiers (photos) : métadonnées ; le binaire est dans le bucket privé
-- ---------------------------------------------------------------------
create table public.files (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  kind public.file_kind not null,
  task_id uuid,
  property_id uuid not null,
  checklist_item_id uuid,
  room_id uuid,
  path text not null unique,                 -- {org}/{kind}/{entité}/{uuid}.{ext}, construit par begin_upload()
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes int not null check (size_bytes between 1 and 15728640),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((kind = 'task_photo') = (task_id is not null)),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade,
  foreign key (organization_id, checklist_item_id) references public.checklist_items (organization_id, id) on delete set null (checklist_item_id),
  foreign key (organization_id, room_id) references public.checklist_rooms (organization_id, id) on delete set null (room_id)
);
create index files_task_idx on public.files (organization_id, task_id);

-- =====================================================================
-- Garde-fous génériques
-- =====================================================================

-- organization_id ne change jamais (même pour un owner, même via une fonction)
create function public.forbid_org_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['memberships','invitations','properties','property_access','access_reveals','beds',
    'checklist_rooms','checklist_items','reservations','tasks','task_reports','task_actions','files'] loop
    execute format('create trigger %I_org_immutable before update on public.%I for each row execute function public.forbid_org_change()', t, t);
  end loop;
  foreach t in array array['profiles','organizations','memberships','properties','reservations','tasks','task_reports'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- Profil créé à l'inscription
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Jamais d'organisation sans owner actif
create function public.keep_one_owner() returns trigger
language plpgsql set search_path = '' as $$
declare org uuid := coalesce(old.organization_id, new.organization_id);
begin
  if old.role = 'owner' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.is_active)
     and exists (select 1 from public.organizations o where o.id = org)  -- suppression en cascade de l'organisation : autorisée
     and not exists (select 1 from public.memberships m
                     where m.organization_id = org and m.role = 'owner' and m.is_active
                       and m.user_id <> old.user_id) then
    raise exception 'last_owner' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_keep_owner before update or delete on public.memberships
  for each row execute function public.keep_one_owner();

-- =====================================================================
-- Fonctions d'aide aux règles (security definer, search_path vide)
-- =====================================================================
create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = (select auth.uid()) and m.is_active);
$$;

create function public.has_role(org uuid, roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.organization_id = org and m.user_id = (select auth.uid()) and m.is_active
                   and m.role = any (roles));
$$;

create function public.is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(org, array['owner', 'manager']::public.member_role[]);
$$;

-- Mission visible par son agent : assignée à lui, membre actif, non annulée.
create function public.my_task(org uuid, task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t
                 join public.memberships m on m.organization_id = t.organization_id and m.user_id = t.assignee_id
                 where t.organization_id = org and t.id = task
                   and t.assignee_id = (select auth.uid()) and m.is_active
                   and t.status <> 'cancelled');
$$;

-- Mission « récente » de l'agent : donne accès au logement, au séjour et aux photos
-- (fenêtre se terminant il y a moins de 30 jours ou à venir).
create function public.my_recent_task(org uuid, task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_task(org, task) and exists (
    select 1 from public.tasks t where t.organization_id = org and t.id = task
      and t.window_end > now() - interval '30 days');
$$;

create function public.agent_sees_property(org uuid, prop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t
                 where t.organization_id = org and t.property_id = prop
                   and public.my_recent_task(org, t.id));
$$;

create function public.agent_sees_reservation(org uuid, res uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t
                 where t.organization_id = org and (t.reservation_id = res or t.next_reservation_id = res)
                   and public.my_recent_task(org, t.id));
$$;

-- Lecture d'un fichier : manager de l'organisation, ou agent de la mission
-- (photos de mission), ou agent ayant une mission récente sur le logement
-- (photos de référence).
create function public.can_read_file(file_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f
                 where f.path = file_path
                   and (public.is_manager(f.organization_id)
                        or (f.kind = 'task_photo' and public.my_recent_task(f.organization_id, f.task_id))
                        or (f.kind = 'property_reference' and public.agent_sees_property(f.organization_id, f.property_id))));
$$;

-- Envoi du binaire : seulement vers un chemin réservé par begin_upload(), par son auteur, dans l'heure.
create function public.can_upload_file(file_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f
                 where f.path = file_path and f.created_by = (select auth.uid())
                   and f.created_at > now() - interval '1 hour'
                   and public.is_member(f.organization_id));
$$;

create function public.can_delete_file(file_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f
                 left join public.tasks t on t.organization_id = f.organization_id and t.id = f.task_id
                 where f.path = file_path
                   and (public.is_manager(f.organization_id)
                        or (f.created_by = (select auth.uid()) and f.kind = 'task_photo'
                            and public.my_task(f.organization_id, f.task_id)
                            and t.status in ('assigned', 'in_progress', 'to_redo'))));
$$;

-- =====================================================================
-- Privilèges : rien pour anon ; écritures sensibles via fonctions
-- =====================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Organisations : création via create_organization()
revoke insert, delete on public.organizations from authenticated;
-- Membres : entrées via create_organization() / accept_invitation(), rôle via set_member_role()
revoke insert, update on public.memberships from authenticated;
grant update (position, color, is_active) on public.memberships to authenticated;
-- Profils : créés par le déclencheur
revoke insert, delete on public.profiles from authenticated;
-- Invitations : création via create_invitation() (le jeton n'est jamais stocké en clair)
revoke insert, update on public.invitations from authenticated;
-- (un droit retiré sur une colonne ne masque rien si la table entière est accordée : on accorde colonne par colonne)
revoke select on public.invitations from authenticated;
grant select (id, organization_id, email, role, position, invited_by, expires_at, accepted_at, accepted_by, created_at)
  on public.invitations to authenticated;
-- Codes : aucun accès direct
revoke all on public.property_access from authenticated;
-- Journal des codes : lecture manager uniquement, écriture par reveal_access()
revoke insert, update, delete on public.access_reveals from authenticated;
-- Actions terrain : écriture par les fonctions uniquement
revoke insert, update, delete on public.task_actions from authenticated;
-- Fichiers : création via begin_upload(), jamais modifiés
revoke insert, update on public.files from authenticated;

grant execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]), public.is_manager(uuid),
  public.my_task(uuid, uuid), public.my_recent_task(uuid, uuid), public.agent_sees_property(uuid, uuid),
  public.agent_sees_reservation(uuid, uuid), public.can_read_file(text), public.can_upload_file(text),
  public.can_delete_file(text) to authenticated;

-- =====================================================================
-- RLS : activé partout, une politique par opération
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.properties enable row level security;
alter table public.property_access enable row level security;
alter table public.access_reveals enable row level security;
alter table public.beds enable row level security;
alter table public.checklist_rooms enable row level security;
alter table public.checklist_items enable row level security;
alter table public.reservations enable row level security;
alter table public.tasks enable row level security;
alter table public.task_reports enable row level security;
alter table public.task_actions enable row level security;
alter table public.files enable row level security;

-- Profils : soi-même, et les collègues d'une organisation commune
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (
    select 1 from public.memberships mine
    join public.memberships other on other.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and mine.is_active and other.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Organisations
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.is_manager(id)) with check (public.is_manager(id));

-- Membres : visibles par les membres de l'organisation ; managers : agents seulement ; owner : tous
create policy memberships_select on public.memberships for select to authenticated
  using (public.is_member(organization_id));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_role(organization_id, array['owner']::public.member_role[])
         or (public.is_manager(organization_id) and role = 'agent'))
  with check (public.has_role(organization_id, array['owner']::public.member_role[])
         or (public.is_manager(organization_id) and role = 'agent'));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_role(organization_id, array['owner']::public.member_role[])
         or (public.is_manager(organization_id) and role = 'agent')
         or user_id = (select auth.uid()));    -- quitter une organisation

-- Invitations
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_manager(organization_id));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_manager(organization_id));

-- Données gérées par les managers, lisibles par l'agent concerné
create policy properties_select on public.properties for select to authenticated
  using (public.is_manager(organization_id) or public.agent_sees_property(organization_id, id));
create policy properties_insert on public.properties for insert to authenticated
  with check (public.is_manager(organization_id));
create policy properties_update on public.properties for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy properties_delete on public.properties for delete to authenticated
  using (public.has_role(organization_id, array['owner']::public.member_role[]));

create policy access_reveals_select on public.access_reveals for select to authenticated
  using (public.is_manager(organization_id));

create policy beds_select on public.beds for select to authenticated
  using (public.is_manager(organization_id) or public.agent_sees_property(organization_id, property_id));
create policy beds_insert on public.beds for insert to authenticated with check (public.is_manager(organization_id));
create policy beds_update on public.beds for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy beds_delete on public.beds for delete to authenticated using (public.is_manager(organization_id));

create policy checklist_rooms_select on public.checklist_rooms for select to authenticated
  using (public.is_manager(organization_id) or public.agent_sees_property(organization_id, property_id));
create policy checklist_rooms_insert on public.checklist_rooms for insert to authenticated with check (public.is_manager(organization_id));
create policy checklist_rooms_update on public.checklist_rooms for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy checklist_rooms_delete on public.checklist_rooms for delete to authenticated using (public.is_manager(organization_id));

create policy checklist_items_select on public.checklist_items for select to authenticated
  using (public.is_manager(organization_id) or exists (
    select 1 from public.checklist_rooms r where r.organization_id = checklist_items.organization_id
      and r.id = checklist_items.room_id and public.agent_sees_property(r.organization_id, r.property_id)));
create policy checklist_items_insert on public.checklist_items for insert to authenticated with check (public.is_manager(organization_id));
create policy checklist_items_update on public.checklist_items for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy checklist_items_delete on public.checklist_items for delete to authenticated using (public.is_manager(organization_id));

create policy reservations_select on public.reservations for select to authenticated
  using (public.is_manager(organization_id) or public.agent_sees_reservation(organization_id, id));
create policy reservations_insert on public.reservations for insert to authenticated with check (public.is_manager(organization_id));
create policy reservations_update on public.reservations for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy reservations_delete on public.reservations for delete to authenticated using (public.is_manager(organization_id));

-- Missions : l'agent lit les siennes ; seules les fonctions terrain les modifient pour lui
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_manager(organization_id) or public.my_task(organization_id, id));
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_manager(organization_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy tasks_delete on public.tasks for delete to authenticated using (public.is_manager(organization_id));

create policy task_reports_select on public.task_reports for select to authenticated
  using (public.is_manager(organization_id) or public.my_task(organization_id, task_id));
create policy task_reports_insert on public.task_reports for insert to authenticated with check (public.is_manager(organization_id));
create policy task_reports_update on public.task_reports for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy task_reports_delete on public.task_reports for delete to authenticated using (public.is_manager(organization_id));

create policy task_actions_select on public.task_actions for select to authenticated
  using (public.is_manager(organization_id) or user_id = (select auth.uid()));

create policy files_select on public.files for select to authenticated
  using (public.can_read_file(path));
create policy files_delete on public.files for delete to authenticated
  using (public.can_delete_file(path));

-- =====================================================================
-- Fonctions métier (seules portes d'entrée pour les opérations sensibles)
-- =====================================================================

create function public.create_organization(org_name text, org_timezone text default 'Europe/Paris', org_country char(2) default 'FR')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); org uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  insert into public.organizations (name, timezone, country_code, created_by)
  values (org_name, org_timezone, org_country, uid) returning id into org;
  insert into public.memberships (organization_id, user_id, role) values (org, uid, 'owner');
  return org;
end $$;

-- Renvoie le jeton brut UNE fois ; seule son empreinte est stockée.
create function public.create_invitation(org uuid, invite_role public.member_role, invite_email text default null,
  invite_position public.staff_position default null)
returns text language plpgsql security definer set search_path = '' as $$
declare raw text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if invite_role <> 'agent' and not public.has_role(org, array['owner']::public.member_role[]) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.invitations (organization_id, email, role, position, token_hash, invited_by)
  values (org, invite_email, invite_role, invite_position, encode(extensions.digest(raw, 'sha256'), 'hex'), (select auth.uid()));
  return raw;
end $$;

create function public.accept_invitation(raw_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); inv public.invitations;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into inv from public.invitations
   where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
   for update;
  if inv.id is null or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'invalid_invitation' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships where organization_id = inv.organization_id and user_id = uid) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  insert into public.memberships (organization_id, user_id, role, position)
  values (inv.organization_id, uid, inv.role, inv.position);
  update public.invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.organization_id;
end $$;

-- Changement de rôle : owner uniquement ; personne ne change son propre rôle ;
-- le dernier owner est protégé par le déclencheur.
create function public.set_member_role(org uuid, member uuid, new_role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(org, array['owner']::public.member_role[]) or member = (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.memberships set role = new_role where organization_id = org and user_id = member;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Codes d'accès : écriture par un manager (jamais renvoyés par cette fonction)
create function public.set_property_access(org uuid, prop uuid, a_type public.access_type, a_code text, a_instructions text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties where organization_id = org and id = prop) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.property_access (organization_id, property_id, access_type, code, instructions, updated_by)
  values (org, prop, a_type, a_code, a_instructions, (select auth.uid()))
  on conflict (property_id) do update set access_type = excluded.access_type, code = excluded.code,
    instructions = excluded.instructions, updated_by = excluded.updated_by, updated_at = now()
  where public.property_access.organization_id = org;
end $$;

-- Lecture d'un code : toujours explicite et journalisée.
--  * manager : à tout moment ;
--  * agent : uniquement pour SA mission active (assignée, en cours ou à reprendre),
--    de 12 h avant le début de la fenêtre à 2 h après sa fin.
create function public.reveal_access(org uuid, task uuid default null, prop uuid default null)
returns table (access_type public.access_type, code text, instructions text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); target uuid := prop;
begin
  if task is not null then
    select t.property_id into target from public.tasks t
     where t.organization_id = org and t.id = task
       and (public.is_manager(org)
            or (public.my_task(org, task) and t.status in ('assigned', 'in_progress', 'to_redo')
                and now() between t.window_start - interval '12 hours' and t.window_end + interval '2 hours'));
    if target is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  elsif not public.is_manager(org) or not exists (select 1 from public.properties p where p.organization_id = org and p.id = target) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.access_reveals (organization_id, property_id, task_id, user_id) values (org, target, task, uid);
  return query select a.access_type, a.code, a.instructions from public.property_access a
    where a.organization_id = org and a.property_id = target;
end $$;

-- Horodatage d'appareil accepté s'il est plausible (hors ligne jusqu'à 48 h), sinon heure serveur.
create function public.plausible_time(client_at timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select case when client_at between now() - interval '48 hours' and now() + interval '5 minutes'
              then client_at else now() end;
$$;

-- Démarrer : assigned / to_redo → in_progress. Rejouable (même action_id = même résultat).
create function public.start_task(org uuid, task uuid, action_id uuid, client_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev text; t public.tasks; res text;
begin
  select result into prev from public.task_actions where id = action_id and user_id = uid;
  if prev is not null then return prev; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status in ('assigned', 'to_redo') then
    update public.tasks set status = 'in_progress',
      previous_work_min = case when t.status = 'to_redo' and t.started_at is not null and t.completed_at is not null
        then previous_work_min + greatest(0, extract(epoch from (t.completed_at - t.started_at))::int / 60) else previous_work_min end,
      started_at = public.plausible_time(client_at), completed_at = null
    where organization_id = org and id = task;
    res := 'applied';
  elsif t.status = 'in_progress' then res := 'already';
  else res := 'conflict:' || t.status;           -- terminée, validée… : le serveur a raison
  end if;
  insert into public.task_actions (id, organization_id, task_id, user_id, kind, client_at, result)
  values (action_id, org, task, uid, 'start', client_at, res);
  return res;
end $$;

-- Terminer : in_progress → done.
create function public.finish_task(org uuid, task uuid, action_id uuid, client_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); prev text; t public.tasks; res text; fin timestamptz;
begin
  select result into prev from public.task_actions where id = action_id and user_id = uid;
  if prev is not null then return prev; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.status = 'in_progress' then
    fin := greatest(public.plausible_time(client_at), t.started_at);
    update public.tasks set status = 'done', completed_at = fin where organization_id = org and id = task;
    res := 'applied';
  elsif t.status in ('done', 'validated') then res := 'already';
  else res := 'conflict:' || t.status;
  end if;
  insert into public.task_actions (id, organization_id, task_id, user_id, kind, client_at, result)
  values (action_id, org, task, uid, 'finish', client_at, res);
  return res;
end $$;

-- Rapport : modifiable par l'agent tant que la mission n'est pas terminée.
-- Un seul rédacteur (l'assigné) ; la version la plus récente selon l'appareil l'emporte.
create function public.save_task_report(org uuid, task uuid, report_checked jsonb, report_rooms jsonb, client_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); st public.task_status; cur timestamptz; at timestamptz := public.plausible_time(client_at);
begin
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select status into st from public.tasks where organization_id = org and id = task;
  if st not in ('assigned', 'in_progress', 'to_redo') then return 'conflict:' || st; end if;
  select client_updated_at into cur from public.task_reports where task_id = task;
  if cur is not null and cur > at then return 'stale'; end if;
  insert into public.task_reports (task_id, organization_id, checked, rooms, client_updated_at, updated_by)
  values (task, org, report_checked, report_rooms, at, uid)
  on conflict (task_id) do update set checked = excluded.checked, rooms = excluded.rooms,
    client_updated_at = excluded.client_updated_at, updated_by = excluded.updated_by, updated_at = now()
  where public.task_reports.organization_id = org;
  return 'applied';
end $$;

-- Réserve un chemin de fichier. Le binaire ne peut être envoyé qu'à ce chemin.
create function public.begin_upload(org uuid, f_kind public.file_kind, f_mime text, f_size int,
  task uuid default null, prop uuid default null, item uuid default null, room uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); target uuid; ext text; p text; st public.task_status;
begin
  ext := case f_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                     when 'image/heic' then 'heic' else null end;
  if ext is null then raise exception 'bad_mime' using errcode = '22023'; end if;
  if f_kind = 'task_photo' then
    select t.property_id, t.status into target, st from public.tasks t where t.organization_id = org and t.id = task;
    if target is null or not (public.is_manager(org)
         or (public.my_task(org, task) and st in ('assigned', 'in_progress', 'to_redo'))) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    p := org || '/task/' || task || '/' || gen_random_uuid() || '.' || ext;
  else
    if not public.is_manager(org) or not exists (select 1 from public.properties where organization_id = org and id = prop) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    target := prop;
    p := org || '/property/' || prop || '/' || gen_random_uuid() || '.' || ext;
  end if;
  insert into public.files (organization_id, kind, task_id, property_id, checklist_item_id, room_id, path, mime, size_bytes, created_by)
  values (org, f_kind, task, target, item, room, p, f_mime, f_size, uid);
  return p;
end $$;

revoke all on function public.create_organization(text, text, char), public.create_invitation(uuid, public.member_role, text, public.staff_position),
  public.accept_invitation(text), public.set_member_role(uuid, uuid, public.member_role),
  public.set_property_access(uuid, uuid, public.access_type, text, text), public.reveal_access(uuid, uuid, uuid),
  public.start_task(uuid, uuid, uuid, timestamptz), public.finish_task(uuid, uuid, uuid, timestamptz),
  public.save_task_report(uuid, uuid, jsonb, jsonb, timestamptz),
  public.begin_upload(uuid, public.file_kind, text, int, uuid, uuid, uuid, uuid),
  public.forbid_org_change(), public.touch_updated_at(), public.handle_new_user(), public.keep_one_owner(),
  public.plausible_time(timestamptz) from public, anon;
grant execute on function public.create_organization(text, text, char), public.create_invitation(uuid, public.member_role, text, public.staff_position),
  public.accept_invitation(text), public.set_member_role(uuid, uuid, public.member_role),
  public.set_property_access(uuid, uuid, public.access_type, text, text), public.reveal_access(uuid, uuid, uuid),
  public.start_task(uuid, uuid, uuid, timestamptz), public.finish_task(uuid, uuid, uuid, timestamptz),
  public.save_task_report(uuid, uuid, jsonb, jsonb, timestamptz),
  public.begin_upload(uuid, public.file_kind, text, int, uuid, uuid, uuid, uuid),
  public.plausible_time(timestamptz) to authenticated;

-- =====================================================================
-- Stockage privé
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-files', 'org-files', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;

create policy org_files_select on storage.objects for select to authenticated
  using (bucket_id = 'org-files' and public.can_read_file(name));
create policy org_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-files' and public.can_upload_file(name));
create policy org_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-files' and public.can_delete_file(name));
-- aucune politique UPDATE : un fichier envoyé n'est jamais remplacé
