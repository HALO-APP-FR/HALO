-- =====================================================================
-- HALO — Environnement connecté, première tranche
--  * onboarding du manager (réponses conservées, reprenables, appliquées après confirmation) ;
--  * espace voyageur par lien de séjour : prestations, réponses, messages ;
--  * historique des demandes, séparation stricte messages voyageur / notes internes ;
--  * notifications : file d'envoi e-mail avec état réel (en attente, envoyé, échec,
--    service non configuré, sans destinataire) et relance possible.
-- =====================================================================

-- ---------- Profil et organisation (onboarding) ----------
alter table public.profiles add column job_title text check (length(job_title) <= 120);

alter table public.organizations
  add column legal_name text check (length(legal_name) <= 200),
  add column address_line text check (length(address_line) <= 300),
  add column postal_code text check (length(postal_code) <= 20),
  add column city text check (length(city) <= 120),
  add column activity_type text check (activity_type in ('concierge', 'short_term_rental', 'residence', 'aparthotel', 'independent_hotel')),
  add column unit_count int check (unit_count between 0 and 100000),
  add column cleaning_model text check (cleaning_model in ('internal', 'providers', 'both')),
  add column linen_model text check (linen_model in ('internal', 'laundry', 'both', 'none')),
  add column services_offered text[] not null default '{}',
  add column frequent_issues text[] not null default '{}',
  add column tools text[] not null default '{}',
  add column default_checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(default_checklist) = 'array'),
  add column linen_turnaround_days int not null default 2 check (linen_turnaround_days between 0 and 30),
  -- État de l'onboarding : étape, questions passées, date de fin, propositions acceptées / ignorées
  add column onboarding jsonb not null default '{}'::jsonb check (jsonb_typeof(onboarding) = 'object');

-- ---------- Séjours : contact voyageur (facultatif) ----------
alter table public.reservations
  add column guest_email text check (guest_email is null or guest_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column guest_locale text not null default 'fr' check (guest_locale in ('fr', 'en', 'es', 'pt', 'it', 'de'));

-- ---------- Prestations ----------
create table public.service_requests (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null,
  reservation_id uuid,
  property_id uuid not null,
  kind text not null check (kind in ('private_chef', 'restaurant', 'driver', 'airport_transfer', 'grocery', 'spa', 'babysitter', 'experience', 'flowers', 'other')),
  start_at timestamptz not null,
  people int check (people between 1 and 100),
  details text check (length(details) <= 2000),
  status text not null default 'requested' check (status in ('requested', 'info_requested', 'confirmed', 'declined', 'done', 'cancelled')),
  source text not null check (source in ('guest', 'manager')),
  assignee_id uuid,
  provider text check (length(provider) <= 200),
  price numeric(10, 2) check (price >= 0),
  manager_unread boolean not null default false,   -- action du voyageur pas encore vue par l'équipe
  guest_unread boolean not null default false,     -- réponse de l'équipe pas encore vue par le voyageur
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (organization_id, assignee_id) references public.memberships (organization_id, user_id) on delete set null (assignee_id)
);
create index service_requests_org_idx on public.service_requests (organization_id, status, start_at);

-- Historique : chaque événement est soit visible du voyageur (`guest`), soit interne (`internal`).
-- Un message voyageur et une note interne ne sont jamais le même enregistrement.
create table public.service_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  service_id uuid not null,
  kind text not null check (kind in ('created', 'status', 'guest_message', 'team_message', 'internal_note', 'updated')),
  status text,
  body text check (length(body) <= 2000),
  visibility text not null check (visibility in ('guest', 'internal')),
  author_kind text not null check (author_kind in ('guest', 'member', 'system')),
  author_id uuid references auth.users (id) on delete set null,
  at timestamptz not null default now(),
  check (kind <> 'internal_note' or visibility = 'internal'),
  check (kind <> 'guest_message' or visibility = 'guest'),
  foreign key (organization_id, service_id) references public.service_requests (organization_id, id) on delete cascade
);
create index service_events_idx on public.service_events (organization_id, service_id, at);

-- Messages du séjour (voyageur ↔ équipe), distincts de la messagerie interne
create table public.stay_messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  reservation_id uuid not null,
  author_kind text not null check (author_kind in ('guest', 'member')),
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_by_team_at timestamptz,
  read_by_guest_at timestamptz,
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade
);
create index stay_messages_idx on public.stay_messages (organization_id, reservation_id, created_at);

