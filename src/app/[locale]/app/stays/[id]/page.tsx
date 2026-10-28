import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { GuestLinkPanel, StayReply, type LinkRow } from "@/components/connected/stay-forms";
import { OutboxList, type OutboxItem } from "@/components/connected/outbox-list";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { cn } from "@/lib/utils";

export default async function StayPage({ params }: PageProps<"/[locale]/app/stays/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const tk = await getTranslations("serviceKind");
  const tss = await getTranslations("serviceStatus");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const { data: s } = await supabase
    .from("reservations")
    .select("id, guest_name, guest_email, check_in_at, check_out_at, adults, children, babies, status, property_id, properties(name)")
    .eq("organization_id", o)
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const [{ data: links }, { data: msgs }, { data: services }, { data: tasks }, { data: outbox }] = await Promise.all([
    supabase.from("guest_links").select("id, valid_from, valid_until, revoked_at, revoke_reason, last_opened_at, created_at").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }),
    supabase.from("stay_messages").select("id, author_kind, body, created_at, read_by_guest_at").eq("organization_id", o).eq("reservation_id", id).order("created_at"),
    supabase.from("service_requests").select("id, kind, start_at, status, manager_unread").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, type, status, window_start, window_end").eq("organization_id", o).or(`reservation_id.eq.${id},next_reservation_id.eq.${id}`).neq("status", "cancelled").order("window_start"),
    supabase.from("notification_outbox").select("id, template, recipient, status, attempts, last_error, created_at, sent_at").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }),
  ]);
  const p = (Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string } | null;
  const d = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <PageHeader title={s.guest_name || t("stays.unnamed")} subtitle={`${p?.name} · ${d(s.check_in_at)} → ${d(s.check_out_at)}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <GuestLinkPanel reservationId={s.id} links={(links ?? []) as LinkRow[]} checkOut={s.check_out_at} />
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("stays.services")}</h2>
            {(services ?? []).length === 0 ? (
              <p className="mt-2 text-[14px] text-muted">{t("stays.noServices")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {(services ?? []).map((sv) => (
                  <li key={sv.id}>
                    <Link href={`/app/services/${sv.id}`} className="flex items-center gap-2 py-2.5 text-[15px] hover:underline">
                      <span className="flex-1">{tk(sv.kind)} · {d(sv.start_at)}</span>
                      <span className="text-[13px] text-muted">{tss(sv.status)}</span>
                      {sv.manager_unread && <span className="size-2 rounded-full bg-danger" aria-label={t("services.unread")} />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("stays.missions")}</h2>
            <ul className="mt-2 space-y-1.5 text-[14px]">
              {(tasks ?? []).map((k) => (
                <li key={k.id}>
                  {tt(k.type)} · {d(k.window_start)} — <span className="text-muted">{tts(k.status)}</span>
                </li>
              ))}
              {(tasks ?? []).length === 0 && <li className="text-muted">{t("stays.noMissions")}</li>}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5" data-testid="stay-messages">
            <h2 className="text-[17px] font-semibold">{t("messages.title")}</h2>
            <p className="mt-1 text-[13px] text-muted">{t("messages.visibleToGuest")}</p>
            <ul className="mt-3 space-y-2">
              {(msgs ?? []).map((m) => (
                <li key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[15px]", m.author_kind === "guest" ? "bg-subtle dark:bg-surface-hover" : "ms-auto bg-accent-soft")}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-[12px] text-faint">
                    {m.author_kind === "guest" ? t("messages.fromGuest") : t("messages.fromTeam")} · {d(m.created_at)}
                    {m.author_kind === "member" && (m.read_by_guest_at ? ` · ${t("messages.seen")}` : "")}
                  </p>
                </li>
              ))}
              {(msgs ?? []).length === 0 && <li className="text-[14px] text-muted">{t("messages.empty")}</li>}
            </ul>
            <StayReply reservationId={s.id} hasEmail={Boolean(s.guest_email)} />
          </Card>
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("outbox.title")}</h2>
            <p className="mb-2 mt-1 text-[13px] text-muted">{s.guest_email ? t("outbox.to", { email: s.guest_email }) : t("outbox.noEmail")}</p>
            <OutboxList items={(outbox ?? []) as OutboxItem[]} />
          </Card>
        </div>
      </div>
    </>
  );
}
