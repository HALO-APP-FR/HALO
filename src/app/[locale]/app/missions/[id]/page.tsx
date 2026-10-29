import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { MissionReport, type ReportRoom } from "@/components/connected/mission-report";
import { ReportIncident } from "@/components/connected/report-incident";
import { getContext, isManagerRole } from "@/lib/connected/context";

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
    .select("id, type, status, window_start, window_end, assignee_id, correction_reason, notes, property_id, properties(name, address_line, city, instructions)")
    .eq("organization_id", o)
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();
  const withChecklist = task.type === "turnover" || task.type === "inspection";
  const [{ data: rooms }, { data: report }, { data: files }, { data: incidents }] = await Promise.all([
    withChecklist
      ? supabase.from("checklist_rooms").select("id, name, sort, checklist_items(id, label, photo_required, sort)").eq("organization_id", o).eq("property_id", task.property_id).order("sort")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("task_reports").select("checked").eq("organization_id", o).eq("task_id", id).maybeSingle(),
    supabase.from("files").select("id, path, checklist_item_id, created_at, superseded_at").eq("organization_id", o).eq("task_id", id).order("created_at"),
    supabase.from("incidents").select("id, category, status, description").eq("organization_id", o).eq("task_id", id).order("created_at", { ascending: false }),
  ]);
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
        subtitle={`${f.dateTime(new Date(task.window_start), { dateStyle: "full", timeStyle: "short" })} → ${f.dateTime(new Date(task.window_end), { timeStyle: "short" })} · ${tts(task.status)}`}
      />
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
      {(mine || manager) && task.status !== "cancelled" && (
        <div className="mt-4">
          <ReportIncident taskId={task.id} reported={incidents ?? []} />
        </div>
      )}
    </>
  );
}
