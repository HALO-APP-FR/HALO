-- Migration 30 : push possible pour les comptes de test (adresses en .invalid).
--
-- Constat (autotest du 12/11) : une notification destinée à une adresse en .invalid était enregistrée directement
-- « échouée » (migration 7), sans passer par la file : le push n'était donc jamais tenté. Or l'organisation QA
-- n'utilise que des adresses .invalid : aucun test réel de push n'aurait été possible.
-- Désormais, si le destinataire a lui-même inscrit un appareil et veut le push pour cet événement, la notification
-- passe par la file : le push est tenté, l'e-mail reste NON envoyé (adresse fictive, marqué échoué comme avant).
-- Prérequis : migration 28.

-- Le destinataire (membre actif de l'organisation) veut-il un push pour cet événement ?
create function public.push_wanted_for_recipient(org uuid, rcpt text, tpl text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships ms join auth.users u on u.id = ms.user_id
     where ms.organization_id = org and ms.is_active and lower(u.email) = lower(rcpt)
       and public.wants_push_channel(org, ms.user_id, tpl));
$$;
revoke all on function public.push_wanted_for_recipient(uuid, text, text) from public, anon, authenticated;

create or replace function public.outbox_insert(org uuid, rcpt text, loc text, tpl text, data jsonb, service uuid, reservation uuid, incident uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if rcpt ~* '\.invalid$' and not public.push_wanted_for_recipient(org, rcpt, tpl) then
    insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id, incident_id, status, last_error)
    values (org, rcpt, coalesce(loc, 'fr'), tpl, data, service, reservation, incident, 'failed', 'undeliverable_test_address');
  else
    -- Adresse réelle, ou adresse de test avec push voulu : la file tente le push ; l'e-mail vers .invalid n'est jamais envoyé
    insert into public.notification_outbox (organization_id, recipient, locale, template, payload, service_id, reservation_id, incident_id)
    values (org, rcpt, coalesce(loc, 'fr'), tpl, data, service, reservation, incident);
  end if;
end $$;
