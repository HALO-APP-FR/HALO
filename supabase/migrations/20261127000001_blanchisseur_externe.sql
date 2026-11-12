-- Migration 32 : blanchisseur externe — invitation nominative, commandes reliées au stock, étapes, écarts, retards.
--
-- Étapes : envoyé (conciergerie) → reçu → en traitement → prêt → en livraison (blanchisseur) → réceptionné (conciergerie).
-- Le blanchisseur déclare ; seule la conciergerie confirme la réception, avec les quantités réellement reçues.
-- Stock : à l'envoi, sale → chez le blanchisseur ; à la réception confirmée, chez le blanchisseur → propre (quantités
-- confirmées). Un écart laisse la différence « chez le blanchisseur », visible, jusqu'à décision du responsable.
-- Accès du blanchisseur : AUCUNE lecture directe de table. Une seule fonction lui renvoie SES commandes (articles,
-- quantités, dates, historique) ; jamais de logement, de voyageur, de mission, de messagerie ni de stock global.
-- Prérequis : migration 26.

create table public.laundry_partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  contact_name text check (length(contact_name) <= 120),
  contact_email text check (length(contact_email) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.laundry_partner_members (
  organization_id uuid not null,
  partner_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (partner_id, user_id),
  foreign key (organization_id, partner_id) references public.laundry_partners (organization_id, id) on delete cascade
);
create index laundry_partner_members_user on public.laundry_partner_members (user_id) where revoked_at is null;

create table public.laundry_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  partner_id uuid not null,
  contact_name text not null check (length(trim(contact_name)) between 1 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, partner_id) references public.laundry_partners (organization_id, id) on delete cascade
);

