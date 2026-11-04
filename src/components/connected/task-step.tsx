"use client";

import { useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { taskStep, type TaskStep } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";

/**
 * Démarrer / terminer une mission : MÊME composant et MÊME règle serveur depuis la liste et depuis la fiche.
 * Le résultat réel de la base est affiché : démarrage impossible (avec l'heure), démarrage anticipé à confirmer,
 * exigences manquantes (avec le lien pour les compléter), envoi au responsable.
 */
export function TaskStepButtons({
  taskId,
  status,
  timeZone,
  variant = "list",
  size,
}: {
  taskId: string;
  status: string;
  timeZone?: string;
  variant?: "list" | "page";
  size?: "sm" | "xl";
}) {
  const t = useTranslations("connected.taskStep");
  const te = useTranslations("connected.errors");
  const f = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<TaskStep | null>(null);
  const busy = useRef(false);
  const at = (x: string) => f.dateTime(new Date(x), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  const go = (kind: "start" | "finish", earlyAck = false) => {
    if (busy.current) return; // double clic : un seul envoi
    busy.current = true;
    setRes(null);
    start(async () => {
      try {
        const r = await taskStep(taskId, kind, earlyAck);
        setRes(r);
        if (r.status === "applied" || r.status === "already") {
          window.dispatchEvent(new CustomEvent("halo:action-ok", { detail: `task-${taskId}` }));
          router.refresh();
        }
      } catch {
        setRes({ status: "error", error: "network" });
      } finally {
        busy.current = false;
      }
    });
  };
  const sz = size ?? (variant === "page" ? "xl" : "sm");
  return (
    <div className={variant === "list" ? "flex max-w-72 flex-col items-end gap-1 text-end" : "space-y-2"} data-testid="task-step">
      {(status === "assigned" || status === "to_redo") && res?.status !== "early_confirm" && (
        <Button size={sz} onClick={() => go("start")} disabled={pending} data-testid={variant === "page" ? "mission-start" : "task-start"}>
          {t(status === "to_redo" ? "resume" : "start")}
        </Button>
      )}
      {status === "in_progress" && (
        <Button size={sz} onClick={() => go("finish")} disabled={pending} data-testid={variant === "page" ? "mission-finish" : "task-finish"}>
          {t("finish")}
        </Button>
      )}
      {res?.status === "too_early" && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft p-2.5 text-start text-[13px]" data-testid="task-too-early">
          <span className="block font-semibold text-danger">{t("tooEarlyTitle", { date: at(res.at) })}</span>
          {t("tooEarlyText")}
        </p>
      )}
      {res?.status === "early_confirm" && (
        <div className="rounded-md border border-warning bg-warning-soft p-2.5 text-start text-[13px]" role="alert" data-testid="task-early-confirm">
          <p className="font-semibold">{t("earlyTitle", { date: at(res.at) })}</p>
          <p className="mt-0.5">{t("earlyText")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => go("start", true)} disabled={pending} data-testid="task-early-go">
              {t("earlyGo")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRes(null)}>
              {t("earlyWait")}
            </Button>
          </div>
        </div>
      )}
      {res?.status === "missing" && (
        <div role="alert" className="rounded-md border border-warning bg-warning-soft p-2.5 text-start text-[13px]" data-testid="task-missing">
          <p className="font-semibold">{t("missingTitle")}</p>
          <ul className="mt-0.5 list-disc ps-4">
            {res.missing.map((m) => (
              <li key={m} data-missing={m}>
                {variant === "page" ? (
                  <a href={`#req-${m}`} className="underline">{t(`missing.${m}`)}</a>
                ) : (
                  t(`missing.${m}`)
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1">{t("missingKept")}</p>
          {variant === "list" && (
            <Link href={`/app/missions/${taskId}`} className="mt-1 inline-block font-medium text-accent-text underline" data-testid="task-missing-open">
              {t("missingOpen")}
            </Link>
          )}
        </div>
      )}
      {(res?.status === "applied" || res?.status === "already") && res.taskStatus === "done" && (
        <p role="status" className="text-[13px] text-success" data-testid="task-sent">{t("sentForReview")}</p>
      )}
      {res?.status === "conflict" && <p role="alert" className="text-[13px] text-danger">{te("conflict")}</p>}
      {res?.status === "error" && <p role="alert" className="text-[13px] text-danger">{te.has(res.error) ? te(res.error) : te("server")}</p>}
    </div>
  );
}
