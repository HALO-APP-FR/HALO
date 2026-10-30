-- =====================================================================
-- Brief du 30/10 au soir (migration 12) :
--  A2. Lieux : « vérifié » seulement après une confirmation explicite (date + personne), remise à zéro
--      si une information importante change.
--  A5. Créneau modifié d'une mission affectée qui touche une absence : conflit signalé (jamais silencieux).
--  B.  Accès voyageur AVANT la fenêtre habituelle (préparation uniquement), questionnaire « Préparons votre
--      séjour », espace « Préparation du séjour » (statut, actions, éléments publiés), historique.
--  C.  VIP : critères par organisation, demandes du voyageur, statut vérifié par la conciergerie, historique.
--  Prestations : statut « en cours d'étude » et types « ménage / linge supplémentaire », « formule premium ».
-- Uniquement des ajouts ou remplacements de fonctions ; retour arrière décrit dans docs/16.
-- =====================================================================

-- A2. Vérification explicite des lieux ---------------------------------------
alter table public.property_places
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users (id) on delete set null;

-- Information importante modifiée : la vérification doit être renouvelée
create function public.place_reset_verification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.verified_at is not distinct from old.verified_at and (
     new.name is distinct from old.name or new.address is distinct from old.address or new.category is distinct from old.category
     or new.opening_hours is distinct from old.opening_hours or new.phone is distinct from old.phone or new.website is distinct from old.website
     or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude) then
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end $$;
revoke all on function public.place_reset_verification() from public, anon, authenticated;
create trigger property_places_reset_verification before update on public.property_places
  for each row execute function public.place_reset_verification();

