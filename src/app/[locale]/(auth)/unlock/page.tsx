import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Avatar } from "@/components/halo/avatar";
import { AnimatedLogoMark } from "@/components/halo/logo";
import { UnlockPad } from "@/components/halo/unlock-pad";
import { DEMO_CURRENT_AGENT_ID, demoAgents } from "@/lib/demo/data";

/**
 * Écran quotidien de l'agent sur un téléphone déjà reconnu :
 * il ne tape que son code, rien d'autre. (Phase 2 : nom et appareil venant du serveur.)
 */
export async function generateMetadata({ params }: PageProps<"/[locale]/unlock">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("pinTitle") };
}

export default async function UnlockPage({ params }: PageProps<"/[locale]/unlock">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const me = demoAgents.find((a) => a.id === DEMO_CURRENT_AGENT_ID)!;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-subtle px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),40px)]">
      <AnimatedLogoMark className="size-10 text-fg" label="HALO" />
      <div className="halo-rise mt-10 flex flex-col items-center text-center [animation-delay:0.3s]">
        <Avatar initials={me.initials} color={me.color} size="lg" />
        <h1 className="mt-4 text-title-1">{t("hello", { name: me.name.split(" ")[0] })}</h1>
        <p className="mt-1 text-body text-muted">{t("pinTitle")}</p>
      </div>
      <div className="halo-rise mt-10 [animation-delay:0.45s]">
        <UnlockPad />
      </div>
      <div className="mt-auto flex flex-col items-center gap-3 pt-10 text-center">
        <Link href="/login?role=agent" className="flex h-11 items-center px-3 text-[15px] font-medium text-accent-text">
          {t("notYou")}
        </Link>
        <p className="max-w-xs text-caption text-muted">{t("pinForgot")}</p>
      </div>
    </div>
  );
}
