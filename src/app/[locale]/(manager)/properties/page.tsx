import { getTranslations, setRequestLocale } from "next-intl/server";
import { PropertiesList } from "@/components/views/properties-list";

export async function generateMetadata({ params }: PageProps<"/[locale]/properties">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("properties") };
}

export default async function Page({ params }: PageProps<"/[locale]/properties">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PropertiesList />;
}
