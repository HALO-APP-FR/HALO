"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, Send, WifiOff } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { markTeamThreadRead, postTeamMessage, startTeamThread } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

export interface ChatMessage {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  urgent: boolean;
  at: string;
  /** Pour ses propres messages : lu par tous / quelques-uns / personne. */
  readBy: number;
  readTotal: number;
  /** Reçu et non lu au moment de l'ouverture. */
  isNew: boolean;
}

type Local = { clientId: string; body: string; urgent: boolean; state: "sending" | "offline" | "failed" };

/**
 * Fil d'une conversation. Un message n'est affiché « envoyé » qu'après confirmation du serveur :
 * hors réseau il reste « en attente » et repart tout seul au retour du réseau (même identifiant, pas de doublon).
 */
export function ChatThread({ threadId, messages, meId, canWrite }: { threadId: string; messages: ChatMessage[]; meId: string; canWrite: boolean }) {
  const t = useTranslations("connected.chat");
  const f = useFormatter();
  const router = useRouter();
  const [local, setLocal] = useState<Local[]>([]);
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const marked = useRef(false);

  // Ouverture : la conversation est marquée lue (côté serveur), puis rafraîchie régulièrement
  useEffect(() => {
    if (!marked.current && messages.some((m) => m.isNew)) {
      marked.current = true;
      void markTeamThreadRead(threadId);
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [threadId, messages, router]);

  const send = async (m: Local) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setLocal((l) => l.map((x) => (x.clientId === m.clientId ? { ...x, state: "offline" } : x)));
      return;
    }
    setLocal((l) => l.map((x) => (x.clientId === m.clientId ? { ...x, state: "sending" } : x)));
    try {
      const r = await postTeamMessage(threadId, m.clientId, m.body, m.urgent);
      if (!r.ok) throw new Error(r.error);
      setLocal((l) => l.filter((x) => x.clientId !== m.clientId));
      router.refresh();
    } catch {
      setLocal((l) => l.map((x) => (x.clientId === m.clientId ? { ...x, state: navigator.onLine ? "failed" : "offline" } : x)));
    }
  };

  // Retour du réseau : les messages en attente repartent (identifiant inchangé)
  useEffect(() => {
    const retry = () => local.filter((x) => x.state === "offline").forEach((x) => void send(x));
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  });

  return (
    <div className="space-y-3" data-testid="chat-thread">
      <ul className="space-y-2">
        {messages.map((m) => {
          const mine = m.authorId === meId;
          return (
            <li
              key={m.id}
              className={cn("max-w-[88%] rounded-lg px-3 py-2 text-[15px]", mine ? "ms-auto bg-accent-soft" : "bg-subtle dark:bg-surface-hover", m.urgent && "border border-danger")}
              data-testid="chat-message"
              data-mine={mine ? "1" : "0"}
            >
              {(m.isNew || m.urgent) && (
                <span className="mb-1 flex gap-1.5">
                  {m.isNew && <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">{t("new")}</span>}
                  {m.urgent && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">{t("urgent")}</span>}
                </span>
              )}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-[12px] text-faint">
                {m.authorName || t("noName")} · {f.dateTime(new Date(m.at), { dateStyle: "short", timeStyle: "short" })}
                {mine && (
                  <span data-testid="chat-read-state">
                    {" · "}
                    {m.readBy >= m.readTotal ? t("readAll") : m.readBy > 0 ? t("readSome", { n: m.readBy, total: m.readTotal }) : t("unread")}
                  </span>
                )}
              </p>
            </li>
          );
        })}
        {local.map((m) => (
          <li key={m.clientId} className="ms-auto max-w-[88%] rounded-lg border border-dashed border-line px-3 py-2 text-[15px]" data-testid="chat-pending" data-state={m.state}>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-warning">
              {m.state === "offline" && <WifiOff className="size-3.5" />}
              {m.state === "failed" && <AlertTriangle className="size-3.5" />}
              {t(`state.${m.state}`)}
              {m.state !== "sending" && (
                <button type="button" className="ms-1 underline" onClick={() => void send(m)}>
                  {t("retry")}
                </button>
              )}
            </p>
          </li>
        ))}
        {messages.length === 0 && local.length === 0 && <li className="text-[14px] text-muted">{t("empty")}</li>}
      </ul>
      {canWrite && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            const m: Local = { clientId: crypto.randomUUID(), body: body.trim(), urgent, state: "sending" };
            setLocal((l) => [...l, m]);
            setBody("");
            setUrgent(false);
            void send(m);
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={2} aria-label={t("write")} placeholder={t("write")} data-testid="chat-body" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} data-testid="chat-urgent" />
              {t("markUrgent")}
            </label>
            <Button type="submit" size="sm" className="ms-auto" disabled={!body.trim()} data-testid="chat-send">
              <Send />
              {t("send")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Nouvelle conversation (responsable) : une ou plusieurs personnes, toujours rattachée à une opération. */
export function NewThreadForm({
  members,
  contexts,
  initial,
}: {
  members: { id: string; name: string; role: string }[];
  contexts: { kind: "task" | "property" | "reservation"; id: string; label: string }[];
  initial?: { kind: "task" | "property" | "reservation"; id: string };
}) {
  const t = useTranslations("connected.chat");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState<string[]>([]);
  const [ctx, setCtx] = useState(initial ? `${initial.kind}:${initial.id}` : contexts[0] ? `${contexts[0].kind}:${contexts[0].id}` : "");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [kind, id] = ctx.split(":") as ["task" | "property" | "reservation", string];
  const groups = (["task", "property", "reservation"] as const).map((k) => ({ k, items: contexts.filter((c) => c.kind === k) })).filter((g) => g.items.length);
  return (
    <Card className="p-5" data-testid="chat-new">
      <h2 className="text-[17px] font-semibold">{t("newTitle")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("newText")}</p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => startTeamThread({ clientId, recipients: to, contextKind: kind, contextId: id, body, urgent }), (d) => {
            setClientId(crypto.randomUUID());
            router.push(`/app/messages/${d.thread}`);
          });
        }}
      >
        <fieldset>
          <legend className="text-[13px] font-medium text-muted">{t("to")}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" checked={to.includes(m.id)} onChange={(e) => setTo(e.target.checked ? [...to, m.id] : to.filter((x) => x !== m.id))} data-testid="chat-to" data-name={m.name} />
                {m.name || t("noName")}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t("context")} htmlFor="chat-ctx" hint={t("contextHint")}>
          <Select id="chat-ctx" value={ctx} onChange={(e) => setCtx(e.target.value)} data-testid="chat-context">
            {groups.map((g) => (
              <optgroup key={g.k} label={t(`contextKind.${g.k}`)}>
                {g.items.map((c) => (
                  <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={t("message")} htmlFor="chat-first">
          <Textarea id="chat-first" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={3} data-testid="chat-first" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            {t("markUrgent")}
          </label>
          <Button type="submit" className="ms-auto" disabled={pending || !to.length || !ctx || !body.trim()} data-testid="chat-start">
            {t("start")}
          </Button>
        </div>
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      </form>
    </Card>
  );
}
