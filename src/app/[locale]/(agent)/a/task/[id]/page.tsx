import { getTranslations, setRequestLocale } from "next-intl/server";
import { AgentTask } from "@/components/views/agent-task";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/task/[id]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mission" });
  return { title: t("title") };
}

export default async function Page({ params }: PageProps<"/[locale]/a/task/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <AgentTask taskId={id} />;
}
