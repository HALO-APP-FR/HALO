/**
 * Espaces de l'application selon les rôles du compte connecté.
 *
 * Le choix d'un espace ne change JAMAIS les droits : ce sont la session et
 * l'appartenance à l'organisation, vérifiées par la base (RLS), qui décident.
 * Cette fonction ne sert qu'à orienter la personne au bon endroit.
 */
import type { MemberRole } from "@/lib/domain/types";

export type Space = "manager" | "agent";

export interface MembershipSummary {
  role: MemberRole;
  active: boolean;
  /** La personne a des missions terrain assignées (ex. un gérant qui fait aussi des ménages). */
  hasFieldWork?: boolean;
}

/** Espaces accessibles, dans l'ordre de préférence. */
export function spacesFor(memberships: MembershipSummary[]): Space[] {
  const active = memberships.filter((m) => m.active);
  const manages = active.some((m) => m.role === "owner" || m.role === "manager");
  const works = active.some((m) => m.role === "agent" || m.hasFieldWork);
  return [...(manages ? (["manager"] as const) : []), ...(works ? (["agent"] as const) : [])];
}

/** Où envoyer la personne à l'ouverture : un seul espace → directement ; deux → choix ; aucun → connexion. */
export function landingFor(memberships: MembershipSummary[]): { kind: "redirect"; href: string } | { kind: "choose"; spaces: Space[] } {
  const spaces = spacesFor(memberships);
  if (spaces.length === 0) return { kind: "redirect", href: "/login" };
  if (spaces.length === 1) return { kind: "redirect", href: spaces[0] === "manager" ? "/today" : "/a/today" };
  return { kind: "choose", spaces };
}

/** Un espace ne s'ouvre que s'il fait partie des espaces du compte. */
export function canOpenSpace(memberships: MembershipSummary[], space: Space) {
  return spacesFor(memberships).includes(space);
}
