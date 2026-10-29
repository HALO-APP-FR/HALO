import "server-only";
import { haloEnv, isConnected } from "@/lib/supabase/config";

/**
 * Comptes de test SANS e-mail : PRÉPRODUCTION uniquement, jamais en production (double verrou :
 * environnement + variable HALO_TEST_ACCOUNTS=1 posée seulement sur la préversion).
 * Identités fictives (…@halo.invalid) ; les données créées sont réelles (base de préproduction).
 */
export const testAccountsEnabled = () => isConnected() && haloEnv() !== "production" && process.env.HALO_TEST_ACCOUNTS === "1";
