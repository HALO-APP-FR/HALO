import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { OutboxList, type OutboxItem } from "@/components/connected/outbox-list";
import { getContext, isManagerRole } from "@/lib/connected/context";

/** Journal des notifications : chaque e-mail (voyageur ou équipe), son état réel, son erreur et la relance. */
const TEAM = /^(team_|agent_|chat_)/;

export default async function NotificationsPage({ params, searchParams }: PageProps<"/[locale]/app/notifications">) {
  const { locale } = await params;
  const sp = await searchParams;
  const audience = sp.audience === "guest" || sp.audience === "team" ? sp.audience : "all";
  const state = sp.state === "problem" || sp.state === "skipped" ? sp.state : "all";
  setRequestLocale(locale);
  const t = await getTranslations("connected.notifications");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data, error } = await supabase
    .from("notification_outbox")
    .select("id, template, recipient, status, attempts, last_error, created_at, sent_at")
    .eq("organization_id", org!.id)
    .order("created_at", { ascending: false })
    .limit(200);
  // Voyageurs et équipe séparés ; « non envoyé par préférence » n'est jamais un échec
  const rows = ((data ?? []) as OutboxItem[])
    .filter((r) => audience === "all" || (audience === "team") === TEAM.test(r.template))
    .filter((r) => state === "all" || (state === "skipped" ? r.status === "skipped" : r.status === "failed" || r.status === "not_configured"));
  const href = (a: string, st: string) => `/app/notifications?audience=${a}&state=${st}`;
  const count = (s: OutboxItem["status"]) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <p className="mb-3 text-[14px] text-muted" data-testid="notifications-summary">
        {t("summary", { sent: count("sent"), pending: count("pending"), failed: count("failed"), notConfigured: count("not_configured") })} · {t("skippedCount", { count: count("skipped") })}
      </p>
      <nav className="mb-3 flex flex-wrap gap-2 text-[13px]" aria-label={t("filters")} data-testid="notifications-filters">
        {(["all", "guest", "team"] as const).map((a) => (
          <Link key={a} href={href(a, state)} aria-current={audience === a ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5", audience === a ? "border-accent bg-accent-soft font-semibold text-accent-text" : "border-line")} data-testid={`filter-audience-${a}`}>
            {t(`audience.${a}`)}
          </Link>
        ))}
        <span className="mx-1 w-px bg-line" aria-hidden />
        {(["all", "problem", "skipped"] as const).map((st) => (
          <Link key={st} href={href(audience, st)} aria-current={state === st ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5", state === st ? "border-accent bg-accent-soft font-semibold text-accent-text" : "border-line")} data-testid={`filter-state-${st}`}>
            {t(`state.${st}`)}
          </Link>
        ))}
      </nav>
      <Card className="p-4" data-testid="notifications-list">
        <OutboxList items={rows} />
      </Card>
    </>
  );
}
