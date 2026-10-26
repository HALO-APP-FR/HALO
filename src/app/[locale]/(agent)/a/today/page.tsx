import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Sun } from "lucide-react";
import { EmptyState } from "@/components/halo/empty-state";
import { TaskCard } from "@/components/halo/task-card";
import { DEMO_CURRENT_AGENT_ID, demoAgents, demoProperties, getDemoDay } from "@/lib/demo/data";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/today">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("today") };
}

export default async function AgentTodayPage({ params }: PageProps<"/[locale]/a/today">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection(); // « maintenant » = l\'heure de la requête, pas celle du build
  const t = await getTranslations();
  const now = new Date();
  const me = demoAgents.find((a) => a.id === DEMO_CURRENT_AGENT_ID)!;
  const tasks = getDemoDay(now)
    .tasks.filter((x) => x.assigneeId === me.id && x.status !== "cancelled")
    .sort((a, b) => a.windowEnd.getTime() - b.windowEnd.getTime());
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <>
      <header className="pb-6">
        <p className="text-[15px] font-medium text-muted first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-1 text-display">{t("agentToday.greeting", { name: me.name.split(" ")[0] })}</h1>
        <p className="mt-1 text-[17px] text-muted">{t("agentToday.summary", { count: tasks.length })}</p>
      </header>

      {tasks.length === 0 ? (
        <EmptyState icon={Sun} title={t("agentToday.emptyTitle")} text={t("agentToday.emptyText")} />
      ) : (
        <ol className="space-y-4">
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskCard task={task} property={demoProperties.find((p) => p.id === task.propertyId)!} now={now} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
