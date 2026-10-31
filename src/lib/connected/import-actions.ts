"use server";

/**
 * Import de données dans HALO : préparation (brouillon reprenable), dépôt des lignes lues, analyse sans
 * aucune écriture métier, exécution contrôlée par la base (run_import), annulation sûre (revert_import).
 * Le fichier lui-même n'est jamais conservé ; les colonnes sensibles ne quittent pas le navigateur.
 */
import { revalidatePath } from "next/cache";
import { analyzeRows, autoMap, IMPORT_KINDS, isSensitiveHeader, MAX_IMPORT_ROWS, type ImportKind } from "@/lib/engine/import";
import { getContext, isManagerRole } from "./context";
import { syncTasks, type Result } from "./actions";
import { supabaseAdmin } from "@/lib/supabase/admin";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}
const SOFTWARE = ["airbnb", "booking", "lodgify", "smoobu", "hostaway", "guesty", "beds24", "superhote", "spreadsheet", "other"];

export async function createImportJob(input: { software: string; kinds: ImportKind[]; method: "file" | "api" | "ical" | "assisted"; scheduledFor: string | null }): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const kinds = IMPORT_KINDS.filter((k) => input.kinds.includes(k));
  if (!kinds.length || !SOFTWARE.includes(input.software)) return fail("invalid");
  const { data, error: e } = await ctx.supabase
    .from("import_jobs")
    .insert({ organization_id: ctx.org!.id, created_by: ctx.user!.id, source_software: input.software, kinds, method: input.method, scheduled_for: input.scheduledFor })
    .select("id")
    .single();
  if (e) return fail("server");
  // Rétention : lignes lues des anciens imports effacées au fil de l'eau (le rapport chiffré reste)
  await supabaseAdmin()?.rpc("purge_import_rows");
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id as string } };
}

/** Lignes lues dans le navigateur (CSV ou XLSX) : enregistrées pour l'analyse, sans colonne sensible. */
export async function stageImportFile(jobId: string, kind: ImportKind, file: { name: string; format: "csv" | "xlsx"; droppedInBrowser?: string[] }, headersIn: string[], rows: string[][]): Promise<Result<{ rows: number; mapping: Record<string, string>; dropped: string[] }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  if (!IMPORT_KINDS.includes(kind)) return fail("invalid");
  if (rows.length > MAX_IMPORT_ROWS) return fail("too_many_rows");
  if (!headersIn.length || headersIn.length > 60) return fail("invalid");
  const o = ctx.org!.id;
  const { data: job } = await ctx.supabase.from("import_jobs").select("id, status, files, mapping").eq("organization_id", o).eq("id", jobId).maybeSingle();
  if (!job) return fail("not_found");
  if (job.status !== "draft" && job.status !== "analyzed") return fail("conflict");
  // Second filet côté serveur : colonnes sensibles retirées, en-têtes uniques et bornés
  const headers = headersIn.map((h, i) => (h ?? "").toString().trim().slice(0, 80) || `Colonne ${i + 1}`);
  const keep = headers.map((h, i) => (headers.indexOf(h) === i && !isSensitiveHeader(h) ? i : -1)).filter((i) => i >= 0);
  // Noms des colonnes écartées (jamais leur contenu), pour l'afficher au responsable
  const dropped = [...(file.droppedInBrowser ?? []).map((h) => String(h).slice(0, 80)).slice(0, 30), ...headers.filter((h, i) => !keep.includes(i))];
  const cleanHeaders = keep.map((i) => headers[i]);
  const { error: de } = await ctx.supabase.from("import_rows").delete().eq("organization_id", o).eq("job_id", jobId).eq("kind", kind);
  if (de) return fail("server");
  const records = rows.map((r, idx) => ({
    organization_id: o,
    job_id: jobId,
    kind,
    row_index: idx + 1,
    raw: Object.fromEntries(keep.map((i) => [headers[i], (r[i] ?? "").toString().slice(0, 2000)])),
  }));
  for (let i = 0; i < records.length; i += 500) {
    const { error: ie } = await ctx.supabase.from("import_rows").insert(records.slice(i, i + 500));
    if (ie) return fail("server");
  }
  const mapping = autoMap(kind, cleanHeaders);
  const files = { ...(job.files as Record<string, unknown>), [kind]: { name: file.name.slice(0, 120), format: file.format, rows: rows.length, headers: cleanHeaders, dropped } };
  const { error: ue } = await ctx.supabase
    .from("import_jobs")
    .update({ files, mapping: { ...(job.mapping as Record<string, unknown>), [kind]: mapping }, status: "draft", summary: {}, updated_at: new Date().toISOString() })
    .eq("organization_id", o)
    .eq("id", jobId);
  if (ue) return fail("server");
  revalidatePath("/", "layout");
  return { ok: true, data: { rows: rows.length, mapping, dropped } };
}