create table public.laundry_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  partner_id uuid not null,
  reference text not null,
  status text not null default 'sent' check (status in ('sent', 'received', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')),
  sent_at timestamptz not null default now(),
  expected_back_at timestamptz not null,
  delivered_at timestamptz,
  note text check (length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, reference),
  foreign key (organization_id, partner_id) references public.laundry_partners (organization_id, id) on delete cascade
);
create index laundry_orders_partner on public.laundry_orders (partner_id, status);

create table public.laundry_order_lines (
  organization_id uuid not null,
  order_id uuid not null,
  item_id uuid not null,
  qty_sent int not null check (qty_sent between 1 and 100000),
  qty_received int check (qty_received between 0 and 100000),     -- déclaré par le blanchisseur à la réception
  qty_returned int check (qty_returned between 0 and 100000),     -- déclaré par le blanchisseur à la livraison
  qty_confirmed int check (qty_confirmed between 0 and 100000),   -- constaté par la conciergerie
  primary key (order_id, item_id),
  foreign key (organization_id, order_id) references public.laundry_orders (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.linen_items (organization_id, id) on delete cascade
);

create table public.laundry_order_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  order_id uuid not null,
  kind text not null check (kind in ('sent', 'received', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'discrepancy', 'note')),
  actor_id uuid references auth.users (id) on delete set null,
  actor_side text not null check (actor_side in ('concierge', 'laundry')),
  note text check (length(note) <= 500),
  data jsonb,
  at timestamptz not null default now(),
  foreign key (organization_id, order_id) references public.laundry_orders (organization_id, id) on delete cascade
);
create index laundry_order_events_order on public.laundry_order_events (order_id, at);

alter table public.laundry_partners enable row level security;
alter table public.laundry_partner_members enable row level security;
alter table public.laundry_invites enable row level security;
alter table public.laundry_orders enable row level security;
alter table public.laundry_order_lines enable row level security;
alter table public.laundry_order_events enable row level security;
revoke all on public.laundry_partners, public.laundry_partner_members, public.laundry_invites, public.laundry_orders,
  public.laundry_order_lines, public.laundry_order_events from anon, authenticated;
-- Lecture : responsables de l'organisation seulement. Écriture : uniquement par les fonctions ci-dessous.
grant select on public.laundry_partners, public.laundry_partner_members, public.laundry_orders, public.laundry_order_lines, public.laundry_order_events to authenticated;
grant select (id, organization_id, partner_id, contact_name, email, expires_at, accepted_at, accepted_by, revoked_at, created_at) on public.laundry_invites to authenticated;
create policy laundry_partners_select on public.laundry_partners for select to authenticated using (public.is_manager(organization_id));
create policy laundry_members_select on public.laundry_partner_members for select to authenticated using (public.is_manager(organization_id));
create policy laundry_invites_select on public.laundry_invites for select to authenticated using (public.is_manager(organization_id));
create policy laundry_orders_select on public.laundry_orders for select to authenticated using (public.is_manager(organization_id));
create policy laundry_lines_select on public.laundry_order_lines for select to authenticated using (public.is_manager(organization_id));
create policy laundry_events_select on public.laundry_order_events for select to authenticated using (public.is_manager(organization_id));

-- ---------------------------------------------------------------------------------------------------------------
-- Conciergerie
-- ---------------------------------------------------------------------------------------------------------------
create function public.laundry_partner_save(org uuid, partner uuid, p_name text, p_contact text, p_email text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'invalid' using errcode = '22023'; end if;
  if partner is null then
    insert into public.laundry_partners (organization_id, name, contact_name, contact_email)
    values (org, left(trim(p_name), 120), nullif(left(trim(coalesce(p_contact, '')), 120), ''), nullif(lower(trim(coalesce(p_email, ''))), ''))
    returning id into pid;
  else
    update public.laundry_partners set name = left(trim(p_name), 120), contact_name = nullif(left(trim(coalesce(p_contact, '')), 120), ''),
      contact_email = nullif(lower(trim(coalesce(p_email, ''))), ''), active = coalesce(p_active, active)
     where organization_id = org and id = partner returning id into pid;
    if pid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    -- Partenaire désactivé : ses accès sont retirés immédiatement
    if p_active is false then update public.laundry_partner_members set revoked_at = now() where partner_id = pid and revoked_at is null; end if;
  end if;
  return pid;
end $$;

-- Invitation nominative : nom + adresse ; le lien n'est valable que pour un compte connecté avec CETTE adresse
create function public.laundry_invite(org uuid, partner uuid, p_contact text, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare raw text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.laundry_partners where organization_id = org and id = partner and active) then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Une seule invitation ouverte par adresse et partenaire
  update public.laundry_invites set revoked_at = now()
   where organization_id = org and partner_id = partner and lower(email) = lower(trim(p_email)) and accepted_at is null and revoked_at is null;
  insert into public.laundry_invites (organization_id, partner_id, contact_name, email, token_hash, created_by)
  values (org, partner, left(trim(coalesce(p_contact, '')), 120), lower(trim(p_email)), encode(extensions.digest(raw, 'sha256'), 'hex'), (select auth.uid()));
  return raw;
end $$;

create function public.laundry_invite_revoke(org uuid, invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.laundry_invites set revoked_at = now() where organization_id = org and id = invite and accepted_at is null and revoked_at is null;
end $$;

create function public.laundry_member_revoke(org uuid, partner uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.laundry_partner_members set revoked_at = now() where organization_id = org and partner_id = partner and user_id = member and revoked_at is null;
end $$;

-- Commande : lignes [{item, qty}] ; le linge sale part chez le blanchisseur (refus si le stock sale ne suffit pas)
create function public.laundry_order_create(org uuid, partner uuid, lines jsonb, back_at timestamptz, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare oid uuid; ref text; l jsonb; n int := 0; why text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.laundry_partners where organization_id = org and id = partner and active) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if back_at is null or back_at <= now() or back_at > now() + interval '60 days' then raise exception 'invalid_date' using errcode = '22023'; end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then raise exception 'invalid' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('laundry-ref:' || org::text, 0));
  ref := 'BL-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || lpad((select count(*) + 1 from public.laundry_orders where organization_id = org
           and sent_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')::text, 3, '0');
  insert into public.laundry_orders (organization_id, partner_id, reference, expected_back_at, note, created_by)
  values (org, partner, ref, back_at, why, (select auth.uid())) returning id into oid;
  for l in select * from jsonb_array_elements(lines) loop
    if coalesce((l ->> 'qty')::int, 0) <= 0 then continue; end if;
    insert into public.laundry_order_lines (organization_id, order_id, item_id, qty_sent) values (org, oid, (l ->> 'item')::uuid, (l ->> 'qty')::int);
    -- Mouvement de stock relié à la commande (refus « insufficient_stock » si le sale ne suffit pas : rien n'est créé)
    perform public.linen_move(org, (l ->> 'item')::uuid, 'dirty', 'laundry', (l ->> 'qty')::int, 'to_laundry', 'Commande ' || ref, null, null);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'invalid' using errcode = '22023'; end if;
  insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, note) values (org, oid, 'sent', (select auth.uid()), 'concierge', why);
  return jsonb_build_object('status', 'applied', 'id', oid, 'reference', ref);
end $$;

-- Annulation : seulement avant réception par le blanchisseur ; le linge revient au sale
create function public.laundry_order_cancel(org uuid, oid uuid, reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.laundry_orders; l record;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(reason, ''))) = 0 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into o from public.laundry_orders where organization_id = org and id = oid for update;
  if o.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status <> 'sent' then return jsonb_build_object('status', 'stale', 'current', o.status); end if;
  for l in select * from public.laundry_order_lines where order_id = oid loop
    perform public.linen_move(org, l.item_id, 'laundry', 'dirty', l.qty_sent, 'adjust', 'Annulation ' || o.reference, null, null);
  end loop;
  update public.laundry_orders set status = 'cancelled', updated_at = now() where id = oid;
  insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, note) values (org, oid, 'cancelled', (select auth.uid()), 'concierge', left(trim(reason), 500));
  return jsonb_build_object('status', 'applied');
end $$;

-- Réception confirmée par la conciergerie : quantités constatées [{item, qty}] ; le constaté passe au propre.
-- Possible dès que le blanchisseur a déclaré « prêt » ou « en livraison » (livraison sans déclaration : le cas existe).
create function public.laundry_order_confirm(org uuid, oid uuid, lines jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.laundry_orders; l record; got int; gaps jsonb := '[]'::jsonb;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into o from public.laundry_orders where organization_id = org and id = oid for update;
  if o.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status not in ('ready', 'out_for_delivery') then return jsonb_build_object('status', 'stale', 'current', o.status); end if;
  for l in select * from public.laundry_order_lines where order_id = oid loop
    got := (select (x ->> 'qty')::int from jsonb_array_elements(lines) x where (x ->> 'item')::uuid = l.item_id limit 1);
    if got is null or got < 0 or got > l.qty_sent then raise exception 'invalid' using errcode = '22023'; end if;
    update public.laundry_order_lines set qty_confirmed = got where order_id = oid and item_id = l.item_id;
    if got > 0 then perform public.linen_move(org, l.item_id, 'laundry', 'clean', got, 'from_laundry', 'Réception ' || o.reference, null, null); end if;
    if got <> l.qty_sent or (l.qty_returned is not null and got <> l.qty_returned) then
      gaps := gaps || jsonb_build_object('item', l.item_id, 'sent', l.qty_sent, 'returned', l.qty_returned, 'confirmed', got);
    end if;
  end loop;
  update public.laundry_orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = oid;
  insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, note, data)
  values (org, oid, 'delivered', (select auth.uid()), 'concierge', nullif(left(trim(coalesce(p_note, '')), 500), ''), case when jsonb_array_length(gaps) > 0 then jsonb_build_object('gaps', gaps) end);
  if jsonb_array_length(gaps) > 0 then
    insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, data) values (org, oid, 'discrepancy', (select auth.uid()), 'concierge', jsonb_build_object('gaps', gaps, 'stage', 'confirm'));
  end if;
  return jsonb_build_object('status', 'applied', 'gaps', gaps);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Blanchisseur
