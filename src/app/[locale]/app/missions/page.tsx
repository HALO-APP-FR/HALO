import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { AgentActions, AssignSelect } from "@/components/connected/mission-controls";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { isoFromNow, nowDate } from "@/lib/connected/time";
import { infeasibility } from "@/lib/engine/conflicts";
import { toTask, type Row } from "@/lib/connected/mappers";
import { loadPlanning } from "@/lib/connected/planning";
import { isAvailable } from "@/lib/engine/availability";
import { durationText, windowText } from "@/lib/connected/format";
import { TriangleAlert } from "lucide-react";

export default async function MissionsPage({ params, searchParams }: PageProps<"/[locale]/app/missions">) {
  const { locale } = await params;
  const sp = await searchParams;
  const onlyToValidate = sp.status === "done";
  setRequestLocale(locale);
  const t = await getTranslations("connected.missions");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const f = await getFormatter();
  const { supabase, org, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  const manager = isManagerRole(org!.role);
  const since = isoFromNow(-86_400_000);
  let q = supabase
    .from("tasks")
    .select("*, properties(name, address_line, city), next:reservations!tasks_organization_id_next_reservation_id_fkey(check_in_at)")
    .eq("organization_id", org!.id)
    .neq("status", "cancelled")
    .order("window_start")
    .limit(200);
  // Agent : uniquement les siennes (la base l'impose déjà ; ce filtre évite d'afficher des missions passées d'autres)
  if (!manager) q = q.eq("assignee_id", user!.id);
  // « Missions à valider » (lien de l'accueil) : terminées, en attente d'un responsable
  q = onlyToValidate ? q.eq("status", "done") : q.gte("window_end", since);
  const now = nowDate();
  const [{ data: tasks, error }, { data: members }, planning] = await Promise.all([
    q,
    manager ? supabase.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true) : Promise.resolve({ data: [] as never[] }),
    manager ? loadPlanning(supabase, org!.id, now) : Promise.resolve(null),
  ]);
  const tc = await getTranslations("connected.schedule");
  // Personnes absentes sur le créneau de chaque mission (même règle que la base)
  const away = (k: { window_start: string; window_end: string; duration_min: number; scheduled_start: string | null }) =>
    (planning?.members ?? []).filter((m) => !isAvailable(m, { windowStart: k.window_start, windowEnd: k.window_end, durationMin: k.duration_min, scheduledStart: k.scheduled_start }, planning!.absences)).map((m) => m.id);
  const nextArrival = (k: { next?: unknown }) => ((Array.isArray(k.next) ? k.next[0] : k.next) as { check_in_at: string } | null)?.check_in_at ?? null;
  const people = (members ?? []).map((m: { user_id: string; profiles: unknown }) => {
    const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null;
    return { id: m.user_id, name: p?.full_name || t("noName") };
  });
  return (
    <>
      <PageHeader title={onlyToValidate ? t("toValidateTitle") : manager ? t("title") : t("mineTitle")} subtitle={onlyToValidate ? t("toValidateSubtitle") : manager ? t("subtitle") : t("mineSubtitle")} />
      {onlyToValidate && (
        <Link href="/app/missions" className="-mt-2 mb-4 inline-block text-[14px] text-accent-text hover:underline" data-testid="missions-all">
          {t("showAll")}
        </Link>
      )}
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      {planning && planning.schedule.length > 0 && (
        // Ménages impossibles : signalés au lieu d'être créés avec un créneau intenable
        <Card className="mb-4 border-danger p-5" data-testid="schedule-conflicts">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold text-danger">
            <TriangleAlert className="size-5" />
            {tc("title", { count: planning.schedule.length })}
          </h2>
          <p className="mt-1 text-[14px] text-muted">{tc("text")}</p>
          <ul className="mt-3 divide-y divide-line">
            {planning.schedule.map((c) => (
              <li key={`${c.reservationId}-${c.kind}`} className="flex flex-wrap items-center gap-2 py-2.5 text-[14px]" data-testid="schedule-conflict">
                <span className="flex-1">
                  <span className="font-medium">{c.propertyName}</span> · {tc(`kind.${c.kind}`, { available: durationText(c.availableMin ?? 0), needed: durationText(c.neededMin ?? 0) })}
                </span>
                <Link href={`/app/stays/${c.nextReservationId ?? c.reservationId}`} className="text-accent-text hover:underline">
                  {tc("open")}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="divide-y divide-line">
        {(tasks ?? []).length === 0 && <p className="p-5 text-[15px] text-muted">{manager ? t("empty") : t("mineEmpty")}</p>}
        {(tasks ?? []).map((k) => {
          const p = (Array.isArray(k.properties) ? k.properties[0] : k.properties) as { name: string; address_line: string | null; city: string | null } | null;
          return (
            <div key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid="mission-row">
              <Link href={`/app/missions/${k.id}`} className="min-w-[14rem] flex-1 hover:underline" data-testid="mission-link">
                <span className="block text-[15px] font-medium">
                  {tt(k.type)} · {p?.name}
                </span>
                <span className="block text-[13px] text-muted">
                  {t("windowLabel", { window: windowText(f, k.window_start, k.window_end) })} · {t("durationLabel", { duration: durationText(k.duration_min) })} · {tts(k.status)}
                  {!manager && p?.address_line ? ` · ${[p.address_line, p.city].filter(Boolean).join(", ")}` : ""}
                </span>
              </Link>
              {manager ? (
                <AssignSelect
                  taskId={k.id}
                  current={k.assignee_id}
                  members={people}
                  disabled={!["unassigned", "assigned"].includes(k.status)}
                  outOfWindow={Boolean(infeasibility(toTask(k as Row), now))}
                  durationMin={k.duration_min}
                  arrival={nextArrival(k) ? f.dateTime(new Date(nextArrival(k)!), { dateStyle: "medium", timeStyle: "short" }) : null}
                  unavailable={away(k)}
                />
              ) : (
                <AgentActions taskId={k.id} status={k.status} />
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}
