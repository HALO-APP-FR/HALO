"use client";

import { useLocale, useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { initialsOf, type Member, type Property, type Task } from "@/lib/domain/types";
import { formatLocalRange } from "@/lib/engine/time";
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
  onOpen,
}: {
  tasks: Task[];
  properties: Property[];
  agents: Member[];
  orgTimezone: string;
  /** Ouvre le détail d'une tâche (assignation, statut…). */
  onOpen: (taskId: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const rows = [...tasks]
    .map((task) => {
      const property = properties.find((p) => p.id === task.propertyId)!;
      const tz = property.timezone;
      return {
        task,
        property,
        agent: agents.find((a) => a.id === task.assigneeId),
        time: formatLocalRange(new Date(task.windowStart), new Date(task.windowEnd), tz, locale),
        otherTz: tz !== orgTimezone,
      };
    });

  const assignButton = (taskId: string) => (
    <Button
      size="sm"
      variant="outline"
      className="h-8 border-danger/40 px-2.5 text-danger hover:bg-danger-soft"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(taskId);
      }}
    >
      {t("managerToday.assign")}
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
            <tr
              key={task.id}
              onClick={() => onOpen(task.id)}
              className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-surface-hover"
            >
              <td className="py-3 pe-4 align-middle">
                <span className="text-[14px] font-semibold tabular">{time}</span>
                {otherTz && <span className="block text-caption text-muted">{property.city}</span>}
              </td>
              <td className="py-3 pe-4 align-middle">
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(task.id);
                    }}
                    className="text-start text-[14px] font-medium hover:underline"
                  >
                    {property.name}
                  </button>
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
                    <Avatar initials={initialsOf(agent.name)} color={agent.color} size="sm" className="ring-0" />
                    {agent.name}
                  </span>
                ) : (
                  assignButton(task.id)
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
            <li key={task.id}>
              <div role="button" tabIndex={0} onClick={() => onOpen(task.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(task.id)} className="flex cursor-pointer items-center gap-3 py-3">
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
              {agent ? <Avatar initials={initialsOf(agent.name)} color={agent.color} size="md" label={agent.name} /> : assignButton(task.id)}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
