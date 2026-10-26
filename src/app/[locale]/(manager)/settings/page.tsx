import { Settings } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionPlaceholder } from "@/components/halo/section-placeholder";

export async function generateMetadata({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("settings") };
}

export default async function Page({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SectionPlaceholder titleKey="settings" icon={Settings} />;
}
