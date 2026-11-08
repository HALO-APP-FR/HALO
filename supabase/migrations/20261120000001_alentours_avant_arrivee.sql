-- Migration 25 : alentours visibles dès l'activation du lien voyageur, sans révéler le logement.
--
-- Avant l'ouverture des informations pratiques, la carte est centrée sur une ZONE : le centre de la maille
-- (≈ 1,7 km) qui contient le logement, calculé par la base à partir de ses coordonnées. Les lieux montrés
-- à ce stade sont récupérés AUTOUR DE CE CENTRE (scope « zone ») et non autour du logement : ni leur
-- sélection (les plus proches par catégorie), ni leurs distances (mesurées depuis le centre de zone) ne
-- dépendent du point exact du logement. Seule la maille est déductible, c'est l'approximation voulue.
-- Recommandations de l'équipe : comme avant, seulement à 300 m ou plus du logement, sans coordonnées ; leur distance
-- est désormais mesurée depuis le centre de zone (arrondie à 100 m), comme les autres lieux.
-- Horaires : transmis seulement s'ils ont été vérifiés par l'équipe depuis moins de 6 mois (jamais ceux d'OpenStreetMap).
-- Aucune donnée existante n'est modifiée.

-- Centre de zone : maille de 0,015° de latitude ; la largeur en longitude dépend de la latitude du CENTRE de
-- la maille (pas de celle du logement), pour que la maille soit identique pour tous les points qu'elle contient.
create function public.zone_center(lat double precision, lng double precision) returns double precision[]
language sql immutable set search_path = '' as $$
  select case when lat is null or lng is null then null else array[
    (floor(lat / 0.015) + 0.5) * 0.015,
    (floor(lng / (0.015 / cos(radians((floor(lat / 0.015) + 0.5) * 0.015)))) + 0.5) * (0.015 / cos(radians((floor(lat / 0.015) + 0.5) * 0.015)))
  ] end;
$$;
revoke all on function public.zone_center(double precision, double precision) from public, anon;
grant execute on function public.zone_center(double precision, double precision) to authenticated;

alter table public.property_places add column scope text not null default 'property' check (scope in ('property', 'zone'));
alter table public.property_places drop constraint property_places_property_id_source_external_id_key;
alter table public.property_places add constraint property_places_property_scope_source_external_key unique (property_id, scope, source, external_id);
alter table public.properties add column zone_places_at timestamptz, add column zone_places_try_at timestamptz;

-- Lieux du voyageur
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
    -- Logement : lieux autour du logement + lieux de zone non déjà présents (favoris choisis avant l'arrivée retrouvés)
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
          'opening_hours', case when x.source <> 'openstreetmap' and x.verified_at > now() - interval '183 days' then x.opening_hours end, 'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at,
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

  -- Avant l'ouverture : zone approximative uniquement
  select count(*) into near_hidden from public.property_places x
   where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden and x.scope = 'property' and x.source <> 'openstreetmap'
     and x.latitude is not null and p.latitude is not null and public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) < 300;
  select coalesce(jsonb_agg(f.place_id), '[]'::jsonb) into favs from public.stay_place_favorites f
   where f.organization_id = r.organization_id and f.reservation_id = r.id;
  return jsonb_build_object('status', 'ok', 'full', false, 'near_hidden', near_hidden, 'auto_hidden', 0, 'favorites', favs,
    'zone', case when z is null then null else jsonb_build_object('lat', z[1], 'lng', z[2], 'radius_m', 1200, 'ready', p.zone_places_at is not null) end,
    'property', jsonb_build_object('name', p.name, 'address', null, 'postal_code', null, 'city', p.city, 'country_code', p.country_code, 'lat', null, 'lng', null),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'kind', x.kind, 'name', x.name,
        'description', x.description,
        -- Lieux de zone : lieux publics trouvés autour du centre de zone (adresse et position publiques)
        'address', case when x.scope = 'zone' or public.guest_place_address_ok(p, x) then x.address end,
        'lat', case when x.scope = 'zone' then x.latitude end, 'lng', case when x.scope = 'zone' then x.longitude end,
        'opening_hours', case when x.source <> 'openstreetmap' and x.verified_at > now() - interval '183 days' then x.opening_hours end, 'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at,
        'created_at', x.created_at, 'verified_at', x.verified_at,
        -- Distances : depuis le centre de zone, jamais depuis le logement
        'distance_m', case when z is not null and x.latitude is not null then round(public.distance_m(z[1], z[2], x.latitude, x.longitude) / 100) * 100 end,
        'distance_band', null)
        order by (x.source <> 'openstreetmap') desc, x.name)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and ((x.scope = 'zone' and p.auto_places and z is not null and x.latitude is not null
              and public.distance_m(z[1], z[2], x.latitude, x.longitude) <= 1200
              -- un lieu masqué par l'équipe l'est aussi dans la zone
              and not exists (select 1 from public.property_places y where y.organization_id = x.organization_id and y.property_id = x.property_id
                                and y.scope = 'property' and y.source = x.source and y.external_id = x.external_id and y.hidden))
          or (x.scope = 'property' and x.source <> 'openstreetmap'
              and (x.latitude is null or p.latitude is null or (public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) >= 300
                   and public.distance_m(z[1], z[2], x.latitude, x.longitude) <= 3000))))), '[]'::jsonb));
end $$;

-- Favoris : mêmes règles de visibilité que guest_places
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
        or (x.scope = 'property' and x.source <> 'openstreetmap'
            and (x.latitude is null or p.latitude is null or (public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) >= 300
                 and public.distance_m(z[1], z[2], x.latitude, x.longitude) <= 3000))))) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if fav then
    insert into public.stay_place_favorites (organization_id, reservation_id, place_id) values (r.organization_id, r.id, x.id)
    on conflict do nothing;
  else
    -- Retirer : la ligne choisie et son équivalent (même lieu public, autre périmètre)
    delete from public.stay_place_favorites f where f.reservation_id = r.id and (f.place_id = x.id or f.place_id in (
      select y.id from public.property_places y where y.organization_id = x.organization_id and y.property_id = x.property_id
         and y.source = x.source and y.external_id = x.external_id));
  end if;
  return jsonb_build_object('status', 'ok', 'favorite', fav);
end $$;
