import "server-only";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export type MemberRole = "owner" | "manager" | "agent";
export interface OrgSummary {
  id: string;
  name: string;
  role: MemberRole;
  onboarding: Record<string, unknown>;
}

export const ORG_COOKIE = "halo_org";

/**
 * Contexte de la personne connectée : identité vérifiée auprès du service d'authentification
 * (getUser, pas seulement le cookie), organisations dont elle est membre et organisation active.
 * L'organisation active (cookie) ne donne aucun droit : la base revérifie l'appartenance.
 */
export async function getContext() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { supabase, user: null, orgs: [] as OrgSummary[], org: null as OrgSummary | null, profile: null };
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase.from("memberships").select("organization_id, role, is_active, organizations(id, name, onboarding)").eq("user_id", user.id).eq("is_active", true),
    supabase.from("profiles").select("id, full_name, phone, job_title, locale").eq("id", user.id).maybeSingle(),
  ]);
  const orgs: OrgSummary[] = (memberships ?? []).flatMap((m) => {
    const o = (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as { id: string; name: string; onboarding: Record<string, unknown> } | null;
    return o ? [{ id: o.id, name: o.name, role: m.role as MemberRole, onboarding: o.onboarding ?? {} }] : [];
  });
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0] ?? null;
  return { supabase, user, orgs, org, profile };
}

export const isManagerRole = (role: MemberRole | undefined) => role === "owner" || role === "manager";
