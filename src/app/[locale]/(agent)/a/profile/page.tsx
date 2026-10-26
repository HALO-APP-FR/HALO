import { getTranslations, setRequestLocale } from "next-intl/server";
import { AgentProfile } from "@/components/views/agent-views";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/profile">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("profile") };
}

export default async function Page({ params }: PageProps<"/[locale]/a/profile">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AgentProfile />;
}
