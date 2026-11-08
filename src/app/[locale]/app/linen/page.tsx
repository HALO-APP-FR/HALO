import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, ChevronRight, CircleDashed, PackageX, Shirt, TriangleAlert, UserRoundX } from "lucide-react";
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
import { ApplyLinenTaskButton, LinenCatalogue, LinenCountForm, LinenKitEditor, LinenMoveForm } from "@/components/connected/linen-ops";
import { PlanLinenForm } from "@/components/connected/create-cleaning-button";
import { loadLinenOps } from "@/lib/connected/linen-data";

/** Fonctions présentes uniquement dans la démo : listées avec ce qu'il faut construire, jamais simulées. */
const DEMO_ONLY = ["laundry", "partner", "costs"] as const;

/**
 * Linge (responsable) — uniquement des données réelles. En tête : ce qui manque, où et quand agir
 * (manques calculés à partir des séjours confirmés, des kits et du stock compté ; données insuffisantes signalées).
 * Puis missions linge, stock par emplacement, kits, catalogue, historique. Le blanchisseur externe (étape 2)
 * n'est pas encore construit : il est annoncé tel quel, sans chiffre ni bouton.
 */
export default async function LinenPage({ params, searchParams }: PageProps<"/[locale]/app/linen">) {
  const { locale } = await params;
  const sp = await searchParams;
  const kitFor = typeof sp.kit === "string" ? sp.kit : undefined;
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
  // ---- Linge opérationnel (migration 26) : catalogue, kits, stock, besoins à venir ----
  const ops = await loadLinenOps(supabase, org!.id, now);
  const tk = await getTranslations("connected.linenOps");
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
  const people = (members ?? []).map((m: { user_id: string; profiles: unknown }) => ({ id: m.user_id, name: nameOf(m.user_id) ?? "—" }));
  const day = (x: string) => f.dateTime(new Date(x), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const itemLabel = (id: string) => (ops.available ? ops.items.find((i) => i.id === id)?.label : null) ?? "—";
  const kitText = (pid: string) =>
    ops.available
      ? ops.kits
          .filter((k) => k.propertyId === pid)
          .map((k) => `${k.qty} × ${itemLabel(k.itemId)}`)
          .join(", ")
      : "";
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


      {/* ===== Ce qui manque, où et quand agir ===== */}
      {!ops.available ? (
        <Card className="mb-6 border-dashed p-5 text-[14px]" data-testid="linen-ops-unavailable">
          <p className="font-semibold">{tk("unavailableTitle")}</p>
          <p className="mt-1 text-muted">{tk("unavailableText")}</p>
        </Card>
      ) : (
        <Card className="mb-6 overflow-hidden" data-testid="linen-todo">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3 md:px-5">
            <h2 className="text-title-3">{tk("todoTitle")}</h2>
          </div>
          <ul className="divide-y divide-line">
            {/* Articles jamais comptés : regroupés en une seule ligne (lisible), les autres alertes une par une */}
            {[...ops.plan.alerts.filter((a) => a.kind !== "no_stock"), ...(ops.plan.alerts.some((a) => a.kind === "no_stock") ? [ops.plan.alerts.find((a) => a.kind === "no_stock")!] : [])].map((a, i) => (
              <li key={`a${i}`} className="flex flex-wrap items-start gap-3 px-4 py-3 md:px-5" data-testid="linen-alert" data-kind={a.kind}>
                <TriangleAlert className={a.kind === "shortage" ? "mt-0.5 size-5 shrink-0 text-danger" : "mt-0.5 size-5 shrink-0 text-warning"} />
                <div className="min-w-0 flex-1 basis-[14rem] text-[14px]">
                  {a.kind === "shortage" && (
                    <>
                      <p className="font-semibold">{tk("alert.shortageTitle", { item: itemLabel(a.itemId) })}</p>
                      <p className="text-muted">{tk("alert.shortage", { need: a.need, available: a.available, date: day(a.at), property: a.propertyName })}</p>
                    </>
                  )}
                  {a.kind === "no_kit" && (
                    <>
                      <p className="font-semibold">{tk("alert.noKitTitle", { property: a.propertyName })}</p>
                      <p className="text-muted">{tk("alert.noKit", { date: day(a.firstArrivalAt), count: a.arrivals })}</p>
                    </>
                  )}
                  {a.kind === "no_stock" && (
                    <>
                      <p className="font-semibold">{tk("alert.noStockTitle", { item: ops.plan.alerts.filter((x) => x.kind === "no_stock").map((x) => itemLabel((x as { itemId: string }).itemId)).join(", ") })}</p>
                      <p className="text-muted">{tk("alert.noStock")}</p>
                    </>
                  )}
                  {a.kind === "no_items" && (
                    <>
                      <p className="font-semibold">{tk("alert.noItemsTitle")}</p>
                      <p className="text-muted">{tk("alert.noItems")}</p>
                    </>
                  )}
                </div>
                <Link
                  href={a.kind === "shortage" ? "#stock" : a.kind === "no_kit" ? `/app/linen?kit=${a.propertyId}#kits` : a.kind === "no_stock" ? "#stock" : "#catalogue"}
                  className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-hover"
                  data-testid="linen-alert-action"
                >
                  {tk(`alert.action.${a.kind}`)}
                </Link>
              </li>
            ))}
            {ops.deliveriesToPlan.map((d) => (
              <li key={`d${d.stayId}`} className="flex flex-wrap items-start gap-3 px-4 py-3 md:px-5" data-testid="linen-delivery-to-plan">
                <ArrowDownToLine className="mt-0.5 size-5 shrink-0 text-accent-text" />
                <div className="min-w-0 flex-1 basis-[14rem] text-[14px]">
                  <p className="font-semibold">{tk("deliveryToPlan", { property: d.propertyName })}</p>
                  <p className="text-muted">{tk("arrival", { date: day(d.checkInAt) })}{kitText(d.propertyId) ? ` · ${kitText(d.propertyId)}` : ` · ${tk("kitUnknown")}`}</p>
                </div>
                <PlanLinenForm stayId={d.stayId} label={tk("planDelivery")} checkInAt={d.checkInAt} propertyName={d.propertyName} guestName={d.guestName} members={people} timeZone={tz} defaultNote={kitText(d.propertyId) ? tk("kitNote", { kit: kitText(d.propertyId) }) : ""} unknown={kitText(d.propertyId) ? tk("knownKit") : undefined} />
              </li>
            ))}
            {ops.pickupsToPlan.map((d) => (
              <li key={`p${d.stayId}`} className="flex flex-wrap items-start gap-3 px-4 py-3 md:px-5" data-testid="linen-pickup-to-plan">
                <ArrowUpFromLine className="mt-0.5 size-5 shrink-0 text-accent-text" />
                <div className="min-w-0 flex-1 basis-[14rem] text-[14px]">
                  <p className="font-semibold">{tk("pickupToPlan", { property: d.propertyName })}</p>
                  <p className="text-muted">{tk("departure", { date: day(d.checkOutAt) })}</p>
                </div>
                <PlanLinenForm stayId={d.stayId} label={tk("planPickup")} checkInAt={d.checkOutAt} propertyName={d.propertyName} guestName={d.guestName} members={people} timeZone={tz} kind="pickup" defaultNote={kitText(d.propertyId) ? tk("kitNote", { kit: kitText(d.propertyId) }) : ""} />
              </li>
            ))}
            {ops.toApply.map((k) => (
              <li key={`k${k.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5" data-testid="linen-to-apply">
                <PackageX className="size-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1 basis-[14rem] text-[14px]">
                  <p className="font-semibold">{tk(k.type === "linen_delivery" ? "toApplyDelivery" : "toApplyPickup", { property: k.propertyName })}</p>
                  <p className="text-muted">{k.hasKit ? tk(k.type === "linen_delivery" ? "toApplyDeliveryHint" : "toApplyPickupHint") : tk("toApplyNoKit")}</p>
                </div>
                <Link href={`/app/missions/${k.id}`} className="text-[13px] font-medium text-accent-text hover:underline">{t("openMission")}</Link>
                {k.hasKit && <ApplyLinenTaskButton taskId={k.id} label={tk("apply")} />}
              </li>
            ))}
            {ops.plan.alerts.length + ops.deliveriesToPlan.length + ops.pickupsToPlan.length + ops.toApply.length === 0 && (
              <li className="flex items-center gap-3 px-4 py-4 text-[14px] md:px-5" data-testid="linen-ok">
                <CheckCircle2 className="size-5 shrink-0 text-success" />
                {ops.plan.complete ? tk("allGood", { date: ops.lastCountAt ? day(ops.lastCountAt) : "—" }) : tk("notEnoughData")}
              </li>
            )}
          </ul>
        </Card>
      )}
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


          {ops.available && (
            <>
              {/* Stock par emplacement et besoins des 14 prochains jours */}
              <details id="stock" open className="group rounded-xl border border-line bg-surface shadow-card" data-testid="linen-stock">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 md:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-title-3">{tk("stockTitle")}</span>
                  <span className="text-[13px] text-muted">{ops.lastCountAt ? tk("lastCount", { date: day(ops.lastCountAt) }) : tk("neverCounted")}</span>
                </summary>
                <div className="border-t border-line px-4 pb-4 pt-3 md:px-5">
                  {ops.items.length === 0 ? (
                    <p className="text-[14px] text-muted">{tk("alert.noItems")}</p>
                  ) : (
                    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
                      <table className="w-full min-w-[520px] text-[14px]" data-testid="linen-stock-table">
                        <thead>
                          <tr className="text-start text-[12px] uppercase tracking-wide text-muted">
                            <th className="py-2 text-start font-medium">{tk("item")}</th>
                            <th className="py-2 text-end font-medium">{tk("need14")}</th>
                            <th className="py-2 text-end font-medium">{tk("loc.clean")}</th>
                            <th className="py-2 text-end font-medium">{tk("loc.dirty")}</th>
                            <th className="py-2 text-end font-medium">{tk("loc.laundry")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {ops.plan.needs.map((n) => (
                            <tr key={n.itemId} data-testid="linen-stock-row" data-item={itemLabel(n.itemId)}>
                              <td className="py-2 font-medium">{itemLabel(n.itemId)}</td>
                              <td className="py-2 text-end tabular" data-testid="linen-need">{n.need}</td>
                              <td className={n.counted && n.need > n.clean ? "py-2 text-end font-semibold tabular text-danger" : "py-2 text-end tabular"} data-testid="linen-clean">
                                {n.counted ? n.clean : <span className="text-[12px] text-warning">{tk("notCounted")}</span>}
                              </td>
                              <td className="py-2 text-end tabular" data-testid="linen-dirty">{n.counted ? n.dirty : "—"}</td>
                              <td className="py-2 text-end tabular" data-testid="linen-laundry">{n.counted ? n.laundry : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-2 text-[12px] text-muted">{tk("needHint")}</p>
                  {ops.items.length > 0 && (
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-md border border-line p-3">
                        <p className="mb-2 text-[14px] font-semibold">{tk("countTitle")}</p>
                        <LinenCountForm items={ops.items} />
                      </div>
                      <div className="rounded-md border border-line p-3">
                        <p className="mb-2 text-[14px] font-semibold">{tk("moveTitle")}</p>
                        <LinenMoveForm items={ops.items} />
                      </div>
                    </div>
                  )}
                </div>
              </details>

              {/* Kits par logement */}
              <details id="kits" open={Boolean(kitFor) || undefined} className="group rounded-xl border border-line bg-surface shadow-card" data-testid="linen-kits">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 md:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-title-3">{tk("kitsTitle")}</span>
                  <span className="text-[13px] text-muted">{tk("kitsSummary", { done: new Set(ops.kits.map((k) => k.propertyId)).size, total: ops.properties.length })}</span>
                </summary>
                <div className="border-t border-line px-4 pb-4 pt-3 md:px-5">
                  <LinenKitEditor key={kitFor ?? "kit"} properties={ops.properties} items={ops.items} kits={ops.kits} initialProperty={kitFor} />
                </div>
              </details>

              {/* Catalogue */}
              <details id="catalogue" open={ops.items.length === 0 || undefined} className="group rounded-xl border border-line bg-surface shadow-card" data-testid="linen-catalogue-section">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 md:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-title-3">{tk("catalogueTitle")}</span>
                  <span className="text-[13px] text-muted">{tk("catalogueSummary", { count: ops.items.length })}</span>
                </summary>
                <div className="border-t border-line px-4 pb-4 pt-3 md:px-5">
                  <LinenCatalogue items={ops.items} />
                </div>
              </details>

              {/* Historique des mouvements */}
              <details id="history" className="group rounded-xl border border-line bg-surface shadow-card" data-testid="linen-history">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 md:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-title-3">{tk("historyTitle")}</span>
                  <span className="text-[13px] text-muted">{tk("historySummary", { count: ops.movements.length })}</span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {ops.movements.length === 0 && <li className="px-4 py-3 text-[14px] text-muted md:px-5">{tk("historyEmpty")}</li>}
                  {ops.movements.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px] md:px-5" data-testid="linen-movement" data-kind={m.kind}>
                      <span className="w-28 shrink-0 text-muted tabular">{day(m.at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{tk(`kindLabel.${m.kind}`)}</span> · {m.itemLabel} · {tk(`loc.${m.location}`)}{" "}
                        <span className={m.delta < 0 ? "font-semibold text-danger tabular" : "font-semibold text-success tabular"}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                        {m.propertyName && <span className="text-muted"> · {m.propertyName}</span>}
                        {m.note && <span className="text-muted"> · « {m.note} »</span>}
                      </span>
                      <span className="text-muted">{m.actor ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}

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
