import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, ClipboardCheck, MessagesSquare, CalendarClock, CalendarDays, CalendarX2, ConciergeBell, MailWarning, MessageSquare, Settings2, TriangleAlert, UserRoundX } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { CreateOrgCard } from "@/components/connected/create-org";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { nowDate } from "@/lib/connected/time";
import { ArrivalsNow } from "@/components/connected/arrivals-now";
import { loadPlanning } from "@/lib/connected/planning";
import { unreadThreads } from "@/lib/connected/chat";

export default async function AppHome({ params }: PageProps<"/[locale]/app">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected");
  const { supabase, org } = await getContext();
  if (!org) return <CreateOrgCard />;
  if (!isManagerRole(org.role)) redirect({ href: "/app/missions", locale });

  const now = nowDate();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [services, messages, outbox, stays, unassigned, incidents, planning, toValidate, chats] = await Promise.all([
    supabase.from("service_requests").select("id", { count: "exact", head: true }).eq("organization_id", org.id).or("manager_unread.eq.true,status.eq.requested"),
    supabase.from("stay_messages").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("author_kind", "guest").is("read_by_team_at", null),
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", ["failed", "not_configured"]),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "confirmed").gte("check_in_at", now.toISOString()).lte("check_in_at", in7),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "unassigned").gte("window_end", now.toISOString()),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("organization_id", org.id).neq("status", "resolved"),
    loadPlanning(supabase, org.id, now),
    // Missions terminées qui attendent un responsable (statut « À valider ») : disparaissent dès validation ou correction
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "done"),
    unreadThreads(supabase, org.id),
  ]);
  const onboardingDone = Boolean(org.onboarding?.completed_at);
  // Linge suivi dans « logement prêt » seulement si l'organisation travaille avec une blanchisserie (réponse d'onboarding)
  const { data: orgRow } = await supabase.from("organizations").select("linen_model").eq("id", org.id).single();
  const linenRequired = orgRow?.linen_model === "laundry" || orgRow?.linen_model === "both";
  const enabled = ((org.onboarding?.config as { alerts?: string[] } | undefined)?.alerts ?? null) as string[] | null;
  const allRows = [
    { key: "toValidate", n: toValidate.count ?? 0, href: "/app/missions?status=done", icon: ClipboardCheck, danger: true },
    { key: "chats", n: chats, href: "/app/messages", icon: MessagesSquare, danger: true },
    { key: "incidents", n: incidents.count ?? 0, href: "/app/incidents", icon: TriangleAlert, danger: true },
    // Planning : ménages impossibles, missions touchées par une absence, demandes d'absence — toujours visibles
    { key: "schedule", n: planning.schedule.length, href: "/app/missions", icon: CalendarX2, danger: true },
    { key: "availability", n: planning.availability.length + planning.closureStays.length, href: "/app/team", icon: CalendarClock, danger: true },
    { key: "absenceRequests", n: planning.pendingAbsences, href: "/app/team", icon: CalendarClock, danger: true },
    { key: "services", n: services.count ?? 0, href: "/app/services", icon: ConciergeBell, danger: true },
    { key: "messages", n: messages.count ?? 0, href: "/app/stays", icon: MessageSquare, danger: true },
    { key: "unassigned", n: unassigned.count ?? 0, href: "/app/missions", icon: UserRoundX, danger: true },
    { key: "emails", n: outbox.count ?? 0, href: "/app/notifications", icon: MailWarning, danger: false },
    { key: "stays7", n: stays.count ?? 0, href: "/app/stays", icon: CalendarDays, danger: false },
  ] as const;
  const alertOf = { toValidate: "unassigned_missions", chats: "unread_messages", schedule: "unassigned_missions", availability: "unassigned_missions", absenceRequests: "unassigned_missions", incidents: "pending_services", services: "pending_services", messages: "unread_messages", unassigned: "unassigned_missions", emails: "failed_emails", stays7: "upcoming_stays" } as const;
  // Alertes choisies à l'onboarding ; les demandes et messages voyageurs restent toujours visibles
  const always = ["toValidate", "chats", "services", "messages", "incidents", "schedule", "availability", "absenceRequests"];
  const rows = allRows.filter((r) => !enabled || always.includes(r.key) || enabled.includes(alertOf[r.key]));

  return (
    <>
      <PageHeader title={org.name} subtitle={t("home.subtitle")} />
      {!onboardingDone && (
        <Link href="/app/onboarding" className="mb-4 flex items-center gap-3 rounded-xl border border-accent bg-accent-soft p-4" data-testid="onboarding-resume">
          <Settings2 className="size-5 text-accent-text" />
          <span className="flex-1">
            <span className="block text-[15px] font-semibold">{t("home.onboardingTitle")}</span>
            <span className="block text-[14px] text-muted">{org.onboarding?.step ? t("home.onboardingResume") : t("home.onboardingStart")}</span>
          </span>
          <ArrowRight className="size-5 text-accent-text rtl:-scale-x-100" />
        </Link>
      )}
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t("home.arrivalsTitle")}</h2>
      <div className="mb-6">
        <ArrivalsNow supabase={supabase} orgId={org.id} now={now} linenRequired={linenRequired} />
      </div>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t("home.queueTitle")}</h2>
      <Card className="divide-y divide-line">
        {rows.map(({ key, n, href, icon: Icon, danger }) => (
          <Link key={key} href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-hover md:px-5" data-testid={`home-${key}`}>
            <span className={`grid size-9 place-items-center rounded-md ${n && danger ? "bg-danger-soft text-danger" : "bg-subtle text-muted dark:bg-surface-hover"}`}>
              <Icon className="size-[18px]" />
            </span>
            <span className="flex-1 text-[15px]">{t(`home.${key}`, { count: n })}</span>
            <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
          </Link>
        ))}
      </Card>
    </>
  );
}