create function public.verify_place(org uuid, place uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare at timestamptz := now();
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.property_places set verified_at = at, verified_by = (select auth.uid())
   where organization_id = org and id = place;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return at;
end $$;
revoke all on function public.verify_place(uuid, uuid) from public, anon;
grant execute on function public.verify_place(uuid, uuid) to authenticated;

-- A5. Créneau d'une mission affectée déplacé sur une absence : conflit signalé ----------------
create function public.task_window_conflict() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is null or new.status in ('done', 'validated', 'cancelled') or new.assignee_id is distinct from old.assignee_id then return new; end if;
  if (new.window_start, new.window_end, new.duration_min) is not distinct from (old.window_start, old.window_end, old.duration_min) then return new; end if;
  if public.task_slot_overlaps_absence(new.organization_id, new.assignee_id, new.window_start, new.window_end, new.scheduled_start, new.duration_min)
     and not public.task_slot_overlaps_absence(old.organization_id, old.assignee_id, old.window_start, old.window_end, old.scheduled_start, old.duration_min) then
    perform public.queue_team_email(new.organization_id, 'team_assignment_conflict',
      jsonb_build_object('member', (select full_name from public.profiles where id = new.assignee_id), 'count', 1, 'path', '/app/missions/' || new.id), null, null, null);
  end if;
  return new;
end $$;
revoke all on function public.task_window_conflict() from public, anon, authenticated;
create trigger tasks_window_conflict after update of window_start, window_end, duration_min on public.tasks
  for each row execute function public.task_window_conflict();

-- Prestations : « en cours d'étude », nouveaux types -----------------------------------------
alter table public.service_requests drop constraint service_requests_status_check;
alter table public.service_requests add constraint service_requests_status_check
  check (status in ('requested', 'in_review', 'info_requested', 'confirmed', 'declined', 'done', 'cancelled'));
alter table public.service_requests drop constraint service_requests_kind_check;
alter table public.service_requests add constraint service_requests_kind_check
  check (kind in ('private_chef', 'restaurant', 'driver', 'airport_transfer', 'grocery', 'spa', 'babysitter', 'experience', 'flowers',
                  'extra_cleaning', 'extra_linen', 'premium_package', 'other'));

create or replace function public.decide_service(org uuid, service uuid, new_status text, guest_message text default null, internal_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.service_requests; r public.reservations; uid uuid := (select auth.uid()); msg text := nullif(trim(coalesce(guest_message, '')), ''); emailed boolean := false;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into s from public.service_requests where organization_id = org and id = service for update;
  if s.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.status = new_status then return jsonb_build_object('status', 'ok', 'email_queued', false, 'replayed', true); end if;
  if not (
    (s.status in ('requested', 'in_review', 'info_requested') and new_status in ('in_review', 'confirmed', 'declined', 'info_requested', 'cancelled'))
    or (s.status = 'confirmed' and new_status in ('done', 'cancelled'))
  ) then
    return jsonb_build_object('status', 'conflict', 'current', s.status);
  end if;
  if new_status = 'info_requested' and msg is null then raise exception 'question_required' using errcode = '22023'; end if;
  update public.service_requests set status = new_status, manager_unread = false, guest_unread = true where id = s.id;
  insert into public.service_events (organization_id, service_id, kind, status, body, visibility, author_kind, author_id)
  values (org, s.id, 'status', new_status, msg, 'guest', 'member', uid);
  if nullif(trim(coalesce(internal_note, '')), '') is not null then
    insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind, author_id)
    values (org, s.id, 'internal_note', left(trim(internal_note), 2000), 'internal', 'member', uid);
  end if;
  -- « en cours d'étude » : visible dans l'espace voyageur, pas d'e-mail
  if s.reservation_id is not null and new_status <> 'in_review' then
    select * into r from public.reservations where organization_id = org and id = s.reservation_id;
    emailed := public.queue_guest_email(r, 'service_' || new_status, jsonb_build_object('kind', s.kind, 'start_at', s.start_at, 'message', msg), s.id);
  end if;
  return jsonb_build_object('status', 'ok', 'email_queued', emailed);
end $$;

-- B. Accès avant arrivée -----------------------------------------------------------------
-- Lien du séjour : la fenêtre habituelle (72 h avant l'arrivée → départ) donne tout l'espace ;
-- AVANT cette fenêtre, le même lien ne donne que la préparation (dates, demandes, questionnaire,
-- messages, éléments publiés) : ni adresse détaillée, ni Wi-Fi, ni livret, ni signalement.
create function public.guest_link_any(token text) returns public.reservations
language plpgsql stable security definer set search_path = '' as $$
declare l public.guest_links; r public.reservations;
begin
  if token is null or length(token) <> 64 or token !~ '^[0-9a-f]+$' then return null; end if;
  select * into l from public.guest_links where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  if l.id is null or l.revoked_at is not null or now() >= l.valid_until then return null; end if;
  select * into r from public.reservations where organization_id = l.organization_id and id = l.reservation_id;
  if r.status <> 'confirmed' then return null; end if;
  return r;
end $$;
revoke all on function public.guest_link_any(text) from public, anon, authenticated;

-- Séjour modifié : le lien suit les nouvelles dates ; séjour annulé : le lien est révoqué
create function public.guest_links_follow_stay() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'confirmed' and old.status = 'confirmed' then
    update public.guest_links set revoked_at = now(), revoke_reason = 'stay_cancelled'
     where organization_id = new.organization_id and reservation_id = new.id and revoked_at is null;
    update public.stay_preparations set prep_status = 'cancelled', prep_updated_at = now()
     where organization_id = new.organization_id and reservation_id = new.id;
  elsif new.check_in_at is distinct from old.check_in_at or new.check_out_at is distinct from old.check_out_at then
    update public.guest_links set valid_from = new.check_in_at - interval '72 hours', valid_until = new.check_out_at
     where organization_id = new.organization_id and reservation_id = new.id and revoked_at is null and new.check_out_at > now();
  end if;
  return new;
end $$;
revoke all on function public.guest_links_follow_stay() from public, anon, authenticated;

-- Préparation du séjour
create table public.stay_preparations (
  organization_id uuid not null,
  reservation_id uuid not null,
  questionnaire_status text not null default 'not_started' check (questionnaire_status in ('not_started', 'opened', 'in_progress', 'submitted')),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  opened_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  guest_updated_at timestamptz,
  needs_review boolean not null default false,
  prep_status text not null default 'to_prepare' check (prep_status in ('to_prepare', 'in_progress', 'waiting_guest', 'ready', 'cancelled')),
  prep_updated_by uuid references auth.users (id) on delete set null,
  prep_updated_at timestamptz,
  invite_sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, reservation_id),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade
);
create trigger reservations_links_follow after update on public.reservations for each row execute function public.guest_links_follow_stay();

create table public.stay_prep_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  kind text not null default 'other' check (kind in ('task', 'service', 'info', 'message', 'vip', 'other')),
  assignee_id uuid,
  due_at timestamptz,
  -- Action indispensable : tant qu'elle est ouverte, l'arrivée n'est pas « prête »
  blocking boolean not null default false,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  task_id uuid,
  service_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (organization_id, assignee_id) references public.memberships (organization_id, user_id) on delete set null (assignee_id),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete set null (task_id),
  foreign key (organization_id, service_id) references public.service_requests (organization_id, id) on delete set null (service_id)
);
create index stay_prep_actions_idx on public.stay_prep_actions (organization_id, reservation_id, status);

-- Éléments préparés pour le voyageur : visibles par lui seulement une fois publiés
alter table public.property_places add constraint property_places_org_id_key unique (organization_id, id);
create table public.stay_guest_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_id uuid not null,
  kind text not null check (kind in ('recommendation', 'info')),
  place_id uuid,
  title text not null check (length(trim(title)) between 1 and 160),
  body text check (length(body) <= 1000),
  url text check (length(url) <= 300 and (url is null or url ~ '^https?://')),
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  -- Lieu de la MÊME organisation uniquement (jamais celui d'une autre conciergerie)
  foreign key (organization_id, place_id) references public.property_places (organization_id, id) on delete set null (place_id)
);

create table public.stay_prep_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  reservation_id uuid not null,
  kind text not null check (kind in ('invite_created', 'invite_sent', 'opened', 'guest_saved', 'guest_submitted', 'guest_updated', 'guest_deleted',
                                     'status_changed', 'action_created', 'action_done', 'action_cancelled', 'item_published', 'item_unpublished',
                                     'vip_requested', 'vip_guest_reply', 'vip_info_requested', 'vip_accepted', 'vip_refused', 'vip_granted', 'vip_revoked')),
  actor_id uuid references auth.users (id) on delete set null,
  note text,
  at timestamptz not null default now(),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade
);
create index stay_prep_events_idx on public.stay_prep_events (organization_id, reservation_id, at);

alter table public.organizations add column prep_questions text[] not null
  default array['guests', 'interests', 'style', 'services', 'budget', 'constraints', 'other', 'language'];

