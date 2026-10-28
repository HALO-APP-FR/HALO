import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Client serveur avec la SESSION de l'utilisateur : la base applique ses règles d'accès (RLS)
 * à chaque requête, y compris côté serveur. Aucune clé administrative ici.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* rendu d'un composant serveur : la session est rafraîchie par le proxy */
        }
      },
    },
  });
}

/** Client anonyme (sans session) : espace voyageur, uniquement les fonctions ouvertes par lien de séjour. */
export function supabaseAnon() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, { cookies: { getAll: () => [], setAll: () => undefined } });
}
