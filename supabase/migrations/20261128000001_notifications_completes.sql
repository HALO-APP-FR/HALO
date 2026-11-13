-- Migration 33 : notifications complètes (manager, agent, voyageur), rappel de dépassement envoyé par le serveur,
-- blanchisseur : étape « prêt » facultative, reprise anticipée, écart traité par le responsable.
-- Prérequis : migrations 28, 30 et 32.

-- =================================================================================================================
-- A. Événements et catégories push
-- =================================================================================================================
alter table public.notification_prefs drop constraint if exists notification_prefs_event_check;
alter table public.notification_prefs add constraint notification_prefs_event_check
  check (event in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message',
                   'team_agent_blocker', 'team_absence_requested', 'team_task_to_validate', 'team_assignment_conflict',
                   'team_stay_changed', 'team_prep_submitted', 'team_prep_updated', 'team_vip_requested', 'team_booking_requested', 'team_low_review',
                   'team_task_overrun', 'team_laundry', 'agent_task_overrun',
                   'chat_message', 'agent_task_assigned', 'agent_task_changed', 'agent_correction_requested', 'agent_absence_decided', 'agent_task_validated'));

-- Préférence d'un modèle : un seul réglage pour les événements d'une même famille
create or replace function public.pref_event(tpl text) returns text
language sql immutable set search_path = '' as $$
  select case when tpl = 'chat_urgent' then 'chat_message' when tpl in ('team_laundry_gap', 'team_laundry_update') then 'team_laundry' else tpl end;
$$;
revoke all on function public.pref_event(text) from public, anon;

create or replace function public.push_category(tpl text) returns text
language sql immutable set search_path = '' as $$
  select case
    -- Agent
    when tpl in ('agent_task_assigned', 'agent_task_changed') then 'mission'
    when tpl = 'agent_correction_requested' then 'correction'
    when tpl = 'agent_task_overrun' then 'overrun_reminder'
    when tpl = 'chat_message' then 'message'
    when tpl = 'chat_urgent' then 'urgent_message'
    -- Responsable
    when tpl in ('team_agent_blocker', 'team_guest_problem') then 'incident'
    when tpl in ('team_service_requested', 'team_guest_message', 'team_vip_requested', 'team_booking_requested', 'team_guest_reply') then 'guest_request'
    when tpl = 'team_task_to_validate' then 'to_validate'
    when tpl = 'team_task_overrun' then 'overrun'
    when tpl in ('team_laundry_gap', 'team_laundry_update') then 'laundry'
    -- Voyageur (appareil inscrit depuis son espace)
    when tpl in ('service_received', 'service_updated', 'service_confirmed', 'service_declined', 'service_info_requested', 'service_cancelled',
                 'service_done', 'problem_taken', 'problem_resolved', 'stay_message', 'vip_update', 'booking_update') then 'guest_update'
  end;
$$;
revoke all on function public.push_category(text) from public, anon;