-- ---------------------------------------------------------------------------------------------------------------
create function public.laundry_accept_invite(raw_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); inv public.laundry_invites; mail text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into inv from public.laundry_invites where token_hash = encode(extensions.digest(coalesce(raw_token, ''), 'sha256'), 'hex') for update;
  if inv.id is null or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at < now() then
    return jsonb_build_object('status', 'invalid');
  end if;
  select lower(email) into mail from auth.users where id = uid;
  -- Nominative : seul le compte de l'adresse invitée peut l'accepter
  if mail is distinct from lower(inv.email) then return jsonb_build_object('status', 'wrong_account', 'email', inv.email); end if;
  if not exists (select 1 from public.laundry_partners where organization_id = inv.organization_id and id = inv.partner_id and active) then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.laundry_partner_members (organization_id, partner_id, user_id) values (inv.organization_id, inv.partner_id, uid)
  on conflict (partner_id, user_id) do update set revoked_at = null;
  update public.laundry_invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  update public.profiles set full_name = coalesce(nullif(full_name, ''), inv.contact_name) where id = uid;
  return jsonb_build_object('status', 'ok');
end $$;

-- Le compte connecté est-il blanchisseur (au moins un accès actif) ?
create function public.laundry_is_partner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.laundry_partner_members m join public.laundry_partners p on p.id = m.partner_id and p.active
                  where m.user_id = (select auth.uid()) and m.revoked_at is null);
$$;

