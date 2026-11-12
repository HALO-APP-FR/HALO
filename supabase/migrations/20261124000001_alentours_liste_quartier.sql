-- Migration 29 : alentours avant l'arrivée — liste de quartier pour les choix de l'équipe, état de chargement.
--
-- Constat du test du 8/11 (recoupement) : les lieux de ZONE sont indépendants du logement (centrés sur la maille,
-- réponse identique si le logement bouge dans la maille). Les recommandations de L'ÉQUIPE, elles, sont choisies
-- autour du logement : adresses et distances permettraient d'approcher le logement en croisant plusieurs lieux.
-- Avant l'ouverture, elles deviennent une liste de quartier : nom, catégorie, description et conseil filtrés,
-- SANS adresse, SANS distance, SANS point. Garde-fous 200 m / même rue inchangés (le nom seul suffirait sinon).
-- Ajoute aussi l'état de recherche des lieux du quartier (ready / preparing / failed) pour un affichage honnête.
-- Prérequis : migration 27.

-- État de la recherche des lieux du quartier (utilisée par guest_places ; sert aussi de témoin de migration)
create function public.zone_places_state(found_at timestamptz, tried_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select case when found_at is not null then 'ready'
              when tried_at is not null and tried_at < now() - interval '3 minutes' then 'failed'
              else 'preparing' end;
$$;
revoke all on function public.zone_places_state(timestamptz, timestamptz) from public, anon, authenticated;

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
    -- État des lieux du quartier : prêts, en cours de recherche, ou recherche terminée sans résultat (service indisponible)
    'zone', case when z is null then null else jsonb_build_object('lat', z[1], 'lng', z[2], 'radius_m', 1200, 'ready', p.zone_places_at is not null,
      'state', public.zone_places_state(p.zone_places_at, p.zone_places_try_at)) end,
    'property', jsonb_build_object('name', p.name, 'address', null, 'postal_code', null, 'city', p.city, 'country_code', p.country_code, 'lat', null, 'lng', null),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'kind', x.kind, 'name', x.name,
        'description', public.guest_text_safe(x.description),
        -- Migration 29 : choix de l'équipe = LISTE DE QUARTIER avant l'ouverture (nom, catégorie, conseil), sans adresse
        -- ni distance — ces lieux sont choisis par rapport au logement, leurs positions permettraient de le recouper.
        -- Adresse, distance et itinéraire à l'ouverture des informations pratiques.
        'address', case when x.scope = 'zone' then x.address end,
        -- Coordonnées : lieux de zone seulement. Les choix de l'équipe sont souvent groupés autour du logement : leurs
        -- points sur la carte permettraient de le retrouver par recoupement → listés (adresse, distance à la zone), pas placés.
        'lat', case when x.scope = 'zone' then x.latitude end, 'lng', case when x.scope = 'zone' then x.longitude end,
        'opening_hours', case when x.source <> 'openstreetmap' and x.verified_at > now() - interval '183 days' then x.opening_hours end,
        'phone', x.phone, 'website', x.website, 'note', public.guest_text_safe(x.note), 'updated_at', x.source_updated_at,
        'created_at', x.created_at, 'verified_at', x.verified_at,
        -- Distances : depuis le centre de zone, jamais depuis le logement
        'distance_m', case when x.scope = 'zone' and z is not null and x.latitude is not null then round(public.distance_m(z[1], z[2], x.latitude, x.longitude) / 100) * 100 end,
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

-- Contenus publiés à l'avance : plus d'adresse de lieu de l'équipe avant l'ouverture (seuls les lieux de zone)
create or replace function public.guest_place_address_ok(p public.properties, x public.property_places) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.scope = 'zone';
$$;
