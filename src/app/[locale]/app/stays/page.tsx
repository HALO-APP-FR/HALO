import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { StayCreateForm } from "@/components/connected/stay-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { isoFromNow } from "@/lib/connected/time";

export default async function StaysPage({ params }: PageProps<"/[locale]/app/stays">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.stays");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const since = isoFromNow(-2 * 86_400_000);
  const [{ data: stays, error }, { data: props }, { data: unread }] = await Promise.all([
    supabase.from("reservations").select("id, guest_name, check_in_at, check_out_at, status, properties(name)").eq("organization_id", org!.id).gte("check_out_at", since).order("check_in_at").limit(200),
    supabase.from("properties").select("id, name").eq("organization_id", org!.id).is("archived_at", null).order("name"),
    supabase.from("stay_messages").select("reservation_id").eq("organization_id", org!.id).eq("author_kind", "guest").is("read_by_team_at", null),
  ]);
  // Nombre de messages non lus par séjour (cohérent avec l'accueil : même requête, même règle)
  const unreadBy = new Map<string, number>();
  for (const m of unread ?? []) unreadBy.set(m.reservation_id, (unreadBy.get(m.reservation_id) ?? 0) + 1);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="divide-y divide-line self-start">
          {(stays ?? []).length === 0 && <p className="p-5 text-[15px] text-muted">{t("empty")}</p>}
          {(stays ?? []).map((s) => {
            const p = (Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string } | null;
            return (
              <Link key={s.id} href={`/app/stays/${s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover" data-testid="stay-row">
                <span className="flex-1">
                  <span className="block text-[15px] font-medium">
                    {s.guest_name || t("unnamed")} · {p?.name}
                  </span>
                  <span className="block text-[13px] text-muted">
                    {f.dateTime(new Date(s.check_in_at), { dateStyle: "medium" })} → {f.dateTime(new Date(s.check_out_at), { dateStyle: "medium" })}
                    {s.status !== "confirmed" ? ` · ${t(`status.${s.status}`)}` : ""}
                  </span>
                </span>
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
