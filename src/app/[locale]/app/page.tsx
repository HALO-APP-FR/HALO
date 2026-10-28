import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, CalendarDays, ConciergeBell, MailWarning, MessageSquare, Settings2, UserRoundX } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { CreateOrgCard } from "@/components/connected/create-org";
import { getContext, isManagerRole } from "@/lib/connected/context";

export default async function AppHome({ params }: PageProps<"/[locale]/app">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected");
  const { supabase, org } = await getContext();
  if (!org) return <CreateOrgCard />;
  if (!isManagerRole(org.role)) redirect({ href: "/app/missions", locale });

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [services, messages, outbox, stays, unassigned] = await Promise.all([
    supabase.from("service_requests").select("id", { count: "exact", head: true }).eq("organization_id", org.id).or("manager_unread.eq.true,status.eq.requested"),
    supabase.from("stay_messages").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("author_kind", "guest").is("read_by_team_at", null),
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", ["failed", "not_configured"]),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "confirmed").gte("check_in_at", now.toISOString()).lte("check_in_at", in7),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "unassigned").gte("window_end", now.toISOString()),
  ]);
  const onboardingDone = Boolean(org.onboarding?.completed_at);
  const enabled = ((org.onboarding?.config as { alerts?: string[] } | undefined)?.alerts ?? null) as string[] | null;
  const allRows = [
    { key: "services", n: services.count ?? 0, href: "/app/services", icon: ConciergeBell, danger: true },
    { key: "messages", n: messages.count ?? 0, href: "/app/stays", icon: MessageSquare, danger: true },
    { key: "unassigned", n: unassigned.count ?? 0, href: "/app/missions", icon: UserRoundX, danger: true },
    { key: "emails", n: outbox.count ?? 0, href: "/app/services", icon: MailWarning, danger: false },
    { key: "stays7", n: stays.count ?? 0, href: "/app/stays", icon: CalendarDays, danger: false },
  ] as const;
  const alertOf = { services: "pending_services", messages: "unread_messages", unassigned: "unassigned_missions", emails: "failed_emails", stays7: "upcoming_stays" } as const;
  // Alertes choisies à l'onboarding ; les demandes et messages voyageurs restent toujours visibles
  const rows = allRows.filter((r) => !enabled || r.key === "services" || r.key === "messages" || enabled.includes(alertOf[r.key]));

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
