-- =====================================================================
-- Migration 13 — corrections opérationnelles, import de données, sources externes (iCal)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 Préparation : statut toujours cohérent avec les actions indispensables
-- ---------------------------------------------------------------------
alter table public.stay_prep_events drop constraint stay_prep_events_kind_check;
alter table public.stay_prep_events add constraint stay_prep_events_kind_check check (kind in (
  'invite_created', 'invite_sent', 'opened', 'guest_saved', 'guest_submitted', 'guest_updated', 'guest_deleted',
  'status_changed', 'status_reverted', 'action_created', 'action_done', 'action_cancelled', 'action_reopened', 'action_forced', 'action_auto_done',
  'item_published', 'item_unpublished',
  'vip_requested', 'vip_guest_reply', 'vip_info_requested', 'vip_accepted', 'vip_refused', 'vip_granted', 'vip_revoked'));

-- Dérogation : une action liée à une mission non terminée ne peut être close qu'avec un motif écrit
alter table public.stay_prep_actions add column override_reason text check (length(override_reason) <= 500);

-- Mission « terminée » au sens de la préparation : validée, ou faite pour un type sans validation
create function public.task_completed(t public.tasks) returns boolean
language sql stable security definer set search_path = '' as $$
  select t.status = 'validated'
      or (t.status = 'done' and not exists (select 1 from public.organizations o where o.id = t.organization_id and t.type = any (o.validation_task_types)));
$$;
revoke all on function public.task_completed(public.tasks) from public, anon, authenticated;

-- Avant écriture d'une action : mission liée non terminée → refus, sauf dérogation motivée
create function public.prep_action_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') and new.task_id is not null then
    select * into t from public.tasks where organization_id = new.organization_id and id = new.task_id;
    if t.id is not null and t.status <> 'cancelled' and not public.task_completed(t) and nullif(trim(coalesce(new.override_reason, '')), '') is null then
      raise exception 'mission_not_done' using errcode = 'P0001';
    end if;
  end if;
  if new.status <> 'done' then new.override_reason := null; end if;
  return new;
end $$;
revoke all on function public.prep_action_guard() from public, anon, authenticated;
create trigger stay_prep_actions_guard before insert or update on public.stay_prep_actions for each row execute function public.prep_action_guard();

-- Après écriture : une action indispensable (re)devenue ouverte retire « Prêt », de façon historisée
create function public.prep_status_follow_actions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.blocking and new.status = 'open'
     and (tg_op = 'INSERT' or old.status <> 'open' or not old.blocking) then
    update public.stay_preparations set prep_status = 'in_progress', prep_updated_at = now(), prep_updated_by = (select auth.uid())
     where organization_id = new.organization_id and reservation_id = new.reservation_id and prep_status = 'ready';
    if found then
      insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
      values (new.organization_id, new.reservation_id, 'status_reverted', (select auth.uid()), new.title);
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'open' and new.status = 'open' then
    insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note) values (new.organization_id, new.reservation_id, 'action_reopened', (select auth.uid()), new.title);
  end if;
  if new.status = 'done' and new.override_reason is not null and (tg_op = 'INSERT' or old.status <> 'done') then
    insert into public.stay_prep_events (organization_id, reservation_id, kind, actor_id, note)
    values (new.organization_id, new.reservation_id, 'action_forced', (select auth.uid()), left(new.title || ' — ' || new.override_reason, 500));
  end if;
  return new;
end $$;
revoke all on function public.prep_status_follow_actions() from public, anon, authenticated;
create trigger stay_prep_actions_follow after insert or update on public.stay_prep_actions for each row execute function public.prep_status_follow_actions();

-- Mission terminée → action liée close automatiquement (historisé) ; mission rouverte (correction) → action rouverte
create function public.prep_action_follow_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.task_completed(new) and not public.task_completed(old) then
    -- Close l'action (l'historique « action faite » est écrit par le journal automatique)
    update public.stay_prep_actions set status = 'done', done_at = now()
     where organization_id = new.organization_id and task_id = new.id and status = 'open';
  elsif new.status = 'to_redo' and old.status <> 'to_redo' then
    update public.stay_prep_actions set status = 'open', done_at = null, done_by = null
     where organization_id = new.organization_id and task_id = new.id and status = 'done' and override_reason is null;
  end if;
  return new;
end $$;
revoke all on function public.prep_action_follow_task() from public, anon, authenticated;
create trigger tasks_prep_action_follow after update of status on public.tasks for each row execute function public.prep_action_follow_task();

