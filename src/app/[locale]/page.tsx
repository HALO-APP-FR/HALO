import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, FlaskConical, LayoutDashboard, Smartphone } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";

/**
 * Accueil : choix de l'espace.
 * Démo : aucun compte, les deux espaces sont ouverts et c'est dit clairement.
 * Avec la connexion réelle (étape 1.3), `landingFor()` (src/lib/auth/spaces.ts)
 * redirige directement selon les rôles du compte, et l'espace Manager est
 * refusé côté serveur à un agent ; la base refuse déjà ses actions (RLS).
 */
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("spaces");

  const spaces = [
    { href: "/today", icon: LayoutDashboard, title: t("manager"), text: t("managerText") },
    { href: "/a/today", icon: Smartphone, title: t("agent"), text: t("agentText") },
  ] as const;

  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex justify-end px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 md:pt-6">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px]">
          <div className="flex flex-col items-center text-center">
            <LogoMark className="size-14 text-fg" />
            <h1 className="mt-6 text-title-1">{t("title")}</h1>
            <p className="mt-2 text-body text-muted">{t("subtitle")}</p>
          </div>
          <ul className="mt-8 space-y-3">
            {spaces.map(({ href, icon: Icon, title, text }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:bg-surface-hover"
                >
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
        </div>
      </main>
    </div>
  );
}
