import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertTriangle, ArrowRight, Cloud, FlaskConical, LayoutDashboard, Smartphone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { EnvBadge } from "@/components/connected/env-badge";
import { isConnected } from "@/lib/supabase/config";
import { backendHealth } from "@/lib/connected/health";

export const dynamic = "force-dynamic";

/**
 * Accueil.
 * - Déploiement CONNECTÉ (préproduction, production) : l'environnement connecté est le parcours principal ;
 *   la démo n'est qu'une entrée secondaire, explicitement étiquetée, qui mène à /demo.
 *   Le libellé « données sauvegardées en ligne » n'apparaît que si le backend a été vérifié à l'instant.
 * - Déploiement sans backend (démo publique) : les deux espaces de démo, présentés comme tels.
 */
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("spaces");
  const connected = isConnected();
  const health = connected ? await backendHealth() : null;

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex justify-end px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 md:pt-6">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          <div className="flex flex-col items-center text-center">
            <LogoMark className="size-14 text-fg" />
            <h1 className="mt-6 text-title-1">{connected ? t("connectedTitle") : t("title")}</h1>
            <p className="mt-2 text-body text-muted">{connected ? t("connectedSubtitle") : t("subtitle")}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );

  if (connected) {
    const ready = health?.ready;
    return shell(
      <>
        {ready ? (
          <Link
            href="/auth/sign-in"
            className="mt-8 flex items-center gap-4 rounded-xl border border-accent bg-surface p-5 shadow-card transition-colors hover:bg-surface-hover"
            data-testid="connected-entry"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent text-on-accent">
              <Cloud className="size-6" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-title-3">{t("connected")}</span>
              <span className="mt-0.5 block text-[14px] text-muted">{t("connectedText")}</span>
              <span className="mt-2 inline-block">
                <EnvBadge />
              </span>
            </span>
            <ArrowRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" />
          </Link>
        ) : (
          <Link href="/status" className="mt-8 flex items-start gap-3 rounded-xl border border-danger bg-danger-soft p-5" data-testid="connected-unavailable">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <span className="text-[15px]">
              <span className="block font-semibold">{t("unavailableTitle")}</span>
              <span className="mt-0.5 block text-muted">{t("unavailableText")}</span>
            </span>
          </Link>
        )}
        <section className="mt-10 border-t border-line pt-6" aria-labelledby="demo-title">
          <h2 id="demo-title" className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-warning">
            <FlaskConical className="size-4" />
            {t("demoSection")}
          </h2>
          <p className="mt-1 text-[14px] text-muted">{t("demoSectionText")}</p>
          <Link href="/demo" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-fg hover:underline" data-testid="demo-link">
            {t("demoOpen")}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        </section>
        <p className="mt-6 text-center text-[13px]">
          <Link href="/status" className="text-muted hover:underline">
            {t("statusLink")}
          </Link>
        </p>
      </>,
    );
  }

  const spaces = [
    { href: "/today", icon: LayoutDashboard, title: t("manager"), text: t("managerText") },
    { href: "/a/today", icon: Smartphone, title: t("agent"), text: t("agentText") },
  ] as const;
  return shell(
    <>
      <ul className="mt-8 space-y-3">
        {spaces.map(({ href, icon: Icon, title, text }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:bg-surface-hover">
              <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
                <Icon className="size-6" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-title-3">{title}</span>
                <span className="mt-0.5 block text-[14px] text-muted">{text}</span>
              </span>
              <ArrowRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-caption text-fg">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
        {t("demoNotice")}
      </p>
    </>,
  );
}
