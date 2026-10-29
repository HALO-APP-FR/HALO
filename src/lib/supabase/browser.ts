"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/** Client navigateur avec la session de la personne : utilisé uniquement pour déposer les photos (droits vérifiés par la base). */
let client: ReturnType<typeof createBrowserClient> | null = null;
export const supabaseBrowser = () => (client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY));
