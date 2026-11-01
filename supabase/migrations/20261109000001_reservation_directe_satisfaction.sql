-- =====================================================================
-- Migration 14 — missions liées cohérentes, réservation directe, satisfaction (voyageurs / propriétaires), vitrine
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1 Mission liée à une action : annulation tracée, jamais d'état contradictoire
-- ---------------------------------------------------------------------
alter table public.stay_prep_events drop constraint stay_prep_events_kind_check;
alter table public.stay_prep_events add constraint stay_prep_events_kind_check check (kind in (
  'invite_created', 'invite_sent', 'opened', 'guest_saved', 'guest_submitted', 'guest_updated', 'guest_deleted',
  'status_changed', 'status_reverted', 'action_created', 'action_done', 'action_cancelled', 'action_reopened', 'action_forced', 'action_auto_done',
  'mission_cancelled', 'mission_reopened',
  'item_published', 'item_unpublished',
  'vip_requested', 'vip_guest_reply', 'vip_info_requested', 'vip_accepted', 'vip_refused', 'vip_granted', 'vip_revoked'));

create or replace function public.prep_action_follow_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.task_completed(new) and not public.task_completed(old) then
    update public.stay_prep_actions set status = 'done', done_at = now()
     where organization_id = new.organization_id and task_id = new.id and status = 'open';
  elsif new.status = 'to_redo' and old.status <> 'to_redo' then
    -- Correction demandée : l'action close automatiquement redevient ouverte (et retire « Prêt » si indispensable)
    update public.stay_prep_actions set status = 'open', done_at = null, done_by = null
     where organization_id = new.organization_id and task_id = new.id and status = 'done' and override_reason is null;
    insert into public.stay_prep_events (organization_id, reservation_id, kind, note)
    select organization_id, reservation_id, 'mission_reopened', title from public.stay_prep_actions where organization_id = new.organization_id and task_id = new.id;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    -- Mission annulée : l'action reste ouverte (à refaire ou à clore explicitement), le responsable est informé
    insert into public.stay_prep_events (organization_id, reservation_id, kind, note)
    select organization_id, reservation_id, 'mission_cancelled', title from public.stay_prep_actions
     where organization_id = new.organization_id and task_id = new.id and status = 'open';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Réservation directe : lien de demande dédié (jamais l'ancien lien de séjour), demandes, offres, confirmation
-- ---------------------------------------------------------------------
alter table public.reservations add column origin_request_id uuid, add column previous_reservation_id uuid;

create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null,                     -- séjour d'origine (le voyageur connaît ce logement)
  token_hash text not null unique,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('manual', 'renewed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade
);

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid,
  client_id uuid not null,                          -- protège contre le double envoi
  origin_reservation_id uuid,
  property_id uuid not null,
  check_in date not null,
  check_out date not null check (check_out > check_in),
  adults int not null default 1 check (adults between 1 and 30),
  children int not null default 0 check (children between 0 and 30),
  babies int not null default 0 check (babies between 0 and 10),
  contact_name text not null check (length(trim(contact_name)) between 1 and 120),
  contact_email text not null check (length(contact_email) <= 254 and contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  contact_phone text check (length(contact_phone) <= 40),
  message text check (length(message) <= 2000),
  status text not null default 'received' check (status in ('received', 'in_review', 'info_requested', 'offer_sent', 'accepted', 'confirmed', 'declined', 'cancelled')),
  guest_message text check (length(guest_message) <= 2000),
  internal_note text check (length(internal_note) <= 2000),
  alt_check_in date,
  alt_check_out date,
  offer jsonb,                                       -- { check_in, check_out, price, fees, total, currency, conditions, valid_until }
  payment_status text not null default 'outside_halo' check (payment_status in ('outside_halo')),
  new_reservation_id uuid,
  manager_unread boolean not null default true,
  guest_unread boolean not null default false,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, client_id),
  check (alt_check_in is null or alt_check_out > alt_check_in),
  foreign key (organization_id, link_id) references public.booking_links (organization_id, id) on delete set null (link_id),
  foreign key (organization_id, origin_reservation_id) references public.reservations (organization_id, id) on delete set null (origin_reservation_id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, new_reservation_id) references public.reservations (organization_id, id) on delete set null (new_reservation_id)
);
create index booking_requests_org on public.booking_requests (organization_id, status, created_at desc);

create table public.booking_request_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  request_id uuid not null,
  kind text not null check (kind in ('received', 'in_review', 'info_requested', 'guest_reply', 'offer_sent', 'accepted', 'confirmed', 'declined', 'cancelled', 'guest_cancelled', 'confirm_refused')),
  visibility text not null default 'guest' check (visibility in ('guest', 'internal')),
  actor_id uuid references auth.users (id) on delete set null,
  body text check (length(body) <= 2000),
  at timestamptz not null default now(),
  foreign key (organization_id, request_id) references public.booking_requests (organization_id, id) on delete cascade
);

alter table public.booking_links enable row level security;
alter table public.booking_requests enable row level security;
alter table public.booking_request_events enable row level security;
revoke all on public.booking_links, public.booking_requests, public.booking_request_events from anon, authenticated;
grant select on public.booking_links, public.booking_requests, public.booking_request_events to authenticated;
create policy booking_links_select on public.booking_links for select to authenticated using (public.is_manager(organization_id));
create policy booking_requests_select on public.booking_requests for select to authenticated using (public.is_manager(organization_id));
create policy booking_request_events_select on public.booking_request_events for select to authenticated using (public.is_manager(organization_id));

