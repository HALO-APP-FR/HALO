import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CalendarDays, MapPin, TriangleAlert } from "lucide-react";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { Card } from "@/components/ui/card";
import { BookingRequestActions, BookingRequestForm } from "@/components/connected/booking-portal";
import { supabaseAnon } from "@/lib/supabase/server";
import { isConnected } from "@/lib/supabase/config";
import { nowDate } from "@/lib/connected/time";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "HALO", robots: { index: false, follow: false }, referrer: "no-referrer" };

interface Offer { check_in: string; check_out: string; price: number; fees: number; total: number; currency: string; conditions: string; valid_until: string | null }
interface Req {
  id: string;
  status: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  babies: number;
  guest_message: string | null;
  alt_check_in: string | null;
  alt_check_out: string | null;
  offer: Offer | null;
  created_at: string;
  events: { kind: string; body: string | null; at: string }[];
}
interface Portal {
  status: "ok";
  organization: string;
  property: { name: string; city: string | null; capacity: number | null; timezone: string };
  guest_name: string | null;
  link_valid_until: string;
  availability: { busy: { from: string; to: string }[]; calendars: { label: string; last_success_at: string | null; error: boolean; paused: boolean }[] };
  requests: Req[];
}

/** Demande de nouveau séjour (lien dédié, sans compte). Rien n'est confirmé sans décision de l'équipe. */
export default async function BookingPortal({ params }: PageProps<"/[locale]/b/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("bookingPortal");
  const f = await getFormatter();
  let data: Portal | { status: string } | null = null;
  let failed = false;
  if (isConnected() && /^[0-9a-f]{64}$/.test(token)) {
    const { data: d, error } = await supabaseAnon().rpc("booking_portal", { token });
    if (error) failed = true;
    else data = d as Portal;
  }
  if (!data || data.status !== "ok") {
    return (
      <div className="grid min-h-dvh place-items-center bg-subtle px-4">
        <Card className="max-w-md p-6 text-center" data-testid="booking-unavailable">
          <LogoMark className="mx-auto size-12 text-fg" />
          <h1 className="mt-5 text-title-2">{failed ? t("error.title") : t("unavailable.title")}</h1>
          <p className="mt-2 text-[15px] text-muted">{failed ? t("error.text") : t("unavailable.text")}</p>
        </Card>
      </div>
    );
  }
  const p = data as Portal;
  const tz = p.property.timezone || "Europe/Paris";
  const day = (x: string) => f.dateTime(new Date(`${x}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(nowDate());
  const open = p.requests.filter((r) => ["received", "in_review", "info_requested", "offer_sent", "accepted"].includes(r.status)).length;
  // Calendriers externes : la disponibilité affichée n'est garantie que s'ils sont à jour
  const stale = p.availability.calendars.filter((c) => c.paused || c.error || !c.last_success_at || nowDate().getTime() - Date.parse(c.last_success_at) > 86_400_000);
  const tone = (s: string) =>
    s === "confirmed" || s === "accepted" ? "bg-success-soft text-success" : s === "declined" || s === "cancelled" ? "bg-danger-soft text-danger" : s === "info_requested" || s === "offer_sent" ? "bg-warning-soft text-warning" : "bg-subtle text-muted";
  return (
    <div className="min-h-dvh bg-subtle">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <LogoMark className="size-8 text-fg" />
          <span className="flex-1 text-[15px] font-semibold">{p.organization}</span>
          <LocaleSwitcher variant="icon" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6" data-testid="booking-portal">
        <div>
          <h1 className="text-title-1">{p.guest_name ? t("hello", { name: p.guest_name }) : t("helloAnon")}</h1>
          <p className="mt-2 text-[15px] text-muted">{t("intro")}</p>
          <p className="mt-2 flex items-center gap-2 text-[15px] text-muted">
            <MapPin className="size-4" />
            {p.property.name}
            {p.property.city ? ` · ${p.property.city}` : ""}
          </p>
        </div>

        {p.requests.length > 0 && (
          <Card className="p-5" data-testid="bk-requests">
            <h2 className="text-[17px] font-semibold">{t("yourRequests")}</h2>
            <ul className="mt-3 space-y-4">
              {p.requests.map((r) => {
                const expired = Boolean(r.offer?.valid_until && r.offer.valid_until < today);
                return (
                  <li key={r.id} className="rounded-md border border-line p-4" data-testid="bk-request" data-status={r.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", tone(r.status))}>{t(`status.${r.status}`)}</span>
                      <span className="flex items-center gap-1 text-[14px]">
                        <CalendarDays className="size-4 text-muted" />
                        {day(r.check_in)} → {day(r.check_out)}
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] text-muted">{t(`statusText.${r.status}`)}</p>
                    {r.guest_message && (
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-accent-soft p-3 text-[14px]" data-testid="bk-team-message">
                        {r.guest_message}
                      </p>
                    )}
                    {r.alt_check_in && r.alt_check_out && !r.offer && (
                      <p className="mt-2 text-[14px]">{t("altDates", { from: day(r.alt_check_in), to: day(r.alt_check_out) })}</p>
                    )}
                    {r.offer && (
                      <div className="mt-3 rounded-md border border-line p-3 text-[14px]" data-testid="bk-offer">
                        <p className="font-medium">{t("offer.title")}</p>
                        <p className="mt-1">
                          {day(r.offer.check_in)} → {day(r.offer.check_out)}
                        </p>
                        <dl className="mt-2 grid grid-cols-2 gap-1">
                          <dt className="text-muted">{t("offer.price")}</dt>
                          <dd>{f.number(r.offer.price, { style: "currency", currency: r.offer.currency || "EUR" })}</dd>
                          <dt className="text-muted">{t("offer.fees")}</dt>
                          <dd>{f.number(r.offer.fees, { style: "currency", currency: r.offer.currency || "EUR" })}</dd>
                          <dt className="font-medium">{t("offer.total")}</dt>
                          <dd className="font-semibold" data-testid="bk-offer-total">
                            {f.number(r.offer.total, { style: "currency", currency: r.offer.currency || "EUR" })}
                          </dd>
                        </dl>
                        <p className="mt-2 whitespace-pre-wrap text-[13px]">{r.offer.conditions}</p>
                        {r.offer.valid_until && <p className="mt-1 text-[12px] text-muted">{expired ? t("offer.expired") : t("offer.validUntil", { date: day(r.offer.valid_until) })}</p>}
                        <p className="mt-2 text-[12px] text-muted">{t("offer.payment")}</p>
                      </div>
                    )}
                    {r.events.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[13px] text-muted">{t("history")}</summary>
                        <ol className="mt-2 space-y-1 border-s border-line ps-3 text-[13px]">
                          {r.events.map((e, i) => (
                            <li key={i}>
                              <span className="text-faint">{f.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short", timeZone: tz })} · </span>
                              {t(`event.${e.kind}`)}
                              {e.body ? ` — ${e.body}` : ""}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    <BookingRequestActions token={token} requestId={r.id} status={r.status} offerExpired={expired} />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{t("newTitle")}</h2>
          <p className="mt-1 text-[14px] text-muted">{t("newText")}</p>
          {p.availability.busy.length > 0 && (
            <div className="mt-3 text-[14px]" data-testid="bk-busy">
              <p className="font-medium">{t("busyTitle")}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {p.availability.busy.slice(0, 24).map((b, i) => (
                  <li key={i} className="rounded-full bg-subtle px-2 py-0.5 text-[13px] dark:bg-surface-hover">
                    {day(b.from)} → {day(b.to)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 flex items-start gap-2 text-[13px] text-muted" data-testid="bk-calendar-note">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {stale.length > 0 || p.availability.calendars.length === 0 ? t("calendarsNotGuaranteed") : t("calendarsInfo")}
          </p>
          <div className="mt-4">
            {open >= 3 ? (
              <p className="text-[14px] text-muted" data-testid="bk-too-many">
                {t("errors.too_many")}
              </p>
            ) : (
              <BookingRequestForm token={token} defaults={{ name: p.guest_name ?? "" }} busy={p.availability.busy} capacity={p.property.capacity} minDate={today} />
            )}
          </div>
          <p className="mt-4 text-[12px] text-faint">{t("linkValid", { date: f.dateTime(new Date(p.link_valid_until), { dateStyle: "medium", timeZone: tz }) })}</p>
        </Card>
      </main>
    </div>
  );
}