-- Urgences : toujours envoyées en push dès qu'un appareil est inscrit (la préférence ne peut pas les couper)
create or replace function public.wants_push_channel(org uuid, member uuid, tpl text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.push_category(tpl) is not null and public.push_category(tpl) <> 'guest_update'
     and exists (select 1 from public.push_subscriptions s where s.user_id = member and s.disabled_at is null)
     and (public.push_category(tpl) in ('urgent_message', 'incident')
          or coalesce((select push from public.notification_prefs where organization_id = org and user_id = member and event = public.pref_event(tpl)), true));
$$;

create or replace function public.wants_email_channel(org uuid, member uuid, tpl text, critical boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select critical or coalesce((select email from public.notification_prefs
                               where organization_id = org and user_id = member and event = public.pref_event(tpl)), true);
$$;

create or replace function public.set_push_pref(org uuid, ev text, by_push boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if ev not in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message', 'team_agent_blocker', 'team_vip_requested',
                'team_booking_requested', 'team_task_to_validate', 'team_task_overrun', 'team_laundry', 'chat_message', 'agent_task_assigned',
                'agent_task_changed', 'agent_correction_requested', 'agent_task_overrun') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into public.notification_prefs (organization_id, user_id, event, email, push)
  values (org, (select auth.uid()), ev, true, by_push)
  on conflict (organization_id, user_id, event) do update set push = excluded.push, updated_at = now();
end $$;

-- =================================================================================================================
-- B. Push du voyageur : appareil inscrit depuis son espace, rattaché au SÉJOUR (aucun compte)
-- =================================================================================================================
create table public.guest_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  disabled_at timestamptz
);
alter table public.guest_push_subscriptions enable row level security;
revoke all on public.guest_push_subscriptions from anon, authenticated;

alter table public.push_deliveries alter column user_id drop not null;
alter table public.push_deliveries add column reservation_id uuid references public.reservations (id) on delete cascade;
alter table public.push_deliveries add constraint push_deliveries_target check (user_id is not null or reservation_id is not null);

create function public.guest_push_subscribe(token text, ep text, key_p256dh text, key_auth text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  insert into public.guest_push_subscriptions (organization_id, reservation_id, endpoint, p256dh, auth)
  values (r.organization_id, r.id, ep, key_p256dh, key_auth)
  on conflict (endpoint) do update set organization_id = excluded.organization_id, reservation_id = excluded.reservation_id,
    p256dh = excluded.p256dh, auth = excluded.auth, disabled_at = null, last_error = null;
  return jsonb_build_object('status', 'ok');
end $$;

create function public.guest_push_unsubscribe(token text, ep text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  delete from public.guest_push_subscriptions where reservation_id = r.id and endpoint = ep;
  return jsonb_build_object('status', 'ok');
end $$;

-- Ce navigateur est-il inscrit pour ce séjour ? (aucune autre information)
create function public.guest_push_state(token text, ep text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  return jsonb_build_object('status', 'ok', 'subscribed', exists (select 1 from public.guest_push_subscriptions where reservation_id = r.id and endpoint = ep and disabled_at is null));
end $$;
revoke all on function public.guest_push_subscribe(text, text, text, text), public.guest_push_unsubscribe(text, text), public.guest_push_state(text, text) from public;
grant execute on function public.guest_push_subscribe(text, text, text, text), public.guest_push_unsubscribe(text, text), public.guest_push_state(text, text) to anon, authenticated;

-- Notification du voyageur : sans adresse e-mail mais avec un appareil inscrit, elle passe quand même par la file
-- (destinataire technique en .invalid : aucun e-mail possible, le push seul est tenté).
create or replace function public.queue_guest_email(r public.reservations, tpl text, data jsonb, service uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if r.guest_email is not null then
    perform public.outbox_insert(r.organization_id, r.guest_email, r.guest_locale, tpl, data, service, r.id, null);
    return true;
  end if;
  if public.push_category(tpl) = 'guest_update' and exists (select 1 from public.guest_push_subscriptions where reservation_id = r.id and disabled_at is null) then
    insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id, incident_id)
    values (r.organization_id, 'voyageur-' || left(r.id::text, 8) || '@push.invalid', coalesce(r.guest_locale, 'fr'), tpl, data, service, r.id, null);
  end if;
  return false;
end $$;

-- Canaux d'une notification préparée (serveur) : membre (compte) ou voyageur (séjour)
create or replace function public.outbox_channels(outbox uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.notification_outbox; uid uuid; cat text;
begin
  select * into o from public.notification_outbox where id = outbox;
  if o.id is null then return null; end if;
  cat := public.push_category(o.template);
  if cat = 'guest_update' then
    return jsonb_build_object(
      'reservation_id', o.reservation_id, 'category', cat,
      'email', o.recipient !~* '@push\.invalid$', 'email_reason', 'no_guest_email',
      'push_done', exists (select 1 from public.push_deliveries d where d.outbox_id = o.id),
      'push', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'guest', true))
                          from public.guest_push_subscriptions s where s.reservation_id = o.reservation_id and s.disabled_at is null), '[]'::jsonb));
  end if;
  select ms.user_id into uid from public.memberships ms join auth.users u on u.id = ms.user_id
   where ms.organization_id = o.organization_id and ms.is_active and lower(u.email) = lower(o.recipient) limit 1;
  if uid is null then return jsonb_build_object('email', true, 'push', '[]'::jsonb); end if;
  return jsonb_build_object(
    'user_id', uid, 'category', cat,
    'email', public.wants_email_channel(o.organization_id, uid, o.template, coalesce((o.payload ->> 'critical')::boolean, false)),
    'email_reason', 'email_off_by_user',
    'push_done', exists (select 1 from public.push_deliveries d where d.outbox_id = o.id),
    'push', case when public.wants_push_channel(o.organization_id, uid, o.template) then
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                  from public.push_subscriptions s where s.user_id = uid and s.disabled_at is null), '[]'::jsonb)
      else '[]'::jsonb end);