/** Analyse : correspondances, contrôles, doublons, décisions proposées. Aucune donnée métier modifiée. */
export async function analyzeImport(jobId: string, mapping: Partial<Record<ImportKind, Record<string, string>>>): Promise<Result<{ summary: Record<string, unknown> }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: job } = await ctx.supabase.from("import_jobs").select("*").eq("organization_id", o).eq("id", jobId).maybeSingle();
  if (!job) return fail("not_found");
  if (job.status !== "draft" && job.status !== "analyzed") return fail("conflict");
  const [{ data: props }, { data: stays }, { data: contacts }, { data: members }, { data: rows }] = await Promise.all([
    ctx.supabase.from("properties").select("id, name, external_ref, timezone, default_check_in, default_check_out").eq("organization_id", o).is("archived_at", null),
    ctx.supabase.from("reservations").select("id, property_id, check_in_at, check_out_at, external_uid").eq("organization_id", o).neq("status", "cancelled"),
    ctx.supabase.from("team_contacts").select("email").eq("organization_id", o),
    ctx.supabase.rpc("organization_member_emails", { org: o }),
    ctx.supabase.from("import_rows").select("kind, row_index, raw").eq("organization_id", o).eq("job_id", jobId).order("row_index").limit(3 * MAX_IMPORT_ROWS),
  ]);
  const files = job.files as Record<string, { headers: string[] }>;
  const fullMapping = { ...(job.mapping as Record<string, Record<string, string>>), ...mapping };
  const analyzeCtx = {
    properties: (props ?? []).map((p) => ({ id: p.id, name: p.name, external_ref: p.external_ref, timezone: p.timezone, check_in: p.default_check_in, check_out: p.default_check_out })),
    stays: stays ?? [],
    teamEmails: [...(contacts ?? []).map((c) => (c.email ?? "").toLowerCase()), ...(((members as string[] | null) ?? []).map((m) => m.toLowerCase()))].filter(Boolean),
  } as Parameters<typeof analyzeRows>[4];
  const summary: Record<string, unknown> = {};
  for (const kind of ["properties", "team", "stays"] as ImportKind[]) {
    const kRows = (rows ?? []).filter((r) => r.kind === kind);
    if (!kRows.length || !files[kind]) continue;
    const headers = files[kind].headers;
    const m = fullMapping[kind] ?? {};
    const missing = (kind === "properties" ? ["name"] : kind === "stays" ? ["property", "check_in", "check_out"] : []).filter((f) => !Object.values(m).includes(f));
    const result = analyzeRows(kind, headers, kRows.map((r) => r.raw as Record<string, string>), m, analyzeCtx);
    if (kind === "properties") {
      analyzeCtx.fileProperties = result.map((r) => ({
        row: r.row,
        name: r.label,
        external_ref: (r.data?.external_ref as string | null) ?? null,
        timezone: (r.data?.timezone as string) ?? "Europe/Paris",
        check_in: (r.data?.check_in_time as string) ?? "16:00",
        check_out: (r.data?.check_out_time as string) ?? "11:00",
        decision: r.decision,
        matchId: r.matchId,
      }));
    }
    for (const r of result) {
      const { error: ue } = await ctx.supabase
        .from("import_rows")
        .update({ data: r.data, issues: r.issues, decision: r.decision, match_id: r.matchId, message: r.label || null })
        .eq("organization_id", o)
        .eq("job_id", jobId)
        .eq("kind", kind)
        .eq("row_index", r.row);
      if (ue) return fail("server");
    }
    const count = (d: string) => result.filter((r) => r.decision === d).length;
    summary[kind] = {
      rows: result.length,
      create: count("create"),
      link: count("link"),
      ignore: count("ignore"),
      reject: count("reject"),
      duplicates: result.filter((r) => r.issues.some((i) => i.startsWith("dup_"))).length,
      missingRequired: missing,
      unmapped: headers.filter((h) => !m[h]),
    };
  }
  const { error: ue } = await ctx.supabase
    .from("import_jobs")
    .update({ mapping: fullMapping, summary, status: "analyzed", updated_at: new Date().toISOString() })
    .eq("organization_id", o)
    .eq("id", jobId);
  if (ue) return fail("server");
  revalidatePath("/", "layout");
  return { ok: true, data: { summary } };
}

