"use client";

import { useTranslations } from "next-intl";
import { Ellipsis, PanelLeftClose, PanelLeftOpen, Smartphone } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { Avatar } from "./avatar";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { OfflineBanner } from "./offline-banner";
import { isActive, managerMobileTabs, managerNav } from "./nav-config";
import { usePersistedFlag } from "./use-persisted-flag";
import { useHalo } from "@/lib/store/halo-store";

/** Pastille de compteur (alertes ouvertes). */
function CountDot({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn("grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold leading-none text-white tabular", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = usePersistedFlag("halo.sidebar.collapsed");
  const mobileTabs = managerNav.filter((n) => managerMobileTabs.includes(n.key));
  const moreItems = managerNav.filter((n) => !managerMobileTabs.includes(n.key));
  const moreActive = moreItems.some((n) => isActive(pathname, n.href));
  const alerts = useHalo((s) => s.alerts);
  const openAlerts = alerts.filter((a) => a.status !== "resolved").length;
  const badge = (key: string) => (key === "alerts" ? openAlerts : 0);

  return (
    <div className="min-h-dvh bg-subtle">
      {/* ===== Barre latérale (ordinateur) ===== */}
      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-30 hidden flex-col border-e border-line bg-canvas transition-[width] duration-280 ease-halo md:flex",
          collapsed ? "w-[72px]" : "w-[248px]",
        )}
      >
        <div className={cn("flex h-16 items-center", collapsed ? "justify-center" : "justify-between px-5")}>
          <Link href="/today" aria-label="HALO">
            <Logo compact={collapsed} />
          </Link>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="grid size-8 place-items-center rounded-sm text-faint transition-colors hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
              aria-label={t("collapse")}
            >
              <PanelLeftClose className="size-[18px] rtl:-scale-x-100" />
            </button>
          )}
        </div>

        <nav aria-label={t("mainNavigation")} className="flex-1 px-3 pt-2">
          <ul className="space-y-0.5">
            {managerNav.map(({ key, href, icon: Icon }) => {
              const active = isActive(pathname, href);
              const link = (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-[14px] font-medium text-muted transition-colors duration-150",
                    "hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover",
                    active && "bg-subtle text-fg dark:bg-surface-hover",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className={cn("size-[18px] shrink-0", active && "text-accent-text")} strokeWidth={active ? 2.2 : 1.8} />
                  {!collapsed && <span className="truncate">{t(key)}</span>}
                </Link>
              );
              return (
                <li key={key}>
                  {collapsed ? (
                    <Tooltip content={t(key)} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={cn("space-y-1 border-t border-line p-3", collapsed && "flex flex-col items-center")}>
          {collapsed ? (
            <>
              <Tooltip content={t("expand")} side="right">
                <button
                  onClick={() => setCollapsed(false)}
                  className="grid size-10 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
                  aria-label={t("expand")}
                >
                  <PanelLeftOpen className="size-[18px] rtl:-scale-x-100" />
                </button>
              </Tooltip>
              <Avatar initials="MD" size="md" color="#0B0B0C" label="Mathieu D." />
            </>
          ) : (
            <>
              <Link
                href="/a/today"
                className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] font-medium text-muted hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
              >
                <Smartphone className="size-4" />
                {t("switchToAgent")}
              </Link>
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar initials="MD" size="md" color="#0B0B0C" className="dark:!bg-line" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">Mathieu D.</div>
                    <div className="truncate text-caption text-muted">HALO Demo</div>
                  </div>
                </div>
                <LocaleSwitcher variant="icon" />
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ===== Contenu ===== */}
      <div className={cn("transition-[padding] duration-280 ease-halo", collapsed ? "md:ps-[72px]" : "md:ps-[248px]")}>
        <OfflineBanner />
        {/* En-tête mobile */}
        <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-canvas/85 px-4 backdrop-blur-xl md:hidden">
          <Logo />
          <Avatar initials="MD" size="md" color="#0B0B0C" className="dark:!bg-line" label="Mathieu D." />
        </div>
        <main className="mx-auto w-full max-w-[1280px] px-4 pb-32 pt-6 md:px-8 md:pb-16 md:pt-10">{children}</main>
      </div>

      {/* ===== Barre d'onglets (mobile) ===== */}
      <nav
        aria-label={t("mainNavigation")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {mobileTabs.map(({ key, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium", active ? "text-accent-text" : "text-muted")}
                >
                  <span className="relative">
                    <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
                    <CountDot count={badge(key)} className="absolute -end-2.5 -top-1.5 h-4 min-w-4 px-1 text-[10px]" />
                  </span>
                  {t(key)}
                </Link>
              </li>
            );
          })}
          <li>
            <Sheet>
              <SheetTrigger
                className={cn("flex h-full w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium", moreActive ? "text-accent-text" : "text-muted")}
              >
                <Ellipsis className="size-[22px]" strokeWidth={1.8} />
                {t("more")}
              </SheetTrigger>
              <SheetContent title={t("more")}>
                <ul className="divide-y divide-line">
                  {moreItems.map(({ key, href, icon: Icon }) => (
                    <li key={key}>
                      <Link href={href} className="flex h-14 items-center gap-3 text-[17px]">
                        <Icon className="size-5 text-muted" strokeWidth={1.8} />
                        {t(key)}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href="/a/today" className="flex h-14 items-center gap-3 text-[17px]">
                      <Smartphone className="size-5 text-muted" strokeWidth={1.8} />
                      {t("switchToAgent")}
                    </Link>
                  </li>
                  <li className="py-2">
                    <LocaleSwitcher variant="row" />
                  </li>
                </ul>
                <ThemeSwitcher className="mt-4 flex w-full" />
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
    </div>
  );
}
