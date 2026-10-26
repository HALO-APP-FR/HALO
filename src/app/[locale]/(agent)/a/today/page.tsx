import { getTranslations, setRequestLocale } from "next-intl/server";
import { AgentToday } from "@/components/views/agent-views";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/today">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("today") };
}

export default async function Page({ params }: PageProps<"/[locale]/a/today">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AgentToday />;
}