-- File d'envoi : l'état reflète ce qui s'est réellement passé, jamais une supposition
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  recipient text not null,
  locale text not null default 'fr',
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  service_id uuid,
  reservation_id uuid,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'not_configured')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_pending on public.notification_outbox (status, created_at) where status = 'pending';

do $$
declare t text;
begin
  foreach t in array array['service_requests', 'service_events', 'stay_messages', 'notification_outbox'] loop
    execute format('create trigger %I_org_immutable before update on public.%I for each row execute function public.forbid_org_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
create trigger service_requests_touch before update on public.service_requests for each row execute function public.touch_updated_at();

-- Droits : lecture selon le rôle ; écritures sensibles uniquement par fonctions
grant select on public.service_requests, public.service_events, public.stay_messages, public.notification_outbox to authenticated;
revoke insert, update, delete on public.service_events, public.stay_messages, public.notification_outbox from authenticated;
grant insert, update, delete on public.service_requests to authenticated;
revoke update (status, manager_unread, guest_unread, source) on public.service_requests from authenticated;
revoke update on public.service_requests from authenticated;
grant update (kind, start_at, people, details, assignee_id, provider, price) on public.service_requests to authenticated;

create policy service_requests_select on public.service_requests for select to authenticated
  using (public.is_manager(organization_id) or (assignee_id = (select auth.uid()) and public.is_member(organization_id)));
create policy service_requests_insert on public.service_requests for insert to authenticated
  with check (public.is_manager(organization_id) and source = 'manager' and status = 'requested');
create policy service_requests_update on public.service_requests for update to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy service_requests_delete on public.service_requests for delete to authenticated
  using (public.is_manager(organization_id));
-- Un agent chargé d'une prestation ne voit pas les notes internes du dossier, seulement le dossier
create policy service_events_select on public.service_events for select to authenticated
  using (public.is_manager(organization_id));
create policy stay_messages_select on public.stay_messages for select to authenticated
  using (public.is_manager(organization_id));
create policy notification_outbox_select on public.notification_outbox for select to authenticated
  using (public.is_manager(organization_id));

-- ---------- Outils internes ----------
-- Lien de séjour valide → séjour ; sinon null (même chemin pour toutes les impossibilités)
create function public.guest_link_stay(token text) returns public.reservations
language plpgsql stable security definer set search_path = '' as $$
declare l public.guest_links; r public.reservations;
begin
  if token is null or length(token) <> 64 or token !~ '^[0-9a-f]+$' then return null; end if;
  select * into l from public.guest_links where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  if l.id is null or public.guest_link_status(l.revoked_at, l.valid_from, l.valid_until) <> 'active' then return null; end if;
  select * into r from public.reservations where organization_id = l.organization_id and id = l.reservation_id;
  if r.status <> 'confirmed' then return null; end if;
  return r;
end $$;
revoke all on function public.guest_link_stay(text) from public, anon, authenticated;

-- E-mail au voyageur : seulement s'il a une adresse ; sinon rien n'est mis en file (et l'interface le dit)
create function public.queue_guest_email(r public.reservations, tpl text, data jsonb, service uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if r.guest_email is null then return false; end if;
  insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id)
  values (r.organization_id, r.guest_email, r.guest_locale, tpl, data, service, r.id);
  return true;
end $$;
revoke all on function public.queue_guest_email(public.reservations, text, jsonb, uuid) from public, anon, authenticated;

-- ---------- Espace voyageur (accès par lien de séjour, sans compte) ----------
-- Remplace la version précédente : même réponse neutre, et en plus les demandes du séjour,
-- leurs événements visibles par le voyageur et les messages du séjour. Jamais de note interne.
create or replace function public.get_guest_stay(token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reservations; l public.guest_links; p public.properties; g public.guest_guides; seen timestamptz;
  unavailable constant jsonb := jsonb_build_object('status', 'unavailable');
begin
  r := public.guest_link_stay(token);
  if r.id is null then return unavailable; end if;
  select * into l from public.guest_links where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  select * into g from public.guest_guides where organization_id = p.organization_id and property_id = p.id;
  if g.property_id is null or not g.enabled then return unavailable; end if;
  seen := l.last_opened_at;
  update public.guest_links set last_opened_at = now() where id = l.id;
  update public.service_requests set guest_unread = false where organization_id = r.organization_id and reservation_id = r.id and guest_unread;
  update public.stay_messages set read_by_guest_at = now() where organization_id = r.organization_id and reservation_id = r.id and author_kind = 'member' and read_by_guest_at is null;
  return jsonb_build_object(
    'status', 'ok',
    'previously_opened_at', seen,
    'organization', (select jsonb_build_object('name', o.name, 'services_offered', to_jsonb(o.services_offered)) from public.organizations o where o.id = r.organization_id),
    'property', jsonb_build_object('name', p.name, 'address', p.address_line, 'city', p.city, 'timezone', p.timezone,
      'check_in_time', p.default_check_in, 'check_out_time', p.default_check_out),
    'stay', jsonb_build_object('guest_name', r.guest_name, 'check_in_at', r.check_in_at, 'check_out_at', r.check_out_at,
      'adults', r.adults, 'children', r.children, 'babies', r.babies, 'link_valid_until', l.valid_until),
    'guide', jsonb_build_object('welcome', g.welcome, 'wifi_name', g.wifi_name, 'wifi_password', g.wifi_password,
      'house_rules', g.house_rules, 'checkout_instructions', g.checkout_instructions, 'parking', g.parking,
      'trash', g.trash, 'emergency_phone', g.emergency_phone, 'recommendations', g.recommendations),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'start_at', s.start_at, 'people', s.people, 'details', s.details, 'status', s.status,
        'created_at', s.created_at,
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'status', e.status, 'body', e.body, 'author', e.author_kind, 'at', e.at) order by e.at)
                            from public.service_events e
                            where e.organization_id = s.organization_id and e.service_id = s.id and e.visibility = 'guest'), '[]'::jsonb))
        order by s.created_at desc)
      from public.service_requests s where s.organization_id = r.organization_id and s.reservation_id = r.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author_kind, 'body', m.body, 'at', m.created_at) order by m.created_at)
      from public.stay_messages m where m.organization_id = r.organization_id and m.reservation_id = r.id), '[]'::jsonb));
