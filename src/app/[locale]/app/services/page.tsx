import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { getContext, isManagerRole } from "@/lib/connected/context";

export default async function ServicesPage({ params }: PageProps<"/[locale]/app/services">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.services");
  const tk = await getTranslations("serviceKind");
  const ts = await getTranslations("serviceStatus");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data, error } = await supabase
    .from("service_requests")
    .select("id, kind, start_at, people, status, manager_unread, source, reservations(guest_name), properties(name)")
    .eq("organization_id", org!.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const groups = [
    { key: "todo", items: rows.filter((r) => r.status === "requested" || r.manager_unread) },
    { key: "waiting", items: rows.filter((r) => r.status === "info_requested" && !r.manager_unread) },
    { key: "confirmed", items: rows.filter((r) => r.status === "confirmed" && !r.manager_unread) },
    { key: "closed", items: rows.filter((r) => ["declined", "done", "cancelled"].includes(r.status) && !r.manager_unread) },
  ];
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key} data-testid={`services-${g.key}`}>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              {t(`group.${g.key}`)} · {g.items.length}
            </h2>
            <Card className="divide-y divide-line">
              {g.items.length === 0 && <p className="px-5 py-3.5 text-[14px] text-muted">{t("none")}</p>}
              {g.items.map((s) => (
                <Link key={s.id} href={`/app/services/${s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-hover" data-testid="service-row">
                  <span className="flex-1">
                    <span className="block text-[15px] font-medium">
                      {tk(s.kind)} · {(one(s.reservations) as { guest_name: string | null } | null)?.guest_name ?? t("noGuest")}
                    </span>
                    <span className="block text-[13px] text-muted">
                      {(one(s.properties) as { name: string } | null)?.name} · {f.dateTime(new Date(s.start_at), { dateStyle: "medium", timeStyle: "short" })} · {ts(s.status)}
                    </span>
                  </span>
                  {s.manager_unread && <span className="rounded-full bg-danger px-2 py-0.5 text-[12px] font-semibold text-white">{t("new")}</span>}
                  <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
                </Link>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