-- ---------------------------------------------------------------------
-- 1.5 Espace voyageur : numéro de contact de l'équipe disponible dès la préparation
-- ---------------------------------------------------------------------
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
    -- Numéro de contact de l'équipe (champ « urgence » du livret) : un contact, pas une information d'accès
    'contact_phone', nullif(trim(coalesce(g.emergency_phone, '')), ''),
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
      'request', case when q.id is null then null else jsonb_build_object('status', q.status, 'message', q.guest_message, 'created_at', q.created_at, 'decided_at', q.decided_at) end,
      'confirmed', coalesce(v.status = 'active' and (v.expires_at is null or v.expires_at > now()), false)));
  if not full_access then return base; end if;
  return base || jsonb_build_object(
    'property', (base -> 'property') || jsonb_build_object('address', p.address_line),
    'guide', jsonb_build_object('welcome', g.welcome, 'wifi_name', g.wifi_name, 'wifi_password', g.wifi_password,
      'house_rules', g.house_rules, 'checkout_instructions', g.checkout_instructions, 'parking', g.parking,
      'trash', g.trash, 'emergency_phone', g.emergency_phone, 'recommendations', g.recommendations));
end $$;

-- ---------------------------------------------------------------------
-- 2. Import de données (fichier CSV / XLSX)
--    Le fichier n'est jamais conservé : seules les lignes lues sont gardées, le temps de l'import,
--    puis effacées 30 jours après (rapport chiffré conservé). Responsables uniquement.
-- ---------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  source_software text check (length(source_software) <= 80),
  kinds text[] not null default '{}' check (kinds <@ array['properties', 'team', 'stays']),
  method text not null default 'file' check (method in ('file', 'api', 'ical', 'assisted')),
  status text not null default 'draft' check (status in ('draft', 'analyzed', 'importing', 'completed', 'failed', 'reverted')),
  scheduled_for timestamptz,
  files jsonb not null default '{}'::jsonb,        -- par type : nom, format, nombre de lignes (jamais le contenu)
  mapping jsonb not null default '{}'::jsonb,      -- par type : colonne du fichier → champ HALO
  options jsonb not null default '{}'::jsonb,      -- e-mails voyageurs importés ?, missions créées ?
  summary jsonb not null default '{}'::jsonb,      -- aperçu chiffré avant import
  report jsonb not null default '{}'::jsonb,       -- résultat : créés, associés, ignorés, rejetés
  error text check (length(error) <= 500),
  started_at timestamptz,
  completed_at timestamptz,
  reverted_at timestamptz,
  rows_purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index import_jobs_org on public.import_jobs (organization_id, created_at desc);

create table public.import_rows (
  organization_id uuid not null,
  job_id uuid not null,
  kind text not null check (kind in ('properties', 'team', 'stays')),
  row_index int not null check (row_index between 1 and 5000),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  data jsonb,                                       -- valeurs reconnues après correspondance
  issues text[] not null default '{}',
  decision text not null default 'create' check (decision in ('create', 'link', 'ignore', 'reject')),
  match_id uuid,                                    -- fiche existante proposée (doublon)
  status text not null default 'pending' check (status in ('pending', 'created', 'linked', 'ignored', 'rejected', 'failed', 'reverted')),
  target_id uuid,
  message text check (length(message) <= 300),
  primary key (job_id, kind, row_index),
  foreign key (organization_id, job_id) references public.import_jobs (organization_id, id) on delete cascade
);

-- Provenance des fiches créées par un import
alter table public.properties add column import_job_id uuid, add column external_ref text check (length(external_ref) <= 120);
alter table public.reservations add column import_job_id uuid;
alter table public.properties add constraint properties_import_fk foreign key (organization_id, import_job_id) references public.import_jobs (organization_id, id) on delete set null (import_job_id);
alter table public.reservations add constraint reservations_import_fk foreign key (organization_id, import_job_id) references public.import_jobs (organization_id, id) on delete set null (import_job_id);

-- Équipe importée : contacts, jamais des comptes ni des invitations envoyées
create table public.team_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  first_name text check (length(first_name) <= 80),
  last_name text check (length(last_name) <= 80),
  email text check (length(email) <= 254),
  phone text check (length(phone) <= 40),
  proposed_role text not null default 'agent' check (proposed_role in ('manager', 'agent')),
  position public.staff_position,
  worker_type text check (worker_type in ('employee', 'contractor')),
  import_job_id uuid,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(first_name, last_name) is not null),
  unique (organization_id, id),
  foreign key (organization_id, import_job_id) references public.import_jobs (organization_id, id) on delete set null (import_job_id)
);

alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
alter table public.team_contacts enable row level security;
revoke all on public.import_jobs, public.import_rows, public.team_contacts from anon;
grant select, insert, update on public.import_jobs to authenticated;
grant select, insert, update, delete on public.import_rows to authenticated;
grant select, insert, update, delete on public.team_contacts to authenticated;
create policy import_jobs_manager on public.import_jobs for all to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id) and status in ('draft', 'analyzed'));
create policy import_rows_manager on public.import_rows for all to authenticated
  using (public.is_manager(organization_id))
  with check (public.is_manager(organization_id) and status = 'pending'
              and exists (select 1 from public.import_jobs j where j.organization_id = import_rows.organization_id and j.id = import_rows.job_id and j.status in ('draft', 'analyzed')));
create policy team_contacts_manager on public.team_contacts for all to authenticated
  using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
-- Les colonnes de résultat ne s'écrivent que par l'exécution contrôlée
revoke update on public.import_jobs from authenticated;
grant update (source_software, kinds, method, status, scheduled_for, files, mapping, options, summary, updated_at) on public.import_jobs to authenticated;

-- Checklist type de l'organisation copiée sur un nouveau logement (comme la création manuelle)
create function public.copy_default_checklist(org uuid, prop uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare room jsonb; i int := 0; k int; rid uuid; item jsonb;
begin
  for room in select value from jsonb_array_elements(coalesce((select default_checklist from public.organizations where id = org), '[]'::jsonb)) loop
    insert into public.checklist_rooms (organization_id, property_id, name, sort) values (org, prop, room ->> 'room', i) returning id into rid;
    k := 0;
    for item in select value from jsonb_array_elements(coalesce(room -> 'items', '[]'::jsonb)) loop
      insert into public.checklist_items (organization_id, room_id, label, photo_required, sort) values (org, rid, item ->> 'label', coalesce((item ->> 'photo_required')::boolean, false), k);
      k := k + 1;
    end loop;
    i := i + 1;
  end loop;
end $$;
revoke all on function public.copy_default_checklist(uuid, uuid) from public, anon, authenticated;

-- Exécution : une seule organisation, reprise sans doublon (une ligne traitée ne l'est jamais deux fois),
-- chaque ligne dans son propre point de reprise (une ligne en erreur n'annule pas les autres).
-- Aucun e-mail, invitation ni message n'est déclenché par l'import.
create function public.run_import(org uuid, job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.import_jobs; r record; pid uuid; rid uuid; n_created int := 0; n_linked int := 0; n_ignored int := 0; n_rejected int := 0; n_failed int := 0;
  keep_emails boolean; prop public.properties; cin timestamptz; cout timestamptz;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into j from public.import_jobs where organization_id = org and id = job for update;
  if j.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if j.status in ('completed', 'reverted') then return jsonb_build_object('status', 'already', 'report', j.report); end if;
  if j.status not in ('analyzed', 'importing', 'failed') then raise exception 'not_analyzed' using errcode = '22023'; end if;
  keep_emails := coalesce((j.options ->> 'import_guest_emails')::boolean, false);
  update public.import_jobs set status = 'importing', started_at = coalesce(started_at, now()), updated_at = now() where id = job;

  -- 1. Logements (en premier : les séjours s'y rattachent)
  for r in select * from public.import_rows where job_id = job and kind = 'properties' and status = 'pending' order by row_index loop
    begin
      if r.decision = 'reject' or r.data is null then
        update public.import_rows set status = 'rejected' where job_id = job and kind = r.kind and row_index = r.row_index; n_rejected := n_rejected + 1;
      elsif r.decision = 'ignore' then
        update public.import_rows set status = 'ignored' where job_id = job and kind = r.kind and row_index = r.row_index; n_ignored := n_ignored + 1;
      elsif r.decision = 'link' then
        if not exists (select 1 from public.properties where organization_id = org and id = r.match_id) then raise exception 'match_not_found'; end if;
        update public.import_rows set status = 'linked', target_id = r.match_id where job_id = job and kind = r.kind and row_index = r.row_index; n_linked := n_linked + 1;
      else
        insert into public.properties (organization_id, name, address_line, postal_code, city, country_code, timezone, capacity,
                                       default_check_in, default_check_out, cleaning_duration_min, instructions, import_job_id, external_ref)
        values (org, r.data ->> 'name', r.data ->> 'address', r.data ->> 'postal_code', coalesce(r.data ->> 'city', ''),
                coalesce(upper(r.data ->> 'country'), 'FR'), coalesce(r.data ->> 'timezone', 'Europe/Paris'),
                coalesce((r.data ->> 'capacity')::int, 2), coalesce((r.data ->> 'check_in_time')::time, '16:00'), coalesce((r.data ->> 'check_out_time')::time, '11:00'),
                coalesce((r.data ->> 'cleaning_minutes')::int, 90), r.data ->> 'instructions', job, r.data ->> 'external_ref')
        returning id into pid;
        -- Même préparation qu'un logement créé à la main : livret vide, checklist type, catégories de missions confirmées
        update public.properties p set
          check_in_service = coalesce((o.onboarding -> 'config' -> 'task_types') ? 'check_in', false),
          check_out_service = coalesce((o.onboarding -> 'config' -> 'task_types') ? 'check_out', false)
          from public.organizations o where o.id = org and p.id = pid;
        insert into public.guest_guides (organization_id, property_id, enabled) values (org, pid, true);
        perform public.copy_default_checklist(org, pid);
        update public.import_rows set status = 'created', target_id = pid where job_id = job and kind = r.kind and row_index = r.row_index; n_created := n_created + 1;
      end if;
    exception when others then
      update public.import_rows set status = 'failed', message = left(sqlerrm, 300) where job_id = job and kind = r.kind and row_index = r.row_index; n_failed := n_failed + 1;
    end;
  end loop;

  -- 2. Équipe : contacts uniquement (aucun compte, aucune invitation)
  for r in select * from public.import_rows where job_id = job and kind = 'team' and status = 'pending' order by row_index loop
    begin
      if r.decision = 'reject' or r.data is null then
        update public.import_rows set status = 'rejected' where job_id = job and kind = r.kind and row_index = r.row_index; n_rejected := n_rejected + 1;
      elsif r.decision in ('ignore', 'link') then
        update public.import_rows set status = 'ignored' where job_id = job and kind = r.kind and row_index = r.row_index; n_ignored := n_ignored + 1;
      else
        insert into public.team_contacts (organization_id, first_name, last_name, email, phone, proposed_role, position, worker_type, import_job_id)
        values (org, r.data ->> 'first_name', r.data ->> 'last_name', lower(r.data ->> 'email'), r.data ->> 'phone',
                coalesce(r.data ->> 'role', 'agent'), (r.data ->> 'position')::public.staff_position, r.data ->> 'worker_type', job)
        returning id into rid;
        update public.import_rows set status = 'created', target_id = rid where job_id = job and kind = r.kind and row_index = r.row_index; n_created := n_created + 1;
      end if;
    exception when others then
      update public.import_rows set status = 'failed', message = left(sqlerrm, 300) where job_id = job and kind = r.kind and row_index = r.row_index; n_failed := n_failed + 1;
    end;
  end loop;

  -- 3. Séjours : logement existant de l'organisation, ou logement de ce même import
  for r in select * from public.import_rows where job_id = job and kind = 'stays' and status = 'pending' order by row_index loop
    begin
      if r.decision = 'reject' or r.data is null then
        update public.import_rows set status = 'rejected' where job_id = job and kind = r.kind and row_index = r.row_index; n_rejected := n_rejected + 1;
      elsif r.decision = 'ignore' then
        update public.import_rows set status = 'ignored' where job_id = job and kind = r.kind and row_index = r.row_index; n_ignored := n_ignored + 1;
      elsif r.decision = 'link' then
        if not exists (select 1 from public.reservations where organization_id = org and id = r.match_id) then raise exception 'match_not_found'; end if;
        update public.import_rows set status = 'linked', target_id = r.match_id where job_id = job and kind = r.kind and row_index = r.row_index; n_linked := n_linked + 1;
      else
        pid := coalesce(nullif(r.data ->> 'property_id', '')::uuid,
                        (select target_id from public.import_rows x where x.job_id = job and x.kind = 'properties' and x.status in ('created', 'linked')
                           and x.row_index = nullif(r.data ->> 'property_row', '')::int));
        select * into prop from public.properties where organization_id = org and id = pid;
        if prop.id is null then raise exception 'property_not_found'; end if;
        cin := (r.data ->> 'check_in_at')::timestamptz;
        cout := (r.data ->> 'check_out_at')::timestamptz;
        insert into public.reservations (organization_id, property_id, source, external_uid, guest_name, guest_email, adults, children, babies,
                                         check_in_at, check_out_at, status, notes, import_job_id)
        values (org, prop.id, coalesce((r.data ->> 'source')::public.reservation_source, 'other'), r.data ->> 'external_ref', r.data ->> 'guest_name',
                case when keep_emails then lower(r.data ->> 'guest_email') end,
                coalesce((r.data ->> 'adults')::int, 0), coalesce((r.data ->> 'children')::int, 0), coalesce((r.data ->> 'babies')::int, 0),
                cin, cout, coalesce((r.data ->> 'status')::public.reservation_status, 'confirmed'), r.data ->> 'notes', job)
        returning id into rid;
        update public.import_rows set status = 'created', target_id = rid where job_id = job and kind = r.kind and row_index = r.row_index; n_created := n_created + 1;
      end if;
    exception when others then
      update public.import_rows set status = 'failed',
        message = case when sqlerrm like '%stay_overlap%' then 'stay_overlap' when sqlerrm like '%property_not_found%' then 'property_not_found'
                       when sqlerrm like '%reservations_external_uid%' then 'duplicate_reference' else left(sqlerrm, 300) end
       where job_id = job and kind = r.kind and row_index = r.row_index; n_failed := n_failed + 1;
    end;
  end loop;

  update public.import_jobs set status = 'completed', completed_at = now(), updated_at = now(), rows_purge_at = now() + interval '30 days',
    report = (select jsonb_object_agg(k, v) from (
      select kind || ':' || status as k, count(*) as v from public.import_rows where job_id = job group by kind, status) s)
  where id = job;
  return jsonb_build_object('status', 'ok', 'created', n_created, 'linked', n_linked, 'ignored', n_ignored, 'rejected', n_rejected, 'failed', n_failed);
end $$;

-- Annulation sûre : seules les fiches créées par cet import ET restées intactes depuis sont retirées.
-- Tout le reste est listé avec la raison (modifié depuis, séjours ajoutés, missions commencées, contact invité…).
create function public.revert_import(org uuid, job uuid, apply boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.import_jobs; r record; removable jsonb := '[]'::jsonb; kept jsonb := '[]'::jsonb; reason text; gone_stays uuid[] := '{}';
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into j from public.import_jobs where organization_id = org and id = job for update;
  if j.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if j.status <> 'completed' then return jsonb_build_object('status', 'not_completed'); end if;
  for r in select x.* from public.import_rows x where x.job_id = job and x.status = 'created' order by case kind when 'stays' then 0 when 'team' then 1 else 2 end, row_index loop
    reason := null;
    if r.kind = 'stays' then
      select case
        when s.id is null then 'gone'
        when s.updated_at > j.completed_at then 'modified_since'
        when exists (select 1 from public.tasks t where t.organization_id = org and (t.reservation_id = s.id or t.next_reservation_id = s.id) and t.status not in ('unassigned', 'assigned', 'cancelled')) then 'missions_started'
        when exists (select 1 from public.service_requests v where v.organization_id = org and v.reservation_id = s.id) then 'has_requests'
        when exists (select 1 from public.stay_messages m where m.organization_id = org and m.reservation_id = s.id) then 'has_messages'
        when exists (select 1 from public.guest_links g where g.organization_id = org and g.reservation_id = s.id) then 'guest_link'
      end into reason
      from (select 1) one left join public.reservations s on s.organization_id = org and s.id = r.target_id;
    elsif r.kind = 'team' then
      select case when c.id is null then 'gone' when c.invited_at is not null then 'invited' when c.updated_at > j.completed_at then 'modified_since' end into reason
      from (select 1) one left join public.team_contacts c on c.organization_id = org and c.id = r.target_id;
    else
      select case
        when p.id is null then 'gone'
        when p.updated_at > j.completed_at then 'modified_since'
        when exists (select 1 from public.reservations s where s.organization_id = org and s.property_id = p.id and s.import_job_id is distinct from job) then 'other_stays'
        -- Ses séjours importés restent (modifiés, avec demandes…) : le logement reste aussi
        when exists (select 1 from public.reservations s where s.organization_id = org and s.property_id = p.id and not (s.id = any (gone_stays))) then 'stays_kept'
        when exists (select 1 from public.tasks t where t.organization_id = org and t.property_id = p.id and t.status not in ('unassigned', 'assigned', 'cancelled')) then 'missions_started'
        when exists (select 1 from public.property_places x where x.organization_id = org and x.property_id = p.id) then 'has_places'
      end into reason
      from (select 1) one left join public.properties p on p.organization_id = org and p.id = r.target_id;
    end if;
    if reason is null then
      removable := removable || jsonb_build_object('kind', r.kind, 'row', r.row_index);
      if r.kind = 'stays' then gone_stays := gone_stays || r.target_id; end if;
      if apply then
        if r.kind = 'stays' then
          delete from public.tasks where organization_id = org and (reservation_id = r.target_id or next_reservation_id = r.target_id) and status in ('unassigned', 'assigned');
          delete from public.reservations where organization_id = org and id = r.target_id;
        elsif r.kind = 'team' then delete from public.team_contacts where organization_id = org and id = r.target_id;
        else
          delete from public.tasks where organization_id = org and property_id = r.target_id and status in ('unassigned', 'assigned', 'cancelled');
          delete from public.properties where organization_id = org and id = r.target_id;
        end if;
        update public.import_rows set status = 'reverted' where job_id = job and kind = r.kind and row_index = r.row_index;
      end if;
    elsif reason <> 'gone' then
      kept := kept || jsonb_build_object('kind', r.kind, 'row', r.row_index, 'reason', reason);
    end if;
  end loop;
  if apply then
    update public.import_jobs set reverted_at = now(), updated_at = now(),
      status = case when jsonb_array_length(kept) = 0 then 'reverted' else status end,
      report = report || jsonb_build_object('reverted', jsonb_array_length(removable), 'kept_after_revert', jsonb_array_length(kept))
     where id = job;
  end if;
  return jsonb_build_object('status', 'ok', 'removable', removable, 'kept', kept, 'applied', apply);
end $$;

-- Missions créées après l'import (option choisie par le responsable) : nombre consigné dans le récapitulatif
create function public.record_import_missions(org uuid, job uuid, n int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.import_jobs set summary = summary || jsonb_build_object('missions_created', greatest(n, 0)), updated_at = now()
   where organization_id = org and id = job and status = 'completed' and coalesce((options ->> 'create_missions')::boolean, false);
end $$;
revoke all on function public.record_import_missions(uuid, uuid, int) from public, anon;
grant execute on function public.record_import_missions(uuid, uuid, int) to authenticated;

-- Rétention : lignes lues effacées 30 jours après l'import (le rapport chiffré reste)
create function public.purge_import_rows() returns int
language sql security definer set search_path = '' as $$
  with d as (delete from public.import_rows x using public.import_jobs j
              where j.id = x.job_id and ((j.rows_purge_at is not null and j.rows_purge_at < now()) or (j.status in ('draft', 'analyzed') and j.updated_at < now() - interval '30 days'))
              returning 1)
  select count(*)::int from d;
$$;

-- Adresses e-mail des membres (détection des doublons d'équipe à l'import ; responsables uniquement)
create function public.organization_member_emails(org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(lower(u.email)), '{}') from public.memberships m join auth.users u on u.id = m.user_id
   where public.is_manager(org) and m.organization_id = org and u.email is not null;
$$;
revoke all on function public.organization_member_emails(uuid) from public, anon;
grant execute on function public.organization_member_emails(uuid) to authenticated;

revoke all on function public.run_import(uuid, uuid), public.revert_import(uuid, uuid, boolean) from public, anon;
revoke all on function public.purge_import_rows() from public, anon, authenticated;
grant execute on function public.run_import(uuid, uuid), public.revert_import(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Sources externes : calendriers iCal par logement (lecture seule, à la demande)
--    L'adresse du calendrier contient souvent un jeton privé : stockée à part, jamais relisible
--    par l'application (seuls l'hôte et la fin de l'adresse sont affichés).
-- ---------------------------------------------------------------------
create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('ical')),
  property_id uuid not null,
  label text check (length(label) <= 80),
  platform text not null default 'other' check (platform in ('airbnb', 'booking', 'vrbo', 'other')),
  url_hint text check (length(url_hint) <= 120),       -- hôte + 4 derniers caractères, pour reconnaître la source
  -- Règle de priorité : HALO garde toujours la main sur une fiche modifiée dans HALO
  priority text not null default 'halo_wins' check (priority in ('halo_wins')),
  status text not null default 'active' check (status in ('active', 'paused')),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text check (length(last_error) <= 200),
  last_counts jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, property_id) references public.properties (organization_id, id) on delete cascade
);
create table public.data_source_secrets (
  source_id uuid primary key references public.data_sources (id) on delete cascade,
  url text not null check (length(url) <= 2000)
);
-- Correspondance événement du calendrier ↔ séjour HALO (pour ne jamais créer deux fois, ni écraser une modification)
create table public.source_events (
  organization_id uuid not null,
  source_id uuid not null,
  uid text not null check (length(uid) <= 500),
  reservation_id uuid,
  feed_start timestamptz not null,
  feed_end timestamptz not null,
  synced_at timestamptz not null default now(),       -- dernière écriture faite par la synchronisation
  last_seen_at timestamptz not null default now(),
  state text not null default 'ok' check (state in ('ok', 'conflict', 'removed', 'dismissed')),
  conflict text check (conflict in ('modified_in_halo', 'missing_from_feed', 'overlap', 'dates_changed')),
  primary key (source_id, uid),
  foreign key (organization_id, source_id) references public.data_sources (organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id) references public.reservations (organization_id, id) on delete set null (reservation_id)
);
alter table public.reservations add column source_id uuid;
alter table public.reservations add constraint reservations_source_fk foreign key (organization_id, source_id) references public.data_sources (organization_id, id) on delete set null (source_id);

alter table public.data_sources enable row level security;
alter table public.data_source_secrets enable row level security;
alter table public.source_events enable row level security;
revoke all on public.data_sources, public.data_source_secrets, public.source_events from anon, authenticated;
grant select, update (label, status) on public.data_sources to authenticated;
grant delete on public.data_sources to authenticated;
grant select on public.source_events to authenticated;
create policy data_sources_manager on public.data_sources for all to authenticated using (public.is_manager(organization_id)) with check (public.is_manager(organization_id));
create policy source_events_manager on public.source_events for select to authenticated using (public.is_manager(organization_id));
-- data_source_secrets : aucune politique → aucun accès hors fonctions contrôlées

create function public.add_ical_source(org uuid, prop uuid, feed_url text, feed_label text, feed_platform text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; u text := trim(feed_url);
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties where organization_id = org and id = prop) then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- https exigé au téléchargement (contrôle serveur) ; http accepté ici pour la préproduction locale seulement
  if u !~* '^(https?|webcal)://[^/\s]+\.[^/\s]+/\S*$' then raise exception 'invalid_url' using errcode = '22023'; end if;
  insert into public.data_sources (organization_id, kind, property_id, label, platform, url_hint, created_by)
  values (org, 'ical', prop, nullif(left(trim(coalesce(feed_label, '')), 80), ''), coalesce(nullif(feed_platform, ''), 'other'),
          substring(u from '^(?:https?|webcal)://([^/]+)') || ' …' || right(u, 4), (select auth.uid()))
  returning id into sid;
  insert into public.data_source_secrets (source_id, url) values (sid, regexp_replace(u, '^webcal://', 'https://', 'i'));
  return sid;
end $$;

-- Adresse lue uniquement par le serveur HALO au moment de la synchronisation (responsable de l'organisation)
create function public.ical_source_url(org uuid, source uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.url from public.data_source_secrets s join public.data_sources d on d.id = s.source_id
   where public.is_manager(org) and d.organization_id = org and d.id = source;
$$;

-- Application d'une synchronisation, calculée par le serveur à partir du calendrier téléchargé.
-- Règles : création si inconnu ; mise à jour seulement si la fiche n'a pas été modifiée dans HALO depuis la
-- dernière synchronisation ; sinon conflit à arbitrer. Disparition du calendrier = conflit (jamais d'annulation automatique).
create function public.apply_ical_sync(org uuid, source uuid, events jsonb, sync_error text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.data_sources; e jsonb; m public.source_events; s public.reservations; rid uuid; started timestamptz := now();
  n_created int := 0; n_updated int := 0; n_unchanged int := 0; n_conflicts int := 0; n_missing int := 0;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into d from public.data_sources where organization_id = org and id = source for update;
  if d.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if sync_error is not null then
    update public.data_sources set last_sync_at = now(), last_error = left(sync_error, 200) where id = source;
    return jsonb_build_object('status', 'error', 'error', sync_error);
  end if;
  if d.status = 'paused' then return jsonb_build_object('status', 'paused'); end if;
  for e in select value from jsonb_array_elements(events) loop
    select * into m from public.source_events where source_id = source and uid = e ->> 'uid';
    if m.uid is null then
      begin
        insert into public.reservations (organization_id, property_id, source, external_uid, guest_name, check_in_at, check_out_at, status, source_id)
        values (org, d.property_id, d.platform::public.reservation_source, e ->> 'uid', nullif(e ->> 'guest_name', ''),
                (e ->> 'check_in_at')::timestamptz, (e ->> 'check_out_at')::timestamptz, (e ->> 'status')::public.reservation_status, source)
        returning id into rid;
        insert into public.source_events (organization_id, source_id, uid, reservation_id, feed_start, feed_end)
        values (org, source, e ->> 'uid', rid, (e ->> 'check_in_at')::timestamptz, (e ->> 'check_out_at')::timestamptz);
        n_created := n_created + 1;
      exception when others then
        insert into public.source_events (organization_id, source_id, uid, feed_start, feed_end, state, conflict)
        values (org, source, e ->> 'uid', (e ->> 'check_in_at')::timestamptz, (e ->> 'check_out_at')::timestamptz, 'conflict',
                case when sqlerrm like '%stay_overlap%' then 'overlap' else 'overlap' end)
        on conflict (source_id, uid) do nothing;
        n_conflicts := n_conflicts + 1;
      end;
    else
      update public.source_events set last_seen_at = now() where source_id = source and uid = m.uid;
      if m.state = 'dismissed' then continue; end if;
      select * into s from public.reservations where organization_id = org and id = m.reservation_id;
      if s.id is null then continue; end if;
      if s.check_in_at = (e ->> 'check_in_at')::timestamptz and s.check_out_at = (e ->> 'check_out_at')::timestamptz then
        if m.state = 'conflict' and m.conflict in ('dates_changed', 'missing_from_feed') then
          update public.source_events set state = 'ok', conflict = null where source_id = source and uid = m.uid;
        end if;
        n_unchanged := n_unchanged + 1;
      elsif s.updated_at > m.synced_at then
        -- Modifiée dans HALO depuis la dernière synchronisation : HALO garde la main, conflit signalé
        update public.source_events set state = 'conflict', conflict = 'modified_in_halo', feed_start = (e ->> 'check_in_at')::timestamptz, feed_end = (e ->> 'check_out_at')::timestamptz
         where source_id = source and uid = m.uid;
        n_conflicts := n_conflicts + 1;
      else
        begin
          update public.reservations set check_in_at = (e ->> 'check_in_at')::timestamptz, check_out_at = (e ->> 'check_out_at')::timestamptz where id = s.id;
          update public.source_events set state = 'ok', conflict = null, feed_start = (e ->> 'check_in_at')::timestamptz, feed_end = (e ->> 'check_out_at')::timestamptz, synced_at = clock_timestamp()
           where source_id = source and uid = m.uid;
          n_updated := n_updated + 1;
        exception when others then
          update public.source_events set state = 'conflict', conflict = 'overlap' where source_id = source and uid = m.uid;
          n_conflicts := n_conflicts + 1;
        end;
      end if;
    end if;
  end loop;
  -- Séjours futurs absents du calendrier : signalés, jamais annulés automatiquement
  update public.source_events x set state = 'conflict', conflict = 'missing_from_feed'
   where x.source_id = source and x.last_seen_at < started and x.state in ('ok') and x.feed_end > now();
  get diagnostics n_missing = row_count;
  update public.data_sources set last_sync_at = now(), last_success_at = now(), last_error = null,
    last_counts = jsonb_build_object('created', n_created, 'updated', n_updated, 'unchanged', n_unchanged, 'conflicts', n_conflicts, 'missing', n_missing, 'events', jsonb_array_length(events))
   where id = source;
  return jsonb_build_object('status', 'ok', 'created', n_created, 'updated', n_updated, 'unchanged', n_unchanged, 'conflicts', n_conflicts, 'missing', n_missing);
end $$;

-- Arbitrage d'un conflit par le responsable
create function public.resolve_source_conflict(org uuid, source uuid, event_uid text, decision text) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.source_events;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into m from public.source_events where organization_id = org and source_id = source and uid = event_uid for update;
  if m.uid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.state <> 'conflict' then return 'already'; end if;
  if decision = 'keep_halo' then
    update public.source_events set state = 'dismissed' where source_id = source and uid = event_uid;
  elsif decision = 'apply_feed' and m.reservation_id is not null and m.conflict in ('modified_in_halo', 'dates_changed') then
    update public.reservations set check_in_at = m.feed_start, check_out_at = m.feed_end where organization_id = org and id = m.reservation_id;
    update public.source_events set state = 'ok', conflict = null, synced_at = clock_timestamp() where source_id = source and uid = event_uid;
  elsif decision = 'cancel_stay' and m.reservation_id is not null and m.conflict = 'missing_from_feed' then
    update public.reservations set status = 'cancelled' where organization_id = org and id = m.reservation_id;
    update public.source_events set state = 'removed' where source_id = source and uid = event_uid;
  else
    raise exception 'invalid' using errcode = '22023';
  end if;
  return 'applied';
end $$;

revoke all on function public.add_ical_source(uuid, uuid, text, text, text), public.ical_source_url(uuid, uuid), public.apply_ical_sync(uuid, uuid, jsonb, text),
  public.resolve_source_conflict(uuid, uuid, text, text) from public, anon;
grant execute on function public.add_ical_source(uuid, uuid, text, text, text), public.ical_source_url(uuid, uuid), public.apply_ical_sync(uuid, uuid, jsonb, text),
  public.resolve_source_conflict(uuid, uuid, text, text) to authenticated;
