"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, BedDouble, Bell, CircleCheck, ConciergeBell, RotateCcw, Siren, UserRoundX, type LucideIcon } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { buildInbox, type InboxItem, type NotificationKind } from "@/lib/engine/notifications";
import { useHalo } from "@/lib/store/halo-store";
import { byId } from "@/lib/store/selectors";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLinenData, useLinenName } from "@/components/linen/use-linen";
import { ServiceSheet } from "@/components/services/service-sheet";
import { useRelativeTime } from "@/components/views/alerts";
import { TaskSheet } from "./task-sheet";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  alert_urgent: Siren,
  service_requested: ConciergeBell,
  task_to_validate: CircleCheck,
  task_correction: RotateCcw,
  task_blocked: AlertTriangle,
  task_unassigned: UserRoundX,
  linen_shortage: BedDouble,
};

function useManagerInbox() {
  const tasks = useHalo((s) => s.tasks);
  const services = useHalo((s) => s.services);
  const alerts = useHalo((s) => s.alerts);
  const muted = useHalo((s) => s.notificationMuted);
  const { forecast } = useLinenData(7);
  const linenTypes = useHalo((s) => s.linenTypes);
  const linenName = useLinenName();
  const linenShortages = forecast
    .filter((r) => r.shortageDay)
    .map((r) => ({ linenTypeId: r.linenTypeId, day: r.shortageDay!, name: linenName(linenTypes.find((x) => x.id === r.linenTypeId)) }));
  return buildInbox({ tasks, services, alerts, linenShortages, now: new Date(), muted, audience: "manager" });
}

function useAgentInbox() {
  const tasks = useHalo((s) => s.tasks);
  const memberId = useHalo((s) => s.currentAgentId);
  const muted = useHalo((s) => s.notificationMuted);
  return buildInbox({ tasks, services: [], alerts: [], now: new Date(), muted, audience: "agent", memberId });
}

/** Cloche + boîte de notifications de l'application. Rien n'est envoyé hors de l'application. */
export function InboxButton({ audience, className }: { audience: "manager" | "agent"; className?: string }) {
  return audience === "manager" ? <ManagerInbox className={className} /> : <AgentInbox className={className} />;
}

function ManagerInbox({ className }: { className?: string }) {
  const items = useManagerInbox();
  const [task, setTask] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const service = useHalo((s) => s.services.find((x) => x.id === serviceId) ?? null);
  return (
    <>
      <InboxSheet
        items={items}
        className={className}
        onOpenTarget={(item, router) => {
          if (item.target.type === "task") setTask(item.target.id);
          else if (item.target.type === "service") setServiceId(item.target.id);
          else router.push(item.target.href);
        }}
      />
      <TaskSheet taskId={task} onClose={() => setTask(null)} />
      <ServiceSheet service={service} onClose={() => setServiceId(null)} />
    </>
  );
}

function AgentInbox({ className }: { className?: string }) {
  const items = useAgentInbox();
  return <InboxSheet items={items} className={className} onOpenTarget={(item, router) => item.target.type === "task" && router.push(`/a/task/${item.target.id}`)} />;
}

function InboxSheet({
  items,
  className,
  onOpenTarget,
}: {
  items: InboxItem[];
  className?: string;
  onOpenTarget: (item: InboxItem, router: ReturnType<typeof useRouter>) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const ago = useRelativeTime();
  const readList = useHalo((s) => s.inboxRead);
  const properties = useHalo((s) => s.properties);
  const props = byId(properties);
  const [open, setOpen] = useState(false);
  const read = new Set(readList);
  const unread = items.filter((i) => !read.has(i.key));
  const criticalUnread = unread.some((i) => i.critical);
  const { markRead } = useHalo.getState();

  const label = (i: InboxItem) => {
    const p = { ...i.params } as Record<string, string | number>;
    if (typeof p.type === "string") p.type = t(`taskType.${p.type}`);
    if (typeof p.kind === "string") p.kind = t(`serviceKind.${p.kind}`);
    if (typeof p.reason === "string" && i.kind === "task_blocked") p.reason = t(`feasibility.${p.reason}Title`);
    if (typeof p.day === "string") p.day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${p.day}T12:00:00Z`));
    return t(`inbox.kind.${i.kind}`, p);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("inbox.open", { count: unread.length })}
        className={cn("relative grid size-10 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover", className)}
      >
        <Bell className="size-5" strokeWidth={1.9} />
        {unread.length > 0 && (
          <span
            className={cn(
              "absolute end-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none text-white tabular",
              criticalUnread ? "bg-danger" : "bg-accent",
            )}
          >
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={t("inbox.title")} description={t("inbox.scope")} closeLabel={t("common.close")}>
          {items.length === 0 ? (
            <p className="py-10 text-center text-[15px] text-muted">{t("inbox.empty")}</p>
          ) : (
            <>
              {unread.length > 0 && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => markRead(unread.map((i) => i.key))}>
                    {t("inbox.markAll")}
                  </Button>
                </div>
              )}
              <ul className="mt-1 divide-y divide-line">
                {items.map((i) => {
                  const Icon = KIND_ICON[i.kind];
                  const isUnread = !read.has(i.key);
                  return (
                    <li key={i.key}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-3 py-3 text-start"
                        onClick={() => {
                          markRead([i.key]);
                          setOpen(false);
                          onOpenTarget(i, router);
                        }}
                      >
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", i.critical ? "bg-danger text-white" : "bg-subtle text-muted dark:bg-surface-hover")}>
                          <Icon className="size-[18px]" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-[15px]", isUnread ? "font-semibold" : "text-muted")}>{label(i)}</span>
                          <span className="block text-caption text-muted">
                            {[i.propertyId ? props.get(i.propertyId)?.name : undefined, ago(i.at)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        {isUnread && <span className={cn("mt-2 size-2 shrink-0 rounded-full", i.critical ? "bg-danger" : "bg-accent")} aria-label={t("inbox.unread")} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
