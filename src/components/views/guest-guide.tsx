"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Car, CheckCircle2, Clock, ConciergeBell, Copy, DoorOpen, KeyRound, LifeBuoy, LogOut, MapPin, PackageOpen, Phone, ScrollText, Sparkles, Trash, Wifi,
} from "lucide-react";
import type { Property, Reservation, ServiceKind } from "@/lib/domain/types";
import { decodeGuide, type GuidePayload } from "@/lib/engine/guide-link";
import { OUTDOOR_AMENITIES } from "@/lib/domain/amenities";
import { formatLocalTime } from "@/lib/engine/time";
import { useHalo, useHaloReady } from "@/lib/store/halo-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AmenityIcon } from "@/components/halo/amenity-icon";
import { EmptyState } from "@/components/halo/empty-state";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { LogoMark } from "@/components/halo/logo";
import { ReportSheet } from "@/components/halo/report-sheet";
import { VipBadge } from "@/components/halo/vip-badge";
import { Badge } from "@/components/ui/badge";
import { SERVICE_ICON, SERVICE_STATUS_TONE } from "@/components/services/service-meta";
import { GuestServiceSheet } from "@/components/services/service-sheet";

/** Livret reçu dans le lien (QR code scanné sur un autre téléphone). */
function payloadToProperty(p: GuidePayload, token: string): Property {
  return {
    id: `shared-${token}`,
    name: p.name,
    addressLine: p.address,
    city: p.city ?? "",
    countryCode: "",
    timezone: p.tz,
    capacity: 0,
    beds: [],
    defaultCheckIn: p.in,
    defaultCheckOut: p.out,
    cleaningDurationMin: 0,
    checkInService: false,
    checkOutService: false,
    access: { type: "other" },
    checklist: [],
    amenities: p.amenities,
    customAmenities: p.custom,
    guide: { ...p.guide, token, enabled: true },
    linenParLevel: 3,
    feeds: [],
    archived: false,
    createdAt: "",
  };
}

const GUEST_SERVICES: ServiceKind[] = ["private_chef", "restaurant", "driver", "airport_transfer", "grocery", "spa"];

/** Séjour concerné : celui demandé dans le lien, sinon le séjour en cours, sinon le prochain. */
function findStay(reservations: Reservation[], propertyId: string, stayId: string | undefined, now: Date) {
  const mine = reservations.filter((r) => r.propertyId === propertyId && r.status === "confirmed");
  if (stayId) return mine.find((r) => r.id === stayId);
  return (
    mine.find((r) => new Date(r.checkInAt) <= now && new Date(r.checkOutAt) > now) ??
    mine.filter((r) => new Date(r.checkInAt) > now).sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))[0]
  );
}

export function GuestGuideView({ token, stayId }: { token: string; stayId?: string }) {
  const ready = useHaloReady();
  const property = useHalo((s) => s.properties.find((p) => p.guide.token === token));
  const reservations = useHalo((s) => s.reservations);
  const t = useTranslations("guest");
  // undefined = lien pas encore lu ; null = pas de livret dans le lien
  const [shared, setShared] = useState<Property | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const m = window.location.hash.match(/[#&]d=([^&]+)/);
    void Promise.resolve(m ? decodeGuide(m[1]) : null).then((p) => alive && setShared(p ? payloadToProperty(p, token) : null));
    return () => {
      alive = false;
    };
  }, [token]);

  if (!ready || shared === undefined) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }
  // Pas de données locales pour ce lien (autre téléphone) : on affiche le livret contenu dans le lien
  if (!property && shared) return <GuestGuideInner property={shared} shared />;
  if (!property || !property.guide.enabled || property.archived) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl items-center px-4">
        <EmptyState icon={DoorOpen} title={t("unavailable")} text={t("unavailableText")} />
      </div>
    );
  }
  return <GuestGuideInner property={property} stay={findStay(reservations, property.id, stayId, new Date())} />;
}

function Section({ icon: Icon, title, children }: { icon: typeof Wifi; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 flex items-center gap-2.5 text-title-3">
        <span className="grid size-8 place-items-center rounded-md bg-subtle text-fg dark:bg-surface-hover">
          <Icon className="size-[18px]" strokeWidth={1.9} />
        </span>
        {title}
      </h2>
      <div className="text-[16px] leading-6">{children}</div>
    </section>
  );
}

const Para = ({ text }: { text?: string }) => (text ? <p className="whitespace-pre-line text-fg">{text}</p> : null);

