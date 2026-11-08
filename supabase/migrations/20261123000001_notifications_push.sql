-- Migration 28 : notifications push (préparées, inactives tant que les clés VAPID ne sont pas configurées).
--
-- Principes :
--  * un appareil n'est inscrit QUE par la personne elle-même, depuis cet appareil (aucune inscription pour autrui) ;
--  * chaque personne choisit, événement par événement, l'e-mail et/ou le push (préférences existantes, colonne push) ;
--  * seuls 5 types d'événements peuvent produire un push : mission assignée ou modifiée, correction demandée,
--    message urgent, incident, demande voyageur à traiter ;
--  * chaque tentative est journalisée avec son résultat RÉEL (transmise au service du téléphone, échec, appareil
--    expiré, non configuré) : jamais « reçue », HALO ne peut pas le savoir ;
--  * contenu du push volontairement neutre (catégorie + logement) : rien sur le voyageur sur l'écran verrouillé.

-- 1. Préférence push par événement (par défaut : oui, dès qu'un appareil est inscrit)
alter table public.notification_prefs add column push boolean not null default true;

-- Événements pouvant produire un push → catégorie affichée
create function public.push_category(tpl text) returns text
language sql immutable set search_path = '' as $$
  select case
    when tpl in ('agent_task_assigned', 'agent_task_changed') then 'mission'
    when tpl = 'agent_correction_requested' then 'correction'
    when tpl = 'chat_urgent' then 'urgent_message'
    when tpl in ('team_agent_blocker', 'team_guest_problem') then 'incident'
    when tpl in ('team_service_requested', 'team_guest_message', 'team_vip_requested', 'team_booking_requested') then 'guest_request'
  end;
$$;
revoke all on function public.push_category(text) from public, anon;

create function public.set_push_pref(org uuid, ev text, by_push boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if public.push_category(case when ev = 'chat_message' then 'chat_urgent' else ev end) is null then raise exception 'invalid' using errcode = '22023'; end if;
  insert into public.notification_prefs (organization_id, user_id, event, email, push)
  values (org, (select auth.uid()), ev, true, by_push)
  on conflict (organization_id, user_id, event) do update set push = excluded.push, updated_at = now();
end $$;
revoke all on function public.set_push_pref(uuid, text, boolean) from public, anon;
grant execute on function public.set_push_pref(uuid, text, boolean) to authenticated;

-- 2. Appareils inscrits (un par navigateur / application installée)
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  label text check (length(label) <= 80),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  disabled_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id) where disabled_at is null;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, user_id, label, created_at, last_success_at, last_error, last_error_at, disabled_at) on public.push_subscriptions to authenticated;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

-- Inscription : uniquement pour soi ; un même appareil réinscrit change de propriétaire (changement de compte sur le téléphone)
create function public.push_subscribe(ep text, key_p256dh text, key_auth text, device text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); sid uuid;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not exists (select 1 from public.memberships where user_id = uid and is_active) then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (uid, ep, key_p256dh, key_auth, left(device, 80))
  on conflict (endpoint) do update set user_id = uid, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label,
    disabled_at = null, last_error = null, last_error_at = null
  returning id into sid;
  return sid;
end $$;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;

create function public.push_unsubscribe(ep text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = ep and user_id = (select auth.uid());
$$;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- 3. Journal des envois push (résultat réel, consultable par la personne concernée)
create table public.push_deliveries (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  outbox_id uuid,
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  category text not null,
  status text not null check (status in ('accepted', 'failed', 'expired', 'not_configured')),
  error text,
  created_at timestamptz not null default now()
);
create index push_deliveries_outbox on public.push_deliveries (outbox_id);
create index push_deliveries_user on public.push_deliveries (user_id, created_at desc);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
grant select on public.push_deliveries to authenticated;
create policy push_deliveries_own on public.push_deliveries for select to authenticated using (user_id = (select auth.uid()));

-- 4. Préférences par canal. wants_email garde son rôle (faut-il préparer une notification ?) : vrai si l'e-mail
--    OU le push est voulu ; l'envoi vérifie ensuite chaque canal séparément.
create function public.wants_email_channel(org uuid, member uuid, tpl text, critical boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select critical or coalesce((select email from public.notification_prefs
                               where organization_id = org and user_id = member
                                 and event = case when tpl = 'chat_urgent' then 'chat_message' else tpl end), true);
$$;
revoke all on function public.wants_email_channel(uuid, uuid, text, boolean) from public, anon, authenticated;

create function public.wants_push_channel(org uuid, member uuid, tpl text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.push_category(tpl) is not null
     and exists (select 1 from public.push_subscriptions s where s.user_id = member and s.disabled_at is null)
     and coalesce((select push from public.notification_prefs
                   where organization_id = org and user_id = member
                     and event = case when tpl = 'chat_urgent' then 'chat_message' else tpl end), true);
$$;
revoke all on function public.wants_push_channel(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.wants_email(org uuid, member uuid, tpl text, critical boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.wants_email_channel(org, member, tpl, critical) or public.wants_push_channel(org, member, tpl);
$$;

-- Destinataire d'une notification préparée : canaux réellement voulus et appareils à prévenir (service d'envoi seulement)
create function public.outbox_channels(outbox uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.notification_outbox; uid uuid;
begin
  select * into o from public.notification_outbox where id = outbox;
  if o.id is null then return null; end if;
  select ms.user_id into uid from public.memberships ms join auth.users u on u.id = ms.user_id
   where ms.organization_id = o.organization_id and ms.is_active and lower(u.email) = lower(o.recipient) limit 1;
  if uid is null then return jsonb_build_object('email', true, 'push', '[]'::jsonb); end if;
  return jsonb_build_object(
    'user_id', uid,
    'category', public.push_category(o.template),
    'email', public.wants_email_channel(o.organization_id, uid, o.template, coalesce((o.payload ->> 'critical')::boolean, false)),
    'push_done', exists (select 1 from public.push_deliveries d where d.outbox_id = o.id),
    'push', case when public.wants_push_channel(o.organization_id, uid, o.template) then
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                  from public.push_subscriptions s where s.user_id = uid and s.disabled_at is null), '[]'::jsonb)
      else '[]'::jsonb end);
end $$;
revoke all on function public.outbox_channels(uuid) from public, anon, authenticated;
grant execute on function public.outbox_channels(uuid) to service_role;

-- Statut « skipped » déjà prévu : e-mail coupé par la personne, push seul
comment on table public.push_deliveries is 'Push : « accepted » = accepté par le service de notification du téléphone (Apple, Google, Mozilla), pas « lu » ni « reçu ».';
