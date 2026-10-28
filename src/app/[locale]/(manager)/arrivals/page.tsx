import { getTranslations, setRequestLocale } from "next-intl/server";
import { Arrivals } from "@/components/views/arrivals";

export async function generateMetadata({ params }: PageProps<"/[locale]/arrivals">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("arrivals") };
}

export default async function Page({ params }: PageProps<"/[locale]/arrivals">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Arrivals />;
}
