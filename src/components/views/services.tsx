"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, Coins, ConciergeBell, Inbox, Plus } from "lucide-react";
import { initialsOf, type ServiceRequest } from "@/lib/domain/types";
import { addDaysToKey, formatLocalTime, localDateKey } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { byId } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/halo/avatar";
import { EmptyState } from "@/components/halo/empty-state";
import { KpiCard } from "@/components/halo/kpi-card";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { VipBadge } from "@/components/halo/vip-badge";
import { isPendingService, SERVICE_STATUS_TONE, ServiceIcon } from "@/components/services/service-meta";
import { ServiceSheet } from "@/components/services/service-sheet";
import { cn } from "@/lib/utils";

type Filter = "todo" | "upcoming" | "done" | "all";

export function Services() {
  return (
    <ReadyGate>
      <ServicesInner />
    </ReadyGate>
  );
}

function ServicesInner() {
  const t = useTranslations();
  const locale = useLocale();
  const services = useHalo((s) => s.services);
  const properties = useHalo((s) => s.properties);
  const members = useHalo((s) => s.members);
  const reservations = useHalo((s) => s.reservations);
  const orgTz = useHalo((s) => s.org.timezone);
  const currency = useHalo((s) => s.linenSettings.currency);
  const [filter, setFilter] = useState<Filter>("todo");
  const [editing, setEditing] = useState<ServiceRequest | "new" | null>(null);
  const props = byId(properties);
  const people = byId(members);
  const stays = byId(reservations);

  const now = new Date();
  const todayKey = localDateKey(now, orgTz);
  const in7 = addDaysToKey(todayKey, 7);
  const dayOf = (x: ServiceRequest) => localDateKey(new Date(x.startAt), props.get(x.propertyId)?.timezone ?? orgTz);
  const requested = services.filter(isPendingService);
  const week = services.filter((x) => x.status !== "cancelled" && dayOf(x) >= todayKey && dayOf(x) <= in7);
  const monthRevenue = services
    .filter((x) => (x.status === "confirmed" || x.status === "done") && dayOf(x).slice(0, 7) === todayKey.slice(0, 7))
    .reduce((n, x) => n + (x.price ?? 0), 0);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });

  const list = services
    .filter((x) =>
      filter === "todo"
        ? isPendingService(x)
        : filter === "upcoming"
          ? x.status === "confirmed" && dayOf(x) >= todayKey
          : filter === "done"
            ? x.status === "done" || x.status === "cancelled" || x.status === "declined"
            : true,
    )
    .sort((a, b) => (filter === "done" ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt)));

  const groups = new Map<string, ServiceRequest[]>();
  for (const x of list) groups.set(dayOf(x), [...(groups.get(dayOf(x)) ?? []), x]);

  return (
    <>
      <PageHeader
        title={t("nav.services")}
        subtitle={t("services.subtitle")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {t("services.new")}
          </Button>
        }
      />
      <section className="mb-5 grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-4">
        <KpiCard label={t("services.kpiRequested")} value={requested.length} icon={Inbox} tone="danger" onClick={() => setFilter("todo")} />
        <KpiCard label={t("services.kpiWeek")} value={week.length} icon={CalendarCheck} onClick={() => setFilter("upcoming")} />
        <Card className="flex items-center justify-between gap-2 px-3.5 py-2.5 md:block md:p-5">
          <span className="flex items-center justify-between text-caption text-muted">
            {t("services.kpiRevenue")}
            <Coins className="hidden size-4 text-faint md:block" />
          </span>
          <span className="block text-[22px] font-bold tabular md:mt-1 md:text-display">{money.format(monthRevenue)}</span>
        </Card>
      </section>

      <Segmented
        label={t("alerts.filter")}
        value={filter}
        onChange={setFilter}
        options={[
          { value: "todo", label: `${t("services.filterTodo")}${requested.length ? ` · ${requested.length}` : ""}` },
          { value: "upcoming", label: t("services.filterUpcoming") },
          { value: "done", label: t("services.filterDone") },
          { value: "all", label: t("alerts.all") },
        ]}
        className="mb-4"
      />

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={ConciergeBell} title={t("services.empty")} text={t("services.emptyText")} />
        </Card>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([key, items]) => (
            <section key={key}>
              <h2 className="mb-2 text-micro text-muted">
                {key === todayKey
                  ? t("time.today")
                  : new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`))}
              </h2>
              <Card className="divide-y divide-line">
                {items.map((x) => {
                  const p = props.get(x.propertyId);
                  const who = x.assigneeId ? people.get(x.assigneeId) : undefined;
                  const stay = x.reservationId ? stays.get(x.reservationId) : undefined;
                  return (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setEditing(x)}
                      className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-surface-hover md:px-5", (x.status === "cancelled" || x.status === "declined") && "opacity-50")}
                    >
                      <ServiceIcon kind={x.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold">{t(`serviceKind.${x.kind}`)}</span>
                          <span className="text-[15px] font-semibold tabular text-muted">{formatLocalTime(new Date(x.startAt), p?.timezone ?? orgTz, locale)}</span>
                          <Badge tone={SERVICE_STATUS_TONE[x.status]}>{t(`serviceStatus.${x.status}`)}</Badge>
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
                          {p?.name}
                          {x.guestName && <span>· {x.guestName}</span>}
                          {x.people ? <span>· {t("task.guests", { count: x.people })}</span> : null}
                          {stay?.vip && <VipBadge />}
                        </span>
                        {x.details && <span className="mt-1 block truncate text-[14px]">{x.details}</span>}
                      </span>
                      <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                        {who ? (
                          <span className="flex items-center gap-1.5 text-caption">
                            <Avatar initials={initialsOf(who.name)} color={who.color} size="sm" className="ring-0" />
                            {who.name.split(" ")[0]}
                          </span>
                        ) : x.provider ? (
                          <span className="text-caption text-muted">{x.provider}</span>
                        ) : (
                          <span className="text-caption font-medium text-danger">{t("services.nobody")}</span>
                        )}
                        {x.price !== undefined && <span className="text-[14px] font-semibold tabular">{money.format(x.price)}</span>}
                      </span>
                    </button>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}
      <ServiceSheet service={editing} onClose={() => setEditing(null)} />
    </>
  );
}