-- Droits : responsables uniquement (les agents n'ont pas accès aux séjours) ; voyageur par ses fonctions
alter table public.stay_preparations enable row level security;
alter table public.stay_prep_actions enable row level security;
alter table public.stay_guest_items enable row level security;
alter table public.stay_prep_events enable row level security;
revoke all on public.stay_preparations, public.stay_prep_actions, public.stay_guest_items, public.stay_prep_events from anon;
grant select on public.stay_preparations, public.stay_prep_events to authenticated;
revoke insert, update, delete on public.stay_preparations, public.stay_prep_events from authenticated;
grant select, insert, update, delete on public.stay_prep_actions, public.stay_guest_items to authenticated;
create policy stay_preparations_select on public.stay_preparations for select to authenticated using (public.is_manager(organization_id));
create policy stay_prep_events_select on public.stay_prep_events for select to authenticated using (public.is_manager(organization_id));
create policy stay_prep_actions_all on public.stay_prep_actions for all to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy stay_guest_items_all on public.stay_guest_items for all to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));

-- Historique automatique des actions et publications
create function public.log_prep_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.reservations where organization_id = new.organization_id and id = new.reservation_id) then return new; end if;
  if tg_table_name = 'stay_prep_actions' then
    if tg_op = 'INSERT' then
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (new.organization_id, new.reservation_id, 'action_created', (select auth.uid()), new.title);
    elsif new.status is distinct from old.status and new.status in ('done', 'cancelled') then
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
      values (new.organization_id, new.reservation_id, case when new.status = 'done' then 'action_done' else 'action_cancelled' end, (select auth.uid()), new.title);
    end if;
  elsif tg_table_name = 'stay_guest_items' then
    if (tg_op = 'INSERT' and new.published_at is not null) or (tg_op = 'UPDATE' and new.published_at is not null and old.published_at is null) then
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (new.organization_id, new.reservation_id, 'item_published', (select auth.uid()), new.title);
    elsif tg_op = 'UPDATE' and new.published_at is null and old.published_at is not null then
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (new.organization_id, new.reservation_id, 'item_unpublished', (select auth.uid()), new.title);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.log_prep_change() from public, anon, authenticated;
create trigger stay_prep_actions_log after insert or update on public.stay_prep_actions for each row execute function public.log_prep_change();
create trigger stay_guest_items_log after insert or update on public.stay_guest_items for each row execute function public.log_prep_change();

-- Statut de préparation (responsable)
create function public.set_prep_status(org uuid, reservation uuid, new_status text) returns text
language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if new_status not in ('to_prepare', 'in_progress', 'waiting_guest', 'ready') then raise exception 'invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.reservations where organization_id = org and id = reservation) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.stay_preparations (organization_id, reservation_id) values (org, reservation) on conflict do nothing;
  select prep_status into cur from public.stay_preparations where organization_id = org and reservation_id = reservation for update;
  if cur = 'cancelled' then return 'conflict:cancelled'; end if;
  if cur = new_status then return 'already'; end if;
  -- « Prêt » impossible tant qu'une action indispensable est ouverte
  if new_status = 'ready' and exists (select 1 from public.stay_prep_actions where organization_id = org and reservation_id = reservation and status = 'open' and blocking) then
    return 'blocking_actions';
  end if;
  update public.stay_preparations set prep_status = new_status, prep_updated_by = (select auth.uid()), prep_updated_at = now(), needs_review = false
   where organization_id = org and reservation_id = reservation;
  insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (org, reservation, 'status_changed', (select auth.uid()), new_status);
  return 'applied';
end $$;

