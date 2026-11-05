"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, Send, WifiOff } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
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
  /** Noms des destinataires qui l'ont lu / pas encore lu (dernière ouverture de la conversation). */
  readers: string[];
  notYet: string[];
  /** Reçu et non lu au moment de l'ouverture. */
  isNew: boolean;
}

type Local = { clientId: string; body: string; urgent: boolean; state: "sending" | "offline" | "failed" };

/**
 * Fil d'une conversation. Un message n'est affiché « envoyé » qu'après confirmation du serveur :
 * hors réseau il reste « en attente » et repart tout seul au retour du réseau (même identifiant, pas de doublon).
 */
export function ChatThread({ threadId, messages, meId, canWrite, sticky = false, showAuthors = true }: { threadId: string; messages: ChatMessage[]; meId: string; canWrite: boolean; sticky?: boolean; showAuthors?: boolean }) {
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
      <ul className="space-y-1.5">
        {messages.map((m, i) => {
          const mine = m.authorId === meId;
          const prev = messages[i - 1];
          const day = f.dateTime(new Date(m.at), { weekday: "long", day: "numeric", month: "long" });
          const newDay = !prev || f.dateTime(new Date(prev.at), { weekday: "long", day: "numeric", month: "long" }) !== day;
          const grouped = !newDay && prev && prev.authorId === m.authorId && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60_000;
          return (
            <li key={m.id} className={cn(!grouped && "pt-2")}>
              {newDay && <p className="py-2 text-center text-[12px] font-medium text-muted first-letter:uppercase">{day}</p>}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed md:max-w-[75%]",
                    mine ? "rounded-ee-md bg-accent text-on-accent" : "rounded-es-md border border-line bg-surface",
                    m.urgent && "ring-2 ring-danger ring-offset-1 ring-offset-canvas",
                  )}
                  data-testid="chat-message"
                  data-mine={mine ? "1" : "0"}
                >
                  {!mine && showAuthors && !grouped && <p className="mb-0.5 text-[12px] font-semibold text-muted">{m.authorName || t("noName")}</p>}
                  {(m.isNew || m.urgent) && (
                    <span className="mb-1 flex gap-1.5">
                      {m.isNew && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-accent">{t("new")}</span>}
                      {m.urgent && <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">{t("urgent")}</span>}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={cn("mt-0.5 text-[11px]", mine ? "text-on-accent/80" : "text-faint")}>
                    {f.dateTime(new Date(m.at), { hour: "2-digit", minute: "2-digit" })}
                    {mine && (
                      <span data-testid="chat-read-state">
                        {" · "}
                        {m.readBy >= m.readTotal ? t("readAll") : m.readBy > 0 ? t("readSome", { n: m.readBy, total: m.readTotal }) : t("unread")}
                      </span>
                    )}
                  </p>
                  {mine && m.readTotal > 1 && (
                    <p className="text-[11px] text-on-accent/80" data-testid="chat-read-detail">
                      {m.readers.length > 0 && t("readBy", { names: m.readers.join(", ") })}
                      {m.readers.length > 0 && m.notYet.length > 0 && " · "}
                      {m.notYet.length > 0 && t("notReadBy", { names: m.notYet.join(", ") })}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {local.map((m) => (
          <li key={m.clientId} className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md border border-dashed border-line px-3.5 py-2 text-[15px] md:max-w-[75%]" data-testid="chat-pending" data-state={m.state}>
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
        {messages.length === 0 && local.length === 0 && <li className="py-6 text-center text-[14px] text-muted">{t("empty")}</li>}
      </ul>
      {canWrite && (
        <form
          className={cn("space-y-2 border-t border-line bg-surface pt-3", sticky && "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 px-4 pb-3 md:bottom-0 md:-mx-5 md:px-5")}
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
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                // Ordinateur : Entrée envoie, Maj+Entrée va à la ligne
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={4000}
              rows={2}
              aria-label={t("write")}
              placeholder={t("write")}
              className="min-h-11 flex-1 resize-none rounded-2xl"
              data-testid="chat-body"
            />
            <Button type="submit" size="icon" className="size-11 rounded-full" disabled={!body.trim()} aria-label={t("send")} data-testid="chat-send">
              <Send />
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} data-testid="chat-urgent" />
            {t("markUrgent")}
          </label>
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
  initialTo = [],
}: {
  members: { id: string; name: string; role: string }[];
  contexts: { kind: "task" | "property" | "reservation"; id: string; label: string }[];
  initial?: { kind: "task" | "property" | "reservation"; id: string };
  initialTo?: string[];
}) {
  const t = useTranslations("connected.chat");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState<string[]>(() => initialTo.filter((x) => members.some((m) => m.id === x)));
  const [ctx, setCtx] = useState(initial ? `${initial.kind}:${initial.id}` : contexts[0] ? `${contexts[0].kind}:${contexts[0].id}` : "");
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [kind, id] = ctx.split(":") as ["task" | "property" | "reservation", string];
  const groups = (["task", "property", "reservation"] as const).map((k) => ({ k, items: contexts.filter((c) => c.kind === k) })).filter((g) => g.items.length);
  return (
    <Card className="p-5" data-testid="chat-new">
      <h2 className="text-[17px] font-semibold">{t("newTitle")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("newText")}</p>
      <p className="mt-1 text-[13px] text-muted">{t("privacy")}</p>
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
          <span className="ms-auto flex items-center gap-2">
            <Link href="/app/messages" className="px-2 text-[14px] text-muted hover:text-fg">
              {t("cancel")}
            </Link>
            <Button type="submit" disabled={pending || !to.length || !ctx || !body.trim()} data-testid="chat-start">
              {t("start")}
            </Button>
          </span>
        </div>
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      </form>
    </Card>
  );
}
