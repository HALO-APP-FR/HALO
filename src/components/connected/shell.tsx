import { getTranslations } from "next-intl/server";
import { CircleUser, ListChecks, MessagesSquare, BellRing } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { EnvBadge } from "./env-badge";
import { AccountMenu, BottomBar, MessagesButton, OrgSwitcher, SpaceNav, SpaceTabs, type NavLabels } from "./shell-client";
import type { OrgSummary } from "@/lib/connected/context";

const AGENT_NAV = [
  { key: "missions", href: "/app/missions", icon: ListChecks },
  { key: "messages", href: "/app/messages", icon: MessagesSquare },
  { key: "profile", href: "/app/profile", icon: CircleUser },
  { key: "preferences", href: "/app/preferences", icon: BellRing },
] as const;

/**
 * Coquille de l'environnement connecté.
 * Responsable : quatre espaces (Tableau de bord, Logistique, Équipe, Guest), barre inférieure sur téléphone,
 * Messages et Compte toujours accessibles en haut. Toutes les adresses existantes restent valides :
 * chaque page est simplement rattachée à un espace (voir SPACES dans shell-client).
 * Agent : navigation inchangée.
 */
export async function ConnectedShell({ org, orgs, email, missingName = false, unreadChats = 0, children }: { org: OrgSummary | null; orgs: OrgSummary[]; email: string; missingName?: boolean; unreadChats?: number; children: React.ReactNode }) {
  const t = await getTranslations("connected");
  const manager = org?.role === "owner" || org?.role === "manager";
  const labelKeys = ["dashboard", "logistics", "teamSpace", "guest", "missions", "incidents", "properties", "import", "members", "toValidate", "messages", "stays", "services", "bookings", "satisfaction", "profile", "preferences", "settings", "setup", "notifications", "account", "label", "spaceTabs"] as const;
  const labels = Object.fromEntries(labelKeys.map((k) => [k, t(`nav.${k}`)])) as NavLabels;
  return (
    <div className="min-h-dvh bg-subtle">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-8">
          <Link href="/app" aria-label="HALO" className="shrink-0">
            <Logo />
          </Link>
          <EnvBadge />
          {manager && <SpaceNav labels={labels} />}
          <div className="ms-auto flex items-center gap-1.5">
            {orgs.length > 1 && org ? <OrgSwitcher orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} current={org.id} /> : org ? <span className="hidden max-w-40 truncate text-[14px] font-medium lg:inline">{org.name}</span> : null}
            {org && manager && <MessagesButton label={labels.messages} unread={unreadChats} />}
            <LocaleSwitcher variant="icon" />
            <AccountMenu labels={labels} email={email} signOut={t("signOut")} manager={manager} />
          </div>
        </div>
        {!manager && org && (
          <nav aria-label={t("nav.label")} className="mx-auto flex max-w-[1200px] items-start gap-1 px-2 md:px-6">
            <ul className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
              {AGENT_NAV.map(({ key, href, icon: Icon }) => (
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
          </nav>
        )}
        {manager && <SpaceTabs labels={labels} />}
      </header>
      <main className={`mx-auto w-full max-w-[1200px] px-4 pt-6 md:px-8 md:pt-8 ${manager ? "pb-28 md:pb-24" : "pb-24"}`}>
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
      {manager && <BottomBar labels={labels} />}
    </div>
  );
}
