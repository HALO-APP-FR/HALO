"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { agentTaskAction, assignTask, cancelTask } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function AssignSelect({
  taskId,
  current,
  members,
  disabled,
  outOfWindow,
  durationMin = 60,
  arrival,
  unavailable = [],
  reasons = {},
}: {
  taskId: string;
  current: string | null;
  members: { id: string; name: string }[];
  disabled?: boolean;
  /** La mission ne peut plus être faite dans sa fenêtre : affectation seulement avec une nouvelle fin confirmée. */
  outOfWindow?: boolean;
  durationMin?: number;
  arrival?: string | null;
  /** Personnes absentes sur ce créneau (absence acceptée ou fermeture) : non proposées. La base refuse aussi. */
  unavailable?: string[];
  /** Motif lisible par personne (période d'absence ou fermeture). */
  reasons?: Record<string, string>;
}) {
  const t = useTranslations("connected.missions");
  const { pending, error, run } = useRun();
  const [pendingMember, setPendingMember] = useState<string | null>(null);
  const [end, setEnd] = useState(() => local(new Date(Math.ceil((Date.now() + (durationMin + 30) * 60_000) / 900_000) * 900_000)));
  return (
    <div className="min-w-44">
      <Select
        aria-label={t("assignee")}
        value={pendingMember ?? current ?? ""}
        disabled={pending || disabled}
        onChange={(e) => {
          const v = e.target.value || null;
          if (v && outOfWindow) return setPendingMember(v);
          run(() => assignTask(taskId, v));
        }}
        data-testid="assign-select"
      >
        <option value="">{t("unassigned")}</option>
        {/* Personnes absentes sur le créneau réel : visibles mais non sélectionnables, avec le motif (la base refuse aussi) */}
        {members.map((m) => {
          const away = unavailable.includes(m.id) && m.id !== current;
          return (
            <option key={m.id} value={m.id} disabled={away} data-away={away ? "1" : "0"}>
              {unavailable.includes(m.id) ? `${m.name} — ${t("absentFor", { period: reasons[m.id] ?? "" })}` : m.name}
            </option>
          );
        })}
      </Select>
      {members.some((m) => unavailable.includes(m.id)) && (
        <p className="mt-1 max-w-72 text-[12px] text-muted" data-testid="assign-hidden">
          {t("hiddenAbsent", { count: members.filter((m) => unavailable.includes(m.id)).length })}
        </p>
      )}
      {pendingMember && (
        <div className="mt-2 max-w-72 rounded-md border border-danger bg-danger-soft p-3 text-[13px]" role="alert" data-testid="out-of-window">
          <p className="font-semibold text-danger">{t("outOfWindowTitle")}</p>
          <p className="mt-1">{arrival ? t("outOfWindowArrival", { arrival }) : t("outOfWindowText")}</p>
          <label className="mt-2 block text-[12px] font-medium text-muted" htmlFor={`end-${taskId}`}>
            {t("newWindowEnd")}
          </label>
          <Input id={`end-${taskId}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="danger" onClick={() => run(() => assignTask(taskId, pendingMember, new Date(end).toISOString()), () => setPendingMember(null))} disabled={pending} data-testid="out-of-window-confirm">
              {t("confirmOutOfWindow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingMember(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
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

/** Annulation d'une mission par un responsable : confirmation explicite, l'agent affecté est prévenu. */
export function CancelTaskButton({ taskId }: { taskId: string }) {
  const t = useTranslations("connected.missions");
  const { pending, error, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!confirm ? (
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} data-testid="task-cancel">
          {t("cancelTask")}
        </Button>
      ) : (
        <>
          <span className="text-[13px]">{t("cancelConfirm")}</span>
          <Button size="sm" variant="danger" onClick={() => run(() => cancelTask(taskId))} disabled={pending} data-testid="task-cancel-confirm">
            {t("cancelYes")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            {t("cancel")}
          </Button>
        </>
      )}
      {error && <p role="alert" className="basis-full text-[13px] text-danger">{error}</p>}
    </div>
  );
}