-- Lien de demande : 60 jours, révocable, renouvelable (un nouveau lien remplace l'ancien)
create function public.create_booking_link(org uuid, reservation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; raw text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.reservations where organization_id = org and id = reservation;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'confirmed' then raise exception 'stay_not_confirmed' using errcode = '22023'; end if;
  update public.booking_links set revoked_at = now(), revoke_reason = 'renewed' where organization_id = org and reservation_id = reservation and revoked_at is null;
  insert into public.booking_links (organization_id, reservation_id, token_hash, valid_until, created_by)
  values (org, reservation, encode(extensions.digest(raw, 'sha256'), 'hex'), now() + interval '60 days', (select auth.uid()));
  return raw;
end $$;

create function public.revoke_booking_link(org uuid, link uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.booking_links set revoked_at = now(), revoke_reason = 'manual' where organization_id = org and id = link and revoked_at is null;
  return case when found then 'applied' else 'already' end;
end $$;

create function public.booking_link_any(token text) returns public.booking_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.booking_links l
   where l.token_hash = encode(extensions.digest(token, 'sha256'), 'hex') and l.revoked_at is null and l.valid_until > now();
$$;
revoke all on function public.booking_link_any(text) from public, anon, authenticated;

-- Périodes indisponibles connues (sans aucun nom) et fraîcheur des calendriers externes
create function public.known_busy(org uuid, prop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'busy', coalesce((select jsonb_agg(jsonb_build_object('from', (r.check_in_at at time zone p.timezone)::date, 'to', (r.check_out_at at time zone p.timezone)::date) order by r.check_in_at)
                       from public.reservations r where r.organization_id = org and r.property_id = prop and r.status in ('confirmed', 'blocked')
                         and r.check_out_at > now() and r.check_in_at < now() + interval '400 days'), '[]'::jsonb),
    'calendars', coalesce((select jsonb_agg(jsonb_build_object('label', coalesce(s.label, s.platform), 'last_success_at', s.last_success_at,
                              'error', s.last_error is not null and (s.last_success_at is null or s.last_sync_at > s.last_success_at), 'paused', s.status = 'paused'))
                            from public.data_sources s where s.organization_id = org and s.property_id = prop), '[]'::jsonb))
  from public.properties p where p.organization_id = org and p.id = prop;
$$;
revoke all on function public.known_busy(uuid, uuid) from public, anon, authenticated;

create function public.dates_conflict(org uuid, prop uuid, a date, b date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reservations r join public.properties p on p.organization_id = r.organization_id and p.id = r.property_id
                  where r.organization_id = org and r.property_id = prop and r.status in ('confirmed', 'blocked')
                    and (r.check_in_at at time zone p.timezone)::date < b and (r.check_out_at at time zone p.timezone)::date > a);
$$;
revoke all on function public.dates_conflict(uuid, uuid, date, date) from public, anon, authenticated;

-- Voyageur (lien de demande) : informations du logement connu, disponibilités connues, ses demandes
create function public.booking_portal(token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare l public.booking_links; r public.reservations; p public.properties;
begin
  l := public.booking_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into r from public.reservations where organization_id = l.organization_id and id = l.reservation_id;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  update public.booking_links set last_used_at = now() where id = l.id;
  update public.booking_requests set guest_unread = false where organization_id = l.organization_id and link_id = l.id and guest_unread;
  return jsonb_build_object('status', 'ok',
    'organization', (select name from public.organizations where id = l.organization_id),
    'property', jsonb_build_object('name', p.name, 'city', p.city, 'capacity', p.capacity, 'timezone', p.timezone),
    'guest_name', r.guest_name, 'link_valid_until', l.valid_until,
    'availability', public.known_busy(l.organization_id, p.id),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status, 'check_in', q.check_in, 'check_out', q.check_out,
        'adults', q.adults, 'children', q.children, 'babies', q.babies, 'guest_message', q.guest_message, 'alt_check_in', q.alt_check_in, 'alt_check_out', q.alt_check_out,
        'offer', q.offer, 'created_at', q.created_at, 'updated_at', q.updated_at,
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'body', e.body, 'at', e.at) order by e.at)
                              from public.booking_request_events e where e.organization_id = q.organization_id and e.request_id = q.id and e.visibility = 'guest'), '[]'::jsonb))
        order by q.created_at desc)
      from public.booking_requests q where q.organization_id = l.organization_id and q.link_id = l.id), '[]'::jsonb));
end $$;

