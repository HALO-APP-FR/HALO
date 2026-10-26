import { getTranslations, setRequestLocale } from "next-intl/server";
import { TasksList } from "@/components/views/tasks-list";

export async function generateMetadata({ params }: PageProps<"/[locale]/tasks">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("tasks") };
}

export default async function Page({ params, searchParams }: PageProps<"/[locale]/tasks">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <TasksList initial={{ period: one(sp.period), type: one(sp.type), status: one(sp.status), day: one(sp.day) }} />;
}
