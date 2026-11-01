import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { BookingDecision, type Offer } from "@/components/connected/booking-forms";
import { MarkBookingRead } from "@/components/connected/mark-booking-read";
import { OutboxList, type OutboxItem } from "@/components/connected/outbox-list";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { nowDate } from "@/lib/connected/time";

export default async function BookingPage({ params }: PageProps<"/[locale]/app/bookings/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.booking");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const { data: q } = await supabase.from("booking_requests").select("*, properties(name, timezone, capacity)").eq("organization_id", o).eq("id", id).maybeSingle();
  if (!q) notFound();
  const p = (Array.isArray(q.properties) ? q.properties[0] : q.properties) as { name: string; timezone: string; capacity: number | null } | null;
  const tz = p?.timezone ?? "Europe/Paris";
  const offer = (q.offer ?? null) as Offer | null;
  const dIn = offer?.check_in ?? q.check_in;
  const dOut = offer?.check_out ?? q.check_out;
  const [{ data: events }, { data: busy }, { data: sources }, { data: origin }, { data: members }, { data: outbox }] = await Promise.all([
    supabase.from("booking_request_events").select("id, kind, visibility, actor_id, body, at").eq("organization_id", o).eq("request_id", id).order("at"),
    // Séjours ou blocages connus qui chevauchent les dates demandées (ou proposées)
    supabase
      .from("reservations")
      .select("id, guest_name, check_in_at, check_out_at, status, source")
      .eq("organization_id", o)
      .eq("property_id", q.property_id)
      .in("status", ["confirmed", "blocked"])
      .lt("check_in_at", `${dOut}T23:59:59Z`)
      .gt("check_out_at", `${dIn}T00:00:00Z`),
    supabase.from("data_sources").select("id, label, platform, status, last_success_at, last_error, last_sync_at").eq("organization_id", o).eq("property_id", q.property_id),
    q.origin_reservation_id ? supabase.from("reservations").select("id, guest_name, guest_email, check_in_at, check_out_at").eq("organization_id", o).eq("id", q.origin_reservation_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", o),
    q.new_reservation_id ?? q.origin_reservation_id
      ? supabase.from("notification_outbox").select("id, template, recipient, status, attempts, last_error, created_at, sent_at").eq("organization_id", o).eq("template", "booking_update").eq("recipient", q.contact_email).order("created_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
  ]);
  const who = (uid: string | null) => {
    const m = (members ?? []).find((x) => x.user_id === uid);
    return ((Array.isArray(m?.profiles) ? m?.profiles[0] : m?.profiles) as { full_name: string | null } | undefined)?.full_name || null;
  };
  const day = (x: string) => f.dateTime(new Date(`${x}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const dt = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  // Calendriers externes : signalés s'ils ne sont pas à jour (la disponibilité n'est alors pas garantie)
  const staleCals = (sources ?? []).filter((s) => s.status === "paused" || !s.last_success_at || nowDate().getTime() - Date.parse(s.last_success_at) > 86_400_000 || (s.last_error && s.last_sync_at && s.last_sync_at > (s.last_success_at ?? "")));
  const nights = Math.round((Date.parse(dOut) - Date.parse(dIn)) / 86_400_000);
  const overCapacity = p?.capacity != null && q.adults + q.children > p.capacity;
  return (
    <>
      <PageHeader
        title={q.contact_name}
        subtitle={`${p?.name} · ${day(q.check_in)} → ${day(q.check_out)}`}
        actions={
          <Link href="/app/bookings" className="text-[14px] text-accent-text hover:underline">
            {t("back")}
          </Link>
        }
      />
      {q.manager_unread && <MarkBookingRead id={q.id} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-5" data-testid="booking-detail" data-status={q.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-medium dark:bg-surface-hover" data-testid="booking-status">
                {t(`status.${q.status}`)}
              </span>
              <span className="text-[13px] text-muted">{t("receivedOn", { date: dt(q.created_at) })}</span>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
              <dt className="text-muted">{t("dates")}</dt>
              <dd>
                {day(q.check_in)} → {day(q.check_out)}
              </dd>
              <dt className="text-muted">{t("guests")}</dt>
              <dd>{t("guestsValue", { adults: q.adults, children: q.children, babies: q.babies })}</dd>
              <dt className="text-muted">{t("email")}</dt>
              <dd className="break-all">{q.contact_email}</dd>
              {q.contact_phone && (
                <>
                  <dt className="text-muted">{t("phone")}</dt>
                  <dd>{q.contact_phone}</dd>
                </>
              )}
            </dl>
            {overCapacity && <p className="mt-2 text-[13px] text-warning">{t("overCapacity", { capacity: p!.capacity! })}</p>}
            {q.message && <p className="mt-3 whitespace-pre-wrap rounded-md bg-subtle p-3 text-[14px] dark:bg-surface-hover">{q.message}</p>}
            {origin && (
              <p className="mt-3 text-[13px] text-muted" data-testid="booking-origin">
                {t("origin")}{" "}
                <Link href={`/app/stays/${origin.id}`} className="text-accent-text hover:underline">
                  {origin.guest_name ?? "—"} · {f.dateTime(new Date(origin.check_in_at), { dateStyle: "medium", timeZone: tz })}
                </Link>
                {origin.guest_email && origin.guest_email.toLowerCase() !== q.contact_email.toLowerCase() ? ` · ${t("emailDiffers")}` : ""}
              </p>
            )}
          </Card>

          <Card className="p-5" data-testid="booking-availability">
            <h2 className="text-[17px] font-semibold">{t("availabilityTitle")}</h2>
            <p className="mt-1 text-[13px] text-muted">
              {offer ? t("availabilityOffer", { from: day(dIn), to: day(dOut) }) : t("availabilityAsked")} · {t("nights", { count: nights })}
            </p>
            {(busy ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1 text-[14px] text-danger" data-testid="booking-conflicts">
                {(busy ?? []).map((b) => (
                  <li key={b.id}>
                    {b.status === "blocked" ? t("blocked") : b.guest_name || t("stay")} · {dt(b.check_in_at)} → {dt(b.check_out_at)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[14px] text-success" data-testid="booking-free">{t("noConflict")}</p>
            )}
            {(sources ?? []).length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">{t("noCalendars")}</p>
            ) : staleCals.length > 0 ? (
              <p className="mt-2 rounded-md bg-warning-soft p-2 text-[13px]" data-testid="booking-stale-cals">
                {t("staleCalendars", { calendars: staleCals.map((s) => s.label ?? s.platform).join(", ") })}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-muted">{t("calendarsOk")}</p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("decisionTitle")}</h2>
            <div className="mt-3">
              <BookingDecision id={q.id} status={q.status} checkIn={q.check_in} checkOut={q.check_out} offer={offer} knownConflict={(busy ?? []).length > 0} newReservationId={q.new_reservation_id} />
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          {offer && (
            <Card className="p-5" data-testid="booking-offer">
              <h2 className="text-[17px] font-semibold">{t("offerTitle")}</h2>
              <p className="mt-1 text-[14px]">
                {day(offer.check_in)} → {day(offer.check_out)}
              </p>
              <p className="mt-1 text-[14px]">
                {f.number(offer.price, { style: "currency", currency: offer.currency })} + {f.number(offer.fees, { style: "currency", currency: offer.currency })} ={" "}
                <strong>{f.number(offer.total, { style: "currency", currency: offer.currency })}</strong>
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[13px]">{offer.conditions}</p>
              {offer.valid_until && <p className="mt-1 text-[12px] text-muted">{t("offerValid", { date: day(offer.valid_until) })}</p>}
              <p className="mt-2 text-[12px] text-muted" data-testid="booking-payment">{t("paymentOutside")}</p>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("historyTitle")}</h2>
            <ol className="mt-2 space-y-2 border-s border-line ps-3 text-[14px]" data-testid="booking-history">
              {(events ?? []).map((e) => (
                <li key={e.id} data-visibility={e.visibility}>
                  <span className="text-[12px] text-faint">{dt(e.at)} · </span>
                  {t(`event.${e.kind}`)}
                  {e.actor_id ? ` · ${who(e.actor_id) ?? "—"}` : ""}
                  {e.visibility === "internal" && <span className="ms-1 rounded bg-warning-soft px-1.5 text-[11px] font-medium">{t("internalBadge")}</span>}
                  {e.body && <p className="whitespace-pre-wrap text-[13px] text-muted">{e.body === "dates_unavailable" ? t("datesUnavailable") : e.body}</p>}
                </li>
              ))}
            </ol>
            {q.internal_note && (
              <p className="mt-3 rounded-md bg-warning-soft p-3 text-[13px]" data-testid="booking-internal-note">
                <strong>{t("internalNote")} :</strong> {q.internal_note}
              </p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("deliveryTitle")}</h2>
            <p className="mb-2 mt-1 text-[13px] text-muted">{t("deliveryText", { email: q.contact_email })}</p>
            <OutboxList items={(outbox ?? []) as OutboxItem[]} />
          </Card>
        </div>
      </div>
    </>
  );
}
