import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { ImportFiles, ImportPreview, ImportReport, type ImportFileInfo, type ImportRowView } from "@/components/connected/import-flow";
import { getContext, isManagerRole } from "@/lib/connected/context";
import type { ImportKind } from "@/lib/engine/import";

const ORDER: ImportKind[] = ["properties", "stays", "team"];

export default async function ImportJobPage({ params }: PageProps<"/[locale]/app/import/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.import");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const { data: job } = await supabase.from("import_jobs").select("*").eq("organization_id", o).eq("id", id).maybeSingle();
  if (!job) notFound();
  const kinds = ORDER.filter((k) => (job.kinds as string[]).includes(k));
  const { data: rawRows } = await supabase
    .from("import_rows")
    .select("kind, row_index, issues, decision, status, message, match_id, data")
    .eq("organization_id", o)
    .eq("job_id", id)
    .order("kind")
    .order("row_index")
    .limit(6000);
  // Fiches existantes proposées comme doublons : nom du logement ou dates du séjour
  const propIds = (rawRows ?? []).filter((r) => r.match_id && r.kind === "properties").map((r) => r.match_id as string);
  const stayIds = (rawRows ?? []).filter((r) => r.match_id && r.kind === "stays").map((r) => r.match_id as string);
  const [{ data: mp }, { data: ms }] = await Promise.all([
    propIds.length ? supabase.from("properties").select("id, name").eq("organization_id", o).in("id", propIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    stayIds.length ? supabase.from("reservations").select("id, guest_name, check_in_at, properties(name)").eq("organization_id", o).in("id", stayIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  const label = (r: { kind: string; match_id: string | null }) => {
    if (!r.match_id) return null;
    if (r.kind === "properties") return (mp ?? []).find((p) => p.id === r.match_id)?.name ?? null;
    const s = (ms ?? []).find((x: { id: string }) => x.id === r.match_id) as { guest_name: string | null; check_in_at: string; properties: { name: string } | { name: string }[] | null } | undefined;
    if (!s) return null;
    const pn = Array.isArray(s.properties) ? s.properties[0]?.name : s.properties?.name;
    return `${s.guest_name ?? "—"} · ${pn ?? ""} · ${f.dateTime(new Date(s.check_in_at), { dateStyle: "medium" })}`;
  };
  const rows: ImportRowView[] = (rawRows ?? []).map((r) => ({
    kind: r.kind as ImportKind,
    row_index: r.row_index,
    issues: (r.issues as string[]) ?? [],
    decision: r.decision,
    status: r.status,
    message: r.message,
    match_label: label(r),
    has_data: Boolean(r.data),
    has_email: Boolean((r.data as { guest_email?: string } | null)?.guest_email),
  }));
  const status = job.status as string;
  return (
    <>
      <PageHeader title={t("jobTitle")} subtitle={`${t(`softwareName.${job.source_software ?? "other"}`)} · ${t(`jobStatus.${status}`)}`} />
      <p className="mb-4 text-[14px]">
        <Link href="/app/import" className="text-accent-text hover:underline">
          {t("backToImports")}
        </Link>
      </p>
      <ol className="mb-5 flex flex-wrap gap-2 text-[13px]" aria-label={t("steps")}>
        {(["files", "preview", "report"] as const).map((s, i) => {
          const active = (s === "files" && status === "draft") || (s === "preview" && status === "analyzed") || (s === "report" && ["importing", "completed", "failed", "reverted"].includes(status));
          return (
            <li key={s} aria-current={active ? "step" : undefined} className={active ? "rounded-full bg-accent px-3 py-1 font-semibold text-on-accent" : "rounded-full bg-subtle px-3 py-1 text-muted dark:bg-surface-hover"}>
              {i + 1}. {t(`step.${s}`)}
            </li>
          );
        })}
      </ol>
      {status === "draft" || status === "analyzed" ? (
        <div className="space-y-6">
          {status === "analyzed" && (
            <ImportPreview
              jobId={id}
              kinds={kinds}
              rows={rows}
              summary={job.summary as never}
              options={job.options as never}
              hasGuestEmails={rows.some((r) => r.kind === "stays" && r.has_email)}
            />
          )}
          <details open={status === "draft"} className="rounded-xl">
            <summary className="mb-3 cursor-pointer text-[15px] font-semibold">{status === "analyzed" ? t("editFiles") : t("step.files")}</summary>
            <ImportFiles jobId={id} kinds={kinds} files={job.files as Record<string, ImportFileInfo>} mapping={job.mapping as Record<string, Record<string, string>>} />
          </details>
        </div>
      ) : (
        <ImportReport
          jobId={id}
          kinds={kinds}
          rows={rows}
          missions={typeof (job.summary as { missions_created?: number }).missions_created === "number" ? (job.summary as { missions_created: number }).missions_created : null}
          reverted={Boolean(job.reverted_at)}
          resumable={status === "importing" || status === "failed"}
        />
      )}
    </>
  );
}
