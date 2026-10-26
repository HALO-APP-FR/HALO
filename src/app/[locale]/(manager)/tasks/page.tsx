import { getTranslations, setRequestLocale } from "next-intl/server";
import { TasksList } from "@/components/views/tasks-list";

export async function generateMetadata({ params }: PageProps<"/[locale]/tasks">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("tasks") };
}

export default async function Page({ params }: PageProps<"/[locale]/tasks">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TasksList />;
}
