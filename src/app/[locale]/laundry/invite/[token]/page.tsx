import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";
import { EnvBadge } from "@/components/connected/env-badge";
import { AcceptLaundryInvite } from "@/components/connected/laundry";
import { getContext } from "@/lib/connected/context";
import { isConnected } from "@/lib/supabase/config";

/** Invitation nominative d'un blanchisseur : acceptée seulement par le compte de l'adresse invitée. */
export default async function LaundryInvitePage({ params }: PageProps<"/[locale]/laundry/invite/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.laundry");
  const tc = await getTranslations("connected");
  if (!isConnected()) return <p className="mx-auto max-w-lg p-8 text-[15px] text-muted">{tc("notConfigured")}</p>;
  const { user } = await getContext();
  if (!user) redirect({ href: { pathname: "/auth/sign-in", query: { next: `/laundry/invite/${token}` } }, locale });
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="px-4 pt-4 md:px-8 md:pt-6">
        <EnvBadge />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] rounded-xl border border-line bg-surface p-6 text-center shadow-card" data-testid="laundry-invite-page">
          <LogoMark className="mx-auto size-12 text-fg" />
          <h1 className="mt-5 text-title-2">{t("inviteTitle")}</h1>
          <p className="mb-6 mt-2 text-[15px] text-muted">{t("inviteSignedAs", { email: user!.email ?? "" })}</p>
          <AcceptLaundryInvite token={token} />
        </div>
      </main>
    </div>
  );
}
