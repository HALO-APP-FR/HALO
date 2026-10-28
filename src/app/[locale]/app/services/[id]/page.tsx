import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Eye, Lock } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { ServiceDecision } from "@/components/connected/service-decision";
import { OutboxList, type OutboxItem } from "@/components/connected/outbox-list";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { cn } from "@/lib/utils";

export default async function ServicePage({ params }: PageProps<"/[locale]/app/services/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected");
  const tk = await getTranslations("serviceKind");
  const ts = await getTranslations("serviceStatus");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const { data: s } = await supabase
    .from("service_requests")
    .select("id, kind, start_at, people, details, status, source, manager_unread, reservation_id, reservations(guest_name, guest_email), properties(name)")
    .eq("organization_id", o)
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const [{ data: events }, { data: outbox }] = await Promise.all([
    supabase.from("service_events").select("id, kind, status, body, visibility, author_kind, at").eq("organization_id", o).eq("service_id", id).order("id"),
    supabase.from("notification_outbox").select("id, template, recipient, status, attempts, last_error, created_at, sent_at").eq("organization_id", o).eq("service_id", id).order("created_at", { ascending: false }),
  ]);
  const r = (Array.isArray(s.reservations) ? s.reservations[0] : s.reservations) as { guest_name: string | null; guest_email: string | null } | null;
  const p = (Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string } | null;
  const d = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <PageHeader title={`${tk(s.kind)} · ${ts(s.status)}`} subtitle={`${r?.guest_name ?? t("services.noGuest")} · ${p?.name} · ${d(s.start_at)}${s.people ? ` · ${t("services.people", { n: s.people })}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {s.details && (
            <Card className="p-5">
              <h2 className="text-[13px] font-medium text-muted">{t("services.details")}</h2>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{s.details}</p>
            </Card>
          )}
          <ServiceDecision serviceId={s.id} status={s.status} guestEmail={r?.guest_email ?? null} unread={s.manager_unread} startAt={s.start_at} people={s.people} />
          {s.reservation_id && (
            <Link href={`/app/stays/${s.reservation_id}`} className="block text-[14px] text-accent-text hover:underline">
              {t("services.openStay")}
            </Link>
          )}
        </div>
        <div className="space-y-4">
          <Card className="p-5" data-testid="service-history">
            <h2 className="text-[17px] font-semibold">{t("history.title")}</h2>
            <p className="mt-1 text-[13px] text-muted">{t("history.legend")}</p>
            <ol className="mt-3 space-y-2.5">
              {(events ?? []).map((e) => (
                <li
                  key={e.id}
                  data-visibility={e.visibility}
                  className={cn("rounded-md border p-3 text-[14px]", e.visibility === "internal" ? "border-dashed border-line-strong bg-subtle dark:bg-surface-hover" : "border-line")}
                >
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                    {e.visibility === "internal" ? <Lock className="size-3.5" /> : <Eye className="size-3.5" />}
                    {e.visibility === "internal" ? t("history.internal") : t("history.guestVisible")} · {t(`history.author.${e.author_kind}`)} · {d(e.at)}
                  </p>
                  <p className="mt-1">
                    {t(`history.kind.${e.kind}`)}
                    {e.status && e.kind !== "internal_note" ? ` — ${ts(e.status)}` : ""}
                  </p>
                  {e.body && <p className="mt-1 whitespace-pre-wrap">« {e.body} »</p>}
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("outbox.title")}</h2>
            <p className="mb-2 mt-1 text-[13px] text-muted">{r?.guest_email ? t("outbox.to", { email: r.guest_email }) : t("outbox.noEmail")}</p>
            <OutboxList items={(outbox ?? []) as OutboxItem[]} />
          </Card>
        </div>
      </div>
    </>
  );
}