-- Invitation envoyée (le lien brut n'est connu qu'au moment de sa création : il part dans l'e-mail)
create function public.record_prep_invite(org uuid, reservation uuid, url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; emailed boolean;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.reservations where organization_id = org and id = reservation;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if url !~ '^https?://[^ ]+/s/[0-9a-f]{64}$' then raise exception 'invalid' using errcode = '22023'; end if;
  insert into public.stay_preparations (organization_id, reservation_id) values (org, reservation) on conflict do nothing;
  -- Le lien brut ne vit dans le journal que le temps de l'envoi (retiré ensuite) ; jamais pour une adresse non distribuable
  emailed := public.queue_guest_email(r, 'prep_invite', jsonb_strip_nulls(jsonb_build_object('url', case when r.guest_email ~* '\.invalid$' then null else url end,
    'property', (select name from public.properties where id = r.property_id))), null);
  if emailed then
    update public.stay_preparations set invite_sent_at = now() where organization_id = org and reservation_id = reservation;
    insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id) values (org, reservation, 'invite_sent', (select auth.uid()));
  end if;
  return jsonb_build_object('email_queued', emailed);
end $$;

-- Questionnaire (voyageur) : réponses contrôlées, aucune information sensible obligatoire
create function public.clean_prep_answers(a jsonb, allowed text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare out jsonb := '{}'::jsonb;
begin
  if 'guests' = any (allowed) then
    if (a ->> 'adults') ~ '^\d{1,2}$' then out := out || jsonb_build_object('adults', least((a ->> 'adults')::int, 30)); end if;
    if (a ->> 'children') ~ '^\d{1,2}$' then out := out || jsonb_build_object('children', least((a ->> 'children')::int, 30)); end if;
    if (a ->> 'babies') ~ '^\d{1,2}$' then out := out || jsonb_build_object('babies', least((a ->> 'babies')::int, 10)); end if;
  end if;
  if 'interests' = any (allowed) and jsonb_typeof(a -> 'interests') = 'array' then
    out := out || jsonb_build_object('interests', coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(a -> 'interests') x
      where x in ('food', 'activities', 'relax', 'culture', 'family', 'nature', 'sport', 'shopping', 'local')), '[]'::jsonb));
  end if;
  if 'style' = any (allowed) and (a ->> 'style') in ('calm', 'discovery', 'family', 'romantic', 'business') then out := out || jsonb_build_object('style', a ->> 'style'); end if;
  if 'services' = any (allowed) and jsonb_typeof(a -> 'services') = 'array' then
    out := out || jsonb_build_object('services', coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(a -> 'services') x
      where x in ('restaurant', 'experience', 'airport_transfer', 'driver', 'grocery', 'extra_cleaning', 'extra_linen', 'private_chef', 'spa', 'babysitter')), '[]'::jsonb));
  end if;
  if 'budget' = any (allowed) and (a ->> 'budget') in ('moderate', 'comfort', 'premium') then out := out || jsonb_build_object('budget', a ->> 'budget'); end if;
  if 'constraints' = any (allowed) and nullif(trim(coalesce(a ->> 'constraints', '')), '') is not null then out := out || jsonb_build_object('constraints', left(trim(a ->> 'constraints'), 1000)); end if;
  if 'other' = any (allowed) and nullif(trim(coalesce(a ->> 'other', '')), '') is not null then out := out || jsonb_build_object('other', left(trim(a ->> 'other'), 1000)); end if;
  if 'language' = any (allowed) and (a ->> 'language') in ('fr', 'en', 'es', 'pt', 'it', 'de') then out := out || jsonb_build_object('language', a ->> 'language'); end if;
  return out;
end $$;

