"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { guestReplyService, guestRequestService, guestSendMessage, type GuestResult } from "@/lib/connected/guest-actions";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function useGuestRun() {
  const t = useTranslations("guestSpace.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<GuestResult>, onOk: () => void) => {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return setError(t(r.error));
        onOk();
        router.refresh();
      } catch {
        setError(t("server"));
      }
    });
  };
  return { pending, error, run };
}

export function GuestRequestForm({ token, kinds, minDate }: { token: string; kinds: string[]; minDate: string }) {
  const t = useTranslations("guestSpace");
  const tk = useTranslations("serviceKind");
  const { pending, error, run } = useGuestRun();
  const [f, setF] = useState({ kind: kinds[0] ?? "other", when: "", people: 2, details: "" });
  const [ok, setOk] = useState(false);
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        run(() => guestRequestService(token, { kind: f.kind, startAt: new Date(f.when).toISOString(), people: f.people, details: f.details }), () => (setOk(true), setF({ ...f, when: "", details: "" })));
      }}
    >
      <Field label={t("request.kind")} htmlFor="gr-kind" className="sm:col-span-2">
        <Select id="gr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("request.when")} htmlFor="gr-when">
        <Input id="gr-when" type="datetime-local" min={minDate} value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} required />
      </Field>
      <Field label={t("request.people")} htmlFor="gr-people">
        <Input id="gr-people" type="number" min={1} max={100} value={f.people} onChange={(e) => setF({ ...f, people: Number(e.target.value) })} />
      </Field>
      <Field label={t("request.details")} htmlFor="gr-details" className="sm:col-span-2">
        <Textarea id="gr-details" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={2000} placeholder={t("request.detailsPlaceholder")} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        {ok && <p role="status" className="text-[14px] text-success" data-testid="guest-request-ok">{t("request.sent")}</p>}
        <Button type="submit" className="ms-auto" disabled={pending || !f.when} data-testid="guest-request-send">
          {t("request.send")}
        </Button>
      </div>
    </form>
  );
}

export function GuestReply({ token, serviceId, question }: { token: string; serviceId: string; question: boolean }) {
  const t = useTranslations("guestSpace");
  const { pending, error, run } = useGuestRun();
  const [body, setBody] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => guestReplyService(token, serviceId, body), () => setBody(""));
      }}
    >
      <Field label={question ? t("reply.answer") : t("reply.add")} htmlFor={`rep-${serviceId}`}>
        <Textarea id={`rep-${serviceId}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="guest-reply" />
      </Field>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      <Button type="submit" size="sm" disabled={pending || !body.trim()} data-testid="guest-reply-send">
        {t("reply.send")}
      </Button>
    </form>
  );
}

export function GuestMessageForm({ token }: { token: string }) {
  const t = useTranslations("guestSpace");
  const { pending, error, run } = useGuestRun();
  const [body, setBody] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => guestSendMessage(token, body), () => setBody(""));
      }}
    >
      <Field label={t("contact.label")} htmlFor="gm" hint={t("contact.hint")}>
        <Textarea id="gm" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="guest-message" />
      </Field>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      <Button type="submit" disabled={pending || !body.trim()} data-testid="guest-message-send">
        {t("contact.send")}
      </Button>
    </form>
  );
}
