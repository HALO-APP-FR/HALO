import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/halo/status-pill";
import { TaskTypeIcon, TASK_TYPE_META } from "@/components/halo/task-type";
import type { TaskStatus, TaskType } from "@/lib/domain/types";
import { MissionReport, type ReportRoom } from "@/components/connected/mission-report";
import { ReportIncident } from "@/components/connected/report-incident";
import { WindowEditor } from "@/components/connected/planning-forms";
import { AssignSelect, CancelTaskButton, EarlyStartForm } from "@/components/connected/mission-controls";
import { loadPlanning } from "@/lib/connected/planning";
import { absenceLevel } from "@/lib/engine/availability";
import { infeasibility } from "@/lib/engine/conflicts";
import { missionVsArrival } from "@/lib/engine/prep-conflicts";
import { toTask } from "@/lib/connected/mappers";
import { nowDate } from "@/lib/connected/time";
import { Card } from "@/components/ui/card";
import { MissionTiming } from "@/components/connected/mission-timing";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { MissionDirections } from "@/components/connected/directions";
import { ChatThread } from "@/components/connected/chat";
import { EndProposal, ForgottenMissionPanel, IncidentResolvePrompt, OverrunPrompt } from "@/components/connected/overrun";
import { loadThreadMessages, loadThreads } from "@/lib/connected/chat";
import { toChatMessages } from "@/lib/connected/chat-view";
import type { MapsApp } from "@/lib/engine/directions";
import { durationText, periodText, windowText, zoneLabel } from "@/lib/connected/format";