end $$;

-- =================================================================================================================
-- C. Dépassement : rappel à l'agent à la fin estimée, information du responsable après le délai de l'organisation.
--    Lancé par le serveur (tâche planifiée et à chaque traitement de la file). Mêmes règles que l'écran
--    (src/lib/engine/overrun.ts) ; un seul rappel par échéance ; rien pour une mission terminée, annulée ou réattribuée.
-- =================================================================================================================
alter table public.tasks add column overrun_reminded_at timestamptz, add column overrun_alerted_at timestamptz;

create function public.overrun_sweep() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t record; n_agent int := 0; n_team int := 0; pname text;
begin
  for t in
    select k.*, o.overrun_alert_min,
           k.started_at + make_interval(mins => k.duration_min) as due,
           case when k.overrun_ack_at is not null and k.overrun_ack_at >= k.started_at + make_interval(mins => k.duration_min)
                then k.overrun_ack_at else k.started_at + make_interval(mins => k.duration_min) end as ref
      from public.tasks k join public.organizations o on o.id = k.organization_id
     where k.status = 'in_progress' and k.started_at is not null and k.duration_min > 0 and k.assignee_id is not null
       and k.started_at + make_interval(mins => k.duration_min) <= now()
     for update of k skip locked
  loop
    select name into pname from public.properties where organization_id = t.organization_id and id = t.property_id;
    -- Rappel à l'agent : à la fin estimée, puis 30 min après chaque « je continue »
    if t.overrun_reminded_at is null or t.overrun_reminded_at < (case when t.ref > t.due then t.ref + interval '30 minutes' else t.due end) then
      if (case when t.ref > t.due then t.ref + interval '30 minutes' else t.due end) <= now() then
        perform public.queue_member_email(t.organization_id, t.assignee_id, 'agent_task_overrun',
          jsonb_build_object('kind', t.type, 'property', pname, 'path', '/app/missions/' || t.id));
        update public.tasks set overrun_reminded_at = now() where id = t.id;
        n_agent := n_agent + 1;
      end if;
    end if;
    -- Information du responsable : sans réponse de l'agent après le délai réglé par l'organisation
    if now() > t.ref + make_interval(mins => t.overrun_alert_min) and (t.overrun_alerted_at is null or t.overrun_alerted_at < t.ref) then
      perform public.queue_team_email(t.organization_id, 'team_task_overrun',
        jsonb_build_object('kind', t.type, 'property', pname, 'member', (select full_name from public.profiles where id = t.assignee_id),
                           'path', '/app/missions/' || t.id), null, null, null);
      update public.tasks set overrun_alerted_at = now() where id = t.id;
      n_team := n_team + 1;
    end if;
  end loop;
  return jsonb_build_object('agent', n_agent, 'team', n_team);
end $$;
revoke all on function public.overrun_sweep() from public, anon, authenticated;
grant execute on function public.overrun_sweep() to service_role;

-- =================================================================================================================
-- D. Blanchisseur : « prêt » facultatif, reprise anticipée, écart traité, notification utile au responsable
-- =================================================================================================================
alter table public.laundry_order_events drop constraint laundry_order_events_kind_check;
alter table public.laundry_order_events add constraint laundry_order_events_kind_check
  check (kind in ('sent', 'received', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'discrepancy', 'note', 'gap_resolved'));
alter table public.laundry_order_lines add column qty_resolved int not null default 0 check (qty_resolved >= 0);

