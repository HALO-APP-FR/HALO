import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, CircleDashed, PackageX, Shirt, TriangleAlert, UserRoundX } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { KpiCard } from "@/components/halo/kpi-card";
import { StatusPill } from "@/components/halo/status-pill";
import { TaskTypeIcon } from "@/components/halo/task-type";
import { EmptyState } from "@/components/halo/empty-state";
import { Avatar } from "@/components/connected/avatar";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { nowDate } from "@/lib/connected/time";
import { periodBounds, typesOf } from "@/lib/connected/mission-filters";
import { placement, whenLabel, type PlacementTask } from "@/lib/engine/placement";
import { durationText } from "@/lib/connected/format";
import type { TaskStatus, TaskType } from "@/lib/domain/types";

/** Fonctions présentes uniquement dans la démo : listées avec ce qu'il faut construire, jamais simulées. */
const DEMO_ONLY = ["stock", "kits", "shortage", "laundry", "partner", "journal"] as const;

/**
 * Linge (responsable) — uniquement des données réelles : organisation du linge, livraisons et collectes planifiées,
 * incidents « linge » ouverts. Ce qui n'existe que dans la démo est listé honnêtement, sans chiffre ni bouton.
 */
export default async function LinenPage({ params }: PageProps<"/[locale]/app/linen">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const t = await getTranslations("connected.linenPage");
  const tn = await getTranslations("nav");
  const tm = await getTranslations("connected.onb.linen");
  const tt = await getTranslations("taskType");
  const tpl = await getTranslations("connected.planningPage");
  const f = await getFormatter();
  const now = nowDate();
  const { data: o } = await supabase.from("organizations").select("timezone, linen_model, linen_turnaround_days").eq("id", org!.id).single();
  const tz = (o?.timezone as string | undefined) ?? "Europe/Paris";
  // Même période et mêmes règles que la liste des missions ouverte par chaque compteur (periodBounds « week »)
  const b = periodBounds("week", now, tz);
  const [{ data: tasks, error }, { data: members }, { data: incidents }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, type, status, title, window_start, window_end, scheduled_start, duration_min, started_at, completed_at, regularized_at, regularized_missing, assignee_id, properties(name, timezone)")
      .eq("organization_id", org!.id)
      .in("type", typesOf("linen"))
      .neq("status", "cancelled")
      .lt("window_start", b.to!.toISOString())
      .gt("window_end", b.from!.toISOString())
      .order("window_start")
      .limit(200),
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true),
    supabase.from("incidents").select("id, description, created_at, urgent, properties(name)").eq("organization_id", org!.id).eq("category", "linen").neq("status", "resolved").order("created_at", { ascending: false }).limit(20),
  ]);
  const list = tasks ?? [];
  const deliveries = list.filter((k) => k.type === "linen_delivery").length;
  const pickups = list.filter((k) => k.type === "linen_pickup").length;
  const noAgent = list.filter((k) => k.status === "unassigned").length;
  const nameOf = (id: string | null) => {
    const m = (members ?? []).find((x: { user_id: string }) => x.user_id === id) as { profiles: unknown } | undefined;
    return ((Array.isArray(m?.profiles) ? m?.profiles[0] : m?.profiles) as { full_name: string } | null)?.full_name || null;
  };
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v) ?? null;
  const model = o?.linen_model as string | null;
  return (
    <>
      <PageHeader title={tn("linen")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4 md:gap-4" data-testid="linen-kpis">
        <KpiCard label={t("kpi.deliveries")} shortLabel={t("kpiShort.deliveries")} value={deliveries} icon={ArrowDownToLine} href="/app/missions?period=week&status=all&type=linen_delivery" />
        <KpiCard label={t("kpi.pickups")} shortLabel={t("kpiShort.pickups")} value={pickups} icon={ArrowUpFromLine} href="/app/missions?period=week&status=all&type=linen_pickup" />
        <KpiCard label={t("kpi.noAgent")} shortLabel={t("kpiShort.noAgent")} value={noAgent} icon={UserRoundX} tone="danger" href="/app/missions?period=week&status=unassigned&type=linen" />
        <KpiCard label={t("kpi.incidents")} shortLabel={t("kpiShort.incidents")} value={incidents?.length ?? 0} icon={PackageX} tone="danger" href="/app/incidents?category=linen&open=1" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section data-testid="linen-missions">
            <h2 className="mb-3 text-title-3">{t("missionsTitle")}</h2>
            {list.length === 0 ? (
              <Card>
                <EmptyState icon={Shirt} title={t("missionsEmpty")} text={t("missionsEmptyText")} />
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {list.map((k) => {
                    const p = one(k.properties as { name: string; timezone: string | null } | { name: string; timezone: string | null }[] | null);
                    const ptz = p?.timezone ?? tz;
                    const pl = placement(k as unknown as PlacementTask, now.getTime());
                    const at = (x: number) => f.dateTime(new Date(x), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ptz });
                    const whenTxt = whenLabel(pl, tpl as unknown as Parameters<typeof whenLabel>[1], at, durationText(k.duration_min as number));
                    const who = nameOf(k.assignee_id as string | null);
                    return (
                      <li key={k.id} className="relative flex items-center gap-3 px-4 py-3 hover:bg-surface-hover md:px-5" data-testid="linen-mission">
                        <TaskTypeIcon type={k.type as TaskType} size="md" />
                        <div className="min-w-0 flex-1">
                          <Link href={`/app/missions/${k.id}`} className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-['']">
                            {p?.name}
                          </Link>
                          <p className="truncate text-[13px] text-muted first-letter:uppercase">
                            {tt(k.type)} · <span data-testid="linen-when">{whenTxt}</span>
                          </p>
                        </div>
                        {who ? (
                          <span className="hidden items-center gap-2 text-[14px] sm:flex">
                            <Avatar name={who} id={k.assignee_id as string} size="sm" />
                            <span className="max-w-32 truncate">{who}</span>
                          </span>
                        ) : (
                          <span className="hidden text-[13px] text-danger sm:inline">{t("noAgent")}</span>
                        )}
                        <StatusPill status={k.status as TaskStatus} />
                        <ChevronRight className="hidden size-4 text-faint md:block rtl:-scale-x-100" aria-hidden />
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
            <p className="mt-2 text-[13px] text-muted">{t("missionsHint")}</p>
          </section>

          <section data-testid="linen-incidents">
            <h2 className="mb-3 text-title-3">{t("incidentsTitle")}</h2>
            {(incidents ?? []).length === 0 ? (
              <Card className="p-5 text-[14px] text-muted">{t("incidentsEmpty")}</Card>
            ) : (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {(incidents ?? []).map((i) => (
                    <li key={i.id} className="relative flex items-center gap-3 px-4 py-3 md:px-5" data-testid="linen-incident">
                      <TriangleAlert className={i.urgent ? "size-5 shrink-0 text-danger" : "size-5 shrink-0 text-warning"} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/app/incidents#incident-${i.id}`} className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-['']">
                          {one(i.properties as { name: string } | { name: string }[] | null)?.name}
                        </Link>
                        <p className="truncate text-[13px] text-muted">{i.description}</p>
                      </div>
                      <ChevronRight className="size-4 text-faint rtl:-scale-x-100" aria-hidden />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <Card className="p-5" data-testid="linen-model">
            <p className="text-micro text-muted">{t("modelTitle")}</p>
            <p className="mt-1 text-[17px] font-semibold">{model ? tm(model) : t("modelUnset")}</p>
            <p className="mt-1 text-[14px] text-muted">{t("turnaround", { days: (o?.linen_turnaround_days as number | undefined) ?? 2 })}</p>
            <p className="mt-1 text-[13px] text-muted">{model === "laundry" || model === "both" ? t("readinessOn") : t("readinessOff")}</p>
            <Link href="/app/onboarding" className="mt-3 inline-flex text-[14px] font-medium text-accent-text hover:underline" data-testid="linen-model-edit">
              {t("modelEdit")}
            </Link>
          </Card>

          <Card className="border-dashed p-5" data-testid="linen-demo-only">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <CircleDashed className="size-5 text-muted" />
              {t("demoOnly.title")}
            </p>
            <p className="mt-1 text-[13px] text-muted">{t("demoOnly.text")}</p>
            <ul className="mt-3 space-y-3">
              {DEMO_ONLY.map((k) => (
                <li key={k} className="text-[14px]" data-testid={`linen-demo-only-${k}`}>
                  <p className="font-medium">{t(`demoOnly.items.${k}.name`)}</p>
                  <p className="text-[13px] text-muted">{t(`demoOnly.items.${k}.build`)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
