import { getTranslations, setRequestLocale } from "next-intl/server";
import { Monitor } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/halo/avatar";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { ThemeSwitcher } from "@/components/halo/theme-switcher";
import { DEMO_CURRENT_AGENT_ID, demoAgents } from "@/lib/demo/data";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/profile">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("profile") };
}

export default async function AgentProfilePage({ params }: PageProps<"/[locale]/a/profile">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const me = demoAgents.find((a) => a.id === DEMO_CURRENT_AGENT_ID)!;

  return (
    <>
      <h1 className="pb-6 text-display">{t("profile.title")}</h1>
      <Card className="flex items-center gap-4 p-5">
        <Avatar initials={me.initials} color={me.color} size="lg" />
        <div>
          <div className="text-title-3">{me.name}</div>
          <div className="text-[15px] text-muted">HALO Demo</div>
        </div>
      </Card>

      <h2 className="mb-3 mt-8 text-micro text-muted">{t("profile.preferences")}</h2>
      <Card className="divide-y divide-line px-4">
        <div className="py-1">
          <LocaleSwitcher variant="row" />
        </div>
        <div className="py-4">
          <div className="mb-3 text-[17px]">{t("theme.label")}</div>
          <ThemeSwitcher className="flex w-full" />
        </div>
      </Card>

      <Link href="/today" className="mt-8 flex items-center justify-center gap-2 text-[15px] font-medium text-accent-text">
        <Monitor className="size-4" />
        {t("nav.switchToManager")}
      </Link>
    </>
  );
}
