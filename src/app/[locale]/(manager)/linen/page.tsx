import { getTranslations, setRequestLocale } from "next-intl/server";
import { Linen } from "@/components/views/linen";

export async function generateMetadata({ params }: PageProps<"/[locale]/linen">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("linen") };
}

export default async function Page({ params }: PageProps<"/[locale]/linen">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Linen />;
}
