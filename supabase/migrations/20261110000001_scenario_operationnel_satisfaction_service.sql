-- =====================================================================
-- Migration 15 — scénario opérationnel (linge, retard, arrivée anticipée) et note du service de la conciergerie
-- =====================================================================

-- ---------------------------------------------------------------------
-- Signalements terrain : « linge manquant » et « retard » (rattachés à la mission, au logement et à l'arrivée)
-- ---------------------------------------------------------------------
alter table public.incidents drop constraint if exists incidents_category_check;
alter table public.incidents add constraint incidents_category_check
  check (category in ('blocker', 'missing_supplies', 'damage', 'breakdown', 'leak', 'cleanliness', 'missing_item', 'access', 'noise', 'pests',
                      'linen', 'delay', 'other'));

-- ---------------------------------------------------------------------
-- Demandes voyageur : arrivée anticipée et départ tardif (jamais acceptées automatiquement : même circuit de décision)
-- ---------------------------------------------------------------------
alter table public.service_requests drop constraint service_requests_kind_check;
alter table public.service_requests add constraint service_requests_kind_check
  check (kind in ('private_chef', 'restaurant', 'driver', 'airport_transfer', 'grocery', 'spa', 'babysitter', 'experience', 'flowers',
                  'extra_cleaning', 'extra_linen', 'premium_package', 'early_checkin', 'late_checkout', 'other'));

-- ---------------------------------------------------------------------
-- Satisfaction : note distincte du service de la conciergerie (voyageur), critères faibles suivis
-- Les avis existants n'ont pas cette note : elle reste vide (jamais déduite d'autres champs).
-- ---------------------------------------------------------------------
alter table public.reviews add column service_overall int check (service_overall between 1 and 5);
-- Critère faible ayant déclenché le suivi (ex. « cleanliness »), pour l'afficher sans relire tout l'avis
alter table public.reviews add column low_reason text check (low_reason ~ '^(overall|service|cleanliness|condition|checkin|communication|reactivity|follow_up|quality|transparency)$');

drop function public.review_submit(text, int, jsonb, text, boolean, text, boolean);

