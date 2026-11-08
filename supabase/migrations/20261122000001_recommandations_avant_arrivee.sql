-- Migration 27 : recommandations de l'équipe avant l'arrivée — choix explicite de l'équipe, textes protégés.
--
-- Décision produit (8/11) : avant l'échéance, le voyageur découvre la ZONE (migration 25) et les recommandations
-- que l'équipe a choisi de montrer « dès la réservation ». Ne sont jamais transmis : point du logement, distance
-- depuis le logement, itinéraire depuis le logement, texte qui situerait le logement.
--
--  * guest_visibility : 'booking' (dès la réservation) ou 'access' (après l'ouverture des informations pratiques,
--    valeur par défaut : rien ne devient visible plus tôt sans décision de l'équipe) ;
--  * la règle « ≥ 300 m » n'est plus le critère principal (elle créait un « trou » autour du logement) : une
--    recommandation choisie « dès la réservation » est LISTÉE (nom, adresse, distance au CENTRE DE ZONE), jamais placée
--    sur la carte (risque de recoupement), sauf garde-fou automatique : à moins de 200 m du logement ou dans la même rue ;
--  * descriptions et conseils passés au filtre public.guest_text_safe : masqués s'ils situent le logement.

alter table public.property_places add column guest_visibility text not null default 'access' check (guest_visibility in ('booking', 'access'));

-- Texte susceptible de situer le logement (« en bas de l'immeuble », « à 50 m », « même rue »…) : masqué avant l'ouverture.
-- Même liste que src/lib/engine/privacy.ts (vérifiée par les tests).
create function public.guest_text_safe(t text) returns text
language sql immutable set search_path = '' as $$
  select case when t is null or t ~* (
      '(en bas|au pied|juste à côté|à côté (du|de l|de la|des)|en face|même (rue|immeuble|bâtiment|résidence)|'
   || 'notre (rue|immeuble|résidence|porte|bâtiment|cour)|immeuble|résidence|rez-de-chaussée|\métage\M|voisin|'
   || 'du logement|de l''appartement|de la maison|depuis le logement|downstairs|next door|across the street|'
   || 'same (street|building)|our (street|building)|from the (flat|apartment|house)|'
   || '\m[0-9]+ ?(m|mètres|metres|meters)\M|\m[0-9]+ ?min(utes)? (à pied|walk))') then null else t end;
$$;
revoke all on function public.guest_text_safe(text) from public, anon;
grant execute on function public.guest_text_safe(text) to authenticated;

-- Rue du logement (adresse sans le numéro), pour le garde-fou « même rue »
create function public.street_of(address text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(trim(regexp_replace(split_part(coalesce(address, ''), ',', 1), '^\s*[0-9]+\s*(bis|ter|b)?\s*,?\s*', '', 'i'))), '');
$$;
revoke all on function public.street_of(text) from public, anon;

-- Recommandation de l'équipe montrée avant l'ouverture ?
create function public.guest_pick_before_access(p public.properties, x public.property_places) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.source <> 'openstreetmap' and x.guest_visibility = 'booking' and not x.hidden
     and not (x.latitude is not null and p.latitude is not null and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) < 200)
     and not (public.street_of(p.address_line) is not null and length(public.street_of(p.address_line)) >= 4
              and position(public.street_of(p.address_line) in lower(coalesce(x.address, ''))) > 0);
$$;
revoke all on function public.guest_pick_before_access(public.properties, public.property_places) from public, anon, authenticated;

create or replace function public.guest_places(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations; p public.properties; full_access boolean; near_hidden int := 0; favs jsonb; z double precision[];
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  z := public.zone_center(p.latitude, p.longitude);

  if full_access then
    select coalesce(jsonb_agg(distinct coalesce(pp.id, f.place_id)), '[]'::jsonb) into favs
      from public.stay_place_favorites f
      join public.property_places x on x.id = f.place_id and x.organization_id = f.organization_id
      left join public.property_places pp on x.scope = 'zone' and pp.organization_id = x.organization_id and pp.property_id = x.property_id
           and pp.scope = 'property' and pp.source = x.source and pp.external_id = x.external_id
     where f.organization_id = r.organization_id and f.reservation_id = r.id;
    return jsonb_build_object('status', 'ok', 'full', true, 'near_hidden', 0, 'auto_hidden', 0, 'favorites', favs, 'zone', null,
      'property', jsonb_build_object('name', p.name, 'address', p.address_line, 'postal_code', p.postal_code, 'city', p.city,
        'country_code', p.country_code, 'lat', p.latitude, 'lng', p.longitude),
      'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'kind', x.kind, 'name', x.name,
          'description', x.description, 'address', x.address, 'lat', x.latitude, 'lng', x.longitude,
          'opening_hours', case when x.source <> 'openstreetmap' and x.verified_at > now() - interval '183 days' then x.opening_hours end,
          'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at,
          'created_at', x.created_at, 'verified_at', x.verified_at,
          'distance_m', case when p.latitude is not null and x.latitude is not null then round(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude)) end,
          'distance_band', null)
          order by (x.source <> 'openstreetmap') desc,
                   case when p.latitude is not null and x.latitude is not null then public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) end nulls last, x.name)
        from public.property_places x
        where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
          and (x.source <> 'openstreetmap' or p.auto_places)
          and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000)
          and (x.scope = 'property' or not exists (select 1 from public.property_places y where y.organization_id = x.organization_id
                 and y.property_id = x.property_id and y.scope = 'property' and y.source = x.source and y.external_id = x.external_id))), '[]'::jsonb));
  end if;

  -- Avant l'ouverture : zone + recommandations choisies « dès la réservation ». Seul est compté (sans détail) ce qui
  -- attend l'ouverture : les recommandations de l'équipe réservées à l'arrivée.
  select count(*) into near_hidden from public.property_places x
   where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden and x.scope = 'property'
     and x.source <> 'openstreetmap' and not public.guest_pick_before_access(p, x);
  select coalesce(jsonb_agg(f.place_id), '[]'::jsonb) into favs from public.stay_place_favorites f
   where f.organization_id = r.organization_id and f.reservation_id = r.id;
  return jsonb_build_object('status', 'ok', 'full', false, 'near_hidden', near_hidden, 'auto_hidden', 0, 'favorites', favs,
    'zone', case when z is null then null else jsonb_build_object('lat', z[1], 'lng', z[2], 'radius_m', 1200, 'ready', p.zone_places_at is not null) end,
    'property', jsonb_build_object('name', p.name, 'address', null, 'postal_code', null, 'city', p.city, 'country_code', p.country_code, 'lat', null, 'lng', null),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'kind', x.kind, 'name', x.name,
        'description', public.guest_text_safe(x.description),
        -- Adresse : seulement si la distance au logement a pu être vérifiée (lieu sans coordonnées → nom seul)
        'address', case when x.scope = 'zone' or (x.latitude is not null and p.latitude is not null) then x.address end,
        -- Coordonnées : lieux de zone seulement. Les choix de l'équipe sont souvent groupés autour du logement : leurs
        -- points sur la carte permettraient de le retrouver par recoupement → listés (adresse, distance à la zone), pas placés.
        'lat', case when x.scope = 'zone' then x.latitude end, 'lng', case when x.scope = 'zone' then x.longitude end,
        'opening_hours', case when x.source <> 'openstreetmap' and x.verified_at > now() - interval '183 days' then x.opening_hours end,
        'phone', x.phone, 'website', x.website, 'note', public.guest_text_safe(x.note), 'updated_at', x.source_updated_at,
        'created_at', x.created_at, 'verified_at', x.verified_at,
        -- Distances : depuis le centre de zone, jamais depuis le logement
        'distance_m', case when z is not null and x.latitude is not null then round(public.distance_m(z[1], z[2], x.latitude, x.longitude) / 100) * 100 end,
        'distance_band', null)
        order by (x.source <> 'openstreetmap') desc, x.name)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and ((x.scope = 'zone' and p.auto_places and z is not null and x.latitude is not null
              and public.distance_m(z[1], z[2], x.latitude, x.longitude) <= 1200
              and not exists (select 1 from public.property_places y where y.organization_id = x.organization_id and y.property_id = x.property_id
                                and y.scope = 'property' and y.source = x.source and y.external_id = x.external_id and y.hidden))
          or (x.scope = 'property' and public.guest_pick_before_access(p, x)
              and (x.latitude is null or z is null or public.distance_m(z[1], z[2], x.latitude, x.longitude) <= 3000)))), '[]'::jsonb));
