import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, ClipboardList, Crown, ClipboardCheck, MessagesSquare, CalendarClock, CalendarDays, CalendarX2, ConciergeBell, MailWarning, MessageSquare, Settings2, TriangleAlert, UserRoundX, CalendarPlus, Star } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { CreateOrgCard } from "@/components/connected/create-org";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { nowDate } from "@/lib/connected/time";
import { ArrivalsNow } from "@/components/connected/arrivals-now";
import { loadPlanning } from "@/lib/connected/planning";
import { unreadThreads } from "@/lib/connected/chat";

export default async function AppHome({ params }: PageProps<"/[locale]/app">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected");
  const { supabase, org } = await getContext();
  if (!org) return <CreateOrgCard />;
  if (!isManagerRole(org.role)) redirect({ href: "/app/missions", locale });

  const now = nowDate();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [services, messages, outbox, stays, unassigned, incidents, planning, toValidate, chats] = await Promise.all([
    supabase.from("service_requests").select("id", { count: "exact", head: true }).eq("organization_id", org.id).or("manager_unread.eq.true,status.eq.requested"),
    supabase.from("stay_messages").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("author_kind", "guest").is("read_by_team_at", null),
    // E-mails voyageurs non remis (échec ou aucun fournisseur) ; les e-mails d'équipe sont comptés à part, les « non envoyés par préférence » jamais
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", ["failed", "not_configured"]).or("last_error.is.null,last_error.neq.undeliverable_test_address").not("template", "like", "team_%").not("template", "like", "agent_%").not("template", "like", "chat_%"),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "confirmed").gte("check_in_at", now.toISOString()).lte("check_in_at", in7),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "unassigned").gte("window_end", now.toISOString()),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("organization_id", org.id).neq("status", "resolved"),
    loadPlanning(supabase, org.id, now),
    // Missions terminées qui attendent un responsable (statut « À valider ») : disparaissent dès validation ou correction
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "done"),
    unreadThreads(supabase, org.id),
  ]);
  const in24 = new Date(now.getTime() + 24 * 3_600_000).toISOString();
  const [teamOutbox, testOutbox, prepReview, prepDue, vipPending, bookings, lowGuest, lowOwner] = await Promise.all([
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", ["failed", "not_configured"]).or("last_error.is.null,last_error.neq.undeliverable_test_address").or("template.like.team_%,template.like.agent_%,template.like.chat_%"),
    // Préproduction : e-mails vers des adresses de test (.invalid), jamais envoyés — comptés à part, pas comme des échecs
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("last_error", "undeliverable_test_address"),
    // Questionnaires envoyés ou modifiés par un voyageur, pas encore examinés
    supabase.from("stay_preparations").select("reservation_id", { count: "exact", head: true }).eq("organization_id", org.id).eq("needs_review", true),
    // Actions de préparation ouvertes à échéance dans les 24 h (ou dépassée)
    supabase.from("stay_prep_actions").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "open").lte("due_at", in24),
    supabase.from("vip_requests").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("status", "pending"),
    // Demandes de séjour à traiter : nouvelles réponses du voyageur, ou offres acceptées à confirmer
    supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", ["received", "in_review", "info_requested", "offer_sent", "accepted"]).or("manager_unread.eq.true,status.eq.accepted,status.eq.received"),
    // Avis à traiter : voyageurs et propriétaires comptés séparément, chacun mène à sa liste filtrée
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("kind", "guest").eq("follow_status", "to_handle"),
    supabase.from("reviews").select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq("kind", "owner").eq("follow_status", "to_handle"),
  ]);
  // Horaires confirmés qui ne correspondent pas au séjour (confirmations antérieures à la décision dédiée)
  const { data: mismatchRaw } = await supabase.rpc("timing_inconsistencies", { org: org.id });
  const mismatch = ((mismatchRaw as { service: string }[] | null) ?? []);
  const onboardingDone = Boolean(org.onboarding?.completed_at);
  // Linge suivi dans « logement prêt » seulement si l'organisation travaille avec une blanchisserie (réponse d'onboarding)
  const { data: orgRow } = await supabase.from("organizations").select("linen_model").eq("id", org.id).single();
  const linenRequired = orgRow?.linen_model === "laundry" || orgRow?.linen_model === "both";
  const enabled = ((org.onboarding?.config as { alerts?: string[] } | undefined)?.alerts ?? null) as string[] | null;
  const allRows = [
    { key: "toValidate", n: toValidate.count ?? 0, href: "/app/missions?status=done", icon: ClipboardCheck, danger: true },
    { key: "chats", n: chats, href: "/app/messages", icon: MessagesSquare, danger: true },
    { key: "incidents", n: incidents.count ?? 0, href: "/app/incidents", icon: TriangleAlert, danger: true },
    // Planning : ménages impossibles, missions touchées par une absence, demandes d'absence — toujours visibles
    { key: "schedule", n: planning.schedule.length, href: "/app/missions", icon: CalendarX2, danger: true },
    { key: "availability", n: planning.availability.filter((c) => !["partial", "started", "started_during", "started_before", "started_upcoming"].includes(c.kind)).length + planning.closureStays.length, href: "/app/team", icon: CalendarClock, danger: true },
    { key: "availabilityRisks", n: planning.availability.filter((c) => ["partial", "started", "started_during", "started_before", "started_upcoming"].includes(c.kind)).length, href: "/app/team", icon: CalendarClock, danger: false },
    { key: "absenceRequests", n: planning.pendingAbsences, href: "/app/team", icon: CalendarClock, danger: true },
    { key: "services", n: services.count ?? 0, href: "/app/services", icon: ConciergeBell, danger: true },
    { key: "prepReview", n: prepReview.count ?? 0, href: "/app/stays?prep=review", icon: ClipboardList, danger: true },
    { key: "prepDue", n: prepDue.count ?? 0, href: "/app/stays?prep=due", icon: ClipboardList, danger: true },
    { key: "vipRequests", n: vipPending.count ?? 0, href: "/app/stays?prep=vip", icon: Crown, danger: true },
    { key: "timingMismatch", n: mismatch.length, href: mismatch[0] ? `/app/services/${mismatch[0].service}` : "/app/services", icon: CalendarClock, danger: true },
    { key: "bookings", n: bookings.count ?? 0, href: "/app/bookings", icon: CalendarPlus, danger: true },
    { key: "lowReviewsGuest", n: lowGuest.count ?? 0, href: "/app/satisfaction?kind=guest&filter=to_handle", icon: Star, danger: true },
    { key: "lowReviewsOwner", n: lowOwner.count ?? 0, href: "/app/satisfaction?kind=owner&filter=to_handle", icon: Star, danger: true },
    { key: "messages", n: messages.count ?? 0, href: "/app/stays", icon: MessageSquare, danger: true },
    { key: "unassigned", n: unassigned.count ?? 0, href: "/app/missions", icon: UserRoundX, danger: true },
    { key: "emails", n: outbox.count ?? 0, href: "/app/notifications?audience=guest", icon: MailWarning, danger: false },
    { key: "teamEmails", n: teamOutbox.count ?? 0, href: "/app/notifications?audience=team", icon: MailWarning, danger: false },
    { key: "stays7", n: stays.count ?? 0, href: "/app/stays", icon: CalendarDays, danger: false },
    { key: "testEmails", n: testOutbox.count ?? 0, href: "/app/notifications", icon: MailWarning, danger: false },
  ] as const;
  const alertOf = { toValidate: "unassigned_missions", chats: "unread_messages", schedule: "unassigned_missions", availability: "unassigned_missions", availabilityRisks: "unassigned_missions", absenceRequests: "unassigned_missions", incidents: "pending_services", services: "pending_services", messages: "unread_messages", unassigned: "unassigned_missions", emails: "failed_emails", teamEmails: "failed_emails", prepReview: "pending_services", prepDue: "pending_services", vipRequests: "pending_services", timingMismatch: "pending_services", bookings: "pending_services", lowReviewsGuest: "pending_services", lowReviewsOwner: "pending_services", stays7: "upcoming_stays", testEmails: "failed_emails" } as const;
  // Alertes choisies à l'onboarding ; les demandes et messages voyageurs restent toujours visibles
  const always = ["toValidate", "chats", "services", "prepReview", "prepDue", "vipRequests", "timingMismatch", "bookings", "lowReviewsGuest", "lowReviewsOwner", "messages", "incidents", "schedule", "availability", "availabilityRisks", "absenceRequests"];
  const rows = allRows.filter((r) => !enabled || always.includes(r.key) || enabled.includes(alertOf[r.key]));
  // Hiérarchie de l'accueil : ce qui demande une décision d'abord (ordre d'urgence), puis les informations,
  // et les catégories sans élément regroupées dans une zone repliable (toujours accessibles)
  const ORDER = ["incidents", "timingMismatch", "schedule", "availability", "toValidate", "services", "bookings", "absenceRequests", "prepDue", "prepReview", "vipRequests", "chats", "messages", "unassigned", "lowReviewsGuest", "lowReviewsOwner"];
  const active = rows.filter((r) => r.n > 0 && r.danger).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const info = rows.filter((r) => r.n > 0 && !r.danger);
  const calm = rows.filter((r) => r.n === 0);
  // Détail des éléments les plus fréquents : missions à valider et incidents urgents (logement, mission, échéance)
  const [{ data: doneList }, { data: urgentList }] = await Promise.all([
    (toValidate.count ?? 0) > 0
      ? supabase.from("tasks").select("id, type, title, completed_at, properties(name)").eq("organization_id", org.id).eq("status", "done").order("completed_at").limit(3)
      : Promise.resolve({ data: [] as never[] }),
    (incidents.count ?? 0) > 0
      ? supabase.from("incidents").select("id, description, urgent, created_at, properties(name)").eq("organization_id", org.id).neq("status", "resolved").order("urgent", { ascending: false }).order("created_at").limit(3)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const tt = await getTranslations("taskType");
  const pname = (x: unknown) => ((Array.isArray(x) ? x[0] : x) as { name: string } | null)?.name ?? "";
  const fmt = await getFormatter();
  const when = (x: string) => fmt.dateTime(new Date(x), { dateStyle: "short", timeStyle: "short" });
  const details: Record<string, { id: string; text: string; href: string }[]> = {
    toValidate: (doneList ?? []).map((k: { id: string; type: string; title: string | null; completed_at: string | null; properties: unknown }) => ({
      id: k.id,
      text: t("home.detail.toValidate", { mission: k.title || tt(k.type), property: pname(k.properties), date: k.completed_at ? when(k.completed_at) : "—" }),
      href: `/app/missions/${k.id}`,
    })),
    incidents: (urgentList ?? []).map((i: { id: string; description: string; urgent: boolean; created_at: string; properties: unknown }) => ({
      id: i.id,
      text: t(i.urgent ? "home.detail.incidentUrgent" : "home.detail.incident", { text: i.description.length > 70 ? `${i.description.slice(0, 70)}…` : i.description, property: pname(i.properties), date: when(i.created_at) }),
      href: "/app/incidents",
    })),
  };

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
      <section className="mb-6" data-testid="home-now">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t("home.nowTitle")}</h2>
        {active.length === 0 ? (
          <Card className="p-4 text-[15px] text-muted" data-testid="home-now-empty">{t("home.nowEmpty")}</Card>
        ) : (
          <Card className="divide-y divide-line">
            {active.map(({ key, n, href, icon: Icon }) => (
              <div key={key} className="px-4 py-3.5 md:px-5" data-testid={`home-${key}`} data-active="1">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-danger-soft text-danger">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{t(`home.${key}`, { count: n })}</span>
                    {t.has(`home.why.${key}`) && <span className="block text-[13px] text-muted">{t(`home.why.${key}`)}</span>}
                    {(details[key] ?? []).length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[13px]" data-testid="home-details">
                        {details[key].map((d) => (
                          <li key={d.id}>
                            <Link href={d.href} className="text-fg hover:underline">{d.text}</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                  <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[14px] font-medium text-accent-text hover:underline" data-testid={`home-cta-${key}`}>
                    {t.has(`home.cta.${key}`) ? t(`home.cta.${key}`) : t("home.cta.open")}
                    <ArrowRight className="size-4 rtl:-scale-x-100" />
                  </Link>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t("home.arrivalsTitle")}</h2>
        <ArrivalsNow supabase={supabase} orgId={org.id} now={now} linenRequired={linenRequired} planning={planning} />
      </section>

      {info.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t("home.infoTitle")}</h2>
          <Card className="divide-y divide-line">
            {info.map(({ key, n, href, icon: Icon }) => (
              <Link key={key} href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover md:px-5" data-testid={`home-${key}`}>
                <Icon className="size-[18px] text-muted" />
                <span className="flex-1 text-[15px]">{t(`home.${key}`, { count: n })}</span>
                <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
              </Link>
            ))}
          </Card>
        </section>
      )}

      <details className="group rounded-xl border border-line bg-surface" data-testid="home-calm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] text-muted md:px-5">
          <span className="flex-1">{t("home.calmTitle", { count: calm.length })}</span>
          <ArrowRight className="size-4 transition-transform group-open:rotate-90" />
        </summary>
        <div className="divide-y divide-line border-t border-line">
          {calm.map(({ key, n, href }) => (
            <Link key={key} href={href} className="flex items-center gap-3 px-4 py-2.5 text-[14px] text-muted hover:bg-surface-hover md:px-5" data-testid={`home-${key}`}>
              <span className="flex-1">{t(`home.${key}`, { count: n })}</span>
            </Link>
          ))}
        </div>
      </details>
    </>
  );
}