function GuestGuideInner({ property, stay, shared = false }: { property: Property; stay?: Reservation; shared?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const g = property.guide;
  const tz = property.timezone;
  const [report, setReport] = useState<"problem" | "missing" | null>(null);
  const [serviceKind, setServiceKind] = useState<ServiceKind | null>(null);
  const allServices = useHalo((s) => s.services);
  const myRequests = stay ? allServices.filter((x) => x.reservationId === stay.id && x.status !== "cancelled") : [];
  const [departed, setDeparted] = useState(Boolean(stay?.departedAt));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  const amenities = [...property.amenities.filter((a) => !OUTDOOR_AMENITIES.has(a))];
  const outdoor = property.amenities.filter((a) => OUTDOOR_AMENITIES.has(a));

  return (
    <div className="min-h-dvh bg-subtle pb-40">
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 pt-[max(env(safe-area-inset-top),16px)]">
        <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.18em] text-muted">
          <LogoMark className="size-5" />
          HALO
        </span>
        <LocaleSwitcher />
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-6">
        <div className="pb-2">
          <p className="text-[15px] font-medium text-muted">{t("guest.welcomeTo")}</p>
          <h1 className="mt-1 text-display">{stay?.guestName ? t("guest.hello", { name: stay.guestName }) : property.name}</h1>
          {stay?.vip && <VipBadge className="mt-2" />}
          {stay?.guestName && <p className="mt-1 text-title-3 text-muted">{property.name}</p>}
          <p className="mt-2 flex items-center gap-1.5 text-[15px] text-muted">
            <MapPin className="size-4" />
            {[property.addressLine, property.postalCode, property.city].filter(Boolean).join(", ")}
          </p>
        </div>

        {g.welcome && (
          <div className="rounded-xl bg-fg p-5 text-[16px] leading-6 text-canvas">
            <p className="whitespace-pre-line">{g.welcome}</p>
          </div>
        )}

        <Section icon={Clock} title={t("guest.yourStay")}>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-subtle p-3 dark:bg-surface-hover">
              <dt className="text-caption text-muted">{t("guest.arrival")}</dt>
              <dd className="mt-1 font-semibold first-letter:uppercase">
                {stay ? fmtDay(stay.checkInAt) : t("guest.from", { time: property.defaultCheckIn })}
              </dd>
              {stay && <dd className="text-[15px] text-muted">{t("guest.from", { time: formatLocalTime(new Date(stay.checkInAt), tz, locale) })}</dd>}
            </div>
            <div className="rounded-lg bg-subtle p-3 dark:bg-surface-hover">
              <dt className="text-caption text-muted">{t("guest.departure")}</dt>
              <dd className="mt-1 font-semibold first-letter:uppercase">
                {stay ? fmtDay(stay.checkOutAt) : t("guest.before", { time: property.defaultCheckOut })}
              </dd>
              {stay && <dd className="text-[15px] text-muted">{t("guest.before", { time: formatLocalTime(new Date(stay.checkOutAt), tz, locale) })}</dd>}
            </div>
          </dl>
        </Section>

        {(g.wifiName || g.wifiPassword) && (
          <Section icon={Wifi} title={t("guest.wifi")}>
            <dl className="space-y-2">
              {g.wifiName && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t("guest.network")}</dt>
                  <dd className="font-semibold">{g.wifiName}</dd>
                </div>
              )}
              {g.wifiPassword && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{t("guest.password")}</dt>
                  <dd className="flex items-center gap-2">
                    <span className="font-semibold tabular tracking-wide">{g.wifiPassword}</span>
                    <button
                      type="button"
                      className="grid size-10 place-items-center rounded-md bg-subtle dark:bg-surface-hover"
                      aria-label={t("guest.copyPassword")}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(g.wifiPassword ?? "");
                          toast(t("guest.copied"));
                        } catch {
                          /* copie impossible : le mot de passe reste lisible */
                        }
                      }}
                    >
                      <Copy className="size-4" />
                    </button>
                  </dd>
                </div>
              )}
            </dl>
          </Section>
        )}

        {g.accessInfo && (
          <Section icon={KeyRound} title={t("guest.access")}>
            <Para text={g.accessInfo} />
          </Section>
        )}

        {(property.amenities.length > 0 || property.customAmenities.length > 0) && (
          <Section icon={Sparkles} title={t("guest.amenities")}>
            {outdoor.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-2">
                {outdoor.map((a) => (
                  <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[14px] font-medium text-accent-text">
                    <AmenityIcon amenity={a} />
                    {t(`amenity.${a}`)}
                  </li>
                ))}
              </ul>
            )}
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
              {amenities.map((a) => (
                <li key={a} className="flex items-center gap-2 text-[15px]">
                  <AmenityIcon amenity={a} className="size-4 text-muted" />
                  {t(`amenity.${a}`)}
                </li>
              ))}
              {property.customAmenities.map((a) => (
                <li key={a} className="flex items-center gap-2 text-[15px]">
                  <AmenityIcon amenity="custom" className="size-4 text-muted" />
                  {a}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section icon={ConciergeBell} title={t("guest.concierge")}>
          <p className="text-[15px] text-muted">{stay?.vip ? t("guest.conciergeVip") : t("guest.conciergeText")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {GUEST_SERVICES.map((k) => {
              const Icon = SERVICE_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setServiceKind(k)}
                  className="flex min-h-12 items-center gap-2 rounded-lg border border-line px-3 py-2 text-start text-[14px] font-medium transition-colors hover:bg-surface-hover"
                >
                  <Icon className="size-[18px] shrink-0 text-vip" strokeWidth={1.9} />
                  {t(`serviceKind.${k}`)}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setServiceKind("other")} className="mt-2 text-[14px] font-medium text-accent-text">
            + {t("guest.otherRequest")}
          </button>
          {myRequests.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
              {myRequests.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-[14px]">
                  <span>
                    <span className="font-medium">{t(`serviceKind.${x.kind}`)}</span>
                    <span className="block text-caption text-muted first-letter:uppercase">
                      {new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric" }).format(new Date(x.startAt))} · {formatLocalTime(new Date(x.startAt), tz, locale)}
                    </span>
                  </span>
                  <Badge tone={SERVICE_STATUS_TONE[x.status]}>{t(`serviceStatus.${x.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {g.houseRules && (
          <Section icon={ScrollText} title={t("guest.rules")}>
            <Para text={g.houseRules} />
          </Section>
        )}
        {(g.parking || g.trash) && (
          <Section icon={Car} title={t("guest.practical")}>
            <div className="space-y-3">
              {g.parking && (
                <div>
                  <p className="text-caption text-muted">{t("guide.parking")}</p>
                  <Para text={g.parking} />
                </div>
              )}
              {g.trash && (
                <div>
                  <p className="flex items-center gap-1 text-caption text-muted">
                    <Trash className="size-3.5" />
                    {t("guide.trash")}
                  </p>
                  <Para text={g.trash} />
                </div>
              )}
            </div>
          </Section>
        )}
        {g.checkoutInstructions && (
          <Section icon={LogOut} title={t("guest.checkout")}>
            <Para text={g.checkoutInstructions} />
          </Section>
        )}
        {g.recommendations && (
          <Section icon={MapPin} title={t("guest.recommendations")}>
            <Para text={g.recommendations} />
          </Section>
        )}
        {g.emergencyPhone && (
          <a
            href={`tel:${g.emergencyPhone.replace(/[^\d+]/g, "")}`}
            className="flex items-center justify-between rounded-xl border border-line bg-surface p-5 shadow-card"
          >
            <span className="flex items-center gap-3">
              <Phone className="size-5 text-danger" />
              <span>
                <span className="block text-caption text-muted">{t("guest.emergency")}</span>
                <span className="block text-title-3 tabular">{g.emergencyPhone}</span>
              </span>
            </span>
          </a>
        )}
        {shared && <p className="px-2 pt-2 text-center text-caption text-faint">{t("guest.sharedNotice")}</p>}
      </main>

      {/* Actions voyageur : toujours à portée de pouce */}
      <nav
        aria-label={t("guest.actions")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-xl"
      >
        <div className="mx-auto grid max-w-xl grid-cols-3 gap-2">
          <Button variant="secondary" className="h-16 flex-col gap-1 rounded-lg text-[13px]" onClick={() => setReport("problem")}>
            <LifeBuoy className="size-5" />
            {t("guest.problem")}
          </Button>
          <Button variant="secondary" className="h-16 flex-col gap-1 rounded-lg text-[13px]" onClick={() => setReport("missing")}>
            <PackageOpen className="size-5" />
            {t("guest.missing")}
          </Button>
          {departed ? (
            <span className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg bg-success-soft text-[13px] font-medium text-success">
              <CheckCircle2 className="size-5" />
              {t("guest.goodbye")}
            </span>
          ) : (
            <Button
              variant={confirmLeave ? "primary" : "secondary"}
              className="h-16 flex-col gap-1 rounded-lg text-[13px]"
              disabled={!stay}
              onClick={() => {
                if (!stay) return;
                if (!confirmLeave) {
                  setConfirmLeave(true);
                  return;
                }
                useHalo.getState().markDeparted(stay.id);
                setDeparted(true);
                toast(t("guest.departedToast"));
              }}
            >
              <LogOut className="size-5" />
              {confirmLeave ? t("guest.confirmLeave") : t("guest.leaving")}
            </Button>
          )}
        </div>
      </nav>

      <ReportSheet
        open={report !== null}
        onOpenChange={(o) => !o && setReport(null)}
        property={property}
        source="guest"
        mode={report ?? "problem"}
        reservationId={stay?.id}
        reporterName={stay?.guestName}
      />
      <GuestServiceSheet
        open={serviceKind !== null}
        onOpenChange={(o) => !o && setServiceKind(null)}
        property={property}
        stay={stay}
        initialKind={serviceKind ?? "other"}
      />
    </div>
  );
}