create or replace function public.laundry_order_advance(oid uuid, to_status text, lines jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.laundry_orders; l record; got int; gaps jsonb := '[]'::jsonb; allowed text[];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into o from public.laundry_orders where id = oid for update;
  if o.id is null or not exists (select 1 from public.laundry_partner_members m join public.laundry_partners p on p.id = m.partner_id and p.active
                                  where m.partner_id = o.partner_id and m.user_id = uid and m.revoked_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Étapes possibles : reçu → en traitement → (prêt, facultatif) → en livraison
  allowed := case o.status when 'sent' then array['received'] when 'received' then array['processing']
                           when 'processing' then array['ready', 'out_for_delivery'] when 'ready' then array['out_for_delivery'] else array[]::text[] end;
  -- Action répétée (double appui, renvoi hors ligne) ou étape déjà dépassée : rien n'est réécrit
  if not (to_status = any (allowed)) then return jsonb_build_object('status', 'stale', 'current', o.status); end if;
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
    perform public.queue_team_email(o.organization_id, 'team_laundry_gap', jsonb_build_object('reference', o.reference, 'stage', to_status, 'path', '/app/linen'), null, null, null);
  elsif to_status = 'out_for_delivery' then
    -- Linge en route : le responsable sait qu'il y a une réception à confirmer
    perform public.queue_team_email(o.organization_id, 'team_laundry_update', jsonb_build_object('reference', o.reference, 'stage', to_status, 'path', '/app/linen'), null, null, null);
  end if;
  return jsonb_build_object('status', 'applied', 'gaps', gaps);
end $$;

-- Réception confirmée : aussi possible avant la fin du traitement (reprise anticipée : le linge revient au SALE).
create or replace function public.laundry_order_confirm(org uuid, oid uuid, lines jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.laundry_orders; l record; got int; gaps jsonb := '[]'::jsonb; dest text;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into o from public.laundry_orders where organization_id = org and id = oid for update;
  if o.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status not in ('received', 'processing', 'ready', 'out_for_delivery') then return jsonb_build_object('status', 'stale', 'current', o.status); end if;
  dest := case when o.status in ('ready', 'out_for_delivery') then 'clean' else 'dirty' end;
  for l in select * from public.laundry_order_lines where order_id = oid loop
    got := (select (x ->> 'qty')::int from jsonb_array_elements(lines) x where (x ->> 'item')::uuid = l.item_id limit 1);
    if got is null or got < 0 or got > l.qty_sent then raise exception 'invalid' using errcode = '22023'; end if;
    update public.laundry_order_lines set qty_confirmed = got where order_id = oid and item_id = l.item_id;
    if got > 0 then perform public.linen_move(org, l.item_id, 'laundry', dest, got, 'from_laundry', 'Réception ' || o.reference, null, null); end if;
    if got <> l.qty_sent or (l.qty_returned is not null and got <> l.qty_returned) then
      gaps := gaps || jsonb_build_object('item', l.item_id, 'sent', l.qty_sent, 'returned', l.qty_returned, 'confirmed', got);
    end if;
  end loop;
  update public.laundry_orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = oid;
  insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, note, data)
  values (org, oid, 'delivered', (select auth.uid()), 'concierge', nullif(left(trim(coalesce(p_note, '')), 500), ''),
          jsonb_build_object('to', dest) || case when jsonb_array_length(gaps) > 0 then jsonb_build_object('gaps', gaps) else '{}'::jsonb end);
  if jsonb_array_length(gaps) > 0 then
    insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, data) values (org, oid, 'discrepancy', (select auth.uid()), 'concierge', jsonb_build_object('gaps', gaps, 'stage', 'confirm'));
  end if;
  return jsonb_build_object('status', 'applied', 'gaps', gaps, 'to', dest);
end $$;

-- Écart traité par le responsable : le linge manquant est « perdu » (sort du stock) ou « retrouvé » (passe au propre).
-- Jamais plus que le manque restant ; une seconde demande identique ne retire rien de plus.
create function public.laundry_gap_resolve(org uuid, oid uuid, item uuid, qty int, outcome text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.laundry_orders; l public.laundry_order_lines; open_gap int;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if outcome not in ('lost', 'found') or qty is null or qty <= 0 then raise exception 'invalid' using errcode = '22023'; end if;
  select * into o from public.laundry_orders where organization_id = org and id = oid for update;
  if o.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if o.status <> 'delivered' then return jsonb_build_object('status', 'stale', 'current', o.status); end if;
  select * into l from public.laundry_order_lines where order_id = oid and item_id = item for update;
  if l.order_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  open_gap := l.qty_sent - coalesce(l.qty_confirmed, 0) - l.qty_resolved;
  if qty > open_gap then return jsonb_build_object('status', 'stale', 'open', open_gap); end if;
  if outcome = 'lost' then
    perform public.linen_move(org, item, 'laundry', null, qty, 'loss', 'Écart ' || o.reference, null, null);
  else
    perform public.linen_move(org, item, 'laundry', 'clean', qty, 'from_laundry', 'Écart retrouvé ' || o.reference, null, null);
  end if;
  update public.laundry_order_lines set qty_resolved = qty_resolved + qty where order_id = oid and item_id = item;
  insert into public.laundry_order_events (organization_id, order_id, kind, actor_id, actor_side, note, data)
  values (org, oid, 'gap_resolved', (select auth.uid()), 'concierge', nullif(left(trim(coalesce(p_note, '')), 500), ''),
          jsonb_build_object('item', item, 'qty', qty, 'outcome', outcome));
  return jsonb_build_object('status', 'applied', 'open', open_gap - qty);
end $$;
revoke all on function public.laundry_gap_resolve(uuid, uuid, uuid, int, text, text) from public, anon;
grant execute on function public.laundry_gap_resolve(uuid, uuid, uuid, int, text, text) to authenticated;

-- Côté blanchisseur : auteur de chaque étape (nom de l'invitation nominative), pour l'historique de la conciergerie
create function public.laundry_actor_names(org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_manager(org) then coalesce((select jsonb_object_agg(i.accepted_by, i.contact_name)
    from public.laundry_invites i where i.organization_id = org and i.accepted_by is not null), '{}'::jsonb) else '{}'::jsonb end;
$$;
revoke all on function public.laundry_actor_names(uuid) from public, anon;
grant execute on function public.laundry_actor_names(uuid) to authenticated;

-- =================================================================================================================
-- E. Réattribuer une mission EN COURS (agent indisponible, imprévu) : motif obligatoire, historique, le nouvel agent
--    redémarre la mission ; l'ancien agent est prévenu et toute réponse tardive de sa part est ignorée (« stale »).
-- =================================================================================================================
alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'assigned', 'unassigned', 'started', 'submitted', 'validated', 'auto_validated',
                  'correction_requested', 'cancelled', 'status_changed', 'window_changed', 'early_start_allowed', 'started_early', 'resubmitted',
                  'overrun_continue', 'end_proposed', 'end_accepted', 'end_rejected', 'end_regularized', 'auto_restored', 'reassigned'));

create function public.reassign_started_task(org uuid, task uuid, member uuid, reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; why text := nullif(left(trim(coalesce(reason, '')), 1000), ''); pname text;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if why is null or length(why) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into t from public.tasks where organization_id = org and id = task for update;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if t.status <> 'in_progress' then return 'stale'; end if;
  if member is null or member = t.assignee_id or not exists (select 1 from public.memberships where organization_id = org and user_id = member and is_active) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  perform set_config('halo.event', 'reassigned', true);
  perform set_config('halo.reason', why, true);
  update public.tasks set assignee_id = member, status = 'assigned', started_at = null, overrun_ack_at = null,
    overrun_reminded_at = null, overrun_alerted_at = null,
    end_proposal_status = case when end_proposal_status = 'pending' then 'superseded' else end_proposal_status end
  where id = t.id;
  perform set_config('halo.event', '', true);
  perform set_config('halo.reason', '', true);
  insert into public.task_events (organization_id, task_id, kind, from_status, to_status, actor_id, note)
  values (org, task, 'reassigned', 'in_progress', 'assigned', (select auth.uid()), why);
  select name into pname from public.properties where organization_id = org and id = t.property_id;
  perform public.queue_member_email(org, t.assignee_id, 'agent_task_changed',
    jsonb_build_object('kind', t.type, 'property', pname, 'reassigned', true, 'path', '/app/missions/' || t.id));
  return 'applied';
end $$;
revoke all on function public.reassign_started_task(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.reassign_started_task(uuid, uuid, uuid, text) to authenticated;
