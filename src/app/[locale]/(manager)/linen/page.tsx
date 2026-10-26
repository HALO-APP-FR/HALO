import { BedDouble } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionPlaceholder } from "@/components/halo/section-placeholder";

export async function generateMetadata({ params }: PageProps<"/[locale]/linen">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("linen") };
}

export default async function Page({ params }: PageProps<"/[locale]/linen">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SectionPlaceholder titleKey="linen" icon={BedDouble} />;
}
