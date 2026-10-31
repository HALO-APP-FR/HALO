import { getTranslations } from "next-intl/server";
import { FileSpreadsheet, Building2, CalendarDays, ConciergeBell, House, ListChecks, Mail, Settings2, TriangleAlert, Users, BellRing, CircleUser, MessagesSquare, SlidersHorizontal } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { EnvBadge } from "./env-badge";
import { NavMore, OrgSwitcher, SignOutButton } from "./shell-client";
import type { OrgSummary } from "@/lib/connected/context";

const MANAGER_NAV = [
  { key: "home", href: "/app", icon: House },
  { key: "stays", href: "/app/stays", icon: CalendarDays },
  { key: "services", href: "/app/services", icon: ConciergeBell },
  { key: "incidents", href: "/app/incidents", icon: TriangleAlert },
  { key: "missions", href: "/app/missions", icon: ListChecks },
  { key: "messages", href: "/app/messages", icon: MessagesSquare },
  { key: "team", href: "/app/team", icon: Users },
] as const;
// Rubriques secondaires (moins fréquentes) : regroupées sous « Plus »
const MANAGER_MORE = [
  { key: "properties", href: "/app/properties", icon: Building2 },
  { key: "notifications", href: "/app/notifications", icon: Mail },
  { key: "settings", href: "/app/settings", icon: SlidersHorizontal },
  { key: "setup", href: "/app/onboarding", icon: Settings2 },
  { key: "import", href: "/app/import", icon: FileSpreadsheet },
  { key: "profile", href: "/app/profile", icon: CircleUser },
  { key: "preferences", href: "/app/preferences", icon: BellRing },
] as const;
const AGENT_NAV = [
  { key: "missions", href: "/app/missions", icon: ListChecks },
  { key: "messages", href: "/app/messages", icon: MessagesSquare },
  { key: "profile", href: "/app/profile", icon: CircleUser },
  { key: "preferences", href: "/app/preferences", icon: BellRing },
] as const;

/** Coquille de l'environnement connecté : environnement affiché en permanence, navigation selon le rôle. */
export async function ConnectedShell({ org, orgs, email, missingName = false, unreadChats = 0, children }: { org: OrgSummary | null; orgs: OrgSummary[]; email: string; missingName?: boolean; unreadChats?: number; children: React.ReactNode }) {
  const t = await getTranslations("connected");
  const manager = org?.role === "owner" || org?.role === "manager";
  const nav = org ? (manager ? MANAGER_NAV : AGENT_NAV) : [];
  return (
    <div className="min-h-dvh bg-subtle">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-8">
          <Link href="/app" aria-label="HALO">
            <Logo />
          </Link>
          <EnvBadge />
          <div className="ms-auto flex items-center gap-2">
            {orgs.length > 1 && org ? <OrgSwitcher orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} current={org.id} /> : org ? <span className="hidden text-[14px] font-medium sm:inline">{org.name}</span> : null}
            <LocaleSwitcher variant="icon" />
            <SignOutButton label={t("signOut")} email={email} />
          </div>
        </div>
        {nav.length > 0 && (
          <nav aria-label={t("nav.label")} className="mx-auto flex max-w-[1200px] items-start gap-1 px-2 md:px-6">
            <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
              {nav.map(({ key, href, icon: Icon }) => (
                <li key={key}>
                  <Link href={href} className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md px-3 text-[14px] font-medium text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover">
                    <Icon className="size-4" />
                    {t(`nav.${key}`)}
                    {key === "messages" && unreadChats > 0 && (
                      <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white" data-testid="nav-chat-unread">
                        {unreadChats}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {manager && (
              <div className="shrink-0 pb-2">
                <NavMore label={t("nav.more")} items={MANAGER_MORE.map(({ key, href, icon: Icon }) => ({ href, label: t(`nav.${key}`), icon: <Icon className="size-4" />, testId: `nav-${key}` }))} />
              </div>
            )}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-6 md:px-8 md:pt-8">
        {missingName && org && (
          // Profil sans nom : l'équipe verrait « Sans nom » — on le demande partout jusqu'à ce qu'il soit renseigné
          <Link href="/app/profile" className="mb-4 flex items-center gap-3 rounded-xl border border-warning bg-warning-soft p-4 text-[15px]" data-testid="profile-incomplete">
            <CircleUser className="size-5 shrink-0 text-warning" />
            <span className="flex-1">
              <span className="block font-semibold">{t("profile.incompleteTitle")}</span>
              <span className="block text-[14px] text-muted">{t("profile.incompleteText")}</span>
            </span>
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
