import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alerts } from "@/components/views/alerts";

export async function generateMetadata({ params }: PageProps<"/[locale]/alerts">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("alerts") };
}

export default async function Page({ params }: PageProps<"/[locale]/alerts">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Alerts />;
}
