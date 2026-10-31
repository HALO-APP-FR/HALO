import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { GuestLinkPanel, StayReply, type LinkRow } from "@/components/connected/stay-forms";
import { OutboxList, type OutboxItem } from "@/components/connected/outbox-list";
import { MarkStayRead } from "@/components/connected/mark-read";
import { GuestItems, PrepActions, PrepStatusControl, VipPanel, type GuestItemRow, type PrepActionRow } from "@/components/connected/prep-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { cn } from "@/lib/utils";
import { durationText, windowText, zoneLabel } from "@/lib/connected/format";
import { toProperty, toReservation } from "@/lib/connected/mappers";
import { scheduleConflicts } from "@/lib/engine/tasks";
import { nowDate } from "@/lib/connected/time";

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
    .select("id, guest_name, guest_email, guest_locale, check_in_at, check_out_at, adults, children, babies, status, property_id, properties(name, timezone)")
    .eq("organization_id", o)
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();
  const [{ data: links }, { data: msgs }, { data: services }, { data: tasks }, { data: outbox }, { data: prop }, { data: around }] = await Promise.all([
    supabase.from("guest_links").select("id, valid_from, valid_until, revoked_at, revoke_reason, last_opened_at, created_at").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }),
    supabase.from("stay_messages").select("id, author_kind, body, created_at, read_by_guest_at, read_by_team_at").eq("organization_id", o).eq("reservation_id", id).order("created_at"),
    supabase.from("service_requests").select("id, kind, start_at, status, manager_unread").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, type, status, window_start, window_end").eq("organization_id", o).or(`reservation_id.eq.${id},next_reservation_id.eq.${id}`).neq("status", "cancelled").order("window_start"),
    supabase.from("notification_outbox").select("id, template, recipient, status, attempts, last_error, created_at, sent_at").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }),
    supabase.from("properties").select("*").eq("organization_id", o).eq("id", s.property_id).single(),
    supabase.from("reservations").select("*").eq("organization_id", o).eq("property_id", s.property_id).eq("status", "confirmed"),
  ]);
  const [{ data: prep }, { data: actions }, { data: items }, { data: events }, { data: members }, { data: places }, { data: criteria }, { data: vipReq }, { data: vipRow }, { data: loyalty }, { data: orgRow }] = await Promise.all([
    supabase.from("stay_preparations").select("*").eq("organization_id", o).eq("reservation_id", id).maybeSingle(),
    supabase.from("stay_prep_actions").select("id, title, kind, assignee_id, due_at, blocking, status, task_id, service_id, done_at, override_reason, task:tasks!stay_prep_actions_organization_id_task_id_fkey(status)").eq("organization_id", o).eq("reservation_id", id).order("created_at"),
    supabase.from("stay_guest_items").select("id, kind, title, body, url, place_id, published_at").eq("organization_id", o).eq("reservation_id", id).order("created_at"),
    supabase.from("stay_prep_events").select("id, kind, actor_id, note, at").eq("organization_id", o).eq("reservation_id", id).order("at", { ascending: false }).limit(40),
    supabase.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", o).eq("is_active", true),
    supabase.from("property_places").select("id, name").eq("organization_id", o).eq("property_id", s.property_id).eq("hidden", false).order("name").limit(200),
    supabase.from("vip_criteria").select("id, label, kind, min_stays, validity_days").eq("organization_id", o).eq("active", true).order("label"),
    supabase.from("vip_requests").select("id, status, note, criterion_id, guest_message, created_at").eq("organization_id", o).eq("reservation_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("stay_vip").select("status, criterion_id, reason, granted_by, granted_at, expires_at").eq("organization_id", o).eq("reservation_id", id).maybeSingle(),
    supabase.rpc("loyalty_count", { org: o, reservation: id }),
    supabase.from("organizations").select("services_offered").eq("id", o).single(),
  ]);
  const tp = await getTranslations("connected.prep");
  const tq = await getTranslations("guestSpace.prep");
  const memberList = (members ?? []).map((m) => ({ id: m.user_id as string, name: ((Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string | null } | null)?.full_name || "—" }));
  // Responsables d'une action : membres qui voient la préparation (les agents reçoivent une mission à la place)
  const managerIds = (members ?? []).filter((m) => m.role === "owner" || m.role === "manager").map((m) => m.user_id as string);
  const who = (uid: string | null) => (uid ? memberList.find((m) => m.id === uid)?.name ?? "—" : null);
  const answers = (prep?.answers ?? {}) as { adults?: number; children?: number; babies?: number; interests?: string[]; style?: string; services?: string[]; budget?: string; constraints?: string; other?: string; language?: string };
  const openBlocking = (actions ?? []).filter((a) => a.status === "open" && a.blocking).length;
  const invite = (outbox ?? []).find((x) => x.template === "prep_invite");
  const crit = (criteria ?? []).find((c) => c.id === vipRow?.criterion_id);
  const tc = await getTranslations("connected.schedule");
  // Conflit de créneau qui touche ce séjour (départ ou arrivée) : signalé, jamais une mission impossible
  const conflicts = prop ? scheduleConflicts(toProperty(prop), (around ?? []).map(toReservation), nowDate()).filter((c) => c.reservationId === id || c.nextReservationId === id) : [];
  const p = (Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string; timezone: string | null } | null;
  const zone = zoneLabel(p?.timezone, new Date(s.check_in_at));
  const tz = p?.timezone ?? "Europe/Paris";
  const d = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  // Messages du voyageur non lus au moment de l'ouverture : signalés « Nouveau », puis marqués lus (ceux affichés seulement)
  const unreadIds = (msgs ?? []).filter((m) => m.author_kind === "guest" && !m.read_by_team_at).map((m) => m.id as number);
  return (
    <>
      <PageHeader title={s.guest_name || t("stays.unnamed")} subtitle={`${p?.name} · ${windowText(f, s.check_in_at, s.check_out_at, false, p?.timezone ?? undefined)}${zone ? ` (${t("missions.localTime", { zone })})` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {conflicts.length > 0 && (
            <Card className="border-danger p-5" data-testid="stay-schedule-conflict">
              <h2 className="text-[17px] font-semibold text-danger">{tc("stayTitle")}</h2>
              {conflicts.map((c) => (
                <p key={c.kind} className="mt-1 text-[14px]">
                  {tc(`kind.${c.kind}`, { available: durationText(c.availableMin ?? 0), needed: durationText(c.neededMin ?? 0) })}
                </p>
              ))}
              <p className="mt-2 text-[13px] text-muted">{tc("stayHint")}</p>
            </Card>
          )}
          <Card className="p-5" data-testid="stay-prep">
            <h2 className="text-[17px] font-semibold">{tp("title")}</h2>
            <p className="mt-1 text-[13px] text-muted">{tp("text")}</p>
            <div className="mt-3">
              <PrepStatusControl reservationId={s.id} status={(prep?.prep_status as string) ?? "to_prepare"} openBlocking={openBlocking} />
              {prep?.prep_updated_at && <p className="mt-1 text-[12px] text-faint">{tp("statusBy", { who: who(prep.prep_updated_by as string | null) ?? "—", date: d(prep.prep_updated_at as string) })}</p>}
            </div>
            <h3 className="mt-5 flex items-center gap-2 text-[15px] font-semibold">
              {tp("answers")}
              {prep?.needs_review && <span className="rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white" data-testid="prep-needs-review">{tp("toReview")}</span>}
            </h3>
            <p className="text-[13px] text-muted" data-testid="prep-questionnaire" data-status={(prep?.questionnaire_status as string) ?? "not_started"}>
              {t(`link.journey.q.${(prep?.questionnaire_status as string) ?? "not_started"}`)}
              {prep?.guest_updated_at ? ` · ${tp("lastUpdate", { date: d(prep.guest_updated_at as string) })}` : ""}
            </p>
            {Object.keys(answers).length > 0 && (
              <dl className="mt-2 grid gap-2 text-[14px]" data-testid="prep-answers">
                {(answers.adults != null || answers.children != null || answers.babies != null) && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("guests")}</dt>
                    <dd>{tp("guestsValue", { adults: answers.adults ?? 0, children: answers.children ?? 0, babies: answers.babies ?? 0 })}</dd>
                  </div>
                )}
                {!!answers.interests?.length && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("interests")}</dt>
                    <dd>{answers.interests.map((x) => tq(`interest.${x}`)).join(", ")}</dd>
                  </div>
                )}
                {answers.style && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("style")}</dt>
                    <dd>{tq(`styles.${answers.style}`)}</dd>
                  </div>
                )}
                {!!answers.services?.length && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("services")}</dt>
                    <dd>{answers.services.map((x) => tk(x)).join(", ")}</dd>
                  </div>
                )}
                {answers.budget && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("budget")}</dt>
                    <dd>{tq(`budgets.${answers.budget}`)}</dd>
                  </div>
                )}
                {answers.constraints && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("constraints")}</dt>
                    <dd className="whitespace-pre-wrap">{answers.constraints}</dd>
                  </div>
                )}
                {answers.other && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("other")}</dt>
                    <dd className="whitespace-pre-wrap">{answers.other}</dd>
                  </div>
                )}
                {answers.language && (
                  <div>
                    <dt className="text-[12px] font-medium text-muted">{tq("language")}</dt>
                    <dd>{answers.language.toUpperCase()}</dd>
                  </div>
                )}
              </dl>
            )}
            <h3 className="mt-5 text-[15px] font-semibold">{tp("actions")}</h3>
            <div className="mt-2">
              <PrepActions
                reservationId={s.id}
                actions={(actions ?? []).map((a) => ({ ...a, task_status: ((Array.isArray(a.task) ? a.task[0] : a.task) as { status: string } | null)?.status ?? null })) as PrepActionRow[]}
                members={memberList.filter((m) => managerIds.includes(m.id))}
                timeZone={tz}
                serviceKinds={(orgRow?.services_offered as string[] | null)?.length ? (orgRow!.services_offered as string[]) : ["other"]}
                checkIn={s.check_in_at}
              />
            </div>
            <h3 className="mt-5 text-[15px] font-semibold">{tp("forGuest")}</h3>
            <p className="mb-2 text-[13px] text-muted">{tp("forGuestText")}</p>
            <GuestItems reservationId={s.id} items={(items ?? []) as GuestItemRow[]} places={(places ?? []) as { id: string; name: string }[]} timeZone={tz} />
            <details className="mt-5">
              <summary className="cursor-pointer text-[15px] font-semibold">{tp("history")}</summary>
              <ol className="mt-2 space-y-1 border-s border-line ps-3 text-[13px]" data-testid="prep-history">
                {(events ?? []).map((e) => (
                  <li key={e.id}>
                    <span className="text-faint">{d(e.at)} · </span>
                    {tp(`event.${e.kind}`)}
                    {e.actor_id ? ` · ${who(e.actor_id)}` : ""}
                    {e.note && e.kind !== "status_changed" ? ` — ${e.note}` : e.kind === "status_changed" && e.note ? ` — ${tp(`status.${e.note}`)}` : ""}
                  </li>
                ))}
                {(events ?? []).length === 0 && <li className="text-muted">{tp("noHistory")}</li>}
              </ol>
            </details>
          </Card>
          <GuestLinkPanel
            reservationId={s.id}
            links={(links ?? []) as LinkRow[]}
            checkOut={s.check_out_at}
            hasEmail={Boolean(s.guest_email)}
            invite={invite ? { status: invite.status as string, created_at: invite.created_at as string } : null}
            questionnaire={(prep?.questionnaire_status as string) ?? null}
            timeZone={tz}
          />
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
                  <Link href={`/app/missions/${k.id}`} className="hover:underline">
                    {tt(k.type)} · {windowText(f, k.window_start, k.window_end, false, p?.timezone ?? undefined)}
                  </Link>{" "}
                  — <span className="text-muted">{tts(k.status)}</span>
                </li>
              ))}
              {(tasks ?? []).length === 0 && <li className="text-muted">{t("stays.noMissions")}</li>}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("vip.title")}</h2>
            <p className="mb-3 mt-1 text-[13px] text-muted">{t("vip.text")}</p>
            <VipPanel
              reservationId={s.id}
              vip={{
                status: (vipRow?.status as "active" | "revoked" | undefined) ?? null,
                expired: Boolean(vipRow?.expires_at && Date.parse(vipRow.expires_at as string) <= nowDate().getTime()),
                criterion: crit?.label ?? null,
                reason: (vipRow?.reason as string | null) ?? null,
                grantedBy: who((vipRow?.granted_by as string | null) ?? null),
                grantedAt: (vipRow?.granted_at as string | null) ?? null,
                expiresAt: (vipRow?.expires_at as string | null) ?? null,
              }}
              request={(vipReq as { id: string; status: string; note: string | null; criterion_id: string | null; guest_message: string | null; created_at: string } | null) ?? null}
              criteria={(criteria ?? []) as { id: string; label: string; kind: string; min_stays: number | null; validity_days: number | null }[]}
              loyalty={typeof loyalty === "number" ? loyalty : null}
              delivery={(() => {
                const v = (outbox ?? []).find((x) => x.template === "vip_update");
                return v ? { status: v.status as string, at: v.created_at as string } : null;
              })()}
              timeZone={tz}
            />
          </Card>
          <Card className="p-5" data-testid="stay-messages">
            <h2 className="text-[17px] font-semibold">{t("messages.title")}</h2>
            <p className="mt-1 text-[13px] text-muted">{t("messages.visibleToGuest")}</p>
            <ul className="mt-3 space-y-2">
              {(msgs ?? []).map((m) => (
                <li key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[15px]", m.author_kind === "guest" ? "bg-subtle dark:bg-surface-hover" : "ms-auto bg-accent-soft")} data-testid="stay-message" data-unread={unreadIds.includes(m.id) ? "1" : "0"}>
                  {unreadIds.includes(m.id) && <span className="mb-1 inline-block rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">{t("messages.new")}</span>}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-[12px] text-faint">
                    {m.author_kind === "guest" ? t("messages.fromGuest") : t("messages.fromTeam")} · {d(m.created_at)}
                    {m.author_kind === "member" && (m.read_by_guest_at ? ` · ${t("messages.seen")}` : "")}
                    {m.author_kind === "guest" && m.read_by_team_at ? ` · ${t("messages.readByTeam", { at: d(m.read_by_team_at) })}` : ""}
                  </p>
                </li>
              ))}
              {unreadIds.length > 0 && <MarkStayRead reservationId={s.id} ids={unreadIds} />}
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
