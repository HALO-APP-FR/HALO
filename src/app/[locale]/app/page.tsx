import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, ClipboardList, Crown, ClipboardCheck, MessagesSquare, CalendarClock, CalendarDays, CalendarX2, ConciergeBell, MailWarning, MessageSquare, Settings2, TriangleAlert, UserRoundX, CalendarPlus, Star, Timer, CircleCheck } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { CreateOrgCard } from "@/components/connected/create-org";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { nowDate } from "@/lib/connected/time";
import { ArrivalsNow } from "@/components/connected/arrivals-now";
import { loadPlanning } from "@/lib/connected/planning";
import { unreadThreads } from "@/lib/connected/chat";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { windowText } from "@/lib/connected/format";
import { overrunAlert } from "@/lib/engine/overrun";
import { conflictGroup } from "@/lib/engine/availability";

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
  const [urgentInc, followInc, running, soon, keptRes, alertRes, ackRes] = await Promise.all([
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("organization_id", org.id).neq("status", "resolved").eq("urgent", true),
    // Interventions validées dont l'incident reste ouvert : la résolution est une décision distincte du responsable
    supabase.from("incidents").select("id, description, properties(name), follow:tasks!incidents_follow_up_fk(status, validated_at)").eq("organization_id", org.id).neq("status", "resolved").not("follow_up_task_id", "is", null).limit(50),
    // Missions en cours : dépassement = durée estimée écoulée depuis le démarrage réel (aucune qualification de faute)
    supabase.from("tasks").select("id, type, title, started_at, duration_min, assignee_id, properties(name)").eq("organization_id", org.id).eq("status", "in_progress").not("started_at", "is", null).limit(100),
    // Missions prévues dans les 24 h (ou en cours)
    supabase.from("tasks").select("id, type, title, status, window_start, window_end, scheduled_start, assignee_id, properties(name, timezone)").eq("organization_id", org.id).in("status", ["unassigned", "assigned", "in_progress", "to_redo"]).lte("window_start", in24).gte("window_end", now.toISOString()).order("window_start").limit(8),
    // Migration 21 (lu à part : sans elle, réglages par défaut et aucune réponse connue)
    supabase.from("incidents").select("id, kept_open_at").eq("organization_id", org.id).neq("status", "resolved").not("kept_open_at", "is", null).limit(50),
    supabase.from("organizations").select("overrun_alert_min").eq("id", org.id).maybeSingle(),
    supabase.from("tasks").select("id, overrun_ack_at").eq("organization_id", org.id).eq("status", "in_progress").not("overrun_ack_at", "is", null).limit(100),
  ]);
  const keptOf = new Map(((keptRes.data ?? []) as { id: string; kept_open_at: string }[]).map((k) => [k.id, k.kept_open_at]));
  const alertMin = ((alertRes.data ?? null) as { overrun_alert_min: number } | null)?.overrun_alert_min ?? 30;
  const ackOf = new Map(((ackRes.data ?? []) as { id: string; overrun_ack_at: string }[]).map((k) => [k.id, k.overrun_ack_at]));
  // Règle : intervention validée, incident ouvert, et pas « laissé ouvert » depuis cette validation
  const toResolve = (followInc.data ?? []).filter((i) => {
    const fu = (Array.isArray(i.follow) ? i.follow[0] : i.follow) as { status: string; validated_at: string | null } | null;
    const kept = keptOf.get(i.id as string);
    return fu?.status === "validated" && (!kept || (fu.validated_at !== null && kept < fu.validated_at));
  });
  // Règle : durée estimée écoulée depuis le démarrage réel + délai d'alerte de l'organisation, sans réponse de l'agent
  // depuis la fin estimée (« Oui, je continue » repousse l'alerte du même délai)
  const overrun = (running.data ?? []).filter((k) => overrunAlert(k.started_at as string, k.duration_min as number, ackOf.get(k.id as string) ?? null, alertMin, now.getTime()));
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
    { key: "incidentResolve", n: toResolve.length, href: "/app/incidents", icon: CircleCheck, danger: true },
    { key: "overrun", n: overrun.length, href: overrun[0] ? `/app/missions/${overrun[0].id}` : "/app/missions", icon: Timer, danger: true },
    // Planning : ménages impossibles, missions touchées par une absence, demandes d'absence — toujours visibles
    { key: "schedule", n: planning.schedule.length, href: "/app/missions", icon: CalendarX2, danger: true },
    { key: "availability", n: planning.availability.filter((c) => conflictGroup(c.kind) === "confirmed").length + planning.closureStays.length, href: "/app/team", icon: CalendarClock, danger: true },
    { key: "availabilityRisks", n: planning.availability.filter((c) => conflictGroup(c.kind) === "review").length, href: "/app/team", icon: CalendarClock, danger: false },
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
  const alertOf = { toValidate: "unassigned_missions", chats: "unread_messages", schedule: "unassigned_missions", availability: "unassigned_missions", availabilityRisks: "unassigned_missions", absenceRequests: "unassigned_missions", incidents: "pending_services", incidentResolve: "pending_services", overrun: "unassigned_missions", services: "pending_services", messages: "unread_messages", unassigned: "unassigned_missions", emails: "failed_emails", teamEmails: "failed_emails", prepReview: "pending_services", prepDue: "pending_services", vipRequests: "pending_services", timingMismatch: "pending_services", bookings: "pending_services", lowReviewsGuest: "pending_services", lowReviewsOwner: "pending_services", stays7: "upcoming_stays", testEmails: "failed_emails" } as const;
  // Alertes choisies à l'onboarding ; les demandes et messages voyageurs restent toujours visibles
  const always = ["toValidate", "incidentResolve", "overrun", "chats", "services", "prepReview", "prepDue", "vipRequests", "timingMismatch", "bookings", "lowReviewsGuest", "lowReviewsOwner", "messages", "incidents", "schedule", "availability", "availabilityRisks", "absenceRequests"];
  const rows = allRows.filter((r) => !enabled || always.includes(r.key) || enabled.includes(alertOf[r.key]));
  // Hiérarchie de l'accueil : ce qui demande une décision d'abord (ordre d'urgence), puis les informations,
  // et les catégories sans élément regroupées dans une zone repliable (toujours accessibles)
  const ORDER = ["incidents", "timingMismatch", "schedule", "availability", "incidentResolve", "overrun", "toValidate", "services", "bookings", "absenceRequests", "prepDue", "prepReview", "vipRequests", "chats", "messages", "unassigned", "lowReviewsGuest", "lowReviewsOwner"];
  const active = rows.filter((r) => r.n > 0 && r.danger).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  // Urgent ou bloquant (règles explicites) : incident marqué urgent, horaire promis contradictoire, ménage impossible,
  // mission empêchée par une absence. Le reste attend une décision, sans être bloquant.
  const isUrgent = (key: string) => (key === "incidents" && (urgentInc.count ?? 0) > 0) || ["timingMismatch", "schedule", "availability"].includes(key);
  const urgent = active.filter((r) => isUrgent(r.key));
  const decide = active.filter((r) => !isUrgent(r.key));
  const info = rows.filter((r) => r.n > 0 && !r.danger);
  const calm = rows.filter((r) => r.n === 0);
  // Détail des éléments : ce qu'il faut pour décider (logement, mission, échéance), le reste dans la fiche
  const [{ data: doneList }, { data: urgentList }] = await Promise.all([
    (toValidate.count ?? 0) > 0
      ? supabase.from("tasks").select("id, type, title, completed_at, properties(name)").eq("organization_id", org.id).eq("status", "done").order("completed_at").limit(3)
      : Promise.resolve({ data: [] as never[] }),
    (incidents.count ?? 0) > 0
      ? supabase.from("incidents").select("id, description, urgent, created_at, properties(name)").eq("organization_id", org.id).neq("status", "resolved").order("urgent", { ascending: false }).order("created_at").limit(3)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  // Missions renvoyées après correction : signalées dans la carte « à valider »
  const doneIds = (doneList ?? []).map((k: { id: string }) => k.id);
  const { data: resub } = doneIds.length
    ? await supabase.from("task_events").select("task_id").eq("organization_id", org.id).eq("kind", "resubmitted").in("task_id", doneIds)
    : { data: [] as { task_id: string }[] };
  const resubmitted = new Set((resub ?? []).map((r) => r.task_id as string));
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const pname = (x: unknown) => ((Array.isArray(x) ? x[0] : x) as { name: string } | null)?.name ?? "";
  const fmt = await getFormatter();
  const when = (x: string) => fmt.dateTime(new Date(x), { dateStyle: "short", timeStyle: "short" });
  const short = (s: string) => (s.length > 70 ? `${s.slice(0, 70)}…` : s);
  const nameOf = (id: string | null) => (id ? planning.members.find((m) => m.id === id)?.name || t("home.noName") : t("home.nobody"));
  const details: Record<string, { id: string; text: string; href: string; tag?: string }[]> = {
    toValidate: (doneList ?? []).map((k: { id: string; type: string; title: string | null; completed_at: string | null; properties: unknown }) => ({
      id: k.id,
      text: t("home.detail.toValidate", { mission: k.title || tt(k.type), property: pname(k.properties), date: k.completed_at ? when(k.completed_at) : "—" }),
      href: `/app/missions/${k.id}`,
      tag: resubmitted.has(k.id) ? t("home.resubmitted") : undefined,
    })),
    incidents: (urgentList ?? []).map((i: { id: string; description: string; urgent: boolean; created_at: string; properties: unknown }) => ({
      id: i.id,
      text: t("home.detail.incident", { text: short(i.description), property: pname(i.properties), date: when(i.created_at) }),
      href: `/app/incidents#incident-${i.id}`,
      tag: i.urgent ? t("home.urgentTag") : undefined,
    })),
    incidentResolve: toResolve.slice(0, 3).map((i) => ({
      id: i.id as string,
      text: t("home.detail.incidentResolve", { text: short(i.description as string), property: pname(i.properties) }),
      href: `/app/incidents#incident-${i.id}`,
    })),
    overrun: overrun.slice(0, 3).map((k) => ({
      id: k.id as string,
      text: t("home.detail.overrun", {
        mission: (k.title as string) || tt(k.type as string),
        property: pname(k.properties),
        who: nameOf(k.assignee_id as string | null),
        minutes: Math.round((now.getTime() - new Date(k.started_at as string).getTime()) / 60_000 - (k.duration_min as number)),
      }),
      href: `/app/missions/${k.id}`,
    })),
  };

  const item = (r: (typeof active)[number], tone: "urgent" | "decide") => {
    const Icon = r.icon;
    return (
      <li key={r.key} className="rounded-xl border border-line bg-surface p-4 shadow-card md:p-5" data-testid={`home-${r.key}`} data-active="1" data-tone={tone}>
        <div className="flex items-start gap-3.5">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone === "urgent" ? "bg-danger-soft text-danger" : "bg-subtle text-fg dark:bg-surface-hover")}>
            <Icon className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold leading-snug">{t(`home.${r.key}`, { count: r.n })}</p>
            {t.has(`home.why.${r.key}`) && <p className="mt-0.5 text-[14px] text-muted">{t(`home.why.${r.key}`)}</p>}
            {(details[r.key] ?? []).length > 0 && (
              <ul className="mt-2.5 space-y-1.5 text-[14px]" data-testid="home-details">
                {details[r.key].map((d) => (
                  <li key={d.id}>
                    <Link href={d.href} className="group flex items-baseline gap-2 text-fg">
                      {d.tag && <span className={cn("shrink-0 rounded-full px-2 py-px text-[11px] font-semibold", tone === "urgent" || d.tag === t("home.urgentTag") ? "bg-danger text-white" : "bg-accent-soft text-accent-text")}>{d.tag}</span>}
                      <span className="min-w-0 group-hover:underline">{d.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={r.href}
              className={cn(buttonVariants({ variant: tone === "urgent" ? "danger" : "primary", size: "md" }), "mt-3.5")}
              data-testid={`home-cta-${r.key}`}
            >
              {t.has(`home.cta.${r.key}`) ? t(`home.cta.${r.key}`) : t("home.cta.open")}
              <ArrowRight className="rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title={t("home.title")} subtitle={`${org.name} · ${t("home.subtitle")}`} />
      {!onboardingDone && (
        <Link href="/app/onboarding" className="mb-6 flex items-center gap-3 rounded-xl border border-accent bg-accent-soft p-4" data-testid="onboarding-resume">
          <Settings2 className="size-5 text-accent-text" />
          <span className="flex-1">
            <span className="block text-[15px] font-semibold">{t("home.onboardingTitle")}</span>
            <span className="block text-[14px] text-muted">{org.onboarding?.step ? t("home.onboardingResume") : t("home.onboardingStart")}</span>
          </span>
          <ArrowRight className="size-5 text-accent-text rtl:-scale-x-100" />
        </Link>
      )}
      <div data-testid="home-now" className="space-y-8">
        {active.length === 0 && (
          <Card className="p-5 text-[15px] text-muted" data-testid="home-now-empty">{t("home.nowEmpty")}</Card>
        )}
        {urgent.length > 0 && (
          <section aria-labelledby="home-urgent-title" data-testid="home-urgent">
            <h2 id="home-urgent-title" className="mb-3 flex items-center gap-2 text-[17px] font-semibold">
              <span className="size-2 rounded-full bg-danger" aria-hidden />
              {t("home.urgentTitle")}
            </h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {urgent.map((r) => item(r, "urgent"))}
            </ul>
          </section>
        )}
        {decide.length > 0 && (
          <section aria-labelledby="home-decide-title" data-testid="home-decide">
            <h2 id="home-decide-title" className="mb-3 text-[17px] font-semibold">{t("home.decideTitle")}</h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {decide.map((r) => item(r, "decide"))}
            </ul>
          </section>
        )}
      </div>

      <section className="mt-10" aria-labelledby="home-today-title">
        <h2 id="home-today-title" className="mb-1 text-[17px] font-semibold">{t("home.todayTitle")}</h2>
        <p className="mb-3 text-[14px] text-muted">{t("home.arrivalsTitle")}</p>
        <ArrivalsNow supabase={supabase} orgId={org.id} now={now} linenRequired={linenRequired} planning={planning} />
        <h3 className="mb-2 mt-6 text-[14px] font-semibold text-muted">{t("home.soonTitle")}</h3>
        <Card className="divide-y divide-line" data-testid="home-soon">
          {(soon.data ?? []).length === 0 && <p className="p-4 text-[15px] text-muted">{t("home.soonEmpty")}</p>}
          {(soon.data ?? []).map((k) => {
            const tz = ((Array.isArray(k.properties) ? k.properties[0] : k.properties) as { timezone?: string } | null)?.timezone ?? undefined;
            return (
              <Link key={k.id} href={`/app/missions/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover md:px-5" data-testid="home-soon-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{(k.title as string) || tt(k.type as string)} · {pname(k.properties)}</span>
                  <span className="block truncate text-[13px] text-muted">{windowText(fmt, k.window_start as string, k.window_end as string, false, tz)} · {nameOf(k.assignee_id as string | null)}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium", k.status === "unassigned" ? "bg-warning-soft text-warning" : "bg-subtle dark:bg-surface-hover")}>{tts(k.status as string)}</span>
              </Link>
            );
          })}
          <Link href="/app/missions" className="flex items-center justify-between px-4 py-3 text-[14px] font-medium text-accent-text hover:bg-surface-hover md:px-5">
            {t("home.allMissions")}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        </Card>
      </section>

      <section className="mt-10" aria-labelledby="home-summary-title">
        <h2 id="home-summary-title" className="mb-3 text-[17px] font-semibold">{t("home.summaryTitle")}</h2>
        {info.length > 0 && (
          <Card className="mb-3 divide-y divide-line">
            {info.map(({ key, n, href, icon: Icon }) => (
              <Link key={key} href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover md:px-5" data-testid={`home-${key}`}>
                <Icon className="size-[18px] text-muted" />
                <span className="flex-1 text-[15px]">{t(`home.${key}`, { count: n })}</span>
                <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
              </Link>
            ))}
          </Card>
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
      </section>
    </>
  );
}
