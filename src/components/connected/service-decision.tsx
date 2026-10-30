"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, Lock } from "lucide-react";
import { decideService, markServiceSeen, updateService } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";
import { zonedTime } from "@/lib/connected/format";

type Status = "requested" | "in_review" | "info_requested" | "confirmed" | "declined" | "done" | "cancelled";
type Decision = "in_review" | "confirmed" | "declined" | "info_requested" | "done" | "cancelled";

const NEXT: Record<Status, Decision[]> = {
  requested: ["in_review", "confirmed", "info_requested", "declined", "cancelled"],
  in_review: ["confirmed", "info_requested", "declined", "cancelled"],
  info_requested: ["in_review", "confirmed", "info_requested", "declined", "cancelled"],
  confirmed: ["done", "cancelled"],
  declined: [],
  done: [],
  cancelled: [],
};

// Heure affichée et saisie dans le fuseau du logement (pas celui de l'ordinateur du responsable)
const toLocalInput = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" ", "T");

export function ServiceDecision({ serviceId, status, guestEmail, unread, startAt, people, timeZone }: { serviceId: string; status: Status; guestEmail: string | null; unread: boolean; startAt: string; people: number | null; timeZone: string }) {
  const t = useTranslations("connected.decide");
  const ts = useTranslations("serviceStatus");
  const { pending, error, run } = useRun();
  const [choice, setChoice] = useState<Decision | null>(null);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [when, setWhen] = useState(toLocalInput(startAt, timeZone));
  const [n, setN] = useState(people ?? 1);
  const [editMsg, setEditMsg] = useState("");

  useEffect(() => {
    if (unread) void markServiceSeen(serviceId);
  }, [serviceId, unread]);

  const options = NEXT[status];
  const needsQuestion = choice === "info_requested";
  const channel = guestEmail ? t("channelEmail", { email: guestEmail }) : t("channelSpace");

  return (
    <Card className="p-5" data-testid="service-decision">
      <h2 className="text-[17px] font-semibold">{t("title")}</h2>
      {options.length === 0 ? (
        <p className="mt-2 text-[14px] text-muted">{t("closed", { status: ts(status) })}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("title")}>
            {options.map((o) => (
              <Button key={o} size="sm" variant={choice === o ? (o === "declined" || o === "cancelled" ? "danger" : "primary") : "outline"} onClick={() => setChoice(o)} aria-pressed={choice === o} data-testid={`decide-${o}`}>
                {t(`action.${o}`)}
              </Button>
            ))}
          </div>
          {choice && (
            <div className="mt-4 space-y-4">
              <Field label={needsQuestion ? t("question") : t("guestMessage")} htmlFor="d-msg" hint={needsQuestion ? t("questionHint") : t(`messageHint.${choice}`)}>
                <Textarea id="d-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} data-testid="decide-message" />
              </Field>
              <Field label={t("internalNote")} htmlFor="d-note" hint={t("internalHint")}>
                <Textarea id="d-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="border-dashed bg-subtle dark:bg-surface-hover" data-testid="decide-note" />
              </Field>
              <div className="rounded-md border border-line p-3" data-testid="decide-preview">
                <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
                  <Eye className="size-4" />
                  {t("previewTitle")}
                </p>
                <p className="mt-1.5 text-[15px] font-medium">{ts(choice)}</p>
                {message.trim() ? <p className="mt-1 whitespace-pre-wrap text-[15px]">« {message.trim()} »</p> : <p className="mt-1 text-[14px] text-muted">{t("noMessage")}</p>}
                <p className="mt-2 text-[13px] text-muted">{channel}</p>
                {note.trim() && (
                  <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
                    <Lock className="size-3.5" />
                    {t("notePrivate")}
                  </p>
                )}
              </div>
              {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
              <Button
                onClick={() =>
                  run(
                    () => decideService(serviceId, choice, message.trim(), note.trim()),
                    (d) => (setDone(d.emailQueued ? t("doneEmail") : t("doneSpace")), setChoice(null), setMessage(""), setNote("")),
                  )
                }
                disabled={pending || (needsQuestion && !message.trim())}
                data-testid="decide-confirm"
              >
                {t("confirm")}
              </Button>
            </div>
          )}
        </>
      )}
      {done && <p role="status" className="mt-3 text-[14px] text-muted" data-testid="decide-saved">{done}</p>}

      {(status === "requested" || status === "in_review" || status === "info_requested" || status === "confirmed") && (
        <div className="mt-5 border-t border-line pt-4">
          {!edit ? (
            <Button variant="ghost" size="sm" onClick={() => setEdit(true)} data-testid="service-edit">
              {t("edit")}
            </Button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("when")} htmlFor="e-when">
                <Input id="e-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Field label={t("people")} htmlFor="e-people">
                <Input id="e-people" type="number" min={1} max={100} value={n} onChange={(e) => setN(Number(e.target.value))} />
              </Field>
              <Field label={t("guestMessage")} htmlFor="e-msg" hint={t("editHint")} className="sm:col-span-2">
                <Textarea id="e-msg" value={editMsg} onChange={(e) => setEditMsg(e.target.value)} maxLength={2000} />
              </Field>
              <div className={cn("flex gap-2 sm:col-span-2")}>
                <Button variant="ghost" onClick={() => setEdit(false)}>
                  {t("cancelEdit")}
                </Button>
                <Button
                  onClick={() => run(() => updateService(serviceId, zonedTime(when, timeZone).toISOString(), n, editMsg.trim()), (d) => (setEdit(false), setEditMsg(""), setDone(d.emailQueued ? t("doneEmail") : t("doneSpace"))))}
                  disabled={pending}
                  data-testid="service-edit-save"
                >
                  {t("saveEdit")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