-- Règle de suivi (documentée) : « À traiter » si la note globale, la note du service, ou un critère clé
-- (voyageur : propreté, état/conformité ; propriétaire : réactivité, qualité) vaut 2/5 ou moins.
-- Une seule alerte équipe par avis ; jamais d'attribution à un agent.
create function public.review_submit(token text, v_overall int, v_ratings jsonb, v_comment text, v_return boolean, v_label text, v_consent boolean,
                                     v_service int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.review_links; rv public.reviews; keys text[]; key_low text[]; clean jsonb := '{}'::jsonb; k text; prop uuid; rid uuid; low text;
begin
  l := public.review_link_any(token);
  if l.id is null then return jsonb_build_object('status', 'unavailable'); end if;
  if v_overall is null or v_overall not between 1 and 5 then return jsonb_build_object('status', 'invalid'); end if;
  if v_service is not null and v_service not between 1 and 5 then return jsonb_build_object('status', 'invalid'); end if;
  keys := case when l.kind = 'guest' then array['cleanliness', 'condition', 'checkin', 'communication'] else array['communication', 'reactivity', 'follow_up', 'quality', 'transparency'] end;
  key_low := case when l.kind = 'guest' then array['cleanliness', 'condition'] else array['reactivity', 'quality'] end;
  foreach k in array keys loop
    if (v_ratings ->> k) ~ '^[1-5]$' then clean := clean || jsonb_build_object(k, (v_ratings ->> k)::int); end if;
  end loop;
  -- Note du service : voyageur seulement (pour le propriétaire, la note globale porte déjà sur la gestion)
  if l.kind <> 'guest' then v_service := null; end if;
  low := case when v_overall <= 2 then 'overall' when v_service <= 2 then 'service'
              else (select x from unnest(key_low) x where (clean ->> x)::int <= 2 limit 1) end;
  select * into rv from public.reviews where link_id = l.id for update;
  if rv.id is not null then
    if rv.editable_until <= now() then return jsonb_build_object('status', 'locked'); end if;
    update public.reviews set overall = v_overall, service_overall = v_service, ratings = clean, comment = nullif(left(trim(coalesce(v_comment, '')), 2000), ''), would_return = v_return,
      author_label = nullif(left(trim(coalesce(v_label, '')), 60), ''),
      consent_publish = coalesce(v_consent, false), consent_at = case when coalesce(v_consent, false) and not rv.consent_publish then now() else consent_at end,
      consent_withdrawn_at = case when not coalesce(v_consent, false) and rv.consent_publish then now() else consent_withdrawn_at end,
      follow_status = case when low is not null and rv.follow_status = 'new' then 'to_handle' else follow_status end,
      low_reason = coalesce(low, low_reason),
      updated_at = now()
     where id = rv.id;
    if not coalesce(v_consent, false) then delete from public.showcase_testimonials where review_id = rv.id; end if;
    -- Devient faible à la modification : l'équipe est prévenue une fois
    if low is not null and rv.low_reason is null and rv.follow_status = 'new' then
      perform public.queue_team_email(l.organization_id, 'team_low_review',
        jsonb_build_object('review_kind', l.kind, 'criterion', low, 'property', (select name from public.properties where id = rv.property_id), 'path', '/app/satisfaction?kind=' || l.kind || '&filter=to_handle'), null, rv.reservation_id, null);
    end if;
    return jsonb_build_object('status', 'ok', 'updated', true);
  end if;
  if l.kind = 'guest' then select property_id into prop from public.reservations where organization_id = l.organization_id and id = l.reservation_id; end if;
  insert into public.reviews (organization_id, kind, source, verified, link_id, reservation_id, property_id, owner_id, overall, service_overall, ratings, comment, would_return,
                              author_label, consent_publish, consent_at, editable_until, follow_status, low_reason)
  values (l.organization_id, l.kind, 'halo', true, l.id, l.reservation_id, prop, l.owner_id, v_overall, v_service, clean, nullif(left(trim(coalesce(v_comment, '')), 2000), ''), v_return,
          nullif(left(trim(coalesce(v_label, '')), 60), ''), coalesce(v_consent, false), case when coalesce(v_consent, false) then now() end, now() + interval '14 days',
          case when low is not null then 'to_handle' else 'new' end, low)
  returning id into rid;
  if low is not null then
    perform public.queue_team_email(l.organization_id, 'team_low_review',
      jsonb_build_object('review_kind', l.kind, 'criterion', low, 'property', (select name from public.properties where id = prop), 'path', '/app/satisfaction?kind=' || l.kind || '&filter=to_handle'), null, l.reservation_id, null);
  end if;
  return jsonb_build_object('status', 'ok', 'updated', false);
end $$;
revoke all on function public.review_submit(text, int, jsonb, text, boolean, text, boolean, int) from public;
grant execute on function public.review_submit(text, int, jsonb, text, boolean, text, boolean, int) to anon, authenticated;

-- Portail d'avis : la note du service est renvoyée à son auteur
create or replace function public.review_portal(token text) returns jsonb
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
    'review', case when rv.id is null then null else jsonb_build_object('overall', rv.overall, 'service_overall', rv.service_overall, 'ratings', rv.ratings, 'comment', rv.comment, 'would_return', rv.would_return,
       'author_label', rv.author_label, 'consent_publish', rv.consent_publish and rv.consent_withdrawn_at is null, 'submitted_at', rv.submitted_at, 'updated_at', rv.updated_at,
       'editable', rv.editable_until > now()) end);
end $$;

-- Score du service (avis voyageurs vérifiés ayant répondu) : nombre d'avis toujours donné, aucune moyenne sans réponse
create function public.service_score(org uuid, months int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('count', count(service_overall), 'average', case when count(service_overall) > 0 then round(avg(service_overall)::numeric, 1) end,
    'from', (current_date - make_interval(months => months))::date, 'to', current_date)
  from public.reviews where organization_id = org and kind = 'guest' and source = 'halo' and verified
    and review_date >= (current_date - make_interval(months => months))::date;
$$;
revoke all on function public.service_score(uuid, int) from public, anon, authenticated;

-- Vitrine : séjour (note globale voyageur), service de la conciergerie (voyageur) et gestion (propriétaires) séparés
create or replace function public.get_showcase(s_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.showcases;
begin
  select * into s from public.showcases where slug = lower(s_slug) and published_at is not null;
  if s.organization_id is null then return jsonb_build_object('status', 'unavailable'); end if;
  return jsonb_build_object('status', 'ok', 'organization', (select name from public.organizations where id = s.organization_id),
    'title', s.title, 'intro', s.intro, 'services', s.services, 'contact', s.contact, 'period_months', s.period_months, 'published_at', s.published_at,
    'guest', case when s.show_guest_score then public.satisfaction_score(s.organization_id, 'guest', s.period_months) end,
    'service', case when s.show_guest_score then public.service_score(s.organization_id, s.period_months) end,
    'owner', case when s.show_owner_score then public.satisfaction_score(s.organization_id, 'owner', s.period_months) end,
    'testimonials', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'overall', r.overall, 'comment', r.comment,
        'author', coalesce(r.author_label, case r.kind when 'guest' then 'guest' else 'owner' end), 'month', to_char(r.review_date, 'YYYY-MM')) order by t.position)
      from public.showcase_testimonials t join public.reviews r on r.organization_id = t.organization_id and r.id = t.review_id
      where t.organization_id = s.organization_id and r.consent_publish and r.consent_withdrawn_at is null), '[]'::jsonb));
end $$;
