import { getTranslations, setRequestLocale } from "next-intl/server";
import { PropertyDetail } from "@/components/views/property-detail";

export async function generateMetadata({ params }: PageProps<"/[locale]/properties/[id]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("properties") };
}

export default async function Page({ params }: PageProps<"/[locale]/properties/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <PropertyDetail id={id} />;
}
