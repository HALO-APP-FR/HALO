import { getTranslations, setRequestLocale } from "next-intl/server";
import { Planning } from "@/components/views/planning";

export async function generateMetadata({ params }: PageProps<"/[locale]/planning">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("planning") };
}

export default async function Page({ params, searchParams }: PageProps<"/[locale]/planning">) {
  const { locale } = await params;
  const { day } = await searchParams;
  setRequestLocale(locale);
  return <Planning initialDay={typeof day === "string" ? day : undefined} />;
}