create function public.booking_submit(token text, client uuid, d_in date, d_out date, n_adults int, n_children int, n_babies int,
                                      c_name text, c_email text, c_phone text, msg text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.booking_links; r public.reservations; prev public.booking_requests; rid uuid; busy boolean;
begin
  l := public.booking_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into prev from public.booking_requests where organization_id = l.organization_id and client_id = client;
  if prev.id is not null then return jsonb_build_object('status', 'ok', 'id', prev.id, 'replayed', true); end if;
  if d_in is null or d_out is null or d_out <= d_in or d_in < current_date then return jsonb_build_object('status', 'invalid_dates'); end if;
  if (select count(*) from public.booking_requests where organization_id = l.organization_id and link_id = l.id and status in ('received', 'in_review', 'info_requested', 'offer_sent', 'accepted')) >= 3 then
    return jsonb_build_object('status', 'too_many');
  end if;
  select * into r from public.reservations where organization_id = l.organization_id and id = l.reservation_id;
  busy := public.dates_conflict(l.organization_id, r.property_id, d_in, d_out);
  insert into public.booking_requests (organization_id, link_id, client_id, origin_reservation_id, property_id, check_in, check_out, adults, children, babies,
                                       contact_name, contact_email, contact_phone, message)
  values (l.organization_id, l.id, client, r.id, r.property_id, d_in, d_out, greatest(coalesce(n_adults, 1), 1), coalesce(n_children, 0), coalesce(n_babies, 0),
          left(trim(c_name), 120), lower(trim(c_email)), nullif(left(trim(coalesce(c_phone, '')), 40), ''), nullif(left(trim(coalesce(msg, '')), 2000), ''))
  returning id into rid;
  insert into public.booking_request_events (organization_id, request_id, kind) values (l.organization_id, rid, 'received');
  perform public.queue_team_email(l.organization_id, 'team_booking_requested',
    jsonb_build_object('guest', left(trim(c_name), 120), 'property', (select name from public.properties where id = r.property_id), 'path', '/app/bookings/' || rid), null, null, null);
  return jsonb_build_object('status', 'ok', 'id', rid, 'replayed', false, 'known_conflict', busy);
end $$;

create function public.booking_guest_action(token text, request uuid, act text, msg text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.booking_links; q public.booking_requests;
begin
  l := public.booking_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into q from public.booking_requests where organization_id = l.organization_id and id = request and link_id = l.id for update;
  if q.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if act = 'reply' then
    if nullif(trim(coalesce(msg, '')), '') is null then return jsonb_build_object('status', 'empty'); end if;
    if q.status not in ('received', 'in_review', 'info_requested', 'offer_sent') then return jsonb_build_object('status', 'conflict', 'current', q.status); end if;
    insert into public.booking_request_events (organization_id, request_id, kind, body) values (q.organization_id, q.id, 'guest_reply', left(trim(msg), 2000));
    update public.booking_requests set status = case when status = 'info_requested' then 'in_review' else status end, manager_unread = true, updated_at = now() where id = q.id;
  elsif act = 'accept' then
    if q.status = 'accepted' then return jsonb_build_object('status', 'ok', 'replayed', true); end if;
    if q.status <> 'offer_sent' then return jsonb_build_object('status', 'conflict', 'current', q.status); end if;
    if (q.offer ->> 'valid_until') is not null and (q.offer ->> 'valid_until')::date < current_date then return jsonb_build_object('status', 'offer_expired'); end if;
    update public.booking_requests set status = 'accepted', manager_unread = true, updated_at = now() where id = q.id;
    insert into public.booking_request_events (organization_id, request_id, kind) values (q.organization_id, q.id, 'accepted');
  elsif act = 'cancel' then
    if q.status = 'cancelled' then return jsonb_build_object('status', 'ok', 'replayed', true); end if;
    if q.status in ('confirmed', 'declined') then return jsonb_build_object('status', 'conflict', 'current', q.status); end if;
    update public.booking_requests set status = 'cancelled', manager_unread = true, updated_at = now() where id = q.id;
    insert into public.booking_request_events (organization_id, request_id, kind) values (q.organization_id, q.id, 'guest_cancelled');
  else
    return jsonb_build_object('status', 'invalid');
  end if;
  perform public.queue_team_email(q.organization_id, 'team_booking_requested',
    jsonb_build_object('guest', q.contact_name, 'property', (select name from public.properties where id = q.property_id), 'path', '/app/bookings/' || q.id), null, null, null);
  return jsonb_build_object('status', 'ok');
end $$;

-- Décisions du responsable (hors confirmation) : étude, précision, offre, refus, annulation, autres dates
create function public.booking_decide(org uuid, request uuid, act text, msg text default null, internal text default null,
                                      offer_data jsonb default null, alt_in date default null, alt_out date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.booking_requests; uid uuid := (select auth.uid()); target text; o jsonb;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into q from public.booking_requests where organization_id = org and id = request for update;
  if q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  target := case act when 'review' then 'in_review' when 'info' then 'info_requested' when 'offer' then 'offer_sent' when 'decline' then 'declined' when 'cancel' then 'cancelled' end;
  if target is null then raise exception 'invalid' using errcode = '22023'; end if;
  if q.status in ('confirmed', 'declined', 'cancelled') then
    return jsonb_build_object('status', case when q.status = target then 'already' else 'conflict' end, 'current', q.status);
  end if;
  if q.status = target and act <> 'offer' then return jsonb_build_object('status', 'already'); end if;
  if act = 'info' and nullif(trim(coalesce(msg, '')), '') is null then raise exception 'question_required' using errcode = '22023'; end if;
  if act = 'offer' then
    -- Offre complète et cohérente : prix, frais, total = prix + frais, conditions
    if offer_data is null or (offer_data ->> 'price') is null or (offer_data ->> 'total') is null or nullif(trim(coalesce(offer_data ->> 'conditions', '')), '') is null then
      raise exception 'offer_incomplete' using errcode = '22023';
    end if;
    if round(((offer_data ->> 'price')::numeric + coalesce((offer_data ->> 'fees')::numeric, 0)) * 100) <> round((offer_data ->> 'total')::numeric * 100) then
      raise exception 'offer_total_mismatch' using errcode = '22023';
    end if;
    o := jsonb_build_object('check_in', coalesce(alt_in, q.check_in), 'check_out', coalesce(alt_out, q.check_out),
      'price', (offer_data ->> 'price')::numeric, 'fees', coalesce((offer_data ->> 'fees')::numeric, 0), 'total', (offer_data ->> 'total')::numeric,
      'currency', coalesce(nullif(offer_data ->> 'currency', ''), 'EUR'), 'conditions', left(trim(offer_data ->> 'conditions'), 2000),
      'valid_until', nullif(offer_data ->> 'valid_until', ''));
    if (o ->> 'check_out')::date <= (o ->> 'check_in')::date then raise exception 'invalid_dates' using errcode = '22023'; end if;
  end if;
  update public.booking_requests set status = target, guest_message = coalesce(nullif(left(trim(coalesce(msg, '')), 2000), ''), guest_message),
    internal_note = coalesce(nullif(left(trim(coalesce(internal, '')), 2000), ''), internal_note), offer = coalesce(o, offer),
    alt_check_in = coalesce(alt_in, alt_check_in), alt_check_out = coalesce(alt_out, alt_check_out),
    decided_by = uid, guest_unread = true, manager_unread = false, updated_at = now()
   where id = q.id;
  insert into public.booking_request_events (organization_id, request_id, kind, actor_id, body)
  values (org, q.id, target, uid, nullif(left(trim(coalesce(msg, '')), 2000), ''));
  if nullif(trim(coalesce(internal, '')), '') is not null then
    insert into public.booking_request_events (organization_id, request_id, kind, visibility, actor_id, body) values (org, q.id, target, 'internal', uid, left(trim(internal), 2000));
  end if;
  -- Voyageur prévenu (sans détail de l'offre dans l'e-mail : il la consulte avec son lien)
  if act <> 'review' then
    perform public.outbox_insert(org, q.contact_email, 'fr', 'booking_update', jsonb_build_object('decision', target, 'property', (select name from public.properties where id = q.property_id)), null, q.origin_reservation_id, null);
  end if;
  return jsonb_build_object('status', 'applied');
end $$;

-- Confirmation : offre acceptée, disponibilités connues revérifiées sous verrou, calendriers externes signalés.
-- Crée UN séjour (rejouer = sans effet). Le paiement reste hors HALO.
create function public.booking_confirm(org uuid, request uuid, ack_calendars boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.booking_requests; p public.properties; uid uuid := (select auth.uid()); d_in date; d_out date; rid uuid; stale jsonb;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into q from public.booking_requests where organization_id = org and id = request for update;
  if q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if q.status = 'confirmed' then return jsonb_build_object('status', 'already', 'reservation', q.new_reservation_id); end if;
  if q.status <> 'accepted' then return jsonb_build_object('status', 'not_accepted', 'current', q.status); end if;
  select * into p from public.properties where organization_id = org and id = q.property_id;
  -- Une confirmation à la fois par logement (deux demandes sur les mêmes dates)
  perform pg_advisory_xact_lock(hashtextextended('booking:' || p.id::text, 0));
  d_in := coalesce((q.offer ->> 'check_in')::date, q.check_in);
  d_out := coalesce((q.offer ->> 'check_out')::date, q.check_out);
  if public.dates_conflict(org, p.id, d_in, d_out) then
    insert into public.booking_request_events (organization_id, request_id, kind, visibility, actor_id, body) values (org, q.id, 'confirm_refused', 'internal', uid, 'dates_unavailable');
    return jsonb_build_object('status', 'dates_unavailable');
  end if;
  stale := coalesce((select jsonb_agg(coalesce(s.label, s.platform)) from public.data_sources s where s.organization_id = org and s.property_id = p.id
    and (s.status = 'paused' or s.last_success_at is null or s.last_success_at < now() - interval '24 hours' or (s.last_error is not null and s.last_sync_at > coalesce(s.last_success_at, '-infinity')))), '[]'::jsonb);
  if jsonb_array_length(stale) > 0 and not coalesce(ack_calendars, false) then
    return jsonb_build_object('status', 'stale_calendars', 'calendars', stale);
  end if;
  insert into public.reservations (organization_id, property_id, source, guest_name, guest_email, adults, children, babies, check_in_at, check_out_at, status,
                                   origin_request_id, previous_reservation_id)
  values (org, p.id, 'manual', q.contact_name, q.contact_email, q.adults, q.children, q.babies,
          (d_in + p.default_check_in) at time zone p.timezone, (d_out + p.default_check_out) at time zone p.timezone, 'confirmed',
          q.id, q.origin_reservation_id)
  returning id into rid;
  update public.booking_requests set status = 'confirmed', new_reservation_id = rid, decided_by = uid, guest_unread = true, manager_unread = false, updated_at = now() where id = q.id;
  insert into public.booking_request_events (organization_id, request_id, kind, actor_id, body)
  values (org, q.id, 'confirmed', uid, case when jsonb_array_length(stale) > 0 then null end);
  if jsonb_array_length(stale) > 0 then
    insert into public.booking_request_events (organization_id, request_id, kind, visibility, actor_id, body)
    values (org, q.id, 'confirmed', 'internal', uid, 'Calendriers non à jour acceptés : ' || (select string_agg(x, ', ') from jsonb_array_elements_text(stale) x));
  end if;
  perform public.outbox_insert(org, q.contact_email, 'fr', 'booking_update', jsonb_build_object('decision', 'confirmed', 'property', p.name), null, rid, null);
  return jsonb_build_object('status', 'applied', 'reservation', rid);
end $$;

-- ---------------------------------------------------------------------
-- Satisfaction : propriétaires (relation de gestion), liens d'avis, avis, vitrine
-- ---------------------------------------------------------------------
create table public.property_owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  email text check (length(email) <= 254),
  phone text check (length(phone) <= 40),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create table public.owner_properties (
  organization_id uuid not null,
  owner_id uuid not null,
  property_id uuid not null,
  since date,
  primary key (owner_id, property_id),
  foreign key (organization_id, owner_id) references public.property_owners (organization_id, id) on delete cascade,
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);

create table public.review_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('guest', 'owner')),
  reservation_id uuid,
  owner_id uuid,
  token_hash text not null unique,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((kind = 'guest') = (reservation_id is not null) and (kind = 'owner') = (owner_id is not null)),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (organization_id, owner_id) references public.property_owners (organization_id, id) on delete cascade
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('guest', 'owner')),
  source text not null default 'halo' check (source in ('halo', 'imported')),
  verified boolean not null default false,          -- séjour (ou relation propriétaire) réellement connu dans HALO
  link_id uuid unique,                               -- un avis par lien (donc par séjour / propriétaire et période)
  reservation_id uuid,
  property_id uuid,
  owner_id uuid,
  overall int not null check (overall between 1 and 5),
  ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object'),
  comment text check (length(comment) <= 2000),
  would_return boolean,                              -- voyageur : reviendrait ; propriétaire : recommanderait
  author_label text check (length(author_label) <= 60), -- signature choisie par l'auteur (ex. « Camille, Lyon »)
  consent_publish boolean not null default false,
  consent_at timestamptz,
  consent_withdrawn_at timestamptz,
  imported_from text check (length(imported_from) <= 80),
  review_date date not null default current_date,  -- date de l'avis (importé : date d'origine)
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  editable_until timestamptz,
  -- Suivi par l'équipe (jamais la note ni le commentaire de l'auteur)
  follow_status text not null default 'new' check (follow_status in ('new', 'to_handle', 'handled')),
  follow_note text check (length(follow_note) <= 2000),
  follow_by uuid references auth.users (id) on delete set null,
  follow_at timestamptz,
  incident_id uuid,
  unique (organization_id, id),
  check ((kind = 'owner') = (owner_id is not null) or source = 'imported'),
  foreign key (organization_id, link_id) references public.review_links (organization_id, id) on delete set null (link_id),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete set null (reservation_id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete set null (property_id),
  foreign key (organization_id, owner_id) references public.property_owners (organization_id, id) on delete set null (owner_id)
);
create index reviews_org on public.reviews (organization_id, kind, review_date desc);

