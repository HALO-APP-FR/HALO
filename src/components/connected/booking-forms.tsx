"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CalendarPlus, Copy, ShieldOff, Star } from "lucide-react";
import { confirmBooking, createBookingLink, decideBooking, revokeBookingLink } from "@/lib/connected/booking-actions";
import { createReviewLink } from "@/lib/connected/review-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { useRun } from "./use-run";

const DELIVERY = ["sent", "pending", "failed", "not_configured", "skipped"];
// Réservé par un envoi en cours : affiché « en attente »
const shown = (s: string) => (s === "sending" ? "pending" : s);

/** Lien affiché une seule fois (jamais conservé en clair par HALO). */
function OnceLink({ url }: { url: string }) {
  const t = useTranslations("connected.link");
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-md border border-accent bg-accent-soft p-3">
      <p className="text-[13px] font-medium">{t("copyOnce")}</p>
      <div className="mt-2 flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="once-link-url" />
        <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
          <Copy />
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

function DeliveryLine({ status }: { status: string | null }) {
  const t = useTranslations("connected.link.journey");
  if (!status) return null;
  return (
    <p className="mt-2 text-[13px]" data-testid="delivery-status" data-status={status}>
      <span className="text-muted">{t("sent")} · </span>
      {t(`delivery.${DELIVERY.includes(shown(status)) ? shown(status) : "failed"}`)}
    </p>
  );
}

export interface BookingLinkRow {
  id: string;
  valid_until: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** Fiche séjour : inviter le voyageur à demander un nouveau séjour, et lui demander son avis après le départ. */
export function StayRelations({
  reservationId,
  hasEmail,
  confirmed,
  ended,
  links,
  bookingDelivery,
  review,
  reviewDelivery,
  requests,
  timeZone,
}: {
  reservationId: string;
  hasEmail: boolean;
  confirmed: boolean;
  ended: boolean;
  links: BookingLinkRow[];
  bookingDelivery: string | null;
  review: { overall: number; submitted_at: string } | null;
  reviewDelivery: { status: string; at: string } | null;
  requests: { id: string; status: string; check_in: string; check_out: string }[];
  timeZone: string;
}) {
  const t = useTranslations("connected.relations");
  const tb = useTranslations("connected.booking");
  const locale = useLocale();
  const fd = useFormatter();
  const { pending, error, run } = useRun();
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [bDel, setBDel] = useState<string | null>(null);
  const [rDel, setRDel] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const current = links.find((l) => !l.revoked_at && Date.parse(l.valid_until) > now);
  const fmt = (d: string) => fd.dateTime(new Date(d), { dateStyle: "medium", timeZone });
  const day = (d: string) => fd.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Card className="p-5" data-testid="stay-relations">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <CalendarPlus className="size-5" />
        {t("bookingTitle")}
      </h2>
      <p className="mt-1 text-[13px] text-muted">{t("bookingText")}</p>
      {!confirmed ? (
        <p className="mt-2 text-[14px] text-muted">{t("needConfirmed")}</p>
      ) : (
        <>
          <p className="mt-2 text-[14px]" data-testid="booking-link-status">
            {current ? t("linkActive", { until: fmt(current.valid_until) }) : t("linkNone")}
            {current?.last_used_at ? ` · ${t("linkUsed", { at: fmt(current.last_used_at) })}` : ""}
          </p>
          <DeliveryLine status={bDel ?? bookingDelivery} />
          <div className="mt-3 flex flex-wrap gap-2">
            {hasEmail && (
              <Button size="sm" disabled={pending} data-testid="booking-link-send" onClick={() => run(() => createBookingLink(reservationId, true, locale), (d) => (setBDel(d.delivery), setBookingUrl(`${origin}/${locale}/b/${d.token}`)))}>
                {current ? t("renewSend") : t("send")}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={pending} data-testid="booking-link-create" onClick={() => run(() => createBookingLink(reservationId, false, locale), (d) => (setBDel(null), setBookingUrl(`${origin}/${locale}/b/${d.token}`)))}>
              {current ? t("renewCopy") : t("createCopy")}
            </Button>
            {current && (
              <Button size="sm" variant="ghost" disabled={pending} data-testid="booking-link-revoke" onClick={() => run(() => revokeBookingLink(current.id), () => setBookingUrl(null))}>
                <ShieldOff />
                {t("revoke")}
              </Button>
            )}
          </div>
          <p className="mt-2 text-[12px] text-faint">{t("linkRules")}</p>
          {bookingUrl && <OnceLink url={bookingUrl} />}
          {requests.length > 0 && (
            <ul className="mt-3 space-y-1 text-[14px]" data-testid="stay-booking-requests">
              {requests.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/bookings/${r.id}`} className="text-accent-text hover:underline">
                    {day(r.check_in)} → {day(r.check_out)}
                  </Link>{" "}
                  · <span className="text-muted">{tb(`status.${r.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h2 className="mt-6 flex items-center gap-2 text-[17px] font-semibold">
        <Star className="size-5" />
        {t("reviewTitle")}
      </h2>
      <p className="mt-1 text-[13px] text-muted">{t("reviewText")}</p>
      {review ? (
        <p className="mt-2 text-[14px]" data-testid="stay-review">
          {t("reviewReceived", { overall: review.overall, date: fmt(review.submitted_at) })}{" "}
          <Link href={`/app/satisfaction`} className="text-accent-text hover:underline">
            {t("openSatisfaction")}
          </Link>
        </p>
      ) : !ended || !confirmed ? (
        <p className="mt-2 text-[14px] text-muted">{t("reviewAfter")}</p>
      ) : (
        <>
          {reviewDelivery && !rDel && <DeliveryLine status={reviewDelivery.status} />}
          <DeliveryLine status={rDel} />
          <div className="mt-3 flex flex-wrap gap-2">
            {hasEmail && (
              <Button size="sm" disabled={pending} data-testid="review-link-send" onClick={() => run(() => createReviewLink("guest", reservationId, true, locale), (d) => (setRDel(d.delivery), setReviewUrl(`${origin}/${locale}/avis/${d.token}`)))}>
                {t("reviewSend")}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={pending} data-testid="review-link-create" onClick={() => run(() => createReviewLink("guest", reservationId, false, locale), (d) => (setRDel(null), setReviewUrl(`${origin}/${locale}/avis/${d.token}`)))}>
              {t("reviewCopy")}
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-faint">{t("reviewRules")}</p>
          {reviewUrl && <OnceLink url={reviewUrl} />}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Détail d'une demande côté responsable
// ---------------------------------------------------------------------------
export interface Offer {
  check_in: string;
  check_out: string;
  price: number;
  fees: number;
  total: number;
  currency: string;
  conditions: string;
  valid_until: string | null;
}

export function BookingDecision({
  id,
  status,
  checkIn,
  checkOut,
  offer,
  knownConflict,
  newReservationId,
}: {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  offer: Offer | null;
  knownConflict: boolean;
  newReservationId: string | null;
}) {
  const t = useTranslations("connected.booking");
  const locale = useLocale();
  const { pending, error, setError, run } = useRun();
  const [mode, setMode] = useState<"info" | "offer" | "decline" | null>(null);
  const [msg, setMsg] = useState("");
  const [internal, setInternal] = useState("");
  const [o, setO] = useState({
    altIn: offer?.check_in ?? checkIn,
    altOut: offer?.check_out ?? checkOut,
    price: offer ? String(offer.price) : "",
    fees: offer ? String(offer.fees) : "0",
    currency: offer?.currency ?? "EUR",
    conditions: offer?.conditions ?? "",
    validUntil: offer?.valid_until ?? "",
  });
  const [stale, setStale] = useState<string[] | null>(null);
  const [done, setDone] = useState<{ reservationId: string; invite: string | null } | null>(null);
  const price = Number(o.price.replace(",", "."));
  const fees = Number((o.fees || "0").replace(",", "."));
  const total = Number.isFinite(price) && Number.isFinite(fees) ? Math.round((price + fees) * 100) / 100 : NaN;
  const closed = ["confirmed", "declined", "cancelled"].includes(status);

  const confirm = (ack: boolean) =>
    run(
      () => confirmBooking(id, ack, locale),
      (d) => {
        if (d.status === "stale_calendars") setStale(d.calendars ?? []);
        else {
          setStale(null);
          setDone({ reservationId: d.reservationId!, invite: d.invite ?? null });
        }
      },
    );

  if (status === "confirmed")
    return (
      <div className="space-y-2" data-testid="booking-confirmed">
        <p className="text-[14px]">{t("confirmedText")}</p>
        {done?.invite && (
          <p className="text-[13px]" data-testid="booking-invite-delivery" data-status={done.invite}>
            {t("inviteDelivery", { status: done.invite })}
          </p>
        )}
        {(newReservationId ?? done?.reservationId) && (
          <Link href={`/app/stays/${newReservationId ?? done?.reservationId}`} className="text-[14px] font-medium text-accent-text hover:underline" data-testid="booking-open-stay">
            {t("openNewStay")}
          </Link>
        )}
        <p className="text-[13px] text-muted">{t("paymentOutside")}</p>
      </div>
    );
  if (closed) return <p className="text-[14px] text-muted">{t("closedText")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {status === "received" && (
          <Button size="sm" variant="outline" disabled={pending} data-testid="booking-review" onClick={() => run(() => decideBooking(id, "review", { message: "", internal: "" }))}>
            {t("act.review")}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={pending} data-testid="booking-info-open" onClick={() => setMode(mode === "info" ? null : "info")}>
          {t("act.info")}
        </Button>
        <Button size="sm" variant={status === "accepted" ? "outline" : "primary"} disabled={pending} data-testid="booking-offer-open" onClick={() => setMode(mode === "offer" ? null : "offer")}>
          {offer ? t("act.offerAgain") : t("act.offer")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} data-testid="booking-decline-open" onClick={() => setMode(mode === "decline" ? null : "decline")}>
          {t("act.decline")}
        </Button>
      </div>

      {status === "accepted" && (
        <div className="rounded-lg border border-success bg-success-soft p-4" data-testid="booking-confirm-box">
          <p className="text-[15px] font-medium">{t("acceptedTitle")}</p>
          <p className="mt-1 text-[13px]">{t("acceptedText")}</p>
          {stale ? (
            <div className="mt-3 rounded-md border border-warning bg-warning-soft p-3" data-testid="booking-stale">
              <p className="text-[14px] font-medium">{t("staleTitle")}</p>
              <p className="mt-1 text-[13px]">{t("staleText", { calendars: stale.join(", ") })}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={pending} data-testid="booking-confirm-ack" onClick={() => confirm(true)}>
                  {t("confirmAnyway")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStale(null)}>
                  {t("cancelAction")}
                </Button>
              </div>
            </div>
          ) : (
            <Button className="mt-3" disabled={pending} data-testid="booking-confirm" onClick={() => confirm(false)}>
              {t("confirm")}
            </Button>
          )}
        </div>
      )}

      {mode === "info" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => decideBooking(id, "info", { message: msg, internal }), () => (setMode(null), setMsg(""), setInternal("")));
          }}
        >
          <Field label={t("question")} htmlFor="b-q">
            <Textarea id="b-q" value={msg} onChange={(e) => setMsg(e.target.value)} required maxLength={2000} data-testid="booking-question" />
          </Field>
          <InternalNote value={internal} onChange={setInternal} />
          <Button type="submit" size="sm" disabled={pending} data-testid="booking-info-send">
            {t("sendQuestion")}
          </Button>
        </form>
      )}

      {mode === "offer" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!Number.isFinite(total) || !(price >= 0)) return setError(t("offerInvalid"));
            run(
              () =>
                decideBooking(id, "offer", {
                  message: msg,
                  internal,
                  offer: { price, fees, total, currency: o.currency, conditions: o.conditions, validUntil: o.validUntil || null },
                  altIn: o.altIn !== checkIn ? o.altIn : null,
                  altOut: o.altOut !== checkOut ? o.altOut : null,
                }),
              () => (setMode(null), setMsg(""), setInternal("")),
            );
          }}
          data-testid="booking-offer-form"
        >
          {knownConflict && <p className="rounded-md bg-warning-soft p-2 text-[13px]">{t("conflictHint")}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("offerIn")} htmlFor="o-in" hint={t("altHint")}>
              <Input id="o-in" type="date" value={o.altIn} onChange={(e) => setO({ ...o, altIn: e.target.value })} required />
            </Field>
            <Field label={t("offerOut")} htmlFor="o-out">
              <Input id="o-out" type="date" value={o.altOut} onChange={(e) => setO({ ...o, altOut: e.target.value })} required />
            </Field>
            <Field label={t("price")} htmlFor="o-price">
              <Input id="o-price" inputMode="decimal" value={o.price} onChange={(e) => setO({ ...o, price: e.target.value })} required data-testid="offer-price" />
            </Field>
            <Field label={t("fees")} htmlFor="o-fees">
              <Input id="o-fees" inputMode="decimal" value={o.fees} onChange={(e) => setO({ ...o, fees: e.target.value })} data-testid="offer-fees" />
            </Field>
            <Field label={t("currency")} htmlFor="o-cur">
              <Input id="o-cur" value={o.currency} maxLength={3} onChange={(e) => setO({ ...o, currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t("validUntil")} htmlFor="o-valid">
              <Input id="o-valid" type="date" value={o.validUntil} onChange={(e) => setO({ ...o, validUntil: e.target.value })} />
            </Field>
          </div>
          <p className="text-[15px] font-semibold" data-testid="offer-total">
            {t("total")} : {Number.isFinite(total) ? `${total.toFixed(2)} ${o.currency}` : "—"}
          </p>
          <Field label={t("conditions")} htmlFor="o-cond" hint={t("conditionsHint")}>
            <Textarea id="o-cond" value={o.conditions} onChange={(e) => setO({ ...o, conditions: e.target.value })} required maxLength={2000} data-testid="offer-conditions" />
          </Field>
          <Field label={t("messageToGuest")} htmlFor="o-msg">
            <Textarea id="o-msg" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} />
          </Field>
          <InternalNote value={internal} onChange={setInternal} />
          <p className="text-[12px] text-muted">{t("paymentOutside")}</p>
          <Button type="submit" size="sm" disabled={pending} data-testid="booking-offer-send">
            {t("sendOffer")}
          </Button>
        </form>
      )}

      {mode === "decline" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => decideBooking(id, "decline", { message: msg, internal }), () => setMode(null));
          }}
        >
          <Field label={t("declineMessage")} htmlFor="d-msg" hint={t("declineHint")}>
            <Textarea id="d-msg" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} />
          </Field>
          <InternalNote value={internal} onChange={setInternal} />
          <Button type="submit" size="sm" variant="danger" disabled={pending} data-testid="booking-decline-send">
            {t("declineConfirm")}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-[14px] text-danger" data-testid="booking-error">
          {error}
        </p>
      )}
    </div>
  );
}

function InternalNote({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("connected.booking");
  return (
    <Field label={t("internalNote")} htmlFor="b-internal" hint={t("internalHint")}>
      <Textarea id="b-internal" value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} data-testid="booking-internal" />
    </Field>
  );
}
