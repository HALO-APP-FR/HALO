"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DemoBadge } from "./demo-badge";
import { InboxButton } from "./inbox";
import { OfflineBanner } from "./offline-banner";
import { agentNav, isActive } from "./nav-config";

/** Coquille de l'app agent : contenu + 3 onglets en bas, rien d'autre. */
export function AgentShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-subtle">
      <OfflineBanner />
      <main className="relative mx-auto w-full max-w-xl px-4 pb-32 pt-[max(env(safe-area-inset-top),24px)]">
        <div className="absolute end-4 top-[max(env(safe-area-inset-top),16px)] flex items-center gap-1">
          <InboxButton audience="agent" />
          <DemoBadge />
        </div>
        {children}
      </main>
      <nav
        aria-label={t("mainNavigation")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      >
        <ul className="mx-auto grid h-[68px] max-w-xl grid-cols-3">
          {agentNav.map(({ key, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-full flex-col items-center justify-center gap-1 text-[12px] font-medium", active ? "text-accent-text" : "text-muted")}
                >
                  <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