create function public.guest_save_preparation(token text, answers jsonb, submit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; p public.stay_preparations; clean jsonb; allowed text[]; was_submitted boolean;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  -- Modifiable jusqu'à l'arrivée ; ensuite l'équipe a déjà préparé
  if now() >= r.check_in_at then return jsonb_build_object('status', 'locked'); end if;
  select prep_questions into allowed from public.organizations where id = r.organization_id;
  clean := public.clean_prep_answers(coalesce(answers, '{}'::jsonb), allowed);
  insert into public.stay_preparations (organization_id, reservation_id) values (r.organization_id, r.id) on conflict do nothing;
  select * into p from public.stay_preparations where organization_id = r.organization_id and reservation_id = r.id for update;
  if p.prep_status = 'cancelled' then return jsonb_build_object('status', 'unavailable'); end if;
  was_submitted := p.questionnaire_status = 'submitted';
  if p.answers = clean and (not submit or was_submitted) then
    return jsonb_build_object('status', 'ok', 'unchanged', true, 'questionnaire_status', p.questionnaire_status, 'updated_at', p.guest_updated_at);
  end if;
  update public.stay_preparations set answers = clean, guest_updated_at = now(),
    started_at = coalesce(started_at, now()),
    questionnaire_status = case when submit or was_submitted then 'submitted' else 'in_progress' end,
    submitted_at = case when submit and not was_submitted then now() else submitted_at end,
    needs_review = needs_review or submit or was_submitted
   where organization_id = r.organization_id and reservation_id = r.id;
  insert into public.stay_prep_events (organization_id, reservation_id, kind)
  values (r.organization_id, r.id, case when submit and not was_submitted then 'guest_submitted' when was_submitted then 'guest_updated' else 'guest_saved' end);
  if (submit and not was_submitted) or was_submitted then
    perform public.queue_team_email(r.organization_id, case when was_submitted then 'team_prep_updated' else 'team_prep_submitted' end,
      jsonb_build_object('guest', r.guest_name, 'property', (select name from public.properties where id = r.property_id), 'path', '/app/stays/' || r.id),
      null, r.id, null);
  end if;
  return jsonb_build_object('status', 'ok', 'questionnaire_status', case when submit or was_submitted then 'submitted' else 'in_progress' end, 'updated_at', now());
end $$;

-- Le voyageur peut retirer ses réponses
create function public.guest_delete_preparation(token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  update public.stay_preparations set answers = '{}'::jsonb, questionnaire_status = 'not_started', submitted_at = null, started_at = null,
    guest_updated_at = now(), needs_review = false
   where organization_id = r.organization_id and reservation_id = r.id;
  insert into public.stay_prep_events (organization_id, reservation_id, kind) values (r.organization_id, r.id, 'guest_deleted');
  return jsonb_build_object('status', 'ok');
end $$;

-- C. VIP ------------------------------------------------------------------------------------
create table public.vip_criteria (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 120),
  kind text not null check (kind in ('loyalty', 'premium', 'partner', 'manual')),
  -- Fidélité : nombre de séjours confirmés terminés avec la même adresse e-mail (indice, jamais une preuve)
  min_stays int check (min_stays between 1 and 100),
  validity_days int check (validity_days between 1 and 3650),
  -- Toujours une validation humaine : HALO ne dispose pas de données assez fiables pour attribuer seul
  requires_validation boolean not null default true check (requires_validation),
  guest_visible boolean not null default true,
  editable_by text not null default 'manager' check (editable_by in ('owner', 'manager')),
  active boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create table public.vip_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_id uuid not null,
  criterion_id uuid,
  note text check (length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'info_requested', 'accepted', 'refused', 'cancelled')),
  guest_message text check (length(guest_message) <= 1000),
  internal_note text check (length(internal_note) <= 1000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (organization_id, criterion_id) references public.vip_criteria (organization_id, id) on delete set null (criterion_id)
);
create unique index vip_requests_open_idx on public.vip_requests (organization_id, reservation_id) where status in ('pending', 'info_requested');
create table public.stay_vip (
  organization_id uuid not null,
  reservation_id uuid not null,
  status text not null check (status in ('active', 'revoked')),
  criterion_id uuid,
  reason text check (length(reason) <= 500),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  primary key (organization_id, reservation_id),
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete cascade,
  foreign key (organization_id, criterion_id) references public.vip_criteria (organization_id, id) on delete set null (criterion_id)
);
alter table public.vip_criteria enable row level security;
alter table public.vip_requests enable row level security;
alter table public.stay_vip enable row level security;
revoke all on public.vip_criteria, public.vip_requests, public.stay_vip from anon;
grant select on public.vip_criteria, public.vip_requests, public.stay_vip to authenticated;
grant insert, update, delete on public.vip_criteria to authenticated;
revoke insert, update, delete on public.vip_requests, public.stay_vip from authenticated;
create policy vip_criteria_select on public.vip_criteria for select to authenticated using (public.is_manager(organization_id));
create policy vip_criteria_insert on public.vip_criteria for insert to authenticated with check (public.is_manager(organization_id));
create policy vip_criteria_update on public.vip_criteria for update to authenticated
  using (public.is_manager(organization_id) and (editable_by = 'manager' or public.has_role(organization_id, array['owner']::public.member_role[])))
  with check (public.is_manager(organization_id) and (editable_by = 'manager' or public.has_role(organization_id, array['owner']::public.member_role[])));
create policy vip_criteria_delete on public.vip_criteria for delete to authenticated
  using (public.is_manager(organization_id) and (editable_by = 'manager' or public.has_role(organization_id, array['owner']::public.member_role[])));
create policy vip_requests_select on public.vip_requests for select to authenticated using (public.is_manager(organization_id));
create policy stay_vip_select on public.stay_vip for select to authenticated using (public.is_manager(organization_id));

-- Statut effectif : actif et non expiré ; synchronisé avec reservations.vip (préparation renforcée des missions)
create function public.sync_reservation_vip(org uuid, reservation uuid) returns void
language sql security definer set search_path = '' as $$
  update public.reservations set vip = exists (select 1 from public.stay_vip v where v.organization_id = org and v.reservation_id = reservation
                                                and v.status = 'active' and (v.expires_at is null or v.expires_at > now()))
   where organization_id = org and id = reservation;
$$;
revoke all on function public.sync_reservation_vip(uuid, uuid) from public, anon, authenticated;

create function public.guest_request_vip(token text, criterion uuid, note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; prev public.vip_requests; rid uuid;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  select * into prev from public.vip_requests where organization_id = r.organization_id and reservation_id = r.id and status in ('pending', 'info_requested');
  if prev.id is not null then return jsonb_build_object('status', 'ok', 'replayed', true, 'request', prev.id); end if;
  if criterion is not null and not exists (select 1 from public.vip_criteria where organization_id = r.organization_id and id = criterion and active and guest_visible) then
    criterion := null;
  end if;
  insert into public.vip_requests (organization_id, reservation_id, criterion_id, note)
  values (r.organization_id, r.id, criterion, nullif(left(trim(coalesce(note, '')), 300), ''))
  returning id into rid;
  insert into public.stay_prep_events (organization_id, reservation_id, kind) values (r.organization_id, r.id, 'vip_requested');
  perform public.queue_team_email(r.organization_id, 'team_vip_requested',
    jsonb_build_object('guest', r.guest_name, 'property', (select name from public.properties where id = r.property_id), 'path', '/app/stays/' || r.id),
    null, r.id, null);
  return jsonb_build_object('status', 'ok', 'replayed', false, 'request', rid);
end $$;

create function public.guest_reply_vip(token text, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; q public.vip_requests;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if length(trim(coalesce(message, ''))) = 0 then return jsonb_build_object('status', 'empty'); end if;
  select * into q from public.vip_requests where organization_id = r.organization_id and reservation_id = r.id and status = 'info_requested' for update;
  if q.id is null then return jsonb_build_object('status', 'conflict'); end if;
  update public.vip_requests set status = 'pending', note = left(coalesce(note || E'\n', '') || trim(message), 300) where id = q.id;
  insert into public.stay_prep_events (organization_id, reservation_id, kind, note) values (r.organization_id, r.id, 'vip_guest_reply', left(trim(message), 300));
  perform public.queue_team_email(r.organization_id, 'team_vip_requested',
    jsonb_build_object('guest', r.guest_name, 'property', (select name from public.properties where id = r.property_id), 'path', '/app/stays/' || r.id),
    null, r.id, null);
  return jsonb_build_object('status', 'ok');
end $$;

-- Décision du responsable (accepter / refuser / demander une précision). Rejouer = sans effet.
create function public.decide_vip(org uuid, request uuid, decision text, criterion uuid default null, expires timestamptz default null,
                                  guest_msg text default null, internal text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare q public.vip_requests; r public.reservations; uid uuid := (select auth.uid());
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into q from public.vip_requests where organization_id = org and id = request for update;
  if q.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if q.status not in ('pending', 'info_requested') then
    return case when q.status = case decision when 'accept' then 'accepted' when 'refuse' then 'refused' else 'info_requested' end then 'already' else 'conflict:' || q.status end;
  end if;
  if decision = 'info' then
    if nullif(trim(coalesce(guest_msg, '')), '') is null then raise exception 'question_required' using errcode = '22023'; end if;
    update public.vip_requests set status = 'info_requested', guest_message = left(trim(guest_msg), 1000), internal_note = coalesce(nullif(left(trim(coalesce(internal, '')), 1000), ''), internal_note) where id = q.id;
    insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id) values (org, q.reservation_id, 'vip_info_requested', uid);
  elsif decision = 'accept' then
    if coalesce(criterion, q.criterion_id) is null and nullif(trim(coalesce(internal, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
    update public.vip_requests set status = 'accepted', criterion_id = coalesce(criterion, q.criterion_id), guest_message = nullif(left(trim(coalesce(guest_msg, '')), 1000), ''),
      internal_note = nullif(left(trim(coalesce(internal, '')), 1000), ''), decided_by = uid, decided_at = now() where id = q.id;
    insert into public.stay_vip (organization_id, reservation_id, status, criterion_id, reason, granted_by, granted_at, expires_at)
    values (org, q.reservation_id, 'active', coalesce(criterion, q.criterion_id), nullif(left(trim(coalesce(internal, '')), 500), ''), uid, now(), expires)
    on conflict (organization_id, reservation_id) do update set status = 'active', criterion_id = excluded.criterion_id, reason = excluded.reason,
      granted_by = uid, granted_at = now(), expires_at = excluded.expires_at, revoked_by = null, revoked_at = null;
    perform public.sync_reservation_vip(org, q.reservation_id);
    insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id) values (org, q.reservation_id, 'vip_accepted', uid);
  elsif decision = 'refuse' then
    update public.vip_requests set status = 'refused', guest_message = nullif(left(trim(coalesce(guest_msg, '')), 1000), ''),
      internal_note = nullif(left(trim(coalesce(internal, '')), 1000), ''), decided_by = uid, decided_at = now() where id = q.id;
    insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id) values (org, q.reservation_id, 'vip_refused', uid);
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  -- Voyageur prévenu par e-mail (s'il en a donné un) : réponse à lire dans son espace ; jamais la note interne
  select * into r from public.reservations where organization_id = org and id = q.reservation_id;
  perform public.queue_guest_email(r, 'vip_update', jsonb_build_object('decision', decision, 'message', case when decision = 'info' then left(trim(guest_msg), 1000) else nullif(left(trim(coalesce(guest_msg, '')), 1000), '') end), null);
  return 'applied';
end $$;

-- Attribution documentée sans demande du voyageur, et retrait
create function public.grant_vip(org uuid, reservation uuid, criterion uuid, expires timestamptz, why text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.reservations where organization_id = org and id = reservation) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if criterion is null and nullif(trim(coalesce(why, '')), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if criterion is not null and not exists (select 1 from public.vip_criteria where organization_id = org and id = criterion) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.stay_vip (organization_id, reservation_id, status, criterion_id, reason, granted_by, granted_at, expires_at)
  values (org, reservation, 'active', criterion, nullif(left(trim(coalesce(why, '')), 500), ''), uid, now(), expires)
  on conflict (organization_id, reservation_id) do update set status = 'active', criterion_id = excluded.criterion_id, reason = excluded.reason,
    granted_by = uid, granted_at = now(), expires_at = excluded.expires_at, revoked_by = null, revoked_at = null;
  perform public.sync_reservation_vip(org, reservation);
  insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (org, reservation, 'vip_granted', uid, left(why, 300));
  return 'applied';
end $$;

create function public.revoke_vip(org uuid, reservation uuid, why text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.stay_vip set status = 'revoked', revoked_by = uid, revoked_at = now(), reason = coalesce(nullif(left(trim(coalesce(why, '')), 500), ''), public.stay_vip.reason)
   where organization_id = org and reservation_id = reservation and status = 'active';
  if not found then return 'already'; end if;
  perform public.sync_reservation_vip(org, reservation);
  insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (org, reservation, 'vip_revoked', uid, left(why, 300));
  return 'applied';
end $$;

-- Indice de fidélité (montré au responsable, jamais appliqué seul) : séjours confirmés terminés, même e-mail
create function public.loyalty_count(org uuid, reservation uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when not public.is_manager(org) then null else (
    select count(*)::int from public.reservations o join public.reservations r on r.organization_id = o.organization_id and r.id = reservation
     where o.organization_id = org and o.id <> r.id and r.guest_email is not null and lower(o.guest_email) = lower(r.guest_email)
       and o.status = 'confirmed' and o.check_out_at < now()) end;
$$;

revoke all on function public.set_prep_status(uuid, uuid, text), public.record_prep_invite(uuid, uuid, text), public.decide_vip(uuid, uuid, text, uuid, timestamptz, text, text),
  public.grant_vip(uuid, uuid, uuid, timestamptz, text), public.revoke_vip(uuid, uuid, text), public.loyalty_count(uuid, uuid) from public, anon;
grant execute on function public.set_prep_status(uuid, uuid, text), public.record_prep_invite(uuid, uuid, text), public.decide_vip(uuid, uuid, text, uuid, timestamptz, text, text),
  public.grant_vip(uuid, uuid, uuid, timestamptz, text), public.revoke_vip(uuid, uuid, text), public.loyalty_count(uuid, uuid) to authenticated;
revoke all on function public.clean_prep_answers(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.guest_save_preparation(text, jsonb, boolean), public.guest_delete_preparation(text),
  public.guest_request_vip(text, uuid, text), public.guest_reply_vip(text, text) from public;
grant execute on function public.guest_save_preparation(text, jsonb, boolean), public.guest_delete_preparation(text),
  public.guest_request_vip(text, uuid, text), public.guest_reply_vip(text, text) to anon, authenticated;

-- Notifications : nouveaux événements -------------------------------------------------------------
alter table public.notification_prefs drop constraint notification_prefs_event_check;
alter table public.notification_prefs add constraint notification_prefs_event_check
  check (event in ('team_service_requested', 'team_guest_reply', 'team_guest_problem', 'team_guest_message',
                   'team_agent_blocker', 'team_absence_requested', 'team_task_to_validate', 'team_assignment_conflict',
                   'team_stay_changed', 'team_prep_submitted', 'team_prep_updated', 'team_vip_requested', 'chat_message', 'agent_task_assigned', 'agent_task_changed',
                   'agent_correction_requested', 'agent_absence_decided'));

-- Espace voyageur : complet dans la fenêtre habituelle, « préparation » avant ------------------------
create or replace function public.guest_request_service(token text, s_kind text, s_start_at timestamptz, s_people int, s_details text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reservations; sid uuid; emailed boolean;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  insert into public.service_requests (organization_id, reservation_id, property_id, kind, start_at, people, details, source, manager_unread)
  values (r.organization_id, r.id, r.property_id, s_kind, s_start_at, s_people, nullif(trim(s_details), ''), 'guest', true)
  returning id into sid;
  insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind)
  values (r.organization_id, sid, 'created', 'requested', 'guest', 'guest');
  emailed := public.queue_guest_email(r, 'service_received', jsonb_build_object('kind', s_kind, 'start_at', s_start_at), sid);
  return jsonb_build_object('status', 'ok', 'id', sid, 'email_queued', emailed);
end $$;

create or replace function public.guest_reply_service(token text, service uuid, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; s public.service_requests;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if length(trim(coalesce(message, ''))) = 0 then return jsonb_build_object('status', 'empty'); end if;
  select * into s from public.service_requests where organization_id = r.organization_id and id = service and reservation_id = r.id for update;
  if s.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  insert into public.service_events (organization_id, service_id, kind, body, visibility, author_kind)
  values (r.organization_id, s.id, 'guest_message', left(trim(message), 2000), 'guest', 'guest');
  update public.service_requests set manager_unread = true,
    status = case when status = 'info_requested' then 'in_review' else status end
  where id = s.id;
  if s.status = 'info_requested' then
    insert into public.service_events (organization_id, service_id, kind, status, visibility, author_kind)
    values (r.organization_id, s.id, 'status', 'in_review', 'guest', 'system');
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.guest_send_message(token text, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if length(trim(coalesce(message, ''))) = 0 then return jsonb_build_object('status', 'empty'); end if;
  insert into public.stay_messages (organization_id, reservation_id, author_kind, body)
  values (r.organization_id, r.id, 'guest', left(trim(message), 2000));
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.get_guest_stay(token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reservations; l public.guest_links; p public.properties; g public.guest_guides; seen timestamptz; full_access boolean;
  pr public.stay_preparations; q public.vip_requests; v public.stay_vip; base jsonb;
  unavailable constant jsonb := jsonb_build_object('status', 'unavailable');
begin
  r := public.guest_link_any(token);
  if r.id is null then return unavailable; end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into l from public.guest_links where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  select * into g from public.guest_guides where organization_id = p.organization_id and property_id = p.id;
  if g.property_id is null or not g.enabled then return unavailable; end if;
  seen := l.last_opened_at;
  update public.guest_links set last_opened_at = now() where id = l.id;
  insert into public.stay_preparations (organization_id, reservation_id, questionnaire_status, opened_at)
  values (r.organization_id, r.id, 'opened', now())
  on conflict (organization_id, reservation_id) do update set
    opened_at = coalesce(public.stay_preparations.opened_at, now()),
    questionnaire_status = case when public.stay_preparations.questionnaire_status = 'not_started' then 'opened' else public.stay_preparations.questionnaire_status end;
  select * into pr from public.stay_preparations where organization_id = r.organization_id and reservation_id = r.id;
  select * into q from public.vip_requests where organization_id = r.organization_id and reservation_id = r.id order by created_at desc limit 1;
  select * into v from public.stay_vip where organization_id = r.organization_id and reservation_id = r.id;
  update public.service_requests set guest_unread = false where organization_id = r.organization_id and reservation_id = r.id and guest_unread;
  update public.stay_messages set read_by_guest_at = now() where organization_id = r.organization_id and reservation_id = r.id and author_kind = 'member' and read_by_guest_at is null;
  base := jsonb_build_object(
    'status', case when full_access then 'ok' else 'prep' end,
    'previously_opened_at', seen,
    'organization', (select jsonb_build_object('name', o.name, 'services_offered', to_jsonb(o.services_offered), 'prep_questions', to_jsonb(o.prep_questions)) from public.organizations o where o.id = r.organization_id),
    'property', jsonb_build_object('name', p.name, 'city', p.city, 'timezone', p.timezone,
      'check_in_time', p.default_check_in, 'check_out_time', p.default_check_out),
    'stay', jsonb_build_object('guest_name', r.guest_name, 'check_in_at', r.check_in_at, 'check_out_at', r.check_out_at,
      'adults', r.adults, 'children', r.children, 'babies', r.babies, 'link_valid_until', l.valid_until, 'details_from', l.valid_from,
      'guest_locale', r.guest_locale),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'start_at', s.start_at, 'people', s.people, 'details', s.details, 'status', s.status,
        'created_at', s.created_at,
        'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'status', e.status, 'body', e.body, 'author', e.author_kind, 'at', e.at) order by e.at)
                            from public.service_events e
                            where e.organization_id = s.organization_id and e.service_id = s.id and e.visibility = 'guest'), '[]'::jsonb))
        order by s.created_at desc)
      from public.service_requests s where s.organization_id = r.organization_id and s.reservation_id = r.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('author', m.author_kind, 'body', m.body, 'at', m.created_at) order by m.created_at)
      from public.stay_messages m where m.organization_id = r.organization_id and m.reservation_id = r.id), '[]'::jsonb),
    'preparation', jsonb_build_object('questionnaire_status', pr.questionnaire_status, 'answers', pr.answers, 'updated_at', pr.guest_updated_at,
      'editable', now() < r.check_in_at),
    'prepared', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'title', i.title, 'body', i.body, 'url', i.url, 'published_at', i.published_at,
        'place', case when x.id is null then null else jsonb_build_object('category', x.category, 'address', x.address, 'lat', x.latitude, 'lng', x.longitude, 'source', x.source) end)
        order by i.published_at)
      from public.stay_guest_items i left join public.property_places x on x.id = i.place_id
      where i.organization_id = r.organization_id and i.reservation_id = r.id and i.published_at is not null), '[]'::jsonb),
    'vip', jsonb_build_object(
      'motifs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label) order by c.label) from public.vip_criteria c
                          where c.organization_id = r.organization_id and c.active and c.guest_visible), '[]'::jsonb),
      'request', case when q.id is null then null else jsonb_build_object('status', q.status, 'message', q.guest_message, 'created_at', q.created_at) end,
      'confirmed', coalesce(v.status = 'active' and (v.expires_at is null or v.expires_at > now()), false)));
  if not full_access then return base; end if;
  -- Fenêtre habituelle : informations pratiques détaillées
  return base || jsonb_build_object(
    'property', (base -> 'property') || jsonb_build_object('address', p.address_line),
    'guide', jsonb_build_object('welcome', g.welcome, 'wifi_name', g.wifi_name, 'wifi_password', g.wifi_password,
      'house_rules', g.house_rules, 'checkout_instructions', g.checkout_instructions, 'parking', g.parking,
      'trash', g.trash, 'emergency_phone', g.emergency_phone, 'recommendations', g.recommendations));
