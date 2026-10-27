import { getTranslations, setRequestLocale } from "next-intl/server";
import { Services } from "@/components/views/services";

export async function generateMetadata({ params }: PageProps<"/[locale]/services">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("services") };
}

export default async function Page({ params }: PageProps<"/[locale]/services">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Services />;
}
