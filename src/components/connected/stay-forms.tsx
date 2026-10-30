"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Copy, Link2, Mail, ShieldOff } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createGuestLink, createStay, extendGuestLink, replyStayMessage, revokeGuestLink, sendPrepInvite } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";

const LOCALES = ["fr", "en", "es", "pt", "it", "de"] as const;

export function StayCreateForm({ properties }: { properties: { id: string; name: string }[] }) {
  const t = useTranslations("connected.stays");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ property_id: properties[0]?.id ?? "", guest_name: "", guest_email: "", guest_locale: "fr", adults: 2, children: 0, babies: 0, in: "", out: "" });
  if (!properties.length) return <Card className="p-5 text-[15px] text-muted">{t("needProperty")}</Card>;
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">{t("new")}</h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              createStay({
                property_id: f.property_id,
                guest_name: f.guest_name,
                guest_email: f.guest_email,
                guest_locale: f.guest_locale,
                adults: f.adults,
                children: f.children,
                babies: f.babies,
                check_in_at: new Date(f.in).toISOString(),
                check_out_at: new Date(f.out).toISOString(),
              }),
            (d) => router.push(`/app/stays/${d.id}`),
          );
        }}
      >
        <Field label={t("property")} htmlFor="st-p" className="sm:col-span-2">
          <Select id="st-p" value={f.property_id} onChange={(e) => setF({ ...f, property_id: e.target.value })}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("guestName")} htmlFor="st-n">
          <Input id="st-n" value={f.guest_name} onChange={(e) => setF({ ...f, guest_name: e.target.value })} />
        </Field>
        <Field label={t("guestEmail")} htmlFor="st-e" hint={t("guestEmailHint")}>
          <Input id="st-e" type="email" value={f.guest_email} onChange={(e) => setF({ ...f, guest_email: e.target.value })} />
        </Field>
        <Field label={t("checkIn")} htmlFor="st-in">
          <Input id="st-in" type="datetime-local" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} required />
        </Field>
        <Field label={t("checkOut")} htmlFor="st-out">
          <Input id="st-out" type="datetime-local" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} required />
        </Field>
        <Field label={t("adults")} htmlFor="st-a">
          <Input id="st-a" type="number" min={0} max={100} value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) })} />
        </Field>
        <Field label={t("guestLocale")} htmlFor="st-l">
          <Select id="st-l" value={f.guest_locale} onChange={(e) => setF({ ...f, guest_locale: e.target.value })}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          <Button type="submit" className="ms-auto" disabled={pending || !f.in || !f.out} data-testid="stay-create">
            {t("create")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export interface LinkRow {
  id: string;
  valid_from: string;
  valid_until: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  last_opened_at: string | null;
  created_at: string;
}

export function GuestLinkPanel({
  reservationId,
  links,
  checkOut,
  hasEmail,
  invite,
  questionnaire,
  timeZone,
}: {
  reservationId: string;
  links: LinkRow[];
  checkOut: string;
  hasEmail: boolean;
  /** Dernière invitation par e-mail, d'après le journal d'envoi réel */
  invite: { status: string; created_at: string } | null;
  questionnaire: string | null;
  timeZone?: string;
}) {
  const t = useTranslations("connected.link");
  const locale = useLocale();
  const fd = useFormatter();
  const { pending, error, run } = useRun();
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now] = useState(() => Date.now());
  // Avant la fenêtre habituelle : lien actif pour la préparation du séjour seulement
  const status = (l: LinkRow) => (l.revoked_at ? "revoked" : now < Date.parse(l.valid_from) ? "prep" : now > Date.parse(l.valid_until) ? "expired" : "active");
  const [delivery, setDelivery] = useState<string | null>(null);
  const current = links.find((l) => !l.revoked_at);
  const fmt = (d: string) => fd.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short", timeZone });
  const inviteStatus = delivery ?? invite?.status ?? null;
  const url = fresh ? `${typeof window !== "undefined" ? window.location.origin : ""}/${locale}/s/${fresh}` : null;
  const maxExtend = new Date(Date.parse(checkOut) + 7 * 86_400_000);

  return (
    <Card className="p-5" data-testid="guest-link-panel">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <Link2 className="size-5" />
        {t("title")}
      </h2>
      <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      {current ? (
        <p className="mt-3 text-[14px]" data-testid="link-status">
          {t(`status.${status(current)}`, { from: fmt(current.valid_from), until: fmt(current.valid_until) })}
          {current.last_opened_at ? ` · ${t("opened", { at: fmt(current.last_opened_at) })}` : ` · ${t("notOpened")}`}
        </p>
      ) : (
        <p className="mt-3 text-[14px] text-muted" data-testid="link-status">{t("none")}</p>
      )}
      <ul className="mt-3 grid gap-1 text-[13px]" data-testid="link-journey">
        <li>
          <span className="text-muted">{t("journey.created")} · </span>
          {current ? fmt(current.created_at) : t("journey.no")}
        </li>
        <li data-testid="link-invite" data-status={inviteStatus ?? "none"}>
          <span className="text-muted">{t("journey.sent")} · </span>
          {inviteStatus ? t(`journey.delivery.${["sent", "pending", "failed", "not_configured", "skipped"].includes(inviteStatus) ? inviteStatus : "failed"}`) : t("journey.notSent")}
          {invite && !delivery && inviteStatus ? ` (${fmt(invite.created_at)})` : ""}
        </li>
        <li>
          <span className="text-muted">{t("journey.opened")} · </span>
          {current?.last_opened_at ? fmt(current.last_opened_at) : t("journey.no")}
        </li>
        <li data-testid="link-questionnaire">
          <span className="text-muted">{t("journey.questionnaire")} · </span>
          {t(`journey.q.${questionnaire ?? "not_started"}`)}
        </li>
      </ul>
      {url && (
        <div className="mt-3 rounded-md border border-accent bg-accent-soft p-3">
          <p className="text-[13px] font-medium">{t("copyOnce")}</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={url} data-testid="guest-link-url" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => setCopied(true));
              }}
            >
              <Copy />
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[14px] text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => run(() => createGuestLink(reservationId), (d) => (setFresh(d.token), setCopied(false), setDelivery(null)))} disabled={pending} data-testid="link-create">
          {current ? t("renew") : t("create")}
        </Button>
        <Button
          variant="outline"
          onClick={() => run(() => sendPrepInvite(reservationId, locale), (d) => (setFresh(d.token), setCopied(false), setDelivery(d.delivery)))}
          disabled={pending || !hasEmail}
          title={hasEmail ? undefined : t("noEmail")}
          data-testid="link-send"
        >
          <Mail />
          {t("sendEmail")}
        </Button>
        {current && (
          <>
            <Button variant="outline" onClick={() => run(() => extendGuestLink(current.id, maxExtend.toISOString()))} disabled={pending || Date.parse(current.valid_until) >= maxExtend.getTime()} data-testid="link-extend">
              {t("extend")}
            </Button>
            <Button variant="ghost" onClick={() => run(() => revokeGuestLink(current.id), () => setFresh(null))} disabled={pending} data-testid="link-revoke">
              <ShieldOff />
              {t("revoke")}
            </Button>
          </>
        )}
      </div>
      {current && <p className="mt-2 text-[13px] text-muted">{t("renewHint")}</p>}
      <p className="mt-1 text-[13px] text-muted">{hasEmail ? t("sendHint") : t("noEmail")}</p>
    </Card>
  );
}

export function StayReply({ reservationId, hasEmail }: { reservationId: string; hasEmail: boolean }) {
  const t = useTranslations("connected.messages");
  const { pending, error, run } = useRun();
  const [body, setBody] = useState("");
  const [sent, setSent] = useState<null | boolean>(null);
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(null);
        run(() => replyStayMessage(reservationId, body), (d) => (setBody(""), setSent(d.emailQueued)));
      }}
    >
      <Field label={t("replyLabel")} htmlFor="reply" hint={hasEmail ? t("replyHintEmail") : t("replyHintNoEmail")}>
        <Textarea id="reply" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
      </Field>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      {sent !== null && <p role="status" className="text-[14px] text-muted">{sent ? t("postedEmailQueued") : t("postedSpaceOnly")}</p>}
      <Button type="submit" disabled={pending || !body.trim()} data-testid="reply-send">
        {t("send")}
      </Button>
    </form>
  );
}