export default async function MissionPage({ params }: PageProps<"/[locale]/app/missions/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.mission");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const f = await getFormatter();
  const { supabase, org, user, profile } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  const o = org!.id;
  const manager = isManagerRole(org!.role);
  // La base ne renvoie la mission qu'à un manager ou à son agent assigné
  const { data: task } = await supabase
    .from("tasks")
    .select("id, type, title, status, window_start, window_end, duration_min, scheduled_start, is_auto_generated, assignee_id, next_reservation_id, correction_reason, notes, property_id, early_start_allowed_at, early_start_reason, started_at, completed_at, validated_at, properties(name, address_line, postal_code, city, country_code, latitude, longitude, timezone, instructions)")
    .eq("organization_id", o)
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();
  const withChecklist = task.type === "turnover" || task.type === "inspection";
  const [{ data: rooms }, { data: report }, { data: files }, { data: incidents }, { data: orgRow }, { data: source }, { data: events }] = await Promise.all([
    withChecklist
      ? supabase.from("checklist_rooms").select("id, name, sort, checklist_items(id, label, photo_required, sort)").eq("organization_id", o).eq("property_id", task.property_id).order("sort")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("task_reports").select("checked, comment").eq("organization_id", o).eq("task_id", id).maybeSingle(),
    supabase.from("files").select("id, path, checklist_item_id, created_at, superseded_at").eq("organization_id", o).eq("task_id", id).order("created_at"),
    supabase.from("incidents").select("id, category, status, description").eq("organization_id", o).eq("task_id", id).order("created_at", { ascending: false }),
    // Réglage réellement appliqué par la base à la fin de la mission
    supabase.from("organizations").select("validation_task_types").eq("id", o).single(),
    // Intervention : l'incident d'origine et son état (sa résolution reste une décision du responsable)
    manager ? supabase.from("incidents").select("id, status, description, source").eq("organization_id", o).eq("follow_up_task_id", id).maybeSingle() : Promise.resolve({ data: null }),
    // Historique : lisible par le responsable ET par l'agent affecté (la base le limite à ses missions)
    supabase.from("task_events").select("id, kind, at, note, actor_id").eq("organization_id", o).eq("task_id", id).order("at", { ascending: false }).limit(40),
  ]);
  // Dépassement, heure de fin proposée, incident laissé ouvert (migration 21) : lus à part, la fiche reste
  // affichable tant que la migration n'est pas appliquée (colonnes absentes → informations simplement non affichées)
  const [{ data: extra }, { data: kept }, { data: extra23 }] = await Promise.all([
    supabase.from("tasks").select("overrun_ack_at, end_proposed_at, end_proposed_note, end_proposal_status, reported_end_at").eq("organization_id", o).eq("id", id).maybeSingle(),
    source ? supabase.from("incidents").select("kept_open_at").eq("organization_id", o).eq("id", source.id).maybeSingle() : Promise.resolve({ data: null }),
    // Régularisation / annulation avec motif (migration 23) : lues à part pour la même raison
    supabase.from("tasks").select("regularized_at, regularized_by, regularized_reason, regularized_missing, cancel_reason, cancelled_at, cancelled_by").eq("organization_id", o).eq("id", id).maybeSingle(),
  ]);
  const x23 = (extra23 ?? null) as { regularized_at: string | null; regularized_by: string | null; regularized_reason: string | null; regularized_missing: string[] | null; cancel_reason: string | null; cancelled_at: string | null; cancelled_by: string | null } | null;
  const ex = (extra ?? null) as { overrun_ack_at: string | null; end_proposed_at: string | null; end_proposed_note: string | null; end_proposal_status: string | null; reported_end_at: string | null } | null;
  const keptOpenAt = ((kept ?? null) as { kept_open_at: string | null } | null)?.kept_open_at ?? null;
  const askResolve = Boolean(source && source.status !== "resolved" && task.status === "validated" && (!keptOpenAt || (task.validated_at && keptOpenAt < task.validated_at)));
  const overrunMin = task.status === "in_progress" && task.started_at && task.duration_min > 0 ? Math.round((nowDate().getTime() - Date.parse(task.started_at)) / 60_000) - task.duration_min : null;
  const tov = await getTranslations("connected.overrun");
  const tfg = await getTranslations("connected.forgotten");
  const tsm = await getTranslations("connected.taskStep.missing");
  const taskTz = ((Array.isArray(task.properties) ? task.properties[0] : task.properties) as { timezone?: string | null } | null)?.timezone ?? null;
  const hm = (x: string) => f.dateTime(new Date(x), { hour: "2-digit", minute: "2-digit", ...(taskTz ? { timeZone: taskTz } : {}) });
  // Règle et exigences réellement appliquées par la base (démarrage, fin)
  const [{ data: reqRaw }, { data: ruleRaw }] = await Promise.all([
    supabase.rpc("task_requirements", { org: o, task: id }),
    supabase.rpc("task_rule", { org: o, t: task.type }),
  ]);
  const requirements = (reqRaw as { checklist: { required: boolean; total: number; done: number }; photos_missing: number; comment: { required: boolean; present: boolean } } | null) ?? null;
  const startRule = ((ruleRaw as { start_rule?: string } | null)?.start_rule ?? "recommended") as "firm" | "recommended";
  // Compatibilité avec l'arrivée confirmée du séjour suivant (alerte, jamais de recalcul)
  let arrivalCheck: ReturnType<typeof missionVsArrival> | null = null;
  let arrivalAt: string | null = null;
  if (task.next_reservation_id && !["check_in", "check_out"].includes(task.type) && ["unassigned", "assigned", "in_progress", "to_redo"].includes(task.status)) {
    const { data: nr } = await supabase.from("reservations").select("check_in_at, status").eq("organization_id", o).eq("id", task.next_reservation_id).maybeSingle();
    if (nr && nr.status === "confirmed") {
      arrivalAt = nr.check_in_at as string;
      arrivalCheck = missionVsArrival(
        { id: task.id, status: task.status, windowStart: task.window_start, windowEnd: task.window_end, durationMin: task.duration_min, scheduledStart: task.scheduled_start ?? undefined, assigneeId: task.assignee_id ?? undefined, isAutoGenerated: task.is_auto_generated },
        arrivalAt,
        nowDate(),
      );
    }
  }
  const notYetOpen = Date.parse(task.window_start) > nowDate().getTime();
  // Plage modifiée PAR UNE PERSONNE (un recalcul automatique n'a pas d'auteur et n'en fait pas une plage « manuelle »)
  // Origine de la plage — UNE seule source de vérité, la même que la fiche séjour et que le recalcul :
  // mission automatique (recalculée quand les séjours changent) ou manuelle (jamais recalculée).
  const windowOrigins = (events ?? [])
    .filter((e: { kind: string }) => e.kind === "window_changed")
    .map((e: { note: string | null }) => {
      try {
        return (JSON.parse(e.note ?? "{}") as { origin?: string }).origin ?? "unknown";
      } catch {
        return "unknown";
      }
    });
  const windowEdited = !task.is_auto_generated && windowOrigins.includes("manual");
  const windowSource: "auto" | "auto_timing" | "created" | "edited" = !task.is_auto_generated ? (windowEdited ? "edited" : "created") : windowOrigins[0] === "timing" ? "auto_timing" : "auto";
  const needsValidation = ((orgRow?.validation_task_types as string[] | undefined) ?? []).includes(task.type);
  const ti = await getTranslations("connected.incidents");
  const th = await getTranslations("connected.missionHistory");
  const paths = (files ?? []).map((x) => x.path);
  const signed = paths.length ? (await supabase.storage.from("org-files").createSignedUrls(paths, 900)).data ?? [] : [];
  const urlOf = new Map(signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  // Seules les photos réellement déposées (lisibles) comptent
  const readable = (files ?? []).filter((x) => urlOf.has(x.path));
  const photos = readable.filter((x) => !x.superseded_at).map((x) => ({ id: x.id, itemId: x.checklist_item_id, url: urlOf.get(x.path)! }));
  // Preuves écartées par une demande de correction : gardées en historique, elles ne comptent plus
  const oldPhotos = readable.filter((x) => x.superseded_at).map((x) => ({ id: x.id, itemId: x.checklist_item_id, url: urlOf.get(x.path)! }));
  const p = (Array.isArray(task.properties) ? task.properties[0] : task.properties) as {
    name: string; address_line: string | null; postal_code: string | null; city: string | null; country_code: string | null;
    latitude: number | null; longitude: number | null; timezone: string | null; instructions: string | null;
  } | null;
  // Conversations internes rattachées à cette mission (jamais visibles du voyageur)
  const threads = await loadThreads(supabase, o, user!.id, { taskId: id });
  const threadMessages = await Promise.all(threads.map(async (th) => toChatMessages(th, await loadThreadMessages(supabase, o, th.id), user!.id)));
  const tc = await getTranslations("connected.chat");
  const ta = await getTranslations("connected.absences");
  const tm = await getTranslations("connected.missions");
  const tc2 = await getTranslations("connected.arrivalConflict");
  // Responsable : affectation, conflit d'absence et actions possibles, au même endroit
  let assign: React.ReactNode = null;
  if (manager && ["unassigned", "assigned", "to_redo"].includes(task.status)) {
    const now = nowDate();
    const [{ data: full }, planning] = await Promise.all([supabase.from("tasks").select("*").eq("organization_id", o).eq("id", id).single(), loadPlanning(supabase, o, now)]);
    const slot = { windowStart: full!.window_start, windowEnd: full!.window_end, durationMin: full!.duration_min, scheduledStart: full!.scheduled_start };
    const reasons: Record<string, string> = {};
    const partial: Record<string, string> = {};
    let assigneeLevel: ReturnType<typeof absenceLevel> | null = null;
    for (const m of planning.members) {
      const lv = absenceLevel(m, slot, planning.absences, ["accepted"], now);
      if (m.id === full!.assignee_id) assigneeLevel = lv;
      if (lv.level === "none") continue;
      const a = lv.absences[0];
      const txt = `${ta(`kinds.${a.kind}`)} ${periodText(f, a.startsAt, a.endsAt)}`;
      if (lv.level === "conflict") reasons[m.id] = txt;
      else partial[m.id] = txt;
    }
    const conflict = full!.assignee_id && reasons[full!.assignee_id];
    const risk = full!.assignee_id && partial[full!.assignee_id];
    // Ce qui fonde la conclusion : fenêtre, durée, temps libre restant, horaire planifié éventuel
    const basis = assigneeLevel && assigneeLevel.level !== "none"
      ? full!.scheduled_start
        ? tm("basisScheduled", { slot: periodText(f, full!.scheduled_start, new Date(Date.parse(full!.scheduled_start) + full!.duration_min * 60_000).toISOString()) })
        : tm(assigneeLevel.period.fromNow ? "basisWindowFromNow" : "basisWindow", { window: periodText(f, assigneeLevel.period.from, assigneeLevel.period.to), free: durationText(assigneeLevel.freeMin ?? 0), duration: durationText(full!.duration_min) })
      : null;
    // Personnes sans absence connue sur ce créneau, avec leurs autres missions sur la même fenêtre (contrainte connue).
    // Le temps de trajet n'est pas calculé : il n'est jamais promis.
    const free = planning.members.filter((m) => !reasons[m.id] && !partial[m.id] && m.id !== full!.assignee_id);
    const { data: overlapping } = free.length
      ? await supabase
          .from("tasks")
          .select("assignee_id")
          .eq("organization_id", o)
          .in("assignee_id", free.map((m) => m.id))
          .in("status", ["assigned", "in_progress", "to_redo"])
          .neq("id", id)
          .lt("window_start", full!.window_end)
          .gt("window_end", full!.window_start)
      : { data: [] as { assignee_id: string }[] };
    const busyCount = (uid: string) => (overlapping ?? []).filter((x) => x.assignee_id === uid).length;
    const needsCover = Boolean(conflict) || Boolean(risk) || full!.status === "unassigned";
    assign = (
      <Card className={conflict ? "mb-4 space-y-3 border-danger p-4" : "mb-4 space-y-3 p-4"} data-testid="mission-assign">
        {conflict && (
          <div role="alert" data-testid="mission-absence-conflict">
            <p className="text-[15px] font-semibold text-danger">{tm("conflictTitle", { name: planning.members.find((m) => m.id === full!.assignee_id)?.name || "—" })}</p>
            <p className="text-[14px]">{conflict}</p>
            {basis && <p className="mt-1 text-[13px]" data-testid="mission-absence-basis">{basis}</p>}
            <p className="mt-1 text-[13px] text-muted">{tm("conflictActions")}</p>
          </div>
        )}
        {!conflict && risk && (
          <div className="rounded-md border border-warning bg-warning-soft p-3" role="status" data-testid="mission-absence-risk">
            <p className="text-[15px] font-semibold">{full!.status === "in_progress" ? tm("riskStartedTitle", { name: planning.members.find((m) => m.id === full!.assignee_id)?.name || "—" }) : tm("riskTitle", { name: planning.members.find((m) => m.id === full!.assignee_id)?.name || "—" })}</p>
            <p className="text-[14px]">{risk}</p>
            {basis && <p className="mt-1 text-[13px]" data-testid="mission-absence-basis">{basis}</p>}
            <p className="mt-1 text-[13px] text-muted">{tm("riskActions")}</p>
          </div>
        )}
        {needsCover && (
          <div className="text-[14px]" data-testid="mission-suggestions">
            <p className="font-medium">{tm("suggestTitle")}</p>
            {free.length === 0 ? (
              <p className="text-muted">{tm("suggestNone")}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {free.slice(0, 6).map((m) => (
                  <li key={m.id} data-testid="mission-suggestion">
                    {m.name || tm("noName")} · <span className="text-muted">{busyCount(m.id) ? tm("suggestBusy", { count: busyCount(m.id) }) : tm("suggestFree")}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[12px] text-muted">{tm("suggestLimits")}</p>
          </div>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <AssignSelect
            taskId={task.id}
            current={full!.assignee_id}
            members={planning.members.map((m) => ({ id: m.id, name: m.name || tm("noName") }))}
            disabled={!["unassigned", "assigned"].includes(task.status)}
            outOfWindow={Boolean(infeasibility(toTask(full!), now))}
            durationMin={full!.duration_min}
            unavailable={Object.keys(reasons)}
            reasons={reasons}
            partial={partial}
            timeZone={p?.timezone ?? undefined}
          />
          <CancelTaskButton taskId={task.id} />
        </div>
      </Card>
    );
  }
  const checklist: ReportRoom[] = (rooms ?? []).map((r: { id: string; name: string; checklist_items: { id: string; label: string; photo_required: boolean; sort: number }[] }) => ({
    id: r.id,
    name: r.name,
    items: [...r.checklist_items].sort((a, b) => a.sort - b.sort).map((i) => ({ id: i.id, label: i.label, photoRequired: i.photo_required })),
  }));
  const mine = task.assignee_id === user!.id;
  // Dernière demande de correction (date) et points désignés : ceux dont la preuve a été écartée par le responsable
  const lastCorrection = (events ?? []).find((e: { kind: string }) => e.kind === "correction_requested") as { at: string } | undefined;
  const oldItemIds = new Set(oldPhotos.map((x) => x.itemId).filter(Boolean));
  const redoItems = checklist.flatMap((r) => r.items.filter((i) => oldItemIds.has(i.id)).map((i) => `${r.name} — ${i.label}`));
  let assigneeName: string | null = null;
  if (manager && task.assignee_id) {
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", task.assignee_id).maybeSingle();
    assigneeName = (prof?.full_name as string | null) || tm("noName");
  }
  return (
    <>
      <Link href="/app/missions" className="mb-3 inline-block text-[14px] text-accent-text hover:underline">
        ← {t("back")}
      </Link>
      {/* En-tête dans l'esprit de la démo : type et statut, logement mis en avant, l'intitulé seulement s'il existe */}
      <header className="relative mb-5 overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-card md:p-6" data-testid="mission-hero">
        <span className={cn("absolute inset-y-0 start-0 w-1", TASK_TYPE_META[task.type as TaskType]?.bar)} aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn("flex items-center gap-2 text-[15px] font-semibold", TASK_TYPE_META[task.type as TaskType]?.text)}>
            <TaskTypeIcon type={task.type as TaskType} size="sm" />
            {tt(task.type)}
          </span>
          <StatusPill status={task.status as TaskStatus} />
        </div>
        <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-[-0.01em] md:text-title-1">{task.title || p?.name}</h1>
        {task.title && <p className="text-[16px] font-medium text-muted">{p?.name}</p>}
        {p?.address_line && <p className="mt-1 text-[14px] text-muted">{[p.address_line, p.city].filter(Boolean).join(", ")}</p>}
      </header>
      {/* Correction demandée : en haut de la fiche, tant qu'elle n'a pas été renvoyée */}
      {mine && (task.status === "to_redo" || task.status === "in_progress") && task.correction_reason && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft p-4 text-[15px]" role="status" data-testid="correction-banner" data-status={task.status}>
          <p className="font-semibold">
            {t("correctionTitle")}
            {lastCorrection && (
              <span className="ms-1 font-normal text-muted" data-testid="correction-at">
                · {f.dateTime(new Date(lastCorrection.at), { dateStyle: "medium", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) })}
              </span>
            )}
          </p>
          <p className="whitespace-pre-wrap" data-testid="correction-reason-shown">{task.correction_reason}</p>
          {redoItems.length > 0 && <p className="mt-1 text-[14px]" data-testid="correction-items-shown">{t("correctionItems", { items: redoItems.join(", ") })}</p>}
          <p className="mt-1 text-[14px] text-muted">{t(task.status === "to_redo" ? "correctionNext" : "correctionNextInProgress")}</p>
        </div>
      )}
      {mine && task.status === "in_progress" && task.started_at && (
        <OverrunPrompt taskId={task.id} startedAt={task.started_at} durationMin={task.duration_min} ackAt={ex?.overrun_ack_at ?? null} timeZone={p?.timezone ?? undefined} />
      )}
      {manager && overrunMin !== null && overrunMin > 0 && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft p-4 text-[15px]" role="status" data-testid="overrun-status">
          <p className="font-semibold">{tov("managerTitle", { minutes: overrunMin })}</p>
          <p className="mt-1 text-[14px]">
            {tov("managerText", { since: hm(task.started_at!), duration: durationText(task.duration_min) })}{" "}
            {ex?.overrun_ack_at && Date.parse(ex.overrun_ack_at) >= Date.parse(task.started_at!) + task.duration_min * 60_000
              ? tov("managerAck", { at: hm(ex.overrun_ack_at) })
              : tov("managerNoAnswer")}
          </p>
          <p className="mt-1 text-[13px] text-muted">{tov("managerHint")}</p>
        </div>
      )}
      {manager && task.status === "in_progress" && task.started_at && (
        <ForgottenMissionPanel taskId={task.id} startedAt={task.started_at} durationMin={task.duration_min} proposedAt={ex?.end_proposal_status === "pending" ? ex.end_proposed_at : null} missing={(requirements ? ([requirements.photos_missing > 0 ? "photos" : null, requirements.checklist.required && requirements.checklist.done < requirements.checklist.total ? "checklist" : null, requirements.comment.required && !requirements.comment.present ? "comment" : null].filter(Boolean) as string[]) : []).map((k) => tsm(k))} timeZone={p?.timezone ?? undefined} />
      )}
      {x23?.regularized_at && (manager || mine) && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft p-4 text-[15px]" role="status" data-testid="task-regularized">
          <p className="font-semibold">{tfg("regularizedTitle")}</p>
          <p className="mt-1 text-[14px]">
            {tfg("regularizedText", {
              end: f.dateTime(new Date(task.completed_at ?? x23.regularized_at), { dateStyle: "medium", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) }),
              at: f.dateTime(new Date(x23.regularized_at), { dateStyle: "medium", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) }),
            })}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[14px]" data-testid="task-regularized-reason">« {x23.regularized_reason} »</p>
          {(x23.regularized_missing ?? []).length > 0 ? (
            <p className="mt-1 text-[14px] font-medium text-danger" data-testid="task-regularized-missing">{tfg("regularizedMissing", { items: (x23.regularized_missing ?? []).map((k) => (tsm.has(k) ? tsm(k) : k)).join(", ") })}</p>
          ) : (
            <p className="mt-1 text-[14px]">{tfg("regularizedComplete")}</p>
          )}
        </div>
      )}
      {task.status === "cancelled" && x23?.cancel_reason && (manager || mine) && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-4 text-[15px]" role="status" data-testid="task-cancel-reason">
          <p className="font-semibold">{tfg("cancelledTitle", { at: f.dateTime(new Date(x23.cancelled_at ?? task.window_start), { dateStyle: "medium", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) }) })}</p>
          <p className="mt-1 whitespace-pre-wrap text-[14px]">« {x23.cancel_reason} »</p>
        </div>
      )}
      {ex?.end_proposal_status && ex.end_proposed_at && (manager || mine) && (
        <EndProposal taskId={task.id} declaredAt={((events ?? []).find((e: { kind: string }) => e.kind === "end_proposed") as { at: string } | undefined)?.at ?? null} proposedAt={ex.end_proposed_at} note={ex.end_proposed_note} status={ex.end_proposal_status} canDecide={manager} timeZone={p?.timezone ?? undefined} />
      )}
      {askResolve && source && <IncidentResolvePrompt incidentId={source.id} description={source.description} fromGuest={source.source === "guest"} />}
      {/* Deux informations distinctes : la fenêtre pendant laquelle la mission doit être faite, et la durée de travail estimée */}
      <div className="mb-4 flex flex-wrap items-start gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-5 text-[15px] shadow-card" data-testid="mission-timing">
        <div className="basis-full">
          <MissionTiming
            task={task}
            timeZone={p?.timezone ?? undefined}
            assignee={manager ? (assigneeName ?? null) : undefined}
            startRule={startRule}
            source={windowSource}
            derogation={task.early_start_allowed_at ? (task.early_start_reason as string | null) ?? "" : null}
          />
          {zoneLabel(p?.timezone, new Date(task.window_start)) && (
            <span className="mt-1 block text-[12px] text-muted" data-testid="mission-zone">{tm("localTime", { zone: zoneLabel(p?.timezone, new Date(task.window_start))! })}</span>
          )}
        </div>
        <p>
          <span className="block text-[13px] font-medium text-muted">{t("closing")}</span>
          <span data-testid="mission-validation-rule">{needsValidation ? t("needsValidation") : t("autoValidated")}</span>
        </p>
        {manager && !["done", "validated", "cancelled"].includes(task.status) && (
          <div className="basis-full">
            <WindowEditor taskId={task.id} start={task.window_start} end={task.window_end} durationMin={task.duration_min} timeZone={p?.timezone ?? undefined} />
            {!task.is_auto_generated && <p className="mt-1 text-[13px] text-muted" data-testid="mission-window-edited">{t("manualWindow")}</p>}
            {startRule === "firm" && ["unassigned", "assigned"].includes(task.status) && !task.early_start_allowed_at && notYetOpen && (
              <EarlyStartForm taskId={task.id} />
            )}
          </div>
        )}
      </div>
      {arrivalCheck && arrivalAt && arrivalCheck.level !== "possible" && (
        <div
          className={`mb-4 rounded-xl border p-4 text-[14px] ${arrivalCheck.level === "impossible" ? "border-danger bg-danger-soft" : "border-warning bg-warning-soft"}`}
          role="alert"
          data-testid="mission-arrival-conflict"
          data-level={arrivalCheck.level}
        >
          <p className="font-semibold">{tc2(`level.${arrivalCheck.level}`)}</p>
          <p>
            {tc2("summary", {
              arrival: f.dateTime(new Date(arrivalAt), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(p?.timezone ? { timeZone: p.timezone } : {}) }),
              from: f.dateTime(new Date(task.window_start), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(p?.timezone ? { timeZone: p.timezone } : {}) }),
              duration: durationText(task.duration_min),
            })}
          </p>
          <ul className="mt-1 list-disc ps-5">
            {arrivalCheck.reasons.map((r) => (
              <li key={r}>{tc2(`reason.${r}`)}</li>
            ))}
          </ul>
          {arrivalCheck.manual && <p className="mt-1">{tc2("manual")}</p>}
          <p className="mt-1 text-muted">{tc2(manager ? "actionManager" : "actionAgent")}</p>
        </div>
      )}
      {assign}
      {source && (
        <Link href={`/app/incidents#incident-${source.id}`} className="mb-4 block rounded-xl border border-line bg-surface p-4 hover:bg-surface-hover" data-testid="mission-source-incident">
          <span className="block text-[13px] font-medium text-muted">{t("sourceIncident")}</span>
          <span className="block text-[15px]">{source.description}</span>
          <span className="mt-1 block text-[13px]" data-testid="mission-source-status">
            {ti(`status.${source.status}`)} · {source.status === "resolved" ? t("incidentResolved") : t("incidentStillOpen")}
          </span>
        </Link>
      )}
      {(p?.address_line || p?.city) && (
        <p className="-mt-2 mb-3 flex items-center gap-2 text-[15px] text-muted" data-testid="mission-address">
          <MapPin className="size-4" />
          {[p?.address_line, [p?.postal_code, p?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
        </p>
      )}
      {/* Toute mission se déroule au logement : itinéraire proposé, adresse envoyée seulement au geste de l'agent */}
      {p && task.status !== "cancelled" && (
        <div className="mb-4">
          <MissionDirections
            destination={{ name: p.name, addressLine: p.address_line ?? undefined, postalCode: p.postal_code ?? undefined, city: p.city ?? undefined, countryCode: p.country_code ?? undefined, lat: p.latitude ?? undefined, lng: p.longitude ?? undefined }}
            preferred={((profile as { maps_app?: string | null } | null)?.maps_app as MapsApp | null) ?? null}
          />
        </div>
      )}
      {task.notes && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft p-4" data-testid="mission-notes">
          <h2 className="text-[13px] font-medium text-muted">{t("notes")}</h2>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{task.notes}</p>
        </div>
      )}
      {p?.instructions && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-[13px] font-medium text-muted">{t("instructions")}</h2>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{p.instructions}</p>
        </div>
      )}
      <MissionReport
        taskId={task.id}
        status={task.status}
        correctionReason={task.correction_reason}
        checklist={checklist}
        checked={(report?.checked as string[]) ?? []}
        photos={photos}
        oldPhotos={oldPhotos}
        canEdit={mine && ["assigned", "in_progress", "to_redo"].includes(task.status)}
        canStart={mine && ["assigned", "to_redo"].includes(task.status)}
        canFinish={mine && task.status === "in_progress"}
        canReview={manager && task.status === "done"}
        canReopen={manager && (task.status === "done" || task.status === "validated")}
        requirements={requirements}
        comment={(report?.comment as string | null) ?? null}
        timeZone={p?.timezone ?? undefined}
        mine={mine}
        correctionAt={lastCorrection ? f.dateTime(new Date(lastCorrection.at), { dateStyle: "medium", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) }) : null}
        redoItems={redoItems}
      />
      {(manager || mine) && (events ?? []).length > 0 && (
        <Card className="mt-4 p-5" data-testid="mission-history">
          <h2 className="text-[17px] font-semibold">{th("title")}</h2>
          <ul className="mt-2 space-y-1.5 text-[14px] text-muted">
            {(events ?? []).map((e: { id: number; kind: string; at: string; note: string | null; actor_id: string | null }) => {
              let extra = "";
              if (e.kind === "window_changed" && e.note) {
                try {
                  const n = JSON.parse(e.note) as { to: [string, string, number]; reason: string | null; origin?: string };
                  extra = ` — ${th(`origin.${["sync", "timing", "manual"].includes(n.origin ?? "") ? n.origin : "unknown"}`)} · ${windowText(f, n.to[0], n.to[1])} · ${durationText(n.to[2])}${n.reason ? ` · « ${n.reason} »` : ""}`;
                } catch {
                  extra = "";
                }
              } else if (["correction_requested", "early_start_allowed", "end_regularized", "cancelled"].includes(e.kind) && e.note) extra = ` — « ${e.note} »`;
              else if (["end_proposed", "end_accepted", "end_rejected"].includes(e.kind) && e.note) extra = ` — ${f.dateTime(new Date(e.note), { dateStyle: "short", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) })}`;
              // Auteur : l'agent affecté, un responsable, ou le système (synchronisation)
              const who = !e.actor_id ? th("bySystem") : e.actor_id === user!.id ? th("byYou") : e.actor_id === task.assignee_id ? th("byAgent", { name: assigneeName ?? th("agent") }) : th("byManager");
              return (
                <li key={e.id} data-testid="history-event" data-kind={e.kind}>
                  <span className="text-fg">{f.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short", ...(p?.timezone ? { timeZone: p.timezone } : {}) })}</span> · {th(`kind.${e.kind}`)} · {who}
                  {extra}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {(threads.length > 0 || manager) && (
        <Card className="mt-4 space-y-4 p-5" data-testid="mission-chat">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-[17px] font-semibold">{tc("missionTitle")}</h2>
            {manager && (
              <Link href={`/app/messages?task=${task.id}`} className="text-[14px] text-accent-text hover:underline" data-testid="mission-chat-new">
                {tc("newForMission")}
              </Link>
            )}
          </div>
          {threads.length === 0 && <p className="text-[14px] text-muted">{tc("noneForMission")}</p>}
          {threads.map((th, i) => (
            <div key={th.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
              <p className="mb-2 text-[13px] text-muted">{th.members.map((m) => m.name || tc("noName")).join(", ")}</p>
              <ChatThread threadId={th.id} messages={threadMessages[i]} meId={user!.id} canWrite={th.mine || manager} />
            </div>
          ))}
        </Card>
      )}
      {(mine || manager) && task.status !== "cancelled" && (
        <div className="mt-4">
          <ReportIncident taskId={task.id} reported={incidents ?? []} />
        </div>
      )}
    </>
  );
}
