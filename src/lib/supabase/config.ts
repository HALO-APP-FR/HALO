/**
 * Mode de fonctionnement de HALO.
 * - « démo » : données dans le navigateur (aucune variable Supabase) ;
 * - « connecté » : base Supabase réelle. L'environnement (préproduction locale, préproduction,
 *   production) est affiché en permanence pour qu'on ne confonde jamais données fictives et réelles.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const isConnected = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export type HaloEnv = "preprod-local" | "preprod" | "production";
export const haloEnv = (): HaloEnv => {
  const v = process.env.NEXT_PUBLIC_HALO_ENV;
  return v === "production" || v === "preprod-local" ? v : "preprod";
};
