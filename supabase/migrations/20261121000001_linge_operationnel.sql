-- Migration 26 : linge opérationnel — catalogue, kit par logement, stock par emplacement (mouvements historisés),
-- collecte de linge planifiée depuis un séjour. Aucune donnée existante n'est modifiée.
--
-- Principes :
--  * le stock n'est jamais saisi directement : il est la somme des mouvements (inventaire compris) ;
--  * chaque mouvement garde son auteur, sa date, son motif et, s'il y a lieu, la mission ou le logement ;
--  * lecture et écriture réservées aux responsables de l'organisation (aucun accès agent, voyageur ou externe).

create table public.linen_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 80),
  unit text not null default 'pièce' check (length(trim(unit)) between 1 and 20),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index linen_items_label_idx on public.linen_items (organization_id, lower(trim(label))) where active;

create table public.property_linen_kits (
  organization_id uuid not null,
  property_id uuid not null,
  item_id uuid not null,
  qty int not null check (qty between 1 and 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (property_id, item_id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.linen_items (organization_id, id) on delete cascade
);

-- Emplacements : propre (réserve), sale (à envoyer), chez le blanchisseur
create table public.linen_movements (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  item_id uuid not null,
  location text not null check (location in ('clean', 'dirty', 'laundry')),
  delta int not null check ((delta <> 0 or kind = 'count') and abs(delta) <= 100000),
  kind text not null check (kind in ('count', 'purchase', 'to_laundry', 'from_laundry', 'delivery', 'pickup', 'loss', 'adjust')),
  group_id uuid not null,
  property_id uuid,
  task_id uuid,
  note text check (length(note) <= 500),
  actor_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now(),
  foreign key (organization_id, item_id) references public.linen_items (organization_id, id) on delete cascade
);
create index linen_movements_idx on public.linen_movements (organization_id, item_id, location);
create index linen_movements_task_idx on public.linen_movements (organization_id, task_id) where task_id is not null;

alter table public.linen_items enable row level security;
alter table public.property_linen_kits enable row level security;
alter table public.linen_movements enable row level security;
revoke all on public.linen_items, public.property_linen_kits, public.linen_movements from anon;
grant select, insert, update on public.linen_items to authenticated;
grant select, insert, update, delete on public.property_linen_kits to authenticated;
grant select on public.linen_movements to authenticated;
create policy linen_items_select on public.linen_items for select to authenticated using (public.is_manager(organization_id));
create policy linen_items_insert on public.linen_items for insert to authenticated with check (public.is_manager(organization_id));
create policy linen_items_update on public.linen_items for update to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy linen_kits_select on public.property_linen_kits for select to authenticated using (public.is_manager(organization_id));
create policy linen_kits_insert on public.property_linen_kits for insert to authenticated with check (public.is_manager(organization_id));
create policy linen_kits_update on public.property_linen_kits for update to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy linen_kits_delete on public.property_linen_kits for delete to authenticated using (public.is_manager(organization_id));
-- Mouvements : lecture par les responsables ; écriture uniquement par les fonctions ci-dessous (historique non modifiable)
create policy linen_movements_select on public.linen_movements for select to authenticated using (public.is_manager(organization_id));

-- Stock actuel par article et emplacement
create function public.linen_stock(org uuid) returns table (item_id uuid, location text, qty bigint, last_count_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.item_id, m.location, sum(m.delta), max(m.at) filter (where m.kind = 'count')
    from public.linen_movements m
   where m.organization_id = org and public.is_manager(org)
   group by m.item_id, m.location;
$$;
revoke all on function public.linen_stock(uuid) from public, anon;
grant execute on function public.linen_stock(uuid) to authenticated;

-- Inventaire : fixe la quantité comptée à un emplacement (le mouvement enregistre l'écart, même nul)
create function public.linen_count(org uuid, item uuid, loc text, counted int, note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur bigint; g uuid := gen_random_uuid();
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.linen_items where organization_id = org and id = item) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if loc not in ('clean', 'dirty', 'laundry') or counted is null or counted < 0 or counted > 100000 then raise exception 'invalid' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('linen:' || item::text || loc, 0));
  select coalesce(sum(delta), 0) into cur from public.linen_movements where organization_id = org and item_id = item and location = loc;
  -- Écart enregistré, même nul : la date du dernier comptage reste connue
  insert into public.linen_movements (organization_id, item_id, location, delta, kind, group_id, note, actor_id)
  values (org, item, loc, counted - cur, 'count', g, nullif(left(trim(coalesce(note, '')), 500), ''), (select auth.uid()));
  return jsonb_build_object('status', 'applied', 'before', cur, 'after', counted);
end $$;
revoke all on function public.linen_count(uuid, uuid, text, int, text) from public, anon;
grant execute on function public.linen_count(uuid, uuid, text, int, text) to authenticated;

-- Mouvement : transfert entre emplacements (from/to), entrée (achat : to seul) ou sortie (perte : from seul).
-- Refus si l'emplacement de départ n'a pas assez de pièces (jamais de stock négatif silencieux).
create function public.linen_move(org uuid, item uuid, from_loc text, to_loc text, qty int, kind text, note text default null,
                                  property uuid default null, task uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cur bigint; g uuid := gen_random_uuid(); why text := nullif(left(trim(coalesce(note, '')), 500), '');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.linen_items where organization_id = org and id = item) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if qty is null or qty <= 0 or qty > 100000 or (from_loc is null and to_loc is null) or from_loc = to_loc
     or (from_loc is not null and from_loc not in ('clean', 'dirty', 'laundry')) or (to_loc is not null and to_loc not in ('clean', 'dirty', 'laundry'))
     or kind not in ('purchase', 'to_laundry', 'from_laundry', 'delivery', 'pickup', 'loss', 'adjust') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if property is not null and not exists (select 1 from public.properties where organization_id = org and id = property) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if task is not null and not exists (select 1 from public.tasks where organization_id = org and id = task) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if from_loc is not null then
    perform pg_advisory_xact_lock(hashtextextended('linen:' || item::text || from_loc, 0));
    select coalesce(sum(delta), 0) into cur from public.linen_movements where organization_id = org and item_id = item and location = from_loc;
    if cur < qty then raise exception 'insufficient_stock' using errcode = '22023'; end if;
    insert into public.linen_movements (organization_id, item_id, location, delta, kind, group_id, property_id, task_id, note, actor_id)
    values (org, item, from_loc, -qty, kind, g, property, task, why, (select auth.uid()));
  end if;
  if to_loc is not null then
    insert into public.linen_movements (organization_id, item_id, location, delta, kind, group_id, property_id, task_id, note, actor_id)
    values (org, item, to_loc, qty, kind, g, property, task, why, (select auth.uid()));
  end if;
  return jsonb_build_object('status', 'applied', 'group', g);
end $$;
revoke all on function public.linen_move(uuid, uuid, text, text, int, text, text, uuid, uuid) from public, anon;
grant execute on function public.linen_move(uuid, uuid, text, text, int, text, text, uuid, uuid) to authenticated;

-- Mission linge terminée → stock : le kit du logement sort du propre (livraison) ou entre au sale (collecte).
-- Une seule fois par mission ; refus si le kit n'est pas défini ou si le stock propre est insuffisant.
create function public.linen_apply_task(org uuid, task uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; k record; n int := 0;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null or t.type not in ('linen_delivery', 'linen_pickup') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status not in ('done', 'validated') then return jsonb_build_object('status', 'not_done'); end if;
  if exists (select 1 from public.linen_movements where organization_id = org and task_id = task) then return jsonb_build_object('status', 'already'); end if;
  if not exists (select 1 from public.property_linen_kits where organization_id = org and property_id = t.property_id) then return jsonb_build_object('status', 'no_kit'); end if;
  for k in select item_id, qty from public.property_linen_kits where organization_id = org and property_id = t.property_id loop
    if t.type = 'linen_delivery' then
      perform public.linen_move(org, k.item_id, 'clean', null, k.qty, 'delivery', null, t.property_id, task);
    else
      perform public.linen_move(org, k.item_id, null, 'dirty', k.qty, 'pickup', null, t.property_id, task);
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('status', 'applied', 'items', n);
end $$;
revoke all on function public.linen_apply_task(uuid, uuid) from public, anon;
grant execute on function public.linen_apply_task(uuid, uuid) to authenticated;

-- Collecte de linge après un départ (même règles que la livraison : responsable, pas de doublon, plage cohérente)
create function public.plan_linen_pickup(org uuid, reservation uuid, w_start timestamptz, w_end timestamptz, duration int,
                                         assignee uuid default null, note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; existing uuid; new_id uuid;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.reservations where organization_id = org and id = reservation;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('linen-pickup:' || reservation::text, 0));
  select t.id into existing from public.tasks t
   where t.organization_id = org and t.reservation_id = reservation and t.type = 'linen_pickup' and t.status <> 'cancelled' limit 1;
  if existing is not null then return jsonb_build_object('status', 'exists', 'id', existing); end if;
  if duration is null or duration < 5 or duration > 1440 or w_start < r.check_out_at or w_end < w_start + make_interval(mins => duration) then
    raise exception 'invalid_window' using errcode = '22023';
  end if;
  insert into public.tasks (organization_id, property_id, reservation_id, type, status, is_auto_generated, window_start, window_end, duration_min, assignee_id, notes)
  values (org, r.property_id, reservation, 'linen_pickup', case when assignee is null then 'unassigned' else 'assigned' end::public.task_status, false,
          w_start, w_end, duration, assignee, nullif(left(trim(coalesce(note, '')), 4000), ''))
  returning tasks.id into new_id;
  return jsonb_build_object('status', 'created', 'id', new_id);
end $$;
revoke all on function public.plan_linen_pickup(uuid, uuid, timestamptz, timestamptz, int, uuid, text) from public, anon;
grant execute on function public.plan_linen_pickup(uuid, uuid, timestamptz, timestamptz, int, uuid, text) to authenticated;
