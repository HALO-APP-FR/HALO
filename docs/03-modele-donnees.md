# HALO — Modèle de données (Supabase / PostgreSQL)

Règles : toutes les tables métier portent `organization_id`. Tous les horaires en `timestamptz` (UTC). Sécurité par **Row Level Security (RLS)** activée sur toutes les tables, sans exception. La migration ci-dessous est la référence : Cursor doit la créer telle quelle dans `supabase/migrations/0001_init.sql`.

## Schéma relationnel (vue d'ensemble)
```
organizations ─┬─ memberships ── profiles (auth.users)
               ├─ invitations
               ├─ properties ─┬─ property_access
               │              ├─ beds
               │              ├─ property_linen_rules ── linen_types
               │              ├─ checklist_rooms ── checklist_items
               │              └─ calendar_feeds ── reservations
               ├─ tasks ─┬─ task_checklist_items
               │         ├─ task_photos
               │         ├─ task_comments
               │         └─ task_linen
               ├─ incidents
               ├─ linen_types ── linen_stock ── linen_locations
               ├─ linen_movements
               ├─ laundry_orders ── laundry_order_lines
               ├─ agent_unavailability
               ├─ notifications
               └─ push_subscriptions
```

## Migration SQL complète

```sql
-- =========================================================
-- HALO — 0001_init.sql
-- =========================================================
create extension if not exists "pgcrypto";

-- ---------- Types ----------
create type member_role       as enum ('owner','manager','agent');
create type task_type         as enum ('turnover','check_in','check_out','linen_delivery','linen_pickup','inspection','other');
create type task_status       as enum ('unassigned','assigned','in_progress','done','to_redo','validated','cancelled');
create type task_priority     as enum ('normal','high','urgent');
create type reservation_status as enum ('confirmed','cancelled','blocked');
create type access_type       as enum ('key_box','keypad','smart_lock','in_person','other');
create type incident_category as enum ('damage','breakdown','abnormal_dirt','forgotten_item','missing_supply','other');
create type incident_status   as enum ('open','in_progress','resolved');
create type linen_location_kind as enum ('central_stock','property','laundry','dirty');
create type laundry_order_status as enum ('draft','sent','received','closed');

-- ---------- Profils (1-1 avec auth.users) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  locale text not null default 'en',          -- langue d'interface de la personne
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------- Organisations ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code char(2) not null,
  default_timezone text not null,              -- IANA, ex 'Europe/Paris'
  default_locale text not null default 'en',
  logo_url text,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null,
  is_active boolean not null default true,
  color text,                                   -- couleur de l'agent dans le planning
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text,
  role member_role not null default 'agent',
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  invited_by uuid references profiles(id),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Fonctions d'aide RLS ----------
create or replace function is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.is_active);
$$;

create or replace function is_manager(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.is_active
      and m.role in ('owner','manager'));
$$;

create or replace function is_owner(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.is_active
      and m.role = 'owner');
$$;

-- ---------- Logements ----------
create table properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  address_line text,
  city text,
  postal_code text,
  country_code char(2),
  latitude double precision,
  longitude double precision,
  timezone text not null,                       -- IANA, obligatoire
  capacity int,
  surface_m2 numeric,
  default_check_in_time time not null default '16:00',
  default_check_out_time time not null default '11:00',
  cleaning_duration_min int not null default 120,
  instructions text,
  reference_photos text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on properties (organization_id);

create table property_access (
  property_id uuid primary key references properties(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  type access_type not null default 'key_box',
  code text,
  instructions text,
  photo_url text,
  updated_at timestamptz not null default now()
);

create table beds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  size text not null,                           -- 'single','double','queen','king','sofa_bed'
  label text,                                   -- 'Chambre 1'
  created_at timestamptz not null default now()
);

-- ---------- Checklists (modèle par logement) ----------
create table checklist_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  name text not null,
  position int not null default 0
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  room_id uuid not null references checklist_rooms(id) on delete cascade,
  label text not null,
  photo_required boolean not null default false,
  position int not null default 0
);

-- ---------- Calendriers iCal & réservations ----------
create table calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  source text not null,                         -- 'airbnb','booking','vrbo','other'
  url text not null,
  last_synced_at timestamptz,
  last_error text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  feed_id uuid references calendar_feeds(id) on delete set null,
  external_uid text,                            -- UID iCal
  source text not null default 'manual',
  guest_name text,
  guests_count int,
  check_in_at timestamptz not null,
  check_out_at timestamptz not null,
  status reservation_status not null default 'confirmed',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feed_id, external_uid),
  check (check_out_at > check_in_at)
);
create index on reservations (organization_id, property_id, check_in_at);

-- ---------- Tâches ----------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,       -- réservation sortante
  next_reservation_id uuid references reservations(id) on delete set null,  -- réservation entrante
  type task_type not null,
  status task_status not null default 'unassigned',
  priority task_priority not null default 'normal',
  is_auto_generated boolean not null default false,
  title text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  scheduled_start timestamptz,
  duration_min int not null default 120,
  assignee_id uuid references profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  validated_at timestamptz,
  validated_by uuid references profiles(id),
  redo_reason text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end > window_start)
);
create index on tasks (organization_id, window_start);
create index on tasks (assignee_id, window_start);
create unique index tasks_auto_unique on tasks (reservation_id, type) where is_auto_generated;

create table task_checklist_items (              -- copie figée de la checklist au moment de la tâche
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  room_name text not null,
  label text not null,
  photo_required boolean not null default false,
  position int not null default 0,
  is_done boolean not null default false,
  done_at timestamptz
);

create table task_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  checklist_item_id uuid references task_checklist_items(id) on delete set null,
  storage_path text not null,
  taken_at timestamptz not null default now(),
  uploaded_by uuid references profiles(id)
);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Incidents ----------
create table incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  category incident_category not null,
  status incident_status not null default 'open',
  is_urgent boolean not null default false,
  description text,
  photo_paths text[] not null default '{}',
  reported_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Linge ----------
create table linen_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,                           -- 'Drap housse double', 'Serviette de bain'
  category text not null,                       -- 'bed','bath','kitchen','other'
  bed_size text,                                -- si linge de lit : taille compatible
  unit_cost numeric,
  is_active boolean not null default true
);

create table property_linen_rules (               -- ce qu'il faut poser à chaque rotation
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  linen_type_id uuid not null references linen_types(id) on delete cascade,
  qty_fixed int not null default 0,             -- quantité fixe par rotation
  qty_per_guest int not null default 0,         -- quantité par voyageur
  unique (property_id, linen_type_id)
);

create table linen_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind linen_location_kind not null,
  name text not null,
  property_id uuid references properties(id) on delete cascade
);

create table linen_stock (
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references linen_locations(id) on delete cascade,
  linen_type_id uuid not null references linen_types(id) on delete cascade,
  quantity int not null default 0,
  primary key (location_id, linen_type_id)
);

create table linen_movements (                    -- journal immuable, la source de vérité du stock
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  linen_type_id uuid not null references linen_types(id),
  from_location_id uuid references linen_locations(id),
  to_location_id uuid references linen_locations(id),
  quantity int not null check (quantity > 0),
  reason text not null,                         -- 'turnover','laundry_send','laundry_receive','loss','damage','adjustment','purchase'
  task_id uuid references tasks(id) on delete set null,
  laundry_order_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table task_linen (                         -- prévu vs réellement posé/retiré
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  linen_type_id uuid not null references linen_types(id),
  qty_planned int not null default 0,
  qty_placed int,
  qty_removed int,
  unique (task_id, linen_type_id)
);

create table laundry_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  reference text not null,
  laundry_name text,
  status laundry_order_status not null default 'draft',
  sent_at timestamptz,
  expected_at timestamptz,
  received_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table laundry_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  laundry_order_id uuid not null references laundry_orders(id) on delete cascade,
  linen_type_id uuid not null references linen_types(id),
  qty_sent int not null default 0,
  qty_received int,
  qty_damaged int not null default 0
);

alter table linen_movements
  add constraint linen_movements_order_fk foreign key (laundry_order_id)
  references laundry_orders(id) on delete set null;

-- ---------- Équipe & notifications ----------
create table agent_unavailability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,                           -- 'task_assigned','task_changed','task_cancelled','task_late','incident','redo'
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------- updated_at automatique ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_res_upd before update on reservations for each row execute function touch_updated_at();
create trigger t_task_upd before update on tasks for each row execute function touch_updated_at();

-- ---------- Profil créé à l'inscription ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- =========================================================
-- RLS
-- =========================================================
alter table profiles enable row level security;
alter table organizations enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table properties enable row level security;
alter table property_access enable row level security;
alter table beds enable row level security;
alter table checklist_rooms enable row level security;
alter table checklist_items enable row level security;
alter table calendar_feeds enable row level security;
alter table reservations enable row level security;
alter table tasks enable row level security;
alter table task_checklist_items enable row level security;
alter table task_photos enable row level security;
alter table task_comments enable row level security;
alter table incidents enable row level security;
alter table linen_types enable row level security;
alter table property_linen_rules enable row level security;
alter table linen_locations enable row level security;
alter table linen_stock enable row level security;
alter table linen_movements enable row level security;
alter table task_linen enable row level security;
alter table laundry_orders enable row level security;
alter table laundry_order_lines enable row level security;
alter table agent_unavailability enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;

-- Profils : soi-même + collègues de la même organisation (lecture)
create policy profiles_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_colleagues on profiles for select using (
  exists (select 1 from memberships a join memberships b on a.organization_id = b.organization_id
          where a.user_id = auth.uid() and b.user_id = profiles.id and a.is_active));

-- Organisations
create policy org_read on organizations for select using (is_member(id));
create policy org_update on organizations for update using (is_owner(id));
create policy org_insert on organizations for insert with check (auth.uid() is not null);

-- Memberships
create policy mem_read on memberships for select using (is_member(organization_id));
create policy mem_write on memberships for all using (is_manager(organization_id)) with check (is_manager(organization_id));

-- Invitations : managers uniquement (l'acceptation passe par une fonction serveur)
create policy inv_all on invitations for all using (is_manager(organization_id)) with check (is_manager(organization_id));

-- Tables "référentiel" : lecture membres, écriture managers
do $$
declare t text;
begin
  foreach t in array array['properties','beds','checklist_rooms','checklist_items','linen_types',
                           'property_linen_rules','linen_locations','linen_stock','calendar_feeds',
                           'reservations','laundry_orders','laundry_order_lines']
  loop
    execute format('create policy %1$s_read on %1$s for select using (is_member(organization_id));', t);
    execute format('create policy %1$s_write on %1$s for all using (is_manager(organization_id)) with check (is_manager(organization_id));', t);
  end loop;
end $$;

-- Accès logement : managers toujours ; agent seulement s'il a une tâche sur ce logement dans les 24 h
create policy access_manager on property_access for all
  using (is_manager(organization_id)) with check (is_manager(organization_id));
create policy access_agent on property_access for select using (
  exists (select 1 from tasks t where t.property_id = property_access.property_id
          and t.assignee_id = auth.uid()
          and t.status in ('assigned','in_progress','to_redo')
          and t.window_start < now() + interval '24 hours'
          and t.window_end > now() - interval '12 hours'));

-- Tâches : managers tout ; agent uniquement ses tâches (lecture + mise à jour)
create policy tasks_manager on tasks for all using (is_manager(organization_id)) with check (is_manager(organization_id));
create policy tasks_agent_read on tasks for select using (assignee_id = auth.uid());
create policy tasks_agent_update on tasks for update using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());

-- Sous-tables de tâche : visibles si la tâche est visible
do $$
declare t text;
begin
  foreach t in array array['task_checklist_items','task_photos','task_comments','task_linen']
  loop
    execute format('create policy %1$s_manager on %1$s for all using (is_manager(organization_id)) with check (is_manager(organization_id));', t);
    execute format('create policy %1$s_agent on %1$s for all using (exists (select 1 from tasks x where x.id = %1$s.task_id and x.assignee_id = auth.uid())) with check (exists (select 1 from tasks x where x.id = %1$s.task_id and x.assignee_id = auth.uid()));', t);
  end loop;
end $$;

-- Incidents : tout membre peut créer ; managers gèrent ; agent voit les siens
create policy inc_manager on incidents for all using (is_manager(organization_id)) with check (is_manager(organization_id));
create policy inc_agent_read on incidents for select using (reported_by = auth.uid());
create policy inc_agent_insert on incidents for insert with check (is_member(organization_id) and reported_by = auth.uid());

-- Mouvements de linge : managers ; agent peut insérer ceux liés à ses tâches
create policy lm_manager on linen_movements for all using (is_manager(organization_id)) with check (is_manager(organization_id));
create policy lm_agent_insert on linen_movements for insert with check (
  exists (select 1 from tasks x where x.id = linen_movements.task_id and x.assignee_id = auth.uid()));

-- Indisponibilités : l'agent gère les siennes, managers voient tout
create policy un_self on agent_unavailability for all using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(organization_id));
create policy un_manager on agent_unavailability for select using (is_manager(organization_id));

-- Notifications & push : personnelles
create policy notif_self on notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_self on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

## Points de vigilance pour Cursor
1. **Création d'organisation** : se fait via une fonction serveur (route API avec la clé service) qui crée l'organisation ET la membership `owner` dans la même transaction, sinon l'utilisateur ne peut pas lire l'organisation qu'il vient de créer.
2. **Acceptation d'invitation** : route serveur qui vérifie le token, crée la membership, marque l'invitation acceptée.
3. **Agent qui met à jour une tâche** : côté serveur, n'autoriser que les champs `status` (vers `in_progress` ou `done`), `started_at`, `completed_at`, `notes`. Un agent ne peut pas changer l'assignation, les fenêtres ou la priorité.
4. **Stockage photos** : bucket Supabase privé `task-photos`, chemin `{organization_id}/{task_id}/{uuid}.jpg`, URLs signées à durée limitée. Compression côté client avant envoi (max 1600 px, qualité 0,8).
5. **Stock de linge** : `linen_stock` est recalculé à partir de `linen_movements` (fonction SQL ou trigger). Ne jamais modifier le stock directement sans mouvement.
