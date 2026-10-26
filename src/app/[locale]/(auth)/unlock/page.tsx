import { getTranslations, setRequestLocale } from "next-intl/server";
import { UnlockView } from "@/components/views/unlock-view";

/** Écran quotidien de l'agent sur un téléphone déjà reconnu : il ne tape que son code. */
export async function generateMetadata({ params }: PageProps<"/[locale]/unlock">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("pinTitle") };
}

export default async function UnlockPage({ params }: PageProps<"/[locale]/unlock">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <UnlockView />;
}
