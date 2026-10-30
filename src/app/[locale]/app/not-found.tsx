import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";

/** Dans l'espace connecté : même message qu'une ressource soit absente ou hors de l'organisation active. */
export default async function AppNotFound() {
  const t = await getTranslations("notFound");
  return (
    <Card className="mx-auto max-w-lg p-6 text-center" data-testid="not-found">
      <h1 className="text-title-2">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-muted">{t("textApp")}</p>
      <Link href="/app" className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-on-accent">
        {t("home")}
      </Link>
    </Card>
  );
}
