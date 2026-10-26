import { getTranslations, setRequestLocale } from "next-intl/server";
import { AnimatedLogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { LoginForm } from "@/components/halo/login-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("title") };
}

export default async function LoginPage({ params }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex justify-end px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 md:pt-6">
        <LocaleSwitcher />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="flex flex-col items-center text-center">
            <AnimatedLogoMark className="size-20 text-fg" label="HALO" />
            <h1 className="halo-rise mt-8 text-title-1 [animation-delay:0.55s]">{t("welcome")}</h1>
            <p className="halo-rise mt-2 text-body text-muted [animation-delay:0.75s]">{t("subtitle")}</p>
          </div>

          <div className="halo-rise mt-10 rounded-xl border border-line bg-surface p-6 shadow-card [animation-delay:0.85s] md:p-8">
            <LoginForm />
          </div>

          <p className="halo-rise mt-6 text-center text-caption text-muted [animation-delay:0.95s]">{t("agentHint")}</p>
        </div>
      </main>

      <footer className="px-6 pb-[max(env(safe-area-inset-bottom),24px)] text-center text-caption text-muted">
        {t("legal")}
      </footer>
    </div>
  );
}
