import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { EnvBadge } from "@/components/connected/env-badge";
import { SignInForm } from "@/components/connected/sign-in-form";
import { isConnected } from "@/lib/supabase/config";
import { getContext } from "@/lib/connected/context";

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/auth/sign-in">) {
  const { locale } = await params;
  const { error, next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  setRequestLocale(locale);
  const t = await getTranslations("connected");
  if (isConnected()) {
    const { user } = await getContext();
    if (user) redirect({ href: nextPath && /^\/(app|invite)(\/[\w-]*)*$/.test(nextPath) ? nextPath : "/app", locale });
  }
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 md:pt-6">
        <EnvBadge />
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="flex flex-col items-center text-center">
            <LogoMark className="size-14 text-fg" />
            <h1 className="mt-6 text-title-1">{t("signIn.title")}</h1>
            <p className="mt-2 text-body text-muted">{t("signIn.subtitle")}</p>
          </div>
          <div className="mt-8 rounded-xl border border-line bg-surface p-6 shadow-card">
            {isConnected() ? (
              <SignInForm initialError={error === "link" ? "link" : undefined} next={nextPath} />
            ) : (
              <p className="text-[15px] text-muted">{t("notConfigured")}</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
