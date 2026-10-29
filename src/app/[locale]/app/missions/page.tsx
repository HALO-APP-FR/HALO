import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { AgentActions, AssignSelect } from "@/components/connected/mission-controls";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { isoFromNow, nowDate } from "@/lib/connected/time";
import { infeasibility } from "@/lib/engine/conflicts";
import { toTask, type Row } from "@/lib/connected/mappers";

export default async function MissionsPage({ params }: PageProps<"/[locale]/app/missions">) {
  const { locale } = await params;
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
    .gte("window_end", since)
    .order("window_start")
    .limit(200);
  // Agent : uniquement les siennes (la base l'impose déjà ; ce filtre évite d'afficher des missions passées d'autres)
  if (!manager) q = q.eq("assignee_id", user!.id);
  const [{ data: tasks, error }, { data: members }] = await Promise.all([
    q,
    manager ? supabase.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true) : Promise.resolve({ data: [] as never[] }),
  ]);
  const now = nowDate();
  const nextArrival = (k: { next?: unknown }) => ((Array.isArray(k.next) ? k.next[0] : k.next) as { check_in_at: string } | null)?.check_in_at ?? null;
  const people = (members ?? []).map((m: { user_id: string; profiles: unknown }) => {
    const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null;
    return { id: m.user_id, name: p?.full_name || t("noName") };
  });
  return (
    <>
      <PageHeader title={manager ? t("title") : t("mineTitle")} subtitle={manager ? t("subtitle") : t("mineSubtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <Card className="divide-y divide-line">
        {(tasks ?? []).length === 0 && <p className="p-5 text-[15px] text-muted">{manager ? t("empty") : t("mineEmpty")}</p>}
        {(tasks ?? []).map((k) => {
          const p = (Array.isArray(k.properties) ? k.properties[0] : k.properties) as { name: string; address_line: string | null; city: string | null } | null;
          return (
            <div key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid="mission-row">
              <Link href={`/app/missions/${k.id}`} className="min-w-0 flex-1 hover:underline" data-testid="mission-link">
                <span className="block text-[15px] font-medium">
                  {tt(k.type)} · {p?.name}
                </span>
                <span className="block text-[13px] text-muted">
                  {f.dateTime(new Date(k.window_start), { dateStyle: "medium", timeStyle: "short" })} → {f.dateTime(new Date(k.window_end), { timeStyle: "short" })} · {tts(k.status)}
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
