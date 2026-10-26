import { useLocale, useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { DemoAgent, DemoProperty, DemoTask } from "@/lib/demo/data";
import { formatLocalTime } from "@/lib/engine/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "./avatar";
import { StatusPill } from "./status-pill";
import { TaskTypeIcon } from "./task-type";

/**
 * Journée du manager : qui fait quoi, et à quelle heure. Rien d'autre.
 * Tableau strict sur ordinateur, liste compacte sur téléphone.
 * Heures à l'heure locale de chaque logement.
 */
export function DayTable({
  tasks,
  properties,
  agents,
  orgTimezone,
}: {
  tasks: DemoTask[];
  properties: DemoProperty[];
  agents: DemoAgent[];
  orgTimezone: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const rows = [...tasks]
    .sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime())
    .map((task) => {
      const property = properties.find((p) => p.id === task.propertyId)!;
      const tz = property.timezone;
      return {
        task,
        property,
        agent: agents.find((a) => a.id === task.assigneeId),
        time: `${formatLocalTime(task.windowStart, tz, locale)} → ${formatLocalTime(task.windowEnd, tz, locale)}`,
        otherTz: tz !== orgTimezone,
      };
    });

  const assignButton = (
    <Button asChild size="sm" variant="outline" className="h-7 border-danger/40 px-2.5 text-danger hover:bg-danger-soft">
      <Link href="/planning">{t("managerToday.assign")}</Link>
    </Button>
  );

  return (
    <>
      {/* Ordinateur : tableau */}
      <table className="hidden w-full text-start md:table">
        <thead>
          <tr className="border-b border-line text-micro text-muted">
            <th scope="col" className="w-[140px] py-2.5 pe-4 text-start font-semibold">{t("managerToday.colTime")}</th>
            <th scope="col" className="py-2.5 pe-4 text-start font-semibold">{t("managerToday.colProperty")}</th>
            <th scope="col" className="py-2.5 pe-4 text-start font-semibold">{t("managerToday.colTask")}</th>
            <th scope="col" className="py-2.5 pe-4 text-start font-semibold">{t("managerToday.colAgent")}</th>
            <th scope="col" className="w-[130px] py-2.5 text-start font-semibold">{t("managerToday.colStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, property, agent, time, otherTz }) => (
            <tr key={task.id} className="border-b border-line transition-colors last:border-b-0 hover:bg-surface-hover">
              <td className="py-3 pe-4 align-middle">
                <span className="text-[14px] font-semibold tabular">{time}</span>
                {otherTz && <span className="block text-caption text-muted">{property.city}</span>}
              </td>
              <td className="py-3 pe-4 align-middle">
                <span className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{property.name}</span>
                  {task.priority !== "normal" && (
                    <Badge tone="danger" className="px-1.5">
                      {t(`priority.${task.priority}`)}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="py-3 pe-4 align-middle">
                <span className="flex items-center gap-2 text-[14px] text-muted">
                  <TaskTypeIcon type={task.type} size="sm" className="size-6 [&_svg]:size-3.5" />
                  {t(`taskType.${task.type}`)}
                </span>
              </td>
              <td className="py-3 pe-4 align-middle">
                {agent ? (
                  <span className="flex items-center gap-2 text-[14px]">
                    <Avatar initials={agent.initials} color={agent.color} size="sm" className="ring-0" />
                    {agent.name}
                  </span>
                ) : (
                  assignButton
                )}
              </td>
              <td className="py-3 align-middle">
                <StatusPill status={task.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Téléphone : liste compacte — nom du logement sur toute la largeur, rien ne passe à la ligne */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map(({ task, property, agent, time, otherTz }) => {
          const [start, end] = time.split(" → ");
          return (
            <li key={task.id} className="flex items-center gap-3 py-3">
              <div className="w-12 shrink-0 tabular">
                <span className="block text-[15px] font-semibold leading-5">{start}</span>
                <span className="block text-caption text-muted">{end}</span>
              </div>
              <div className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold leading-5">{property.name}</span>
                  {task.priority !== "normal" && (
                    <span className="flex shrink-0 items-center text-danger" title={t(`priority.${task.priority}`)}>
                      <CircleAlert className="size-4" strokeWidth={2.2} aria-hidden />
                      <span className="sr-only">{t(`priority.${task.priority}`)}</span>
                    </span>
                  )}
                </span>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-caption text-muted">
                  <span className="truncate">
                    {t(`taskType.${task.type}`)}
                    {otherTz && ` · ${property.city}`}
                  </span>
                  {agent && <StatusPill status={task.status} className="shrink-0" />}
                </div>
              </div>
              {agent ? <Avatar initials={agent.initials} color={agent.color} size="md" label={agent.name} /> : assignButton}
            </li>
          );
        })}
      </ul>
    </>
  );
}
