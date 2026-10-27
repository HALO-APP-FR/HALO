import { getTranslations, setRequestLocale } from "next-intl/server";
import { AgentUpcoming } from "@/components/views/agent-views";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/upcoming">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("calendar") };
}

export default async function Page({ params }: PageProps<"/[locale]/a/upcoming">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AgentUpcoming />;
}
