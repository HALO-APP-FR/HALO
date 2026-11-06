import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, LogIn, LogOut, Sparkles, UserRoundX } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { StatusPill } from "@/components/halo/status-pill";
import { TASK_TYPE_META } from "@/components/halo/task-type";
import { EmptyState } from "@/components/halo/empty-state";
import { Avatar } from "@/components/connected/avatar";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { nowDate } from "@/lib/connected/time";
import { addDays, dayKey, dayRange } from "@/lib/connected/days";
import { durationText } from "@/lib/connected/format";
import { clip, occupies, placement, type Placement, type PlacementTask } from "@/lib/engine/placement";
import type { TaskStatus, TaskType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const HOUR_PX = 64;

/**
 * Planning du jour (responsable), présentation de la démo : une colonne par agent, une ligne horaire,
 * les missions non affectées au-dessus. Données réelles uniquement ; l'affectation se fait depuis la mission.
 */
export default async function PlanningPage({ params, searchParams }: PageProps<"/[locale]/app/planning">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const t = await getTranslations("connected.planningPage");
  const tn = await getTranslations("nav");
  const tt = await getTranslations("taskType");
  const f = await getFormatter();
  const { data: o } = await supabase.from("organizations").select("timezone").eq("id", org!.id).single();
  const tz = (o?.timezone as string | undefined) ?? "Europe/Paris";
  const today = dayKey(nowDate(), tz);
  const raw = Array.isArray(sp.d) ? sp.d[0] : sp.d;
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const agentF = (Array.isArray(sp.a) ? sp.a[0] : sp.a) ?? "";
  const { start, end } = dayRange(day, 1, tz);
  const now = nowDate();
  const dayS = start.getTime();
  const dayE = end.getTime();
  const cols = "id, type, status, title, window_start, window_end, scheduled_start, duration_min, assignee_id, started_at, completed_at, properties(name)";
  // Plages proches du jour + toutes les missions en cours (une mission oubliée peut avoir démarré il y a plusieurs jours)
  const [{ data: near, error }, { data: running }, { data: members }, { data: stays }, { data: endRows }] = await Promise.all([
    supabase.from("tasks").select(cols).eq("organization_id", org!.id).neq("status", "cancelled")
      .lt("window_start", new Date(dayE + 86_400_000).toISOString()).gt("window_end", new Date(dayS - 2 * 86_400_000).toISOString())
      .order("window_start").limit(400),
    supabase.from("tasks").select(cols).eq("organization_id", org!.id).eq("status", "in_progress").limit(100),
    supabase.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true),
    supabase
      .from("reservations")
      .select("id, check_in_at, check_out_at, properties(name)")
      .eq("organization_id", org!.id)
      .eq("status", "confirmed")
      .or(`and(check_in_at.gte.${start.toISOString()},check_in_at.lt.${end.toISOString()}),and(check_out_at.gte.${start.toISOString()},check_out_at.lt.${end.toISOString()})`)
      .limit(200),
    // Fin retenue (heure acceptée ou régularisée) — colonne de la migration 21, lue à part
    supabase.from("tasks").select("id, reported_end_at").eq("organization_id", org!.id).not("reported_end_at", "is", null).gt("reported_end_at", new Date(dayS - 2 * 86_400_000).toISOString()).limit(400),
  ]);
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v) ?? null;
  const people = (members ?? []).map((m: { user_id: string; profiles: unknown }) => ({ id: m.user_id, name: one(m.profiles as { full_name: string } | null)?.full_name || t("noName") }));
  const reportedEnd = new Map(((endRows ?? []) as { id: string; reported_end_at: string }[]).map((r) => [r.id, r.reported_end_at]));
  const byId = new Map<string, NonNullable<typeof near>[number]>();
  for (const k of [...(near ?? []), ...(running ?? [])]) byId.set(k.id as string, k);
  const all = [...byId.values()]
    .map((k) => {
      const pl = placement({ ...(k as PlacementTask), reported_end_at: reportedEnd.get(k.id as string) ?? null }, now.getTime());
      return { ...k, pl, property: one(k.properties as unknown as { name: string } | null)?.name ?? "" };
    })
    .filter((k) => occupies(k.pl, dayS, dayE));
  // Sur la grille : uniquement un créneau réellement fixé ou des heures réelles, et un agent
  const timed = all
    .filter((k) => k.pl.kind !== "unscheduled" && k.assignee_id)
    .map((k) => {
      const c = clip(k.pl as Exclude<Placement, { kind: "unscheduled" }>, dayS, dayE);
      return { ...k, c, startMin: Math.round((c.start - dayS) / 60_000), endMin: Math.round((c.end - dayS) / 60_000) };
    });
  // « À planifier » : sans créneau fixé (plage seulement), ou sans agent
  const toPlan = all.filter((k) => k.pl.kind === "unscheduled" || !k.assignee_id);
  const list = all;
  // Plage horaire de la démo (7 h–22 h), élargie si une mission en sort
  const START_H = Math.min(7, ...timed.map((k) => Math.floor(k.startMin / 60)));
  const END_H = Math.min(25, Math.max(22, ...timed.map((k) => Math.ceil(k.endMin / 60))));
  const agents = people.filter((p) => timed.some((k) => k.assignee_id === p.id));
  const hm = (d: Date | number) => f.dateTime(new Date(d), { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const dhm = (d: number) => (d >= dayS && d < dayE ? hm(d) : f.dateTime(new Date(d), { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }));
  const dayLabel = f.dateTime(new Date(`${day}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const href = (d: string, a = agentF) => {
    const q = new URLSearchParams();
    if (d !== today) q.set("d", d);
    if (a) q.set("a", a);
    const s = q.toString();
    return s ? `/app/planning?${s}` : "/app/planning";
  };
  const arrivals = (stays ?? []).filter((s) => Date.parse(s.check_in_at as string) >= dayS && Date.parse(s.check_in_at as string) < dayE);
  const departures = (stays ?? []).filter((s) => Date.parse(s.check_out_at as string) >= dayS && Date.parse(s.check_out_at as string) < dayE);
  /** Libellé horaire honnête : créneau fixé, heures réelles ou plage autorisée « à planifier ». */
  const when = (k: (typeof all)[number]) => {
    const p = k.pl;
    if (p.kind === "unscheduled") return t("when.window", { from: dhm(p.windowStart), to: dhm(p.windowEnd), duration: durationText(k.duration_min as number) });
    if (p.kind === "scheduled") return t("when.scheduled", { from: dhm(p.start), to: dhm(p.end) });
    return p.running ? t("when.running", { from: dhm(p.start) }) : t("when.actual", { from: dhm(p.start), to: dhm(p.end) });
  };
  const sortKey = (k: (typeof all)[number]) => (k.pl.kind === "unscheduled" ? k.pl.windowStart : k.pl.start);
  const mobile = (agentF === "none" ? list.filter((k) => !k.assignee_id) : agentF ? list.filter((k) => k.assignee_id === agentF) : list).sort((x, y) => sortKey(x) - sortKey(y));
  const top = (min: number) => ((Math.min(Math.max(min, START_H * 60), END_H * 60 - 30) - START_H * 60) / 60) * HOUR_PX;
  return (
    <>
      <PageHeader title={tn("planning")} subtitle={t("subtitle", { count: list.length })} />
      <p className="sr-only">{t("legend")}</p>
      <div className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted first-letter:uppercase" data-testid="planning-day">{dayLabel}</p>
        <div className="flex items-center gap-1">
          <Link href={href(addDays(day, -1))} aria-label={t("previous")} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-fg" data-testid="planning-prev">
            <ChevronLeft className="size-5 rtl:-scale-x-100" />
          </Link>
          <Link href={href(today)} aria-disabled={day === today} className={cn("inline-flex h-8 items-center rounded-md border border-line px-3 text-[14px] font-medium", day === today ? "pointer-events-none bg-subtle text-muted" : "hover:bg-surface-hover")} data-testid="planning-today">
            {t("today")}
          </Link>
          <Link href={href(addDays(day, 1))} aria-label={t("next")} className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-fg" data-testid="planning-next">
            <ChevronRight className="size-5 rtl:-scale-x-100" />
          </Link>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}

      {/* Mouvements voyageurs du jour */}
      {(arrivals.length > 0 || departures.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="planning-stays">
          {arrivals.map((s) => (
            <Link key={`a-${s.id}`} href={`/app/stays/${s.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[13px] hover:bg-surface-hover" data-testid="planning-arrival">
              <LogIn className="size-3.5 text-success" />
              <span className="font-medium">{one(s.properties as unknown as { name: string } | null)?.name}</span>
              <span className="tabular text-muted">{hm(Date.parse(s.check_in_at as string))}</span>
            </Link>
          ))}
          {departures.map((s) => (
            <Link key={`d-${s.id}`} href={`/app/stays/${s.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[13px] hover:bg-surface-hover" data-testid="planning-departure">
              <LogOut className="size-3.5 text-warning" />
              <span className="font-medium">{one(s.properties as unknown as { name: string } | null)?.name}</span>
              <span className="tabular text-muted">{hm(Date.parse(s.check_out_at as string))}</span>
            </Link>
          ))}
        </div>
      )}

      {/* À planifier : plage autorisée sans créneau fixé, ou mission sans agent — jamais placée sur la grille horaire */}
      {toPlan.length > 0 && (
        <Card className="mb-4 p-4" data-testid="planning-unassigned">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="grid size-7 place-items-center rounded-md bg-warning-soft text-warning">
              <CalendarClock className="size-4" />
            </span>
            {t("toPlan", { count: toPlan.length })}
          </div>
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {toPlan.map((k) => {
              const who = people.find((p) => p.id === k.assignee_id);
              return (
                <li key={k.id} className="shrink-0">
                  <Link href={`/app/missions/${k.id}`} className="relative flex w-64 items-center gap-3 overflow-hidden rounded-md border border-dashed border-line-strong bg-surface px-3 py-2 hover:shadow-float" data-testid="planning-to-plan" data-kind={k.pl.kind} data-assigned={k.assignee_id ? "1" : "0"}>
                    <span className={cn("absolute inset-y-0 start-0 w-1", TASK_TYPE_META[k.type as TaskType]?.bar)} aria-hidden />
                    <span className="min-w-0 flex-1 ps-1">
                      <span className="block truncate text-[14px] font-semibold">{k.property}</span>
                      <span className="block truncate text-caption text-muted tabular" data-testid="planning-when">{when(k)}</span>
                      <span className="block truncate text-caption text-muted">{tt(k.type)}</span>
                    </span>
                    {who ? <Avatar name={who.name} id={who.id} size="sm" /> : <UserRoundX className="size-4 shrink-0 text-danger" aria-label={t("noAgent")} />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-caption text-muted">{t("toPlanHint")}</p>
        </Card>
      )}

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} title={t("empty")} text={t("emptyText")} />
        </Card>
      ) : (
        <>
          {/* Ordinateur : colonnes par agent, comme la démo */}
          {agents.length > 0 && (
            <Card className="hidden overflow-hidden md:block" data-testid="planning-grid">
              <div className="overflow-x-auto">
                <div className="min-w-[720px]" style={{ display: "grid", gridTemplateColumns: `64px repeat(${agents.length}, minmax(180px, 1fr))` }}>
                  <div className="sticky top-0 z-10 border-b border-line bg-surface" />
                  {agents.map((a) => (
                    <div key={a.id} className="sticky top-0 z-10 flex items-center gap-2 border-b border-s border-line bg-surface px-3 py-3">
                      <Avatar name={a.name} id={a.id} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">{a.name}</span>
                        <span className="block text-caption text-muted tabular">{t("count", { count: timed.filter((k) => k.assignee_id === a.id).length })}</span>
                      </span>
                    </div>
                  ))}
                  <div className="relative" style={{ height: (END_H - START_H) * HOUR_PX }}>
                    {Array.from({ length: END_H - START_H }, (_, i) => START_H + i).map((h) => (
                      <span key={h} className={cn("absolute end-2 text-caption text-muted tabular", h === START_H ? "translate-y-1" : "-translate-y-1/2")} style={{ top: (h - START_H) * HOUR_PX }}>
                        {String(h).padStart(2, "0")}:00
                      </span>
                    ))}
                  </div>
                  {agents.map((a) => (
                    <div key={a.id} className="relative border-s border-line" style={{ height: (END_H - START_H) * HOUR_PX }}>
                      {Array.from({ length: END_H - START_H }, (_, i) => i).map((i) => (
                        <span key={i} className="absolute inset-x-0 border-t border-line/60" style={{ top: i * HOUR_PX }} aria-hidden />
                      ))}
                      {timed
                        .filter((k) => k.assignee_id === a.id)
                        .map((k) => {
                          const height = Math.max(((k.endMin - k.startMin) / 60) * HOUR_PX - 4, 44);
                          const done = k.status === "done" || k.status === "validated";
                          return (
                            <Link
                              key={k.id}
                              href={`/app/missions/${k.id}`}
                              className={cn("absolute inset-x-1.5 overflow-hidden rounded-md border border-line bg-surface px-2.5 py-1.5 text-start shadow-card transition-shadow hover:shadow-float", done && "opacity-60", (k.c.fromPrevDay || k.c.toNextDay) && "border-dashed", k.c.fromPrevDay && "rounded-t-none", k.c.toNextDay && "rounded-b-none")}
                              style={{ top: top(k.startMin) + 2, height }}
                              data-testid="planning-task"
                              data-kind={k.pl.kind}
                            >
                              <span className={cn("absolute inset-y-0 start-0 w-1", TASK_TYPE_META[k.type as TaskType]?.bar)} aria-hidden />
                              <span className="block truncate text-[13px] font-semibold">{k.property}</span>
                              <span className="block truncate text-caption text-muted tabular" data-testid="planning-when">{when(k)}</span>
                              {height > 64 && <StatusPill status={k.status as TaskStatus} className="mt-1" />}
                            </Link>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Téléphone : puces par agent, puis liste horaire */}
          <div className={cn(agents.length > 0 && "md:hidden")} data-testid="planning-agenda">
            <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {[{ id: "", name: t("all"), n: list.length }, ...(list.some((k) => !k.assignee_id) ? [{ id: "none", name: t("noAgent"), n: list.filter((k) => !k.assignee_id).length }] : []), ...people.filter((p) => list.some((k) => k.assignee_id === p.id)).map((a) => ({ ...a, n: list.filter((k) => k.assignee_id === a.id).length }))].map((a) => (
                <Link
                  key={a.id || "all"}
                  href={href(day, a.id)}
                  className={cn("flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium", agentF === a.id ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface")}
                  data-testid="planning-agent-chip"
                >
                  {a.id && a.id !== "none" && <Avatar name={a.name} id={a.id} size="sm" />}
                  {a.name}
                  <span className="tabular opacity-70">{a.n}</span>
                </Link>
              ))}
            </div>
            <Card className="divide-y divide-line">
              {mobile.length === 0 ? (
                <EmptyState icon={Sparkles} title={t("nothingForAgent")} className="py-10" />
              ) : (
                mobile.map((k) => {
                  const who = people.find((p) => p.id === k.assignee_id);
                  const unplanned = k.pl.kind === "unscheduled";
                  return (
                    <Link key={k.id} href={`/app/missions/${k.id}`} className="flex w-full items-center gap-3 px-4 py-3 text-start" data-testid="planning-row" data-kind={k.pl.kind}>
                      <span className={cn("h-10 w-1 shrink-0 rounded-full", TASK_TYPE_META[k.type as TaskType]?.bar)} aria-hidden />
                      <span className="w-14 shrink-0 text-[15px] font-semibold tabular">{unplanned ? <span className="text-[12px] font-semibold uppercase text-warning">{t("toPlanShort")}</span> : hm((k.pl as { start: number }).start)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{k.property}</span>
                        <span className="mt-0.5 block truncate text-caption text-muted" data-testid="planning-when">{when(k)}</span>
                      </span>
                      {who ? <Avatar name={who.name} id={who.id} size="sm" /> : <UserRoundX className="size-4 shrink-0 text-danger" aria-label={t("noAgent")} />}
                      <StatusPill status={k.status as TaskStatus} />
                    </Link>
                  );
                })
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
