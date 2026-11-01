import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { cn } from "@/lib/utils";

const OPEN = ["received", "in_review", "info_requested", "offer_sent", "accepted"];

export default async function BookingsPage({ params, searchParams }: PageProps<"/[locale]/app/bookings">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("connected.booking");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const view = sp.view === "closed" ? "closed" : "open";
  const { data, error } = await supabase
    .from("booking_requests")
    .select("id, status, check_in, check_out, adults, children, babies, contact_name, manager_unread, created_at, updated_at, properties(name)")
    .eq("organization_id", org!.id)
    .in("status", view === "open" ? OPEN : ["confirmed", "declined", "cancelled"])
    .order("updated_at", { ascending: false })
    .limit(200);
  const day = (x: string) => f.dateTime(new Date(`${x}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
  // À traiter d'abord : non lues, puis acceptées (à confirmer), puis reçues
  const rank = (s: string) => ["accepted", "received", "info_requested", "in_review", "offer_sent"].indexOf(s);
  const rows = (data ?? []).sort((a, b) => (view === "open" ? Number(b.manager_unread) - Number(a.manager_unread) || rank(a.status) - rank(b.status) : 0));
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mb-4 flex gap-2 text-[14px]">
        <Link href="/app/bookings" className={cn("rounded-full px-3 py-1", view === "open" ? "bg-fg text-canvas" : "bg-subtle dark:bg-surface-hover")}>
          {t("viewOpen")}
        </Link>
        <Link href="/app/bookings?view=closed" className={cn("rounded-full px-3 py-1", view === "closed" ? "bg-fg text-canvas" : "bg-subtle dark:bg-surface-hover")}>
          {t("viewClosed")}
        </Link>
      </div>
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="space-y-3">
        {rows.length === 0 && <Card className="p-5 text-[15px] text-muted">{view === "open" ? t("empty") : t("emptyClosed")}</Card>}
        {rows.map((r) => (
          <Link key={r.id} href={`/app/bookings/${r.id}`} className="block" data-testid="booking-row" data-status={r.status}>
            <Card className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-hover">
              {r.manager_unread && <span className="size-2.5 rounded-full bg-danger" aria-label={t("unread")} />}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">
                  {r.contact_name} · {(one(r.properties) as { name: string } | null)?.name}
                </p>
                <p className="text-[13px] text-muted">
                  {day(r.check_in)} → {day(r.check_out)} · {t("people", { count: r.adults + r.children + r.babies })} · {t("receivedOn", { date: f.dateTime(new Date(r.created_at), { dateStyle: "short" }) })}
                </p>
              </div>
              <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-medium dark:bg-surface-hover">{t(`status.${r.status}`)}</span>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
