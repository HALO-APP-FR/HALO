import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { ConnectedShell } from "@/components/connected/shell";
import { getContext } from "@/lib/connected/context";
import { unreadThreads } from "@/lib/connected/chat";
import { isConnected } from "@/lib/supabase/config";

/** Environnement connecté : session obligatoire, vérifiée côté serveur à chaque requête. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]/app">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!isConnected()) {
    const t = await getTranslations("connected");
    return <p className="mx-auto max-w-lg p-8 text-[15px] text-muted">{t("notConfigured")}</p>;
  }
  const { supabase, user, org, orgs, profile } = await getContext();
  if (!user) redirect({ href: "/auth/sign-in", locale });
  const unreadChats = org ? await unreadThreads(supabase, org.id) : 0;
  return (
    <ConnectedShell org={org} orgs={orgs} email={user!.email ?? ""} missingName={!profile?.full_name?.trim()} unreadChats={unreadChats}>
      {children}
    </ConnectedShell>
  );
}
