-- Migration 34 — Tâche planifiée des notifications sans secret à manipuler.
-- Le jeton d'appel est créé DANS Supabase (coffre Vault) par le fichier d'activation et n'en sort jamais :
-- pg_cron + pg_net l'envoient à /api/cron/notifications, qui le fait vérifier par la base (cron_token_ok).
-- Chaque passage accepté est enregistré (cron_runs) et affiché sur la page d'état : la preuve que la tâche tourne.

create table if not exists public.cron_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  overrun_agent int not null default 0,
  overrun_team int not null default 0,
  processed int not null default 0
);
alter table public.cron_runs enable row level security;
revoke all on public.cron_runs from public, anon, authenticated;
grant select, insert, delete on public.cron_runs to service_role;
grant usage, select on sequence public.cron_runs_id_seq to service_role;

-- Jeton valide ? Comparaison dans la base ; sans coffre (base locale) ou sans jeton créé : toujours faux.
create or replace function public.cron_token_ok(token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  if token is null or length(token) < 32 or to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into expected using 'halo_cron_secret';
  return expected is not null and length(expected) >= 32 and expected = token;
end;
$$;
revoke all on function public.cron_token_ok(text) from public, anon, authenticated;
grant execute on function public.cron_token_ok(text) to service_role;

-- Passage enregistré ; on ne garde que les 500 derniers
create or replace function public.cron_run_record(agent int, team int, n int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cron_runs (overrun_agent, overrun_team, processed) values (coalesce(agent, 0), coalesce(team, 0), coalesce(n, 0));
  delete from public.cron_runs where id < (select max(id) - 500 from public.cron_runs);
$$;
revoke all on function public.cron_run_record(int, int, int) from public, anon, authenticated;
grant execute on function public.cron_run_record(int, int, int) to service_role;

-- Dernier passage (page d'état, responsables connectés) : uniquement la date, rien d'autre
create or replace function public.cron_last_run()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$ select max(at) from public.cron_runs $$;
revoke all on function public.cron_last_run() from public, anon;
grant execute on function public.cron_last_run() to authenticated, service_role;

-- Clés des notifications push générées PAR LE SERVEUR lui-même (aucune clé privée recopiée par une personne).
-- Utilisées seulement si HALO_PUSH_AUTO_KEYS=1 et en l'absence de VAPID_* dans l'environnement. Lisibles par la clé
-- serveur uniquement. Les supprimer invalide toutes les inscriptions d'appareils (à réactiver sur chaque appareil).
create table if not exists public.push_server_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
alter table public.push_server_keys enable row level security;
revoke all on public.push_server_keys from public, anon, authenticated;
grant select, insert on public.push_server_keys to service_role;
