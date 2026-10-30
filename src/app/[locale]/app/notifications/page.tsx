import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { OutboxList, type OutboxItem } from "@/components/connected/outbox-list";
import { getContext, isManagerRole } from "@/lib/connected/context";

/** Journal des notifications : chaque e-mail (voyageur ou équipe), son état réel, son erreur et la relance. */
export default async function NotificationsPage({ params }: PageProps<"/[locale]/app/notifications">) {
  const { locale } = await params;
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
  const rows = (data ?? []) as OutboxItem[];
  const count = (s: OutboxItem["status"]) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <p className="mb-3 text-[14px] text-muted" data-testid="notifications-summary">
        {t("summary", { sent: count("sent"), pending: count("pending"), failed: count("failed"), notConfigured: count("not_configured") })} · {t("skippedCount", { count: count("skipped") })}
      </p>
      <Card className="p-4" data-testid="notifications-list">
        <OutboxList items={rows} />
      </Card>
    </>
  );
}
