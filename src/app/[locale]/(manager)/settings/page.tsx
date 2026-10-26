import { getTranslations, setRequestLocale } from "next-intl/server";
import { Settings } from "@/components/views/settings";

export async function generateMetadata({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("settings") };
}

export default async function Page({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Settings />;
}
