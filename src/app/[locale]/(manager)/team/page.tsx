import { getTranslations, setRequestLocale } from "next-intl/server";
import { Team } from "@/components/views/team";

export async function generateMetadata({ params }: PageProps<"/[locale]/team">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("team") };
}

export default async function Page({ params }: PageProps<"/[locale]/team">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Team />;
}