create table public.showcases (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  title text not null check (length(trim(title)) between 1 and 120),
  intro text check (length(intro) <= 2000),
  services text check (length(services) <= 1000),
  contact text check (length(contact) <= 300),
  period_months int not null default 12 check (period_months between 1 and 36),
  show_guest_score boolean not null default true,
  show_owner_score boolean not null default true,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.showcase_testimonials (
  organization_id uuid not null,
  review_id uuid not null,
  position int not null default 0,
  primary key (organization_id, review_id),
  foreign key (organization_id, review_id) references public.reviews (organization_id, id) on delete cascade
);

alter table public.property_owners enable row level security;
alter table public.owner_properties enable row level security;
alter table public.review_links enable row level security;
alter table public.reviews enable row level security;
alter table public.showcases enable row level security;
alter table public.showcase_testimonials enable row level security;
revoke all on public.property_owners, public.owner_properties, public.review_links, public.reviews, public.showcases, public.showcase_testimonials from anon, authenticated;
grant select, insert, update, delete on public.property_owners, public.owner_properties to authenticated;
grant select on public.review_links, public.reviews, public.showcases, public.showcase_testimonials to authenticated;
create policy property_owners_manager on public.property_owners for all to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy owner_properties_manager on public.owner_properties for all to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy review_links_select on public.review_links for select to authenticated using (public.is_manager(organization_id));
create policy reviews_select on public.reviews for select to authenticated using (public.is_manager(organization_id));
create policy showcases_select on public.showcases for select to authenticated using (public.is_manager(organization_id));
create policy showcase_testimonials_select on public.showcase_testimonials for select to authenticated using (public.is_manager(organization_id));

-- Lien d'avis : voyageur après son séjour (30 jours), propriétaire relié à au moins un logement (30 jours)
create function public.create_review_link(org uuid, link_kind text, target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare raw text := encode(extensions.gen_random_bytes(32), 'hex'); r public.reservations;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if link_kind = 'guest' then
    select * into r from public.reservations where organization_id = org and id = target;
    if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    if r.status <> 'confirmed' or r.check_out_at > now() + interval '1 day' then raise exception 'stay_not_finished' using errcode = '22023'; end if;
    if exists (select 1 from public.reviews where organization_id = org and reservation_id = target and kind = 'guest') then raise exception 'already_reviewed' using errcode = '22023'; end if;
    update public.review_links set revoked_at = now() where organization_id = org and reservation_id = target and revoked_at is null;
    insert into public.review_links (organization_id, kind, reservation_id, token_hash, valid_until, created_by)
    values (org, 'guest', target, encode(extensions.digest(raw, 'sha256'), 'hex'), now() + interval '30 days', (select auth.uid()));
  elsif link_kind = 'owner' then
    if not exists (select 1 from public.owner_properties where organization_id = org and owner_id = target) then raise exception 'no_managed_property' using errcode = '22023'; end if;
    update public.review_links set revoked_at = now() where organization_id = org and owner_id = target and revoked_at is null;
    insert into public.review_links (organization_id, kind, owner_id, token_hash, valid_until, created_by)
    values (org, 'owner', target, encode(extensions.digest(raw, 'sha256'), 'hex'), now() + interval '30 days', (select auth.uid()));
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  return raw;
end $$;

create function public.review_link_any(token text) returns public.review_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.review_links l where l.token_hash = encode(extensions.digest(token, 'sha256'), 'hex') and l.revoked_at is null and l.valid_until > now();
$$;
revoke all on function public.review_link_any(text) from public, anon, authenticated;

create function public.review_portal(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.review_links; rv public.reviews;
begin
  l := public.review_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into rv from public.reviews where link_id = l.id;
  return jsonb_build_object('status', 'ok', 'kind', l.kind,
    'organization', (select name from public.organizations where id = l.organization_id),
    'stay', case when l.kind = 'guest' then (select jsonb_build_object('property', p.name, 'check_in_at', r.check_in_at, 'check_out_at', r.check_out_at, 'timezone', p.timezone)
                                              from public.reservations r join public.properties p on p.id = r.property_id where r.organization_id = l.organization_id and r.id = l.reservation_id) end,
    'owner', case when l.kind = 'owner' then (select jsonb_build_object('name', o.name, 'properties', (select count(*) from public.owner_properties x where x.owner_id = o.id))
                                              from public.property_owners o where o.id = l.owner_id) end,
    'link_valid_until', l.valid_until,
    'review', case when rv.id is null then null else jsonb_build_object('overall', rv.overall, 'ratings', rv.ratings, 'comment', rv.comment, 'would_return', rv.would_return,
       'author_label', rv.author_label, 'consent_publish', rv.consent_publish and rv.consent_withdrawn_at is null, 'submitted_at', rv.submitted_at, 'updated_at', rv.updated_at,
       'editable', rv.editable_until > now()) end);
end $$;

-- Dépôt ou modification de l'avis par son auteur (14 jours pour modifier) ; consentement de publication distinct
create function public.review_submit(token text, v_overall int, v_ratings jsonb, v_comment text, v_return boolean, v_label text, v_consent boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.review_links; rv public.reviews; keys text[]; clean jsonb := '{}'::jsonb; k text; prop uuid; rid uuid;
begin
  l := public.review_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if v_overall is null or v_overall not between 1 and 5 then return jsonb_build_object('status', 'invalid'); end if;
  keys := case when l.kind = 'guest' then array['cleanliness', 'condition', 'checkin', 'communication'] else array['communication', 'reactivity', 'follow_up', 'quality', 'transparency'] end;
  foreach k in array keys loop
    if (v_ratings ->> k) ~ '^[1-5]$' then clean := clean || jsonb_build_object(k, (v_ratings ->> k)::int); end if;
  end loop;
  select * into rv from public.reviews where link_id = l.id for update;
  if rv.id is not null then
    if rv.editable_until <= now() then return jsonb_build_object('status', 'locked'); end if;
    update public.reviews set overall = v_overall, ratings = clean, comment = nullif(left(trim(coalesce(v_comment, '')), 2000), ''), would_return = v_return,
      author_label = nullif(left(trim(coalesce(v_label, '')), 60), ''),
      consent_publish = coalesce(v_consent, false), consent_at = case when coalesce(v_consent, false) and not rv.consent_publish then now() else consent_at end,
      consent_withdrawn_at = case when not coalesce(v_consent, false) and rv.consent_publish then now() else consent_withdrawn_at end,
      follow_status = case when v_overall <= 2 and rv.follow_status = 'new' then 'to_handle' else follow_status end,
      updated_at = now()
     where id = rv.id;
    -- Retrait du consentement : le témoignage quitte la vitrine immédiatement
    if not coalesce(v_consent, false) then delete from public.showcase_testimonials where review_id = rv.id; end if;
    return jsonb_build_object('status', 'ok', 'updated', true);
  end if;
  if l.kind = 'guest' then select property_id into prop from public.reservations where organization_id = l.organization_id and id = l.reservation_id; end if;
  insert into public.reviews (organization_id, kind, source, verified, link_id, reservation_id, property_id, owner_id, overall, ratings, comment, would_return,
                              author_label, consent_publish, consent_at, editable_until, follow_status)
  values (l.organization_id, l.kind, 'halo', true, l.id, l.reservation_id, prop, l.owner_id, v_overall, clean, nullif(left(trim(coalesce(v_comment, '')), 2000), ''), v_return,
          nullif(left(trim(coalesce(v_label, '')), 60), ''), coalesce(v_consent, false), case when coalesce(v_consent, false) then now() end, now() + interval '14 days',
          case when v_overall <= 2 then 'to_handle' else 'new' end)
  returning id into rid;
  if v_overall <= 2 then
    perform public.queue_team_email(l.organization_id, 'team_low_review',
      jsonb_build_object('review_kind', l.kind, 'property', (select name from public.properties where id = prop), 'path', '/app/satisfaction'), null, l.reservation_id, null);
  end if;
  return jsonb_build_object('status', 'ok', 'updated', false);
end $$;

-- Suivi par l'équipe : statut, note de suivi, incident éventuel. La note et le commentaire de l'auteur sont intouchables.
create function public.review_follow(org uuid, review uuid, new_status text, note text default null, make_incident boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rv public.reviews; iid uuid;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into rv from public.reviews where organization_id = org and id = review for update;
  if rv.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if new_status not in ('new', 'to_handle', 'handled') then raise exception 'invalid' using errcode = '22023'; end if;
  if make_incident and rv.incident_id is null then
    if rv.property_id is null then raise exception 'no_property' using errcode = '22023'; end if;
    insert into public.incidents (organization_id, property_id, reservation_id, source, category, description, reported_by, manager_unread)
    values (org, rv.property_id, rv.reservation_id, 'manager', 'other',
            left('Suite à un avis voyageur (' || rv.overall || '/5) : ' || coalesce(nullif(trim(coalesce(note, '')), ''), coalesce(rv.comment, 'note faible')), 2000), (select auth.uid()), false)
    returning id into iid;
  end if;
  update public.reviews set follow_status = new_status, follow_note = coalesce(nullif(left(trim(coalesce(note, '')), 2000), ''), follow_note),
    follow_by = (select auth.uid()), follow_at = now(), incident_id = coalesce(iid, incident_id)
   where id = rv.id;
  return jsonb_build_object('status', 'applied', 'incident', iid);
end $$;

-- Avis importés (autre plateforme) : jamais « vérifiés », provenance et date d'origine conservées
create function public.add_imported_review(org uuid, r_kind text, r_overall int, r_comment text, r_from text, r_date date, prop uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if r_kind not in ('guest', 'owner') or r_overall not between 1 and 5 or nullif(trim(coalesce(r_from, '')), '') is null or r_date is null or r_date > current_date then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if prop is not null and not exists (select 1 from public.properties where organization_id = org and id = prop) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.reviews (organization_id, kind, source, verified, property_id, overall, comment, imported_from, review_date, follow_status)
  values (org, r_kind, 'imported', false, prop, r_overall, nullif(left(trim(coalesce(r_comment, '')), 2000), ''), left(trim(r_from), 80), r_date, 'handled')
  returning id into rid;
  return rid;
end $$;

-- Vitrine : réglages, sélection de témoignages consentis, publication explicite
create function public.save_showcase(org uuid, s_slug text, s_title text, s_intro text, s_services text, s_contact text, s_months int, s_guest boolean, s_owner boolean, testimonials uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bad int;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select count(*) into bad from unnest(coalesce(testimonials, '{}')) t
   where not exists (select 1 from public.reviews r where r.organization_id = org and r.id = t and r.source = 'halo' and r.consent_publish and r.consent_withdrawn_at is null and r.comment is not null);
  if bad > 0 then raise exception 'testimonial_not_allowed' using errcode = '22023'; end if;
  insert into public.showcases (organization_id, slug, title, intro, services, contact, period_months, show_guest_score, show_owner_score)
  values (org, lower(s_slug), s_title, s_intro, s_services, s_contact, coalesce(s_months, 12), coalesce(s_guest, true), coalesce(s_owner, true))
  on conflict (organization_id) do update set slug = excluded.slug, title = excluded.title, intro = excluded.intro, services = excluded.services, contact = excluded.contact,
    period_months = excluded.period_months, show_guest_score = excluded.show_guest_score, show_owner_score = excluded.show_owner_score, updated_at = now();
  delete from public.showcase_testimonials where organization_id = org;
  insert into public.showcase_testimonials (organization_id, review_id, position)
  select org, t, ord from unnest(coalesce(testimonials, '{}')) with ordinality as x(t, ord);
  return jsonb_build_object('status', 'applied');
end $$;

create function public.publish_showcase(org uuid, publish boolean) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.showcases set published_at = case when publish then now() end, published_by = case when publish then (select auth.uid()) end, updated_at = now()
   where organization_id = org;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return 'applied';
end $$;

-- Scores : avis HALO vérifiés seulement, toutes les notes de la période (aucune exclusion), avec le nombre d'avis
create function public.satisfaction_score(org uuid, r_kind text, months int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('count', count(*), 'average', case when count(*) > 0 then round(avg(overall)::numeric, 1) end,
    'from', (current_date - make_interval(months => months))::date, 'to', current_date)
  from public.reviews where organization_id = org and kind = r_kind and source = 'halo' and verified
    and review_date >= (current_date - make_interval(months => months))::date;
$$;
revoke all on function public.satisfaction_score(uuid, text, int) from public, anon, authenticated;

-- Page publique : uniquement si publiée ; aucune identité complète, aucune adresse, aucune coordonnée personnelle
create function public.get_showcase(s_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.showcases;
begin
  select * into s from public.showcases where slug = lower(s_slug) and published_at is not null;
  if s.organization_id is null then return jsonb_build_object('status', 'unavailable'); end if;
  return jsonb_build_object('status', 'ok', 'organization', (select name from public.organizations where id = s.organization_id),
    'title', s.title, 'intro', s.intro, 'services', s.services, 'contact', s.contact, 'period_months', s.period_months, 'published_at', s.published_at,
    'guest', case when s.show_guest_score then public.satisfaction_score(s.organization_id, 'guest', s.period_months) end,
    'owner', case when s.show_owner_score then public.satisfaction_score(s.organization_id, 'owner', s.period_months) end,
    'testimonials', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'overall', r.overall, 'comment', r.comment,
        'author', coalesce(r.author_label, case r.kind when 'guest' then 'guest' else 'owner' end), 'month', to_char(r.review_date, 'YYYY-MM')) order by t.position)
      from public.showcase_testimonials t join public.reviews r on r.organization_id = t.organization_id and r.id = t.review_id
      where t.organization_id = s.organization_id and r.consent_publish and r.consent_withdrawn_at is null), '[]'::jsonb));
end $$;

-- Rétention des liens : rien de spécial (expirés = inutilisables) ; notifications
alter table public.notification_prefs drop constraint if exists notification_prefs_event_check;
alter table public.notification_prefs add constraint notification_prefs_event_check
  check (event in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message',
                   'team_agent_blocker', 'team_absence_requested', 'team_task_to_validate', 'team_assignment_conflict',
                   'team_stay_changed', 'team_prep_submitted', 'team_prep_updated', 'team_vip_requested', 'team_booking_requested', 'team_low_review',
                   'chat_message', 'agent_task_assigned', 'agent_task_changed', 'agent_correction_requested', 'agent_absence_decided'));

create function public.booking_mark_read(org uuid, request uuid) returns void
language sql security definer set search_path = '' as $$
  update public.booking_requests set manager_unread = false where public.is_manager(org) and organization_id = org and id = request and manager_unread;
$$;
revoke all on function public.booking_mark_read(uuid, uuid) from public, anon;
grant execute on function public.booking_mark_read(uuid, uuid) to authenticated;

-- E-mail portant un lien personnel (demande de séjour, avis) : adresse contrôlée, lien retiré du journal après l'envoi
create function public.queue_link_email(org uuid, reservation uuid, owner uuid, tpl text, url text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; o public.property_owners; pattern text;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  pattern := case tpl when 'booking_link' then '^https?://[^ ]+/b/[0-9a-f]{64}$' when 'review_request' then '^https?://[^ ]+/avis/[0-9a-f]{64}$' end;
  if pattern is null or url !~ pattern then raise exception 'invalid' using errcode = '22023'; end if;
  if reservation is not null then
    select * into r from public.reservations where organization_id = org and id = reservation;
    if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    return public.queue_guest_email(r, tpl, jsonb_strip_nulls(jsonb_build_object('url', case when r.guest_email ~* '\.invalid$' then null else url end,
      'property', (select name from public.properties where id = r.property_id))), null);
  end if;
  select * into o from public.property_owners where organization_id = org and id = owner;
  if o.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.email is null then return false; end if;
  perform public.outbox_insert(org, o.email, 'fr', tpl, jsonb_strip_nulls(jsonb_build_object('url', case when o.email ~* '\.invalid$' then null else url end)), null, null, null);
  return true;
end $$;
revoke all on function public.queue_link_email(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.queue_link_email(uuid, uuid, uuid, text, text) to authenticated;

revoke all on function public.create_booking_link(uuid, uuid), public.revoke_booking_link(uuid, uuid), public.booking_portal(text),
  public.booking_submit(text, uuid, date, date, int, int, int, text, text, text, text), public.booking_guest_action(text, uuid, text, text),
  public.booking_decide(uuid, uuid, text, text, text, jsonb, date, date), public.booking_confirm(uuid, uuid, boolean),
  public.create_review_link(uuid, text, uuid), public.review_portal(text), public.review_submit(text, int, jsonb, text, boolean, text, boolean),
  public.review_follow(uuid, uuid, text, text, boolean), public.add_imported_review(uuid, text, int, text, text, date, uuid),
  public.save_showcase(uuid, text, text, text, text, text, int, boolean, boolean, uuid[]), public.publish_showcase(uuid, boolean), public.get_showcase(text) from public;
grant execute on function public.booking_portal(text), public.booking_submit(text, uuid, date, date, int, int, int, text, text, text, text),
  public.booking_guest_action(text, uuid, text, text), public.review_portal(text), public.review_submit(text, int, jsonb, text, boolean, text, boolean),
  public.get_showcase(text) to anon, authenticated;
grant execute on function public.create_booking_link(uuid, uuid), public.revoke_booking_link(uuid, uuid), public.booking_decide(uuid, uuid, text, text, text, jsonb, date, date),
  public.booking_confirm(uuid, uuid, boolean), public.create_review_link(uuid, text, uuid), public.review_follow(uuid, uuid, text, text, boolean),
  public.add_imported_review(uuid, text, int, text, text, date, uuid), public.save_showcase(uuid, text, text, text, text, text, int, boolean, boolean, uuid[]),
  public.publish_showcase(uuid, boolean) to authenticated;