end $$;

-- Lieux : date d'ajout et de vérification transmises au voyageur ; recommandations disponibles dès la préparation
create or replace function public.guest_places(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations; p public.properties; full_access boolean;
begin
  r := public.guest_link_any(token);
  if r.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  full_access := (public.guest_link_stay(token)).id is not null;
  select * into p from public.properties where organization_id = r.organization_id and id = r.property_id;
  -- Avant la fenêtre habituelle : ni adresse ni coordonnées du logement (distances seulement)
  return jsonb_build_object('status', 'ok', 'full', full_access,
    'property', jsonb_build_object('name', p.name, 'address', case when full_access then p.address_line end,
      'postal_code', case when full_access then p.postal_code end, 'city', p.city, 'country_code', p.country_code,
      'lat', case when full_access then p.latitude end, 'lng', case when full_access then p.longitude end),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'category', x.category, 'name', x.name,
        'description', x.description, 'address', x.address, 'lat', x.latitude, 'lng', x.longitude, 'opening_hours', x.opening_hours,
        'phone', x.phone, 'website', x.website, 'note', x.note, 'updated_at', x.source_updated_at, 'created_at', x.created_at, 'verified_at', x.verified_at,
        'distance_m', case when p.latitude is not null and x.latitude is not null
                           then round(public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude)) end)
        order by (x.source <> 'openstreetmap') desc, case when p.latitude is not null and x.latitude is not null then public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) end nulls last)
      from public.property_places x
      where x.organization_id = p.organization_id and x.property_id = p.id and not x.hidden
        and (x.source <> 'openstreetmap' or p.auto_places)
        and (x.latitude is null or p.latitude is null or public.distance_m(p.latitude, p.longitude, x.latitude, x.longitude) <= 3000)), '[]'::jsonb));
end $$;

-- Problèmes : uniquement dans la fenêtre habituelle (inchangé : guest_report_problem et guest_problems utilisent guest_link_stay)
