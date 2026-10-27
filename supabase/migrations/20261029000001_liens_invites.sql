-- =====================================================================
-- HALO — Lien invité par séjour (étape 1.6)
--
-- Un lien = un séjour. Valable de `valid_from` à `valid_until` (par défaut :
-- 72 h avant l'arrivée → heure de départ prévue, en UTC), révocable,
-- renouvelable et prolongeable par un responsable de l'organisation.
-- Réutilisable pendant sa période (pas d'usage unique).
--
-- Ce lien donne accès au livret du séjour. Il ne commande aucune serrure,
-- ne change aucun code de porte et ne renvoie jamais de code d'accès.
--
-- Seule exception d'accès anonyme de toute la base : get_guest_stay(token).
-- =====================================================================

-- Contenu du livret destiné aux voyageurs (sans code d'accès, par construction)
create table public.guest_guides (
  property_id uuid primary key,
  organization_id uuid not null,
  enabled boolean not null default true,
  welcome text check (length(welcome) <= 4000),
  wifi_name text check (length(wifi_name) <= 120),
  wifi_password text check (length(wifi_password) <= 120),
  house_rules text check (length(house_rules) <= 4000),
  checkout_instructions text check (length(checkout_instructions) <= 4000),
  parking text check (length(parking) <= 2000),
  trash text check (length(trash) <= 2000),
  emergency_phone text check (length(emergency_phone) <= 40),
  recommendations text check (length(recommendations) <= 8000),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);

create table public.guest_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_id uuid not null,
  token_hash text not null unique,             -- sha256 du jeton ; le jeton brut n'est jamais stocké
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text check (revoke_reason in ('manual', 'renewed', 'stay_cancelled')),
  extended_at timestamptz,
  extended_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz,
  check (valid_until > valid_from),
  unique (organization_id, id),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade
);
create index guest_links_reservation_idx on public.guest_links (organization_id, reservation_id);

create trigger guest_guides_org_immutable before update on public.guest_guides for each row execute function public.forbid_org_change();
create trigger guest_links_org_immutable before update on public.guest_links for each row execute function public.forbid_org_change();

alter table public.guest_guides enable row level security;
alter table public.guest_links enable row level security;
revoke all on public.guest_guides, public.guest_links from anon;

-- Livret : géré par les managers (lecture, création, modification, suppression)
grant select, insert, update, delete on public.guest_guides to authenticated;
create policy guest_guides_select on public.guest_guides for select to authenticated using (public.is_manager(organization_id));
create policy guest_guides_insert on public.guest_guides for insert to authenticated with check (public.is_manager(organization_id));
create policy guest_guides_update on public.guest_guides for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy guest_guides_delete on public.guest_guides for delete to authenticated using (public.is_manager(organization_id));

-- Liens : lecture du statut par les managers, jamais de l'empreinte ; écriture uniquement par les fonctions
revoke all on public.guest_links from authenticated;
grant select (id, organization_id, reservation_id, valid_from, valid_until, revoked_at, revoked_by, revoke_reason,
              extended_at, extended_by, created_by, created_at, last_opened_at) on public.guest_links to authenticated;
create policy guest_links_select on public.guest_links for select to authenticated using (public.is_manager(organization_id));

-- Statut lisible : actif, à venir, expiré, révoqué
create function public.guest_link_status(revoked timestamptz, v_from timestamptz, v_until timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when revoked is not null then 'revoked'
    when now() < v_from then 'upcoming'
    when now() >= v_until then 'expired'
    else 'active' end;
$$;

-- Créer (ou renouveler) le lien d'un séjour : l'ancien lien actif est révoqué.
-- Renvoie le jeton brut UNE fois (à mettre dans l'URL / le QR).
create function public.create_guest_link(org uuid, reservation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; raw text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.reservations where organization_id = org and id = reservation;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'confirmed' then raise exception 'stay_not_confirmed' using errcode = '22023'; end if;
  if r.check_out_at <= now() then raise exception 'stay_ended' using errcode = '22023'; end if;
  update public.guest_links set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = 'renewed'
   where organization_id = org and reservation_id = reservation and revoked_at is null;
  insert into public.guest_links (organization_id, reservation_id, token_hash, valid_from, valid_until, created_by)
  values (org, reservation, encode(extensions.digest(raw, 'sha256'), 'hex'),
          r.check_in_at - interval '72 hours', r.check_out_at, (select auth.uid()));
  return raw;
end $$;

create function public.revoke_guest_link(org uuid, link uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.guest_links set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = 'manual'
   where organization_id = org and id = link and revoked_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Prolonger (départ tardif). Au plus 7 jours après le départ prévu ; jamais un lien révoqué.
create function public.extend_guest_link(org uuid, link uuid, new_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.guest_links; r public.reservations;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into l from public.guest_links where organization_id = org and id = link for update;
  if l.id is null or l.revoked_at is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.reservations where organization_id = org and id = l.reservation_id;
  if new_until <= now() or new_until <= l.valid_from or new_until > r.check_out_at + interval '7 days' then
    raise exception 'bad_date' using errcode = '22023';
  end if;
  update public.guest_links set valid_until = new_until, extended_at = now(), extended_by = (select auth.uid())
   where id = link;
end $$;

-- Séjour annulé : ses liens sont révoqués automatiquement.
create function public.revoke_links_of_cancelled_stay() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'confirmed' and old.status = 'confirmed' then
    update public.guest_links set revoked_at = now(), revoked_by = (select auth.uid()), revoke_reason = 'stay_cancelled'
     where organization_id = new.organization_id and reservation_id = new.id and revoked_at is null;
  end if;
  return new;
end $$;
create trigger reservations_revoke_links after update of status on public.reservations
  for each row execute function public.revoke_links_of_cancelled_stay();

-- Seule porte d'entrée des voyageurs. Toute impossibilité (jeton absent, faux, à venir,
-- expiré, révoqué, séjour annulé, livret désactivé) donne la MÊME réponse neutre.
-- Contenu renvoyé : uniquement le livret de CE séjour. Jamais de code d'accès.
create function public.get_guest_stay(token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare l public.guest_links; r public.reservations; p public.properties; g public.guest_guides;
  unavailable constant jsonb := jsonb_build_object('status', 'unavailable');
begin
  if token is null or length(token) <> 64 or token !~ '^[0-9a-f]+$' then return unavailable; end if;
  select * into l from public.guest_links where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  if l.id is null or public.guest_link_status(l.revoked_at, l.valid_from, l.valid_until) <> 'active' then return unavailable; end if;
  select * into r from public.reservations where organization_id = l.organization_id and id = l.reservation_id;
  if r.status <> 'confirmed' then return unavailable; end if;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  select * into g from public.guest_guides where organization_id = p.organization_id and property_id = p.id;
  if g.property_id is null or not g.enabled then return unavailable; end if;
  update public.guest_links set last_opened_at = now() where id = l.id;
  return jsonb_build_object(
    'status', 'ok',
    'property', jsonb_build_object('name', p.name, 'address', p.address_line, 'city', p.city, 'timezone', p.timezone),
    'stay', jsonb_build_object('check_in_at', r.check_in_at, 'check_out_at', r.check_out_at, 'link_valid_until', l.valid_until),
    'guide', jsonb_build_object('welcome', g.welcome, 'wifi_name', g.wifi_name, 'wifi_password', g.wifi_password,
      'house_rules', g.house_rules, 'checkout_instructions', g.checkout_instructions, 'parking', g.parking,
      'trash', g.trash, 'emergency_phone', g.emergency_phone, 'recommendations', g.recommendations));
end $$;

revoke all on function public.guest_link_status(timestamptz, timestamptz, timestamptz), public.create_guest_link(uuid, uuid),
  public.revoke_guest_link(uuid, uuid), public.extend_guest_link(uuid, uuid, timestamptz),
  public.revoke_links_of_cancelled_stay(), public.get_guest_stay(text) from public, anon;
grant execute on function public.guest_link_status(timestamptz, timestamptz, timestamptz), public.create_guest_link(uuid, uuid),
  public.revoke_guest_link(uuid, uuid), public.extend_guest_link(uuid, uuid, timestamptz) to authenticated;
-- L'exception anonyme, unique et explicite :
grant execute on function public.get_guest_stay(text) to anon, authenticated;
