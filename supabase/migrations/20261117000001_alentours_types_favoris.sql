-- Migration 22 : carte « Découvrir les alentours » — type précis des lieux (restaurant, café, supermarché, pharmacie…)
-- et favoris du voyageur, liés au séjour et soumis aux règles du lien (durée, expiration, révocation).
-- Aucune donnée existante n'est modifiée : colonne nullable, nouvelle table.

-- A. Type précis issu de la source (valeur OpenStreetMap : restaurant, cafe, supermarket, pharmacy…) ; vide pour les lieux saisis
alter table public.property_places add column kind text check (kind ~ '^[a-z_]{1,40}$');

-- B. Favoris du voyageur : un par lieu et par séjour ; jamais lisibles hors d'un lien valide
create table public.stay_place_favorites (
  organization_id uuid not null,
  reservation_id uuid not null,
  place_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (reservation_id, place_id),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (place_id) references public.property_places (id) on delete cascade
);
create index stay_place_favorites_org_idx on public.stay_place_favorites (organization_id, reservation_id);
alter table public.stay_place_favorites enable row level security;
revoke all on public.stay_place_favorites from anon, authenticated;
-- L'équipe peut voir les favoris de ses séjours (lecture seule) ; le voyageur passe par les fonctions à jeton
grant select on public.stay_place_favorites to authenticated;
create policy stay_place_favorites_select on public.stay_place_favorites for select to authenticated using (public.is_manager(organization_id));

-- Ajouter / retirer un favori : lien valide, lieu du logement, visible pour ce voyageur à ce moment
create function public.guest_place_favorite(token text, place uuid, fav boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; p public.properties; x public.property_places; full_access boolean;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  select * into x from public.property_places where organization_id = r.organization_id and property_id = r.property_id and id = place;
  if x.id is null or x.hidden or (x.source = 'openstreetmap' and not p.auto_places)
     or (not full_access and (x.source = 'openstreetmap'
         or (x.latitude is not null and p.latitude is not null and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) < 300))) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if fav then
    insert into public.stay_place_favorites (organization_id, reservation_id, place_id) values (r.organization_id, r.id, x.id)
    on conflict do nothing;
  else
    delete from public.stay_place_favorites where reservation_id = r.id and place_id = x.id;
  end if;
  return jsonb_build_object('status', 'ok', 'favorite', fav);
end $$;
revoke all on function public.guest_place_favorite(text, uuid, boolean) from public;
grant execute on function public.guest_place_favorite(text, uuid, boolean) to anon, authenticated;

-- C. Lieux du voyageur : + type précis et favoris (mêmes règles de visibilité qu'avant)
create or replace function public.guest_places(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations; p public.properties; full_access boolean; near_hidden int := 0; auto_hidden int := 0; favs jsonb;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  if not full_access then
    select count(*) filter (where x.source = 'openstreetmap'),
           count(*) filter (where x.source <> 'openstreetmap' and p.latitude is not null and x.latitude is not null
                              and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) < 300)
      into auto_hidden, near_hidden
      from public.property_places x
     where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden and (x.source <> 'openstreetmap' or p.auto_places)
       and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000);
  end if;
  -- Favoris du séjour (lien valide uniquement : expiré ou révoqué → « unavailable » plus haut, aucun favori lisible)
  select coalesce(jsonb_agg(f.place_id order by f.created_at), '[]'::jsonb) into favs
    from public.stay_place_favorites f where f.organization_id = r.organization_id and f.reservation_id = r.id;
  return jsonb_build_object('status', 'ok', 'full', full_access, 'near_hidden', near_hidden, 'auto_hidden', auto_hidden, 'favorites', favs,
    'property', jsonb_build_object('name', p.name, 'address', case when full_access then p.address_line end,
      'postal_code', case when full_access then p.postal_code end, 'city', p.city, 'country_code', p.country_code,
      'lat', case when full_access then p.latitude end, 'lng', case when full_access then p.longitude end),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'kind', x.kind, 'name', x.name,
        'description', x.description, 'address', case when full_access or public.guest_place_address_ok(p, x) then x.address end,
        'lat', case when full_access then x.latitude end, 'lng', case when full_access then x.longitude end,
        'opening_hours', x.opening_hours, 'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at, 'created_at', x.created_at, 'verified_at', x.verified_at,
        'distance_m', case when full_access and p.latitude is not null and x.latitude is not null
                           then round(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude)) end,
        'distance_band', case when not full_access and p.latitude is not null and x.latitude is not null
                              then least(3, greatest(1, ceil(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) / 1000.0)))::int end)
        order by (x.source <> 'openstreetmap') desc,
                 case when full_access and p.latitude is not null and x.latitude is not null then public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) end nulls last,
                 x.name)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and (x.source <> 'openstreetmap' or p.auto_places)
        and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000)
        and (full_access or (x.source <> 'openstreetmap'
             and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) >= 300)))), '[]'::jsonb));
end $$;

-- D. Rappel de durée devenu périmé (mission terminée, annulée ou réattribuée pendant que l'écran était ouvert) :
--    pour un membre de l'organisation, la réponse renvoie « stale » et n'enregistre rien (au lieu d'une erreur).
--    Hors organisation : toujours refusé.
create or replace function public.task_overrun_continue(org uuid, task uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null or t.assignee_id is distinct from (select auth.uid()) or t.status <> 'in_progress' then return 'stale'; end if;
  if not public.my_task(org, task) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if t.overrun_ack_at is not null and t.overrun_ack_at > now() - interval '1 minute' then return 'already'; end if;
  update public.tasks set overrun_ack_at = now() where id = t.id;
  insert into public.task_events (organization_id, task_id, kind, actor_id, note)
  values (org, task, 'overrun_continue', (select auth.uid()), null);
  return 'applied';
end $$;

create or replace function public.propose_task_end(org uuid, task uuid, ended_at timestamptz, note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null or t.assignee_id is distinct from (select auth.uid()) or t.status not in ('in_progress', 'done') or t.started_at is null then return 'stale'; end if;
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
