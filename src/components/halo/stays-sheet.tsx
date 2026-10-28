"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, LogOut } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Property, Reservation } from "@/lib/domain/types";
import { formatLocalTime } from "@/lib/engine/time";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EmptyState } from "./empty-state";
import { GuestBadges } from "./guest-badges";
import { CalendarX } from "lucide-react";
import { useHalo } from "@/lib/store/halo-store";
import { arrivalControl } from "@/lib/engine/arrival-control";

const STATE_TONE = { blocked: "danger", watch: "warning", preparing: "accent", ready: "success" } as const;

/** Arrivées ou départs du jour : qui, combien, bébés, animaux, à quelle heure. */
export function StaysSheet({
  kind,
  stays,
  properties,
  title,
  onClose,
}: {
  kind: "arrivals" | "departures" | null;
  stays: Reservation[];
  properties: Property[];
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const tasks = useHalo((s) => s.tasks);
  const alerts = useHalo((s) => s.alerts);
  const services = useHalo((s) => s.services);
  if (!kind) return null;
  const now = new Date();
  const at = (r: Reservation) => (kind === "arrivals" ? r.checkInAt : r.checkOutAt);
  const sorted = [...stays].sort((a, b) => at(a).localeCompare(at(b)));
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={title} description={t("staysSheet.count", { count: stays.length })} closeLabel={t("common.close")}>
        {sorted.length === 0 ? (
          <EmptyState icon={CalendarX} title={t("staysSheet.empty")} className="py-8" />
        ) : (
          <ul className="divide-y divide-line">
            {sorted.map((r) => {
              const p = properties.find((x) => x.id === r.propertyId);
              const tz = p?.timezone ?? "UTC";
              return (
                <li key={r.id}>
                  <Link href={`/properties/${r.propertyId}`} className="flex items-center gap-3 py-3" onClick={onClose}>
                    <span className="w-14 shrink-0 text-[17px] font-semibold tabular">{formatLocalTime(new Date(at(r)), tz, locale)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold">{r.guestName ?? t(`source.${r.source}`)}</span>
                        {r.source !== "manual" && <Badge>{t(`source.${r.source}`)}</Badge>}
                        {kind === "arrivals" &&
                          (() => {
                            const [row] = arrivalControl({ stays: [r], tasks, alerts, services, now });
                            return row ? (
                              <Badge tone={STATE_TONE[row.state]} data-testid="readiness">
                                {t(`arrivals.state.${row.state}`)}
                              </Badge>
                            ) : null;
                          })()}
                        {kind === "departures" && r.departedAt && (
                          <Badge tone="success">
                            <LogOut className="size-3" />
                            {t("staysSheet.departed")}
                          </Badge>
                        )}
                      </span>
                      <span className="block text-[14px] text-muted">{p?.name}</span>
                      <GuestBadges guests={r.guestsCount} babies={r.babies} pets={r.pets} vip={r.vip} size="sm" className="mt-1" />
                      {r.notes && <span className="mt-1 block text-caption text-fg">{r.notes}</span>}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-faint rtl:-scale-x-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
