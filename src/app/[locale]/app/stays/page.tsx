import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { StayCreateForm } from "@/components/connected/stay-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { isoFromNow } from "@/lib/connected/time";

export default async function StaysPage({ params, searchParams }: PageProps<"/[locale]/app/stays">) {
  const { locale } = await params;
  const sp = await searchParams;
  const filter = sp.prep === "review" || sp.prep === "due" || sp.prep === "vip" ? sp.prep : null;
  setRequestLocale(locale);
  const t = await getTranslations("connected.stays");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const since = isoFromNow(-2 * 86_400_000);
  const in24 = isoFromNow(24 * 3_600_000);
  const [{ data: stays, error }, { data: props }, { data: unread }, { data: review }, { data: due }, { data: vip }] = await Promise.all([
    supabase.from("reservations").select("id, guest_name, check_in_at, check_out_at, status, properties(name, timezone)").eq("organization_id", org!.id).gte("check_out_at", since).order("check_in_at").limit(200),
    supabase.from("properties").select("id, name").eq("organization_id", org!.id).is("archived_at", null).order("name"),
    supabase.from("stay_messages").select("reservation_id").eq("organization_id", org!.id).eq("author_kind", "guest").is("read_by_team_at", null),
    supabase.from("stay_preparations").select("reservation_id").eq("organization_id", org!.id).eq("needs_review", true),
    supabase.from("stay_prep_actions").select("reservation_id").eq("organization_id", org!.id).eq("status", "open").lte("due_at", in24),
    supabase.from("vip_requests").select("reservation_id").eq("organization_id", org!.id).eq("status", "pending"),
  ]);
  const flags = { review: new Set((review ?? []).map((x) => x.reservation_id as string)), due: new Set((due ?? []).map((x) => x.reservation_id as string)), vip: new Set((vip ?? []).map((x) => x.reservation_id as string)) };
  const list = (stays ?? []).filter((s) => !filter || flags[filter].has(s.id));
  // Nombre de messages non lus par séjour (cohérent avec l'accueil : même requête, même règle)
  const unreadBy = new Map<string, number>();
  for (const m of unread ?? []) unreadBy.set(m.reservation_id, (unreadBy.get(m.reservation_id) ?? 0) + 1);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      {filter && (
        <p className="mb-3 flex flex-wrap items-center gap-3 text-[14px]" data-testid="stays-filter">
          <span className="rounded-full bg-accent-soft px-3 py-1 font-semibold text-accent-text">{t(`prepFilter.${filter}`)}</span>
          <Link href="/app/stays" className="text-accent-text hover:underline">
            {t("prepFilter.clear")}
          </Link>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="divide-y divide-line self-start">
          {list.length === 0 && <p className="p-5 text-[15px] text-muted">{t("empty")}</p>}
          {list.map((s) => {
            const p = (Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string; timezone: string | null } | null;
            const tz = p?.timezone ? { timeZone: p.timezone } : {};
            return (
              <Link key={s.id} href={`/app/stays/${s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover" data-testid="stay-row">
                <span className="flex-1">
                  <span className="block text-[15px] font-medium">
                    {s.guest_name || t("unnamed")} · {p?.name}
                  </span>
                  <span className="block text-[13px] text-muted">
                    {f.dateTime(new Date(s.check_in_at), { dateStyle: "medium", ...tz })} → {f.dateTime(new Date(s.check_out_at), { dateStyle: "medium", ...tz })}
                    {s.status !== "confirmed" ? ` · ${t(`status.${s.status}`)}` : ""}
                  </span>
                </span>
                {flags.review.has(s.id) && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent-text">{t("prepFilter.review")}</span>}
                {flags.vip.has(s.id) && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning">{t("prepFilter.vip")}</span>}
                {unreadBy.has(s.id) && <span className="rounded-full bg-danger px-2 py-0.5 text-[12px] font-semibold text-white" data-testid="stay-unread">{t("newMessages", { count: unreadBy.get(s.id)! })}</span>}
                <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
              </Link>
            );
          })}
        </Card>
        <StayCreateForm properties={props ?? []} />
      </div>
    </>
  );
}
