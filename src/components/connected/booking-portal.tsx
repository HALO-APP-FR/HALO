"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { guestBookingAction, guestSubmitBooking } from "@/lib/connected/booking-actions";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function useBookingRun() {
  const t = useTranslations("bookingPortal.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (d: T) => void) => {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return setError(t.has(r.error) ? t(r.error) : t("server"));
        onOk(r.data);
        router.refresh();
      } catch {
        setError(t("network"));
      }
    });
  };
  return { pending, error, run };
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

/** Demande de nouveau séjour : identifiant d'envoi généré une fois par formulaire (double clic = une seule demande). */
export function BookingRequestForm({ token, defaults, busy, capacity, minDate }: { token: string; defaults: { name: string }; busy: { from: string; to: string }[]; capacity: number | null; minDate: string }) {
  const t = useTranslations("bookingPortal");
  const { pending, error, run } = useBookingRun();
  const [clientId, setClientId] = useState(uuid);
  const [f, setF] = useState({ checkIn: "", checkOut: "", adults: 2, children: 0, babies: 0, name: defaults.name, email: "", phone: "", message: "" });
  const [sent, setSent] = useState<{ knownConflict: boolean } | null>(null);
  // Un seul envoi à la fois (double clic) ; la base dédoublonne aussi par identifiant d'envoi
  const sending = useRef(false);
  const overlaps = f.checkIn && f.checkOut && f.checkOut > f.checkIn ? busy.some((b) => b.from < f.checkOut && b.to > f.checkIn) : false;
  const over = capacity != null && f.adults + f.children > capacity;
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      data-testid="booking-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (sending.current) return;
        sending.current = true;
        run(
          () => guestSubmitBooking(token, { clientId, ...f }).finally(() => (sending.current = false)),
          (d) => {
            setSent({ knownConflict: Boolean(d.knownConflict) });
            setClientId(uuid());
            setF({ ...f, checkIn: "", checkOut: "", message: "" });
          },
        );
      }}
    >
      <Field label={t("form.checkIn")} htmlFor="bk-in">
        <Input id="bk-in" type="date" min={minDate} value={f.checkIn} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, checkIn: val })); }} required data-testid="bk-in" />
      </Field>
      <Field label={t("form.checkOut")} htmlFor="bk-out">
        <Input id="bk-out" type="date" min={f.checkIn || minDate} value={f.checkOut} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, checkOut: val })); }} required data-testid="bk-out" />
      </Field>
      {overlaps && (
        <p className="rounded-md bg-warning-soft p-2 text-[13px] sm:col-span-2" role="status" data-testid="bk-overlap">
          {t("form.overlap")}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3 sm:col-span-2">
        <Field label={t("form.adults")} htmlFor="bk-a">
          <Input id="bk-a" type="number" min={1} max={30} value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) })} />
        </Field>
        <Field label={t("form.children")} htmlFor="bk-c">
          <Input id="bk-c" type="number" min={0} max={30} value={f.children} onChange={(e) => setF({ ...f, children: Number(e.target.value) })} />
        </Field>
        <Field label={t("form.babies")} htmlFor="bk-b">
          <Input id="bk-b" type="number" min={0} max={10} value={f.babies} onChange={(e) => setF({ ...f, babies: Number(e.target.value) })} />
        </Field>
      </div>
      {over && <p className="text-[13px] text-warning sm:col-span-2">{t("form.overCapacity", { capacity: capacity ?? 0 })}</p>}
      <Field label={t("form.name")} htmlFor="bk-name">
        <Input id="bk-name" value={f.name} maxLength={120} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, name: val })); }} required autoComplete="name" />
      </Field>
      <Field label={t("form.email")} htmlFor="bk-email" hint={t("form.emailHint")}>
        <Input id="bk-email" type="email" value={f.email} maxLength={254} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, email: val })); }} required autoComplete="email" data-testid="bk-email" />
      </Field>
      <Field label={t("form.phone")} htmlFor="bk-phone">
        <Input id="bk-phone" type="tel" value={f.phone} maxLength={40} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, phone: val })); }} autoComplete="tel" />
      </Field>
      <Field label={t("form.message")} htmlFor="bk-msg" className="sm:col-span-2">
        <Textarea id="bk-msg" value={f.message} maxLength={2000} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, message: val })); }} placeholder={t("form.messagePlaceholder")} />
      </Field>
      <p className="rounded-md border border-line bg-subtle p-3 text-[13px] sm:col-span-2 dark:bg-surface-hover" data-testid="bk-not-confirmed">
        {t("form.notConfirmed")}
      </p>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {error && (
          <p role="alert" className="text-[14px] text-danger" data-testid="bk-error">
            {error}
          </p>
        )}
        {sent && (
          <p role="status" className="text-[14px] text-success" data-testid="bk-sent">
            {sent.knownConflict ? t("form.sentConflict") : t("form.sent")}
          </p>
        )}
        <Button type="submit" className="ms-auto" disabled={pending} data-testid="bk-send">
          {t("form.send")}
        </Button>
      </div>
    </form>
  );
}

export function BookingRequestActions({ token, requestId, status, offerExpired }: { token: string; requestId: string; status: string; offerExpired: boolean }) {
  const t = useTranslations("bookingPortal");
  const { pending, error, run } = useBookingRun();
  const [body, setBody] = useState("");
  const [cancel, setCancel] = useState(false);
  const canReply = ["received", "in_review", "info_requested", "offer_sent"].includes(status);
  const canCancel = !["confirmed", "declined", "cancelled"].includes(status);
  return (
    <div className="mt-3 space-y-3">
      {status === "offer_sent" && !offerExpired && (
        <div className="rounded-md border border-accent bg-accent-soft p-3">
          <p className="text-[13px]">{t("acceptText")}</p>
          <Button className="mt-2" size="sm" disabled={pending} data-testid="bk-accept" onClick={() => run(() => guestBookingAction(token, requestId, "accept"), () => undefined)}>
            {t("accept")}
          </Button>
        </div>
      )}
      {canReply && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => guestBookingAction(token, requestId, "reply", body), () => setBody(""));
          }}
        >
          <Field label={status === "info_requested" ? t("replyAnswer") : t("replyAdd")} htmlFor={`bkr-${requestId}`}>
            <Textarea id={`bkr-${requestId}`} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} data-testid="bk-reply" />
          </Field>
          <Button type="submit" size="sm" variant="outline" disabled={pending || !body.trim()} data-testid="bk-reply-send">
            {t("replySend")}
          </Button>
        </form>
      )}
      {canCancel &&
        (cancel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]">{t("cancelConfirmText")}</span>
            <Button size="sm" variant="danger" disabled={pending} data-testid="bk-cancel-confirm" onClick={() => run(() => guestBookingAction(token, requestId, "cancel"), () => setCancel(false))}>
              {t("cancelConfirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancel(false)}>
              {t("keep")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setCancel(true)} data-testid="bk-cancel">
            {t("cancel")}
          </Button>
        ))}
      {error && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
