import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ConnectedShell } from "@/components/connected/shell";
import { getContext } from "@/lib/connected/context";
import { isConnected } from "@/lib/supabase/config";

/** Environnement connecté : session obligatoire, vérifiée côté serveur à chaque requête. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]/app">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!isConnected()) {
    const t = await getTranslations("connected");
    return <p className="mx-auto max-w-lg p-8 text-[15px] text-muted">{t("notConfigured")}</p>;
  }
  const { user, org, orgs } = await getContext();
  if (!user) redirect({ href: "/auth/sign-in", locale });
  return (
    <ConnectedShell org={org} orgs={orgs} email={user!.email ?? ""}>
      {children}
    </ConnectedShell>
  );
}
