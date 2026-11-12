-- Migration 31 : inventaire de linge à plusieurs — aucune saisie écrasée en silence.
--
-- Constat : deux responsables ouvrent le même article ; l'un enregistre une sortie, l'autre valide ensuite un comptage
-- préparé sur l'ancien chiffre. Le comptage fixait la quantité sans savoir que le stock avait bougé entre-temps.
-- Désormais l'écran transmet la quantité qu'il affichait (« expected ») : si le stock a changé, rien n'est enregistré
-- et HALO montre le nouveau chiffre ; on recompte ou on confirme explicitement (force).
-- Prérequis : migration 26.

drop function public.linen_count(uuid, uuid, text, int, text);
create function public.linen_count(org uuid, item uuid, loc text, counted int, note text default null, expected bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur bigint; g uuid := gen_random_uuid();
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.linen_items where organization_id = org and id = item) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if loc not in ('clean', 'dirty', 'laundry') or counted is null or counted < 0 or counted > 100000 then raise exception 'invalid' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('linen:' || item::text || loc, 0));
  select coalesce(sum(delta), 0) into cur from public.linen_movements where organization_id = org and item_id = item and location = loc;
  -- Stock modifié depuis l'ouverture de l'écran : rien n'est écrit, la nouvelle valeur est renvoyée
  if expected is not null and expected <> cur then
    return jsonb_build_object('status', 'stale', 'current', cur);
  end if;
  insert into public.linen_movements (organization_id, item_id, location, delta, kind, group_id, note, actor_id)
  values (org, item, loc, counted - cur, 'count', g, nullif(left(trim(coalesce(note, '')), 500), ''), (select auth.uid()));
  return jsonb_build_object('status', 'applied', 'before', cur, 'after', counted);
end $$;
revoke all on function public.linen_count(uuid, uuid, text, int, text, bigint) from public, anon;
grant execute on function public.linen_count(uuid, uuid, text, int, text, bigint) to authenticated;
