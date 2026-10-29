import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { MissionReport, type ReportRoom } from "@/components/connected/mission-report";
import { ReportIncident } from "@/components/connected/report-incident";
import { WindowEditor } from "@/components/connected/planning-forms";
import { Card } from "@/components/ui/card";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { durationText, windowText } from "@/lib/connected/format";

export default async function MissionPage({ params }: PageProps<"/[locale]/app/missions/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.mission");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const f = await getFormatter();
  const { supabase, org, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  const o = org!.id;
  const manager = isManagerRole(org!.role);
  // La base ne renvoie la mission qu'à un manager ou à son agent assigné
  const { data: task } = await supabase
    .from("tasks")
    .select("id, type, status, window_start, window_end, duration_min, is_auto_generated, assignee_id, correction_reason, notes, property_id, properties(name, address_line, city, instructions)")
    .eq("organization_id", o)
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();
  const withChecklist = task.type === "turnover" || task.type === "inspection";
  const [{ data: rooms }, { data: report }, { data: files }, { data: incidents }, { data: orgRow }, { data: source }, { data: events }] = await Promise.all([
    withChecklist
      ? supabase.from("checklist_rooms").select("id, name, sort, checklist_items(id, label, photo_required, sort)").eq("organization_id", o).eq("property_id", task.property_id).order("sort")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("task_reports").select("checked").eq("organization_id", o).eq("task_id", id).maybeSingle(),
    supabase.from("files").select("id, path, checklist_item_id, created_at, superseded_at").eq("organization_id", o).eq("task_id", id).order("created_at"),
    supabase.from("incidents").select("id, category, status, description").eq("organization_id", o).eq("task_id", id).order("created_at", { ascending: false }),
    // Réglage réellement appliqué par la base à la fin de la mission
    supabase.from("organizations").select("validation_task_types").eq("id", o).single(),
    // Intervention : l'incident d'origine et son état (sa résolution reste une décision du responsable)
    manager ? supabase.from("incidents").select("id, status, description").eq("organization_id", o).eq("follow_up_task_id", id).maybeSingle() : Promise.resolve({ data: null }),
    manager ? supabase.from("task_events").select("id, kind, at, note, actor_id").eq("organization_id", o).eq("task_id", id).order("at", { ascending: false }).limit(30) : Promise.resolve({ data: [] as never[] }),
  ]);
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
  const p = (Array.isArray(task.properties) ? task.properties[0] : task.properties) as { name: string; address_line: string | null; city: string | null; instructions: string | null } | null;
  const checklist: ReportRoom[] = (rooms ?? []).map((r: { id: string; name: string; checklist_items: { id: string; label: string; photo_required: boolean; sort: number }[] }) => ({
    id: r.id,
    name: r.name,
    items: [...r.checklist_items].sort((a, b) => a.sort - b.sort).map((i) => ({ id: i.id, label: i.label, photoRequired: i.photo_required })),
  }));
  const mine = task.assignee_id === user!.id;
  return (
    <>
      <Link href="/app/missions" className="mb-3 inline-block text-[14px] text-accent-text hover:underline">
        ← {t("back")}
      </Link>
      <PageHeader
        title={`${tt(task.type)} · ${p?.name ?? ""}`}
        subtitle={tts(task.status)}
      />
      {/* Deux informations distinctes : la fenêtre pendant laquelle la mission doit être faite, et la durée de travail estimée */}
      <div className="-mt-2 mb-4 flex flex-wrap items-start gap-x-6 gap-y-2 text-[15px]" data-testid="mission-timing">
        <p>
          <span className="block text-[13px] font-medium text-muted">{t("window")}</span>
          <span data-testid="mission-window">{windowText(f, task.window_start, task.window_end, true)}</span>
        </p>
        <p>
          <span className="block text-[13px] font-medium text-muted">{t("duration")}</span>
          <span data-testid="mission-duration">{durationText(task.duration_min)}</span>
        </p>
        <p>
          <span className="block text-[13px] font-medium text-muted">{t("closing")}</span>
          <span data-testid="mission-validation-rule">{needsValidation ? t("needsValidation") : t("autoValidated")}</span>
        </p>
        {manager && !["done", "validated", "cancelled"].includes(task.status) && (
          <div className="basis-full">
            <WindowEditor taskId={task.id} start={task.window_start} end={task.window_end} durationMin={task.duration_min} />
            {!task.is_auto_generated && <p className="mt-1 text-[13px] text-muted">{t("manualWindow")}</p>}
          </div>
        )}
      </div>
      {source && (
        <Link href="/app/incidents" className="mb-4 block rounded-xl border border-line bg-surface p-4 hover:bg-surface-hover" data-testid="mission-source-incident">
          <span className="block text-[13px] font-medium text-muted">{t("sourceIncident")}</span>
          <span className="block text-[15px]">{source.description}</span>
          <span className="mt-1 block text-[13px]" data-testid="mission-source-status">
            {ti(`status.${source.status}`)} · {source.status === "resolved" ? t("incidentResolved") : t("incidentStillOpen")}
          </span>
        </Link>
      )}
      {(p?.address_line || p?.city) && (
        <p className="-mt-2 mb-4 flex items-center gap-2 text-[15px] text-muted">
          <MapPin className="size-4" />
          {[p?.address_line, p?.city].filter(Boolean).join(", ")}
        </p>
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
      />
      {manager && (events ?? []).length > 0 && (
        <Card className="mt-4 p-5" data-testid="mission-history">
          <h2 className="text-[17px] font-semibold">{th("title")}</h2>
          <ul className="mt-2 space-y-1.5 text-[14px] text-muted">
            {(events ?? []).map((e: { id: number; kind: string; at: string; note: string | null }) => {
              let extra = "";
              if (e.kind === "window_changed" && e.note) {
                try {
                  const n = JSON.parse(e.note) as { to: [string, string, number]; reason: string | null };
                  extra = ` — ${windowText(f, n.to[0], n.to[1])} · ${durationText(n.to[2])}${n.reason ? ` · « ${n.reason} »` : ""}`;
                } catch {
                  extra = "";
                }
              } else if (e.kind === "correction_requested" && e.note) extra = ` — « ${e.note} »`;
              return (
                <li key={e.id}>
                  <span className="text-fg">{f.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short" })}</span> · {th(`kind.${e.kind}`)}
                  {extra}
                </li>
              );
            })}
          </ul>
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
