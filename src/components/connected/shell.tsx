import { getTranslations } from "next-intl/server";
import { Building2, CalendarDays, ConciergeBell, House, ListChecks, Settings2, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { EnvBadge } from "./env-badge";
import { OrgSwitcher, SignOutButton } from "./shell-client";
import type { OrgSummary } from "@/lib/connected/context";

const MANAGER_NAV = [
  { key: "home", href: "/app", icon: House },
  { key: "stays", href: "/app/stays", icon: CalendarDays },
  { key: "services", href: "/app/services", icon: ConciergeBell },
  { key: "missions", href: "/app/missions", icon: ListChecks },
  { key: "properties", href: "/app/properties", icon: Building2 },
  { key: "team", href: "/app/team", icon: Users },
  { key: "setup", href: "/app/onboarding", icon: Settings2 },
] as const;
const AGENT_NAV = [{ key: "missions", href: "/app/missions", icon: ListChecks }] as const;

/** Coquille de l'environnement connecté : environnement affiché en permanence, navigation selon le rôle. */
export async function ConnectedShell({ org, orgs, email, children }: { org: OrgSummary | null; orgs: OrgSummary[]; email: string; children: React.ReactNode }) {
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
          <nav aria-label={t("nav.label")} className="mx-auto max-w-[1200px] overflow-x-auto px-2 [scrollbar-width:none] md:px-6">
            <ul className="flex gap-1 pb-2">
              {nav.map(({ key, href, icon: Icon }) => (
                <li key={key}>
                  <Link href={href} className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md px-3 text-[14px] font-medium text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover">
                    <Icon className="size-4" />
                    {t(`nav.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-6 md:px-8 md:pt-8">{children}</main>
    </div>
  );
}
