"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BedDouble, Building2, CalendarSync, ChevronRight, Plus, Search, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatLocalTime } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { currentOrNextStay } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/halo/empty-state";
import { PageHeader } from "@/components/halo/page-header";
import { PropertyCreateSheet } from "@/components/halo/property-create-sheet";
import { ReadyGate } from "@/components/halo/ready-gate";

export function PropertiesList() {
  return (
    <ReadyGate>
      <PropertiesListInner />
    </ReadyGate>
  );
}

function PropertiesListInner() {
  const t = useTranslations();
  const locale = useLocale();
  const properties = useHalo((s) => s.properties);
  const reservations = useHalo((s) => s.reservations);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [creating, setCreating] = useState(false);
  const now = new Date();

  const q = query.trim().toLocaleLowerCase(locale);
  const list = properties
    .filter((p) => (filter === "active" ? !p.archived : p.archived))
    .filter((p) => !q || [p.name, p.city, p.area, p.addressLine].filter(Boolean).join(" ").toLocaleLowerCase(locale).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, locale));

  const stayLabel = (propertyId: string, tz: string) => {
    const stay = currentOrNextStay(reservations, propertyId, now);
    if (!stay) return { text: t("properties.free"), tone: "neutral" as const };
    const fmt = (iso: string) =>
      `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso))} ${formatLocalTime(new Date(iso), tz, locale)}`;
    if (new Date(stay.checkInAt) <= now) return { text: t("properties.occupiedUntil", { date: fmt(stay.checkOutAt) }), tone: "accent" as const };
    return { text: t("properties.nextArrival", { date: fmt(stay.checkInAt) }), tone: "neutral" as const };
  };

  return (
    <>
      <PageHeader
        title={t("nav.properties")}
        subtitle={t("properties.count", { count: properties.filter((p) => !p.archived).length })}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t("properties.add")}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("properties.search")}
            aria-label={t("properties.search")}
            className="ps-10"
          />
        </div>
        <Segmented
          label={t("properties.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: t("properties.active") },
            { value: "archived", label: t("properties.archived") },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title={properties.length === 0 ? t("properties.emptyTitle") : t("properties.noResult")}
            text={properties.length === 0 ? t("properties.emptyText") : undefined}
            action={
              properties.length === 0 ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus />
                  {t("properties.add")}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const stay = stayLabel(p.id, p.timezone);
            const feedError = p.feeds.some((f) => f.lastError);
            return (
              <li key={p.id}>
                <Link
                  href={`/properties/${p.id}`}
                  className="group block h-full rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-title-3">{p.name}</h2>
                      <p className="mt-0.5 truncate text-[14px] text-muted">{[p.area, p.city].filter(Boolean).join(" · ")}</p>
                    </div>
                    <ChevronRight className="mt-1 size-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-4" strokeWidth={1.9} />
                      {p.capacity}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <BedDouble className="size-4" strokeWidth={1.9} />
                      {t("properties.beds", { count: p.beds.length })}
                    </span>
                    {p.feeds.length > 0 && (
                      <span className={feedError ? "flex items-center gap-1.5 text-danger" : "flex items-center gap-1.5"}>
                        <CalendarSync className="size-4" strokeWidth={1.9} />
                        {feedError ? t("calendar.syncError") : t("calendar.feedsCount", { count: p.feeds.length })}
                      </span>
                    )}
                  </div>
                  <div className="mt-4">
                    <Badge tone={stay.tone}>{stay.text}</Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <PropertyCreateSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}