-- Commandes du blanchisseur connecté : uniquement celles de SES partenaires actifs, sans aucune autre donnée
create function public.laundry_my_orders() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'reference', o.reference, 'status', o.status, 'sent_at', o.sent_at, 'expected_back_at', o.expected_back_at,
      'delivered_at', o.delivered_at, 'late', o.status not in ('delivered', 'cancelled') and o.expected_back_at < now(),
      'client', org.name, 'partner', p.name, 'note', o.note,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('item', l.item_id, 'label', i.label, 'unit', i.unit, 'sent', l.qty_sent,
                  'received', l.qty_received, 'returned', l.qty_returned, 'confirmed', l.qty_confirmed) order by i.label), '[]'::jsonb)
                from public.laundry_order_lines l join public.linen_items i on i.id = l.item_id where l.order_id = o.id),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'side', e.actor_side, 'at', e.at, 'note', e.note) order by e.at, e.id), '[]'::jsonb)
                 from public.laundry_order_events e where e.order_id = o.id))
      order by (o.status in ('delivered', 'cancelled')), o.expected_back_at), '[]'::jsonb)
    from public.laundry_orders o
    join public.laundry_partners p on p.id = o.partner_id and p.active
    join public.laundry_partner_members m on m.partner_id = o.partner_id and m.user_id = (select auth.uid()) and m.revoked_at is null
    join public.organizations org on org.id = o.organization_id;
$$;

-- Étape suivante déclarée par le blanchisseur. Quantités déclarées à la réception (reçu) et à la livraison (en livraison).
create function public.laundry_order_advance(oid uuid, to_status text, lines jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.laundry_orders; l record; got int; gaps jsonb := '[]'::jsonb;
        nxt text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into o from public.laundry_orders where id = oid for update;
  -- Commande inconnue OU d'un autre blanchisseur : même réponse (aucune information divulguée)
  if o.id is null or not exists (select 1 from public.laundry_partner_members m join public.laundry_partners p on p.id = m.partner_id and p.active
                                  where m.partner_id = o.partner_id and m.user_id = uid and m.revoked_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  nxt := case o.status when 'sent' then 'received' when 'received' then 'processing' when 'processing' then 'ready' when 'ready' then 'out_for_delivery' end;
  if nxt is null or to_status is distinct from nxt then return jsonb_build_object('status', 'stale', 'current', o.status); end if;
  if to_status in ('received', 'out_for_delivery') then
    for l in select * from public.laundry_order_lines where order_id = oid loop
      got := (select (x ->> 'qty')::int from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) x where (x ->> 'item')::uuid = l.item_id limit 1);
      if got is null or got < 0 or got > 100000 then raise exception 'invalid' using errcode = '22023'; end if;
      if to_status = 'received' then update public.laundry_order_lines set qty_received = got where order_id = oid and item_id = l.item_id;
      else update public.laundry_order_lines set qty_returned = got where order_id = oid and item_id = l.item_id; end if;
      if got <> l.qty_sent then gaps := gaps || jsonb_build_object('item', l.item_id, 'sent', l.qty_sent, 'declared', got); end if;
    end loop;
  end if;
  update public.laundry_orders set status = to_status, updated_at = now() where id = oid;
  insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, note)
  values (o.organization_id, oid, to_status, uid, 'laundry', nullif(left(trim(coalesce(p_note, '')), 500), ''));
  if jsonb_array_length(gaps) > 0 then
    insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, data)
    values (o.organization_id, oid, 'discrepancy', uid, 'laundry', jsonb_build_object('gaps', gaps, 'stage', to_status));
    -- Écart déclaré : signalé aux responsables (notification préparée ; jamais de détail sur le voyageur)
    perform public.queue_team_email(o.organization_id, 'team_laundry_gap', jsonb_build_object('reference', o.reference, 'stage', to_status, 'path', '/app/linen'), null, null, null);
  end if;
  return jsonb_build_object('status', 'applied', 'gaps', gaps);
end $$;

revoke all on function public.laundry_partner_save(uuid, uuid, text, text, text, boolean), public.laundry_invite(uuid, uuid, text, text),
  public.laundry_invite_revoke(uuid, uuid), public.laundry_member_revoke(uuid, uuid, uuid), public.laundry_order_create(uuid, uuid, jsonb, timestamptz, text),
  public.laundry_order_cancel(uuid, uuid, text), public.laundry_order_confirm(uuid, uuid, jsonb, text), public.laundry_accept_invite(text),
  public.laundry_is_partner(), public.laundry_my_orders(), public.laundry_order_advance(uuid, text, jsonb, text) from public, anon;
grant execute on function public.laundry_partner_save(uuid, uuid, text, text, text, boolean), public.laundry_invite(uuid, uuid, text, text),
  public.laundry_invite_revoke(uuid, uuid), public.laundry_member_revoke(uuid, uuid, uuid), public.laundry_order_create(uuid, uuid, jsonb, timestamptz, text),
  public.laundry_order_cancel(uuid, uuid, text), public.laundry_order_confirm(uuid, uuid, jsonb, text), public.laundry_accept_invite(text),
  public.laundry_is_partner(), public.laundry_my_orders(), public.laundry_order_advance(uuid, text, jsonb, text) to authenticated;