end $$;

create function public.guest_request_service(token text, s_kind text, s_start_at timestamptz, s_people int, s_details text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reservations; sid uuid; emailed boolean;
begin
  r := public.guest_link_stay(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  insert into public.service_requests (organization_id, reservation_id, property_id, kind, start_at, people, details, source, manager_unread)
  values (r.organization_id, r.id, r.property_id, s_kind, s_start_at, s_people, nullif(trim(s_details), ''), 'guest', true)
  returning id into sid;
  insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind)
  values (r.organization_id, sid, 'created', 'requested', 'guest', 'guest');
  emailed := public.queue_guest_email(r, 'service_received', jsonb_build_object('kind', s_kind, 'start_at', s_start_at), sid);
  return jsonb_build_object('status', 'ok', 'id', sid, 'email_queued', emailed);
end $$;

-- Réponse du voyageur à une demande de précisions (ou complément) : retour au dossier, signalé à l'équipe
create function public.guest_reply_service(token text, service uuid, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; s public.service_requests;
begin
  r := public.guest_link_stay(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if length(trim(coalesce(message, ''))) = 0 then return jsonb_build_object('status', 'empty'); end if;
  select * into s from public.service_requests where organization_id = r.organization_id and id = service and reservation_id = r.id for update;
  if s.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind)
  values (r.organization_id, s.id, 'guest_message', left(trim(message), 2000), 'guest', 'guest');
  update public.service_requests set manager_unread = true,
    status = case when status = 'info_requested' then 'requested' else status end
  where id = s.id;
  if s.status = 'info_requested' then
    insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind)
    values (r.organization_id, s.id, 'status', 'requested', 'guest', 'system');
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

create function public.guest_send_message(token text, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_stay(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if length(trim(coalesce(message, ''))) = 0 then return jsonb_build_object('status', 'empty'); end if;
  insert into public.stay_messages (organization_id, reservation_id, author_kind, body)
  values (r.organization_id, r.id, 'guest', left(trim(message), 2000));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------- Côté équipe ----------
-- Décision sur une demande. `guest_message` est transmis au voyageur (visible dans son espace,
-- et par e-mail si possible) ; `internal_note` ne l'est jamais.
create function public.decide_service(org uuid, service uuid, new_status text, guest_message text default null, internal_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; uid uuid := (select auth.uid()); msg text := nullif(trim(coalesce(guest_message, '')), ''); emailed boolean := false;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service for update;
  if s.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (
    (s.status in ('requested', 'info_requested') and new_status in ('confirmed', 'declined', 'info_requested', 'cancelled'))
    or (s.status = 'confirmed' and new_status in ('done', 'cancelled'))
  ) then
    return jsonb_build_object('status', 'conflict', 'current', s.status);
  end if;
  if new_status = 'info_requested' and msg is null then raise exception 'question_required' using errcode = '22023'; end if;
  update public.service_requests set status = new_status, manager_unread = false, guest_unread = (s.source = 'guest') where id = s.id;
  insert into public.service_events (organization_id, service_id, kind, status, body, visibility, author_kind, author_id)
  values (org, s.id, 'status', new_status, msg, 'guest', 'member', uid);
  if nullif(trim(coalesce(internal_note, '')), '') is not null then
    insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind, author_id)
    values (org, s.id, 'internal_note', left(trim(internal_note), 2000), 'internal', 'member', uid);
  end if;
  if s.reservation_id is not null then
    select * into r from public.reservations where organization_id = org and id = s.reservation_id;
    emailed := public.queue_guest_email(r, 'service_' || new_status, jsonb_build_object('kind', s.kind, 'start_at', s.start_at, 'message', msg), s.id);
  end if;
  return jsonb_build_object('status', 'ok', 'email_queued', emailed);
end $$;

create function public.mark_service_seen(org uuid, service uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.service_requests set manager_unread = false where organization_id = org and id = service;
end $$;

create function public.reply_stay_message(org uuid, reservation uuid, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; emailed boolean;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(message, ''))) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  select * into r from public.reservations where organization_id = org and id = reservation;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.stay_messages (organization_id, reservation_id, author_kind, author_id, body)
  values (org, reservation, 'member', (select auth.uid()), left(trim(message), 2000));
  update public.stay_messages set read_by_team_at = now() where organization_id = org and reservation_id = reservation and author_kind = 'guest' and read_by_team_at is null;
  emailed := public.queue_guest_email(r, 'stay_message', jsonb_build_object('message', left(trim(message), 2000)), null);
  return jsonb_build_object('status', 'ok', 'email_queued', emailed);
end $$;

create function public.retry_notification(org uuid, notification uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.notification_outbox set status = 'pending', last_error = null
   where organization_id = org and id = notification and status in ('failed', 'not_configured');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Demande modifiée par l'équipe (date, nombre de personnes) : historique visible et voyageur prévenu
create function public.update_service(org uuid, service uuid, new_start_at timestamptz, new_people int, guest_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; msg text := nullif(trim(coalesce(guest_message, '')), ''); emailed boolean := false;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service for update;
  if s.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.status not in ('requested', 'info_requested', 'confirmed') then return jsonb_build_object('status', 'conflict', 'current', s.status); end if;
  if new_start_at is not distinct from s.start_at and new_people is not distinct from s.people then return jsonb_build_object('status', 'unchanged'); end if;
  update public.service_requests set start_at = coalesce(new_start_at, s.start_at), people = new_people, guest_unread = (s.source = 'guest') where id = s.id;
  insert into public.service_events (organization_id, service_id, kind, status, body, visibility, author_kind, author_id)
  values (org, s.id, 'updated', s.status, msg, 'guest', 'member', (select auth.uid()));
  if s.reservation_id is not null then
    select * into r from public.reservations where organization_id = org and id = s.reservation_id;
    emailed := public.queue_guest_email(r, 'service_updated', jsonb_build_object('kind', s.kind, 'start_at', coalesce(new_start_at, s.start_at), 'message', msg), s.id);
  end if;
  return jsonb_build_object('status', 'ok', 'email_queued', emailed);
end $$;

revoke all on function public.get_guest_stay(text), public.guest_request_service(text, text, timestamptz, int, text),
  public.guest_reply_service(text, uuid, text), public.guest_send_message(text, text),
  public.decide_service(uuid, uuid, text, text, text), public.mark_service_seen(uuid, uuid),
  public.reply_stay_message(uuid, uuid, text), public.retry_notification(uuid, uuid),
  public.update_service(uuid, uuid, timestamptz, int, text) from public, anon;
-- Exceptions anonymes (porte d'entrée voyageur, toujours conditionnée par un lien de séjour valide)
grant execute on function public.get_guest_stay(text), public.guest_request_service(text, text, timestamptz, int, text),
  public.guest_reply_service(text, uuid, text), public.guest_send_message(text, text) to anon, authenticated;
grant execute on function public.decide_service(uuid, uuid, text, text, text), public.mark_service_seen(uuid, uuid),
  public.reply_stay_message(uuid, uuid, text), public.retry_notification(uuid, uuid),
  public.update_service(uuid, uuid, timestamptz, int, text) to authenticated;
