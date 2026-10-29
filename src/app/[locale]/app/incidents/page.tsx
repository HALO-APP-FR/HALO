import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { IncidentActions } from "@/components/connected/incident-actions";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { cn } from "@/lib/utils";

export default async function IncidentsPage({ params }: PageProps<"/[locale]/app/incidents">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.incidents");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data: members } = await supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true);
  const people = (members ?? []).map((m: { user_id: string; profiles: unknown }) => ({
    id: m.user_id,
    name: ((Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null)?.full_name || "—",
  }));
  const { data, error } = await supabase
    .from("incidents")
    .select("id, source, category, description, urgent, status, created_at, taken_at, resolved_at, resolution, guest_message, manager_unread, task_id, reservation_id, follow_up_task_id, properties(name), reservations(guest_name, guest_email), tasks!incidents_organization_id_task_id_fkey(type), follow:tasks!incidents_follow_up_fk(status)")
    .eq("organization_id", org!.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []).sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || Number(b.urgent) - Number(a.urgent));
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="space-y-3">
        {rows.length === 0 && <Card className="p-5 text-[15px] text-muted">{t("empty")}</Card>}
        {rows.map((i) => {
          const r = one(i.reservations) as { guest_name: string | null; guest_email: string | null } | null;
          const task = one(i.tasks) as { type: string } | null;
          return (
            <Card key={i.id} className={cn("p-5", i.status === "resolved" && "opacity-70")} data-testid="incident-row" data-status={i.status}>
              <div className="flex flex-wrap items-center gap-2">
                {i.urgent && i.status !== "resolved" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[12px] font-semibold text-white">
                    <AlertTriangle className="size-3.5" />
                    {t("urgent")}
                  </span>
                )}
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-medium dark:bg-surface-hover">{t(`status.${i.status}`)}</span>
                <span className="text-[13px] text-muted">
                  {t(`source.${i.source}`)} · {(one(i.properties) as { name: string } | null)?.name}
                  {task ? ` · ${tt(task.type)}` : ""}
                  {r?.guest_name ? ` · ${r.guest_name}` : ""} · {f.dateTime(new Date(i.created_at), { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <p className="mt-2 text-[15px] font-medium">{t(`category.${i.category}`)}</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{i.description}</p>
              {i.status === "resolved" && (
                <div className="mt-3 space-y-1 text-[14px]">
                  <p className="text-muted">
                    {t("resolvedNote")} : {i.resolution}
                  </p>
                  {i.guest_message && (
                    <p>
                      {t("sentToGuest")} : « {i.guest_message} »
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-[14px]">
                {i.task_id && (
                  <Link href={`/app/missions/${i.task_id}`} className="mt-2 text-accent-text hover:underline">
                    {t("openMission")}
                  </Link>
                )}
                {i.follow_up_task_id && (
                  <Link href={`/app/missions/${i.follow_up_task_id}`} className="mt-2 text-accent-text hover:underline" data-testid="incident-intervention">
                    {t("openIntervention")}
                    {/* État de l'intervention, distinct de celui de l'incident (résolu seulement par un responsable) */}
                    {(() => {
                      const fu = one(i.follow as unknown as { status: string } | { status: string }[] | null);
                      return fu ? (
                        <span className="ms-1 text-muted" data-testid="incident-intervention-status">
                          · {t("interventionStatus", { status: tts(fu.status) })}
                        </span>
                      ) : null;
                    })()}
                  </Link>
                )}
                {i.reservation_id && (
                  <Link href={`/app/stays/${i.reservation_id}`} className="mt-2 text-accent-text hover:underline">
                    {t("openStay")}
                  </Link>
                )}
              </div>
              <IncidentActions id={i.id} status={i.status} fromGuest={i.source === "guest"} guestHasEmail={Boolean(r?.guest_email)} hasIntervention={Boolean(i.follow_up_task_id)} members={people} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
