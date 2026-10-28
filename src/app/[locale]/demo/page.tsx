import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, FlaskConical, LayoutDashboard, LogOut, Smartphone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { isConnected } from "@/lib/supabase/config";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Entrée EXPLICITE de la démo : séparée de l'environnement connecté, et présentée comme telle. */
export default async function DemoEntry({ params }: PageProps<"/[locale]/demo">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("demoEntry");
  const ts = await getTranslations("spaces");
  const spaces = [
    { to: `/${locale}/today`, icon: LayoutDashboard, title: ts("manager"), text: ts("managerText") },
    { to: `/${locale}/a/today`, icon: Smartphone, title: ts("agent"), text: ts("agentText") },
  ];
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex justify-end px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 md:pt-6">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          <div className="flex flex-col items-center text-center">
            <LogoMark className="size-14 text-fg" />
            <span className="mt-5 inline-flex h-7 items-center gap-1.5 rounded-full bg-warning-soft px-3 text-[12px] font-semibold text-warning" data-testid="demo-entry-badge">
              <FlaskConical className="size-3.5" />
              {t("badge")}
            </span>
            <h1 className="mt-4 text-title-1">{t("title")}</h1>
            <p className="mt-2 text-body text-muted">{t("text")}</p>
          </div>
          <ul className="mt-8 space-y-3">
            {spaces.map(({ to, icon: Icon, title, text }) => (
              <li key={to}>
                {/* Passage par /api/demo : pose le marqueur « démo » puis ouvre l'espace */}
                <a
                  href={`/api/demo?to=${encodeURIComponent(to)}`}
                  className="flex items-center gap-4 rounded-xl border border-dashed border-warning bg-surface p-5 transition-colors hover:bg-surface-hover"
                  data-testid="demo-space"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                    <Icon className="size-6" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-title-3">
                      {title} · {t("badge")}
                    </span>
                    <span className="mt-0.5 block text-[14px] text-muted">{text}</span>
                  </span>
                  <ArrowRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-6 rounded-lg bg-warning-soft p-3 text-caption text-fg">{t("warning")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-4 text-[14px]">
            {isConnected() && (
              <Link href="/auth/sign-in" className="font-medium text-accent-text hover:underline">
                {t("toConnected")}
              </Link>
            )}
            <a href={`/api/demo?action=exit&to=/${locale}/`} className="inline-flex items-center gap-1.5 text-muted hover:underline">
              <LogOut className="size-4" />
              {t("exit")}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
