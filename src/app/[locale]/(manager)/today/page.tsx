import { getTranslations, setRequestLocale } from "next-intl/server";
import { ManagerToday } from "@/components/views/manager-today";

export async function generateMetadata({ params }: PageProps<"/[locale]/today">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("today") };
}

export default async function ManagerTodayPage({ params }: PageProps<"/[locale]/today">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ManagerToday />;
}