/** Choix du responsable pour une ligne (doublon : ignorer, associer, créer). */
export async function setImportDecision(jobId: string, kind: ImportKind, row: number, decision: "create" | "link" | "ignore"): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: r } = await ctx.supabase.from("import_rows").select("data, match_id, issues").eq("organization_id", o).eq("job_id", jobId).eq("kind", kind).eq("row_index", row).maybeSingle();
  if (!r) return fail("not_found");
  if (!r.data) return fail("invalid"); // ligne rejetée : à corriger dans le fichier
  if (decision === "link" && !r.match_id) return fail("invalid");
  if (decision === "link" && kind === "team") return fail("invalid");
  const { data, error: e } = await ctx.supabase.from("import_rows").update({ decision }).eq("organization_id", o).eq("job_id", jobId).eq("kind", kind).eq("row_index", row).select("row_index");
  if (e || !data?.length) return fail(e ? "server" : "conflict");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function setImportOptions(jobId: string, options: { import_guest_emails: boolean; create_missions: boolean }): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase
    .from("import_jobs")
    .update({ options: { import_guest_emails: Boolean(options.import_guest_emails), create_missions: Boolean(options.create_missions) }, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.org!.id)
    .eq("id", jobId)
    .select("id");
  if (e || !data?.length) return fail(e ? "server" : "conflict");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Exécution : la base fait tout dans l'organisation active ; missions seulement si choisies. Aucun envoi. */
export async function executeImport(jobId: string, options?: { import_guest_emails: boolean; create_missions: boolean }): Promise<Result<{ created: number; failed: number; missions: number | null; already: boolean }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  if (options) {
    // Reprise après interruption : les options déjà enregistrées s'appliquent (job plus modifiable)
    const r = await setImportOptions(jobId, options);
    if (!r.ok && r.error !== "conflict") return r;
  }
  const { data, error: e } = await ctx.supabase.rpc("run_import", { org: o, job: jobId });
  if (e) return fail(e.message?.includes("not_analyzed") ? "not_analyzed" : e.code === "42501" ? "forbidden" : "server");
  const res = data as { status: string; created?: number; failed?: number };
  let missions: number | null = null;
  const { data: job } = await ctx.supabase.from("import_jobs").select("options, summary").eq("organization_id", o).eq("id", jobId).single();
  if (res.status === "ok" && (job?.options as { create_missions?: boolean })?.create_missions) {
    const { data: created } = await ctx.supabase.from("import_rows").select("target_id").eq("organization_id", o).eq("job_id", jobId).eq("kind", "stays").eq("status", "created");
    const ids = (created ?? []).map((x) => x.target_id as string);
    const { data: ps } = ids.length ? await ctx.supabase.from("reservations").select("property_id").eq("organization_id", o).in("id", ids) : { data: [] };
    missions = 0;
    for (const pid of Array.from(new Set((ps ?? []).map((p) => p.property_id as string)))) {
      const r = await syncTasks(pid);
      if (r.ok) missions += r.data.created;
    }
    const rec = await ctx.supabase.rpc("record_import_missions", { org: o, job: jobId, n: missions });
    if (rec.error) console.error("record_import_missions", rec.error.message);
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { created: res.created ?? 0, failed: res.failed ?? 0, missions, already: res.status === "already" } };
}

export async function revertImport(jobId: string, apply: boolean): Promise<Result<{ removable: { kind: string; row: number }[]; kept: { kind: string; row: number; reason: string }[] }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("revert_import", { org: ctx.org!.id, job: jobId, apply });
  if (e) return fail(e.code === "42501" ? "forbidden" : "server");
  const res = data as { status: string; removable?: { kind: string; row: number }[]; kept?: { kind: string; row: number; reason: string }[] };
  if (res.status !== "ok") return fail("conflict");
  if (apply) revalidatePath("/", "layout");
  return { ok: true, data: { removable: res.removable ?? [], kept: res.kept ?? [] } };
}
