"use client";

import { useTranslations } from "next-intl";
import { agentTaskAction, assignTask } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { useRun } from "./use-run";

export function AssignSelect({ taskId, current, members, disabled }: { taskId: string; current: string | null; members: { id: string; name: string }[]; disabled?: boolean }) {
  const t = useTranslations("connected.missions");
  const { pending, error, run } = useRun();
  return (
    <div className="min-w-44">
      <Select aria-label={t("assignee")} value={current ?? ""} disabled={pending || disabled} onChange={(e) => run(() => assignTask(taskId, e.target.value || null))} data-testid="assign-select">
        <option value="">{t("unassigned")}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      {error && <p role="alert" className="mt-1 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function AgentActions({ taskId, status }: { taskId: string; status: string }) {
  const t = useTranslations("connected.missions");
  const { pending, error, run } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      {(status === "assigned" || status === "to_redo") && (
        <Button size="sm" onClick={() => run(() => agentTaskAction(taskId, "start"))} disabled={pending} data-testid="task-start">
          {t("start")}
        </Button>
      )}
      {status === "in_progress" && (
        <Button size="sm" onClick={() => run(() => agentTaskAction(taskId, "finish"))} disabled={pending} data-testid="task-finish">
          {t("finish")}
        </Button>
      )}
      {error && <p role="alert" className="max-w-56 text-end text-[13px] text-danger">{error}</p>}
    </div>
  );
}
