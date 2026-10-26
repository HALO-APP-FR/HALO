import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/halo/empty-state";
import { TaskCard } from "@/components/halo/task-card";
import { localDateKey } from "@/lib/engine/time";
import { demoProperties, getDemoDay, type DemoTask } from "@/lib/demo/data";

export async function generateMetadata({ params }: PageProps<"/[locale]/a/upcoming">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("upcoming") };
}

export default async function AgentUpcomingPage({ params }: PageProps<"/[locale]/a/upcoming">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection(); // « maintenant » = l\'heure de la requête, pas celle du build
  const t = await getTranslations();
  const now = new Date();
  const tasks = getDemoDay(now).upcoming;

  // Regroupement par jour (à l'heure du logement)
  const groups = new Map<string, DemoTask[]>();
  for (const task of tasks) {
    const tz = demoProperties.find((p) => p.id === task.propertyId)!.timezone;
    const key = localDateKey(task.windowStart, tz);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return (
    <>
      <h1 className="pb-6 text-display">{t("agentUpcoming.title")}</h1>
      {groups.size === 0 ? (
        <EmptyState icon={CalendarClock} title={t("agentUpcoming.title")} text={t("agentUpcoming.emptyText")} />
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-3 text-title-3 first-letter:uppercase">
                {new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
                  new Date(`${key}T12:00:00Z`),
                )}
              </h2>
              <ol className="space-y-3">
                {list.map((task) => (
                  <li key={task.id}>
                    <TaskCard task={task} property={demoProperties.find((p) => p.id === task.propertyId)!} now={now} showAction={false} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