end $$;

create or replace function public.guest_place_favorite(token text, place uuid, fav boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; p public.properties; x public.property_places; full_access boolean; z double precision[];
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  select * into x from public.property_places where organization_id = r.organization_id and property_id = r.property_id and id = place;
  z := public.zone_center(p.latitude, p.longitude);
  if x.id is null or x.hidden or (x.source = 'openstreetmap' and not p.auto_places)
     or (not full_access and not (
           (x.scope = 'zone' and z is not null and x.latitude is not null and public.distance_m(z[1], z[2], x.latitude, x.longitude) <= 1200)
        or (x.scope = 'property' and public.guest_pick_before_access(p, x)))) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if fav then
    insert into public.stay_place_favorites (organization_id, reservation_id, place_id) values (r.organization_id, r.id, x.id)
    on conflict do nothing;
  else
    delete from public.stay_place_favorites f where f.reservation_id = r.id and (f.place_id = x.id or f.place_id in (
      select y.id from public.property_places y where y.organization_id = x.organization_id and y.property_id = x.property_id
         and y.source = x.source and y.external_id = x.external_id));
  end if;
  return jsonb_build_object('status', 'ok', 'favorite', fav);
end $$;

-- Contenus publiés avant l'ouverture (« prepared » de get_guest_stay) : l'adresse d'un lieu associé suit la même règle
-- (recommandation choisie « dès la réservation », distance vérifiable, hors garde-fous) ; plus la règle des 300 m seule.
create or replace function public.guest_place_address_ok(p public.properties, x public.property_places) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.scope = 'zone' or (x.latitude is not null and p.latitude is not null and public.guest_pick_before_access(p, x));
$$;
