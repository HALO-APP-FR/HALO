"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Download, FileSpreadsheet, ShieldCheck, Undo2, Upload } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { FIELDS, isSensitiveHeader, MAX_IMPORT_ROWS, parseCsv, TEMPLATES, toCsv, type ImportKind } from "@/lib/engine/import";
import { analyzeImport, createImportJob, executeImport, revertImport, setImportDecision, stageImportFile } from "@/lib/connected/import-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

const SOFTWARE = ["spreadsheet", "airbnb", "booking", "lodgify", "smoobu", "hostaway", "guesty", "beds24", "superhote", "other"] as const;
const KINDS: ImportKind[] = ["properties", "stays", "team"];

function download(name: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TemplateLinks() {
  const t = useTranslations("connected.import");
  return (
    <div className="flex flex-wrap gap-2" data-testid="import-templates">
      {KINDS.map((k) => (
        <Button key={k} type="button" size="sm" variant="outline" onClick={() => download(`halo-modele-${k}.csv`, toCsv(TEMPLATES[k]))}>
          <Download />
          {t("template", { kind: t(`kind.${k}`) })}
        </Button>
      ))}
    </div>
  );
}

/** Étape 1 : source, types de données, méthode, moment. Enregistré comme brouillon reprenable. */
export function ImportStart() {
  const t = useTranslations("connected.import");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [software, setSoftware] = useState<(typeof SOFTWARE)[number]>("spreadsheet");
  const [kinds, setKinds] = useState<ImportKind[]>(["properties", "stays"]);
  const [method, setMethod] = useState<"file" | "ical" | "api" | "assisted">("file");
  return (
    <Card className="space-y-5 p-5" data-testid="import-start">
      <div>
        <h2 className="text-[17px] font-semibold">{t("startTitle")}</h2>
        <p className="mt-1 text-[14px] text-muted">{t("startText")}</p>
      </div>
      <Field label={t("software")} htmlFor="imp-sw">
        <Select id="imp-sw" value={software} onChange={(e) => setSoftware(e.target.value as (typeof SOFTWARE)[number])} data-testid="import-software">
          {SOFTWARE.map((s) => (
            <option key={s} value={s}>
              {t(`softwareName.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      {software !== "spreadsheet" && software !== "other" && <p className="-mt-3 text-[13px] text-muted" data-testid="import-software-hint">{t(`softwareHint.${software}`)}</p>}
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium">{t("kinds")}</legend>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <label key={k} className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-[14px]">
              <input type="checkbox" className="size-4" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} data-testid={`import-kind-${k}`} />
              {t(`kind.${k}`)}
            </label>
          ))}
        </div>
        {kinds.includes("stays") && !kinds.includes("properties") && <p className="text-[13px] text-muted">{t("staysNeedProperties")}</p>}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium">{t("method")}</legend>
        {(["file", "ical", "api", "assisted"] as const).map((m) => (
          <label key={m} className={cn("flex items-start gap-3 rounded-md border p-3 text-[14px]", method === m ? "border-accent bg-accent-soft" : "border-line")}>
            <input type="radio" name="imp-method" className="mt-1 size-4" checked={method === m} onChange={() => setMethod(m)} data-testid={`import-method-${m}`} />
            <span>
              <span className="block font-medium">{t(`methodName.${m}`)}</span>
              <span className="block text-muted">{t(`methodText.${m}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      {method === "file" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !kinds.length} onClick={() => run(() => createImportJob({ software, kinds, method, scheduledFor: null }), (d) => router.push(`/app/import/${d.id}`))} data-testid="import-create">
            {t("continue")}
          </Button>
          <Button variant="ghost" disabled={pending || !kinds.length} onClick={() => run(() => createImportJob({ software, kinds, method, scheduledFor: null }), () => router.refresh())} data-testid="import-later">
            {t("saveForLater")}
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-subtle p-3 text-[14px] dark:bg-surface-hover" data-testid="import-method-note">
          {t(`methodNext.${method}`)}
        </p>
      )}
    </Card>
  );
}

/** Cellule XLSX → texte (dates converties sans fuseau : chiffres lus tels qu'affichés dans le fichier). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    const time = v.getUTCHours() || v.getUTCMinutes() ? ` ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}` : "";
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}${time}`;
  }
  return String(v);
}

async function readTable(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    const rows = await readSheet(file);
    return (rows as unknown[][]).map((r) => r.map(cellText)).filter((r) => r.some((c) => c.trim() !== ""));
  }
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  // Fichiers Excel « CSV » anciens (Windows-1252) : accents illisibles en UTF-8
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
  return parseCsv(text);
}

export interface ImportFileInfo {
  name: string;
  format: string;
  rows: number;
  headers: string[];
  dropped: string[];
}
export interface ImportRowView {
  kind: ImportKind;
  row_index: number;
  raw?: Record<string, string>;
  issues: string[];
  decision: "create" | "link" | "ignore" | "reject";
  status: string;
  message: string | null;
  match_label: string | null;
  has_data: boolean;
  has_email?: boolean;
}

/** Étapes 2-3 : dépôt des fichiers, correspondance des colonnes, analyse. */
export function ImportFiles({ jobId, kinds, files, mapping }: { jobId: string; kinds: ImportKind[]; files: Record<string, ImportFileInfo>; mapping: Record<string, Record<string, string>> }) {
  const t = useTranslations("connected.import");
  const { pending, error, setError, run } = useRun();
  const [map, setMap] = useState(mapping);
  const [reading, setReading] = useState<ImportKind | null>(null);
  const [samples, setSamples] = useState<Record<string, string[][]>>({});
  const onFile = async (kind: ImportKind, file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setError(t("errors.format"));
    if (file.size > 5 * 1024 * 1024) return setError(t("errors.tooBig"));
    setReading(kind);
    try {
      const table = await readTable(file);
      if (table.length < 2) return setError(t("errors.empty"));
      const [headers, ...rows] = table;
      if (rows.length > MAX_IMPORT_ROWS) return setError(t("errors.tooMany", { max: MAX_IMPORT_ROWS }));
      // Colonnes sensibles retirées AVANT tout envoi à HALO
      const keep = headers.map((h, i) => (isSensitiveHeader(h) ? -1 : i)).filter((i) => i >= 0);
      const kept = rows.map((r) => keep.map((i) => (r[i] ?? "").toString()));
      setSamples((s) => ({ ...s, [kind]: kept.slice(0, 3) }));
      run(
        () => stageImportFile(jobId, kind, { name: file.name, format: /\.xlsx$/i.test(file.name) ? "xlsx" : "csv", droppedInBrowser: headers.filter((h) => isSensitiveHeader(h)) }, keep.map((i) => headers[i]), kept),
        (d) => setMap((m) => ({ ...m, [kind]: d.mapping })),
      );
    } catch {
      setError(t("errors.read"));
    } finally {
      setReading(null);
    }
  };
  const ready = kinds.every((k) => files[k]);
  return (
    <div className="space-y-4">
      {kinds.map((kind) => {
        const f = files[kind];
        const m = map[kind] ?? {};
        const fields = FIELDS[kind];
        const missing = fields.filter((x) => x.required && !Object.values(m).includes(x.key)).map((x) => x.key);
        return (
          <Card key={kind} className="space-y-4 p-5" data-testid={`import-file-${kind}`}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-[17px] font-semibold">{t(`kind.${kind}`)}</h2>
              <Button type="button" size="sm" variant="ghost" onClick={() => download(`halo-modele-${kind}.csv`, toCsv(TEMPLATES[kind]))}>
                <Download />
                {t("templateShort")}
              </Button>
            </div>
            <label className="flex cursor-pointer flex-wrap items-center gap-3 rounded-md border border-dashed border-line p-4 text-[14px] hover:bg-subtle dark:hover:bg-surface-hover">
              <Upload className="size-5 text-muted" />
              <span className="flex-1">
                {f ? t("fileLoaded", { name: f.name, rows: f.rows }) : t("chooseFile")}
                <span className="block text-[12px] text-muted">{t("fileHint")}</span>
              </span>
              <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => onFile(kind, e.target.files?.[0])} data-testid={`import-input-${kind}`} />
              <span className="text-[13px] font-medium text-accent-text">{reading === kind ? t("reading") : f ? t("replaceFile") : t("browse")}</span>
            </label>
            {f && f.dropped.length > 0 && (
              <p className="flex items-start gap-2 rounded-md bg-subtle p-3 text-[13px] dark:bg-surface-hover" data-testid="import-dropped">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                {t("dropped", { columns: f.dropped.join(", ") })}
              </p>
            )}
            {f && (
              <div className="space-y-2">
                <h3 className="text-[14px] font-semibold">{t("mapping")}</h3>
                <p className="text-[13px] text-muted">{t("mappingHint")}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-[14px]">
                    <thead>
                      <tr className="text-start text-[12px] text-muted">
                        <th className="py-1.5 text-start font-medium">{t("column")}</th>
                        <th className="py-1.5 text-start font-medium">{t("example")}</th>
                        <th className="py-1.5 text-start font-medium">{t("haloField")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {f.headers.map((h, i) => (
                        <tr key={h}>
                          <td className="py-1.5 pe-3 font-medium">{h}</td>
                          <td className="max-w-[12rem] truncate py-1.5 pe-3 text-muted">{samples[kind]?.[0]?.[i] ?? ""}</td>
                          <td className="py-1.5">
                            <Select
                              aria-label={t("haloFieldFor", { column: h })}
                              value={m[h] ?? ""}
                              onChange={(e) => setMap({ ...map, [kind]: { ...m, [h]: e.target.value } })}
                              data-testid={`import-map-${kind}-${i}`}
                            >
                              <option value="">{t("ignoreColumn")}</option>
                              {fields.map((x) => (
                                <option key={x.key} value={x.key} disabled={Object.entries(m).some(([hh, v]) => v === x.key && hh !== h)}>
                                  {t(`field.${kind}.${x.key}`)}
                                  {x.required ? " *" : ""}
                                </option>
                              ))}
                            </Select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {missing.length > 0 && (
                  <p className="text-[13px] text-danger" data-testid="import-missing">
                    {t("missingFields", { fields: missing.map((x) => t(`field.${kind}.${x}`)).join(", ") })}
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !ready} onClick={() => run(() => analyzeImport(jobId, map))} data-testid="import-analyze">
          {t("analyze")}
        </Button>
        <p className="text-[13px] text-muted">{t("analyzeHint")}</p>
      </div>
    </div>
  );
}

const ISSUE_ORDER = ["missing", "invalid_date", "dates_order", "unknown_property", "invalid_number", "invalid_time", "invalid_email", "invalid_country", "invalid_timezone", "invalid_role", "invalid_status", "invalid_phone", "unknown_worker_type", "dup_in_file", "dup_existing"];

function IssueList({ issues, kind }: { issues: string[]; kind: ImportKind }) {
  const t = useTranslations("connected.import");
  const sorted = [...issues].sort((a, b) => ISSUE_ORDER.indexOf(a.split(":")[0]) - ISSUE_ORDER.indexOf(b.split(":")[0]));
  return (
    <ul className="space-y-0.5 text-[13px]">
      {sorted.map((i) => {
        const [code, arg] = i.split(":");
        const label = arg ? (code === "dup_in_file" ? t("issue.dup_in_file", { row: arg }) : t(`issue.${code}`, { field: t(`field.${kind}.${arg}`) })) : t(`issue.${code}`);
        return (
          <li key={i} className={cn(/^(dup_|invalid_phone|unknown_worker)/.test(code) ? "text-warning" : "text-danger")}>
            {label}
          </li>
        );
      })}
    </ul>
  );
}

/** Étape 4 : aperçu, choix sur les doublons, options, validation explicite. */
export function ImportPreview({
  jobId,
  kinds,
  rows,
  summary,
  options,
  hasGuestEmails,
}: {
  jobId: string;
  kinds: ImportKind[];
  rows: ImportRowView[];
  summary: Record<string, { rows: number; create: number; link: number; ignore: number; reject: number; duplicates: number; unmapped: string[]; missingRequired: string[] }>;
  options: { import_guest_emails?: boolean; create_missions?: boolean };
  hasGuestEmails: boolean;
}) {
  const t = useTranslations("connected.import");
  const { pending, error, run } = useRun();
  const [opts, setOpts] = useState({ import_guest_emails: Boolean(options.import_guest_emails), create_missions: Boolean(options.create_missions) });
  const [filter, setFilter] = useState<"all" | "problems">("problems");
  const counts = (k: ImportKind, d: string) => rows.filter((r) => r.kind === k && r.decision === d).length;
  const created = { properties: counts("properties", "create"), stays: counts("stays", "create"), team: counts("team", "create") };
  const blocked = kinds.some((k) => (summary[k]?.missingRequired ?? []).length > 0);
  const nothing = created.properties + created.stays + created.team + rows.filter((r) => r.decision === "link").length === 0;
  const parts = [
    created.properties ? t("count.properties", { count: created.properties }) : null,
    created.stays ? t("count.stays", { count: created.stays }) : null,
    created.team ? t("count.team", { count: created.team }) : null,
  ].filter(Boolean);
  const report = () => {
    const lines = [[t("csv.type"), t("csv.row"), t("csv.label"), t("csv.decision"), t("csv.problems")]];
    for (const r of rows.filter((x) => x.issues.length)) {
      lines.push([t(`kind.${r.kind}`), String(r.row_index + 1), r.message ?? "", t(`decision.${r.decision}`), r.issues.map((i) => i.split(":")[0]).map((c) => t(`issueShort.${c}`)).join(" ; ")]);
    }
    download("halo-import-lignes-a-corriger.csv", toCsv(lines));
  };
  const shown = rows.filter((r) => filter === "all" || r.issues.length > 0);
  return (
    <div className="space-y-4" data-testid="import-preview">
      <Card className="p-5">
        <h2 className="text-[17px] font-semibold">{t("summaryTitle")}</h2>
        <p className="mt-1 text-[13px] text-muted">{t("summaryText")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {kinds.map((k) => {
            const s = summary[k];
            if (!s) return null;
            return (
              <div key={k} className="rounded-md border border-line p-3 text-[14px]" data-testid={`import-summary-${k}`}>
                <p className="font-semibold">{t(`kind.${k}`)}</p>
                <p>{t("sum.create", { count: counts(k, "create") })}</p>
                {counts(k, "link") > 0 && <p>{t("sum.link", { count: counts(k, "link") })}</p>}
                {counts(k, "ignore") > 0 && <p className="text-warning">{t("sum.ignore", { count: counts(k, "ignore") })}</p>}
                {counts(k, "reject") > 0 && <p className="text-danger">{t("sum.reject", { count: counts(k, "reject") })}</p>}
                <p className="text-muted">{t("sum.updates")}</p>
                {s.unmapped.length > 0 && <p className="mt-1 text-[12px] text-muted">{t("sum.unmapped", { columns: s.unmapped.join(", ") })}</p>}
                {s.missingRequired.length > 0 && <p className="mt-1 text-[12px] text-danger">{t("missingFields", { fields: s.missingRequired.map((x) => t(`field.${k}.${x}`)).join(", ") })}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-[17px] font-semibold">{t("rowsTitle")}</h2>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "problems")} aria-label={t("rowsFilter")} className="w-auto">
            <option value="problems">{t("rowsProblems")}</option>
            <option value="all">{t("rowsAll")}</option>
          </Select>
          <Button size="sm" variant="outline" onClick={report} disabled={!rows.some((r) => r.issues.length)} data-testid="import-report-download">
            <Download />
            {t("downloadReport")}
          </Button>
        </div>
        {shown.length === 0 && <p className="mt-3 text-[14px] text-muted">{t("noProblems")}</p>}
        <ul className="mt-3 divide-y divide-line">
          {shown.slice(0, 300).map((r) => {
            const dup = r.issues.some((i) => i.startsWith("dup_"));
            return (
              <li key={`${r.kind}-${r.row_index}`} className="flex flex-wrap items-start gap-3 py-2.5" data-testid="import-row" data-kind={r.kind} data-decision={r.decision}>
                <span className="w-28 shrink-0 text-[12px] text-muted">
                  {t(`kindShort.${r.kind}`)} · {t("line", { n: r.row_index + 1 })}
                </span>
                <span className="min-w-[10rem] flex-1">
                  <span className="block text-[14px] font-medium">{r.message || "—"}</span>
                  <IssueList issues={r.issues} kind={r.kind} />
                  {r.match_label && <span className="block text-[12px] text-muted">{t("matches", { label: r.match_label })}</span>}
                </span>
                {r.decision === "reject" ? (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[12px] font-semibold text-danger">{t("decision.reject")}</span>
                ) : dup ? (
                  <Select
                    aria-label={t("decisionFor", { n: r.row_index + 1 })}
                    value={r.decision}
                    disabled={pending}
                    className="w-auto"
                    onChange={(e) => run(() => setImportDecision(jobId, r.kind, r.row_index, e.target.value as "create" | "link" | "ignore"))}
                    data-testid="import-decision"
                  >
                    <option value="ignore">{t("decision.ignore")}</option>
                    {r.match_label && r.kind !== "team" && <option value="link">{t("decision.link")}</option>}
                    <option value="create">{t("decision.create")}</option>
                  </Select>
                ) : (
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-semibold text-muted dark:bg-surface-hover">{t(`decision.${r.decision}`)}</span>
                )}
              </li>
            );
          })}
        </ul>
        {shown.length > 300 && <p className="mt-2 text-[13px] text-muted">{t("moreRows", { count: shown.length - 300 })}</p>}
      </Card>

      <Card className="space-y-3 p-5" data-testid="import-options">
        <h2 className="text-[17px] font-semibold">{t("effectsTitle")}</h2>
        <p className="rounded-md bg-subtle p-3 text-[14px] dark:bg-surface-hover">{t("noSideEffects")}</p>
        {kinds.includes("stays") && (
          <>
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 size-4" checked={opts.create_missions} onChange={(e) => setOpts({ ...opts, create_missions: e.target.checked })} data-testid="import-opt-missions" />
              <span>
                <span className="block font-medium">{t("optMissions")}</span>
                <span className="block text-muted">{t("optMissionsText")}</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 size-4" checked={opts.import_guest_emails} disabled={!hasGuestEmails} onChange={(e) => setOpts({ ...opts, import_guest_emails: e.target.checked })} data-testid="import-opt-emails" />
              <span>
                <span className="block font-medium">{t("optEmails")}</span>
                <span className="block text-muted">{hasGuestEmails ? t("optEmailsText") : t("optEmailsNone")}</span>
              </span>
            </label>
          </>
        )}
        {kinds.includes("team") && <p className="text-[13px] text-muted">{t("teamNote")}</p>}
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        <Button
          size="lg"
          disabled={pending || blocked || nothing}
          onClick={() => run(() => executeImport(jobId, opts))}
          data-testid="import-run"
        >
          {nothing ? t("nothingToImport") : t("runButton", { what: parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${t("and")}${parts.at(-1)}` : parts[0] || t("count.links") })}
        </Button>
        {blocked && <p className="text-[13px] text-danger">{t("fixMapping")}</p>}
      </Card>
    </div>
  );
}

const REASONS = ["modified_since", "missions_started", "has_requests", "has_messages", "guest_link", "other_stays", "stays_kept", "has_places", "invited"];

/** Étape 5 : rapport final et annulation sûre. */
export function ImportReport({ jobId, kinds, rows, missions, reverted, resumable }: { jobId: string; kinds: ImportKind[]; rows: ImportRowView[]; missions: number | null; reverted: boolean; resumable?: boolean }) {
  const t = useTranslations("connected.import");
  const { pending, error, run } = useRun();
  const [plan, setPlan] = useState<{ removable: { kind: string; row: number }[]; kept: { kind: string; row: number; reason: string }[] } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const stats = useMemo(
    () => Object.fromEntries(kinds.map((k) => [k, Object.fromEntries(["created", "linked", "ignored", "rejected", "failed", "reverted"].map((s) => [s, rows.filter((r) => r.kind === k && r.status === s).length]))])),
    [kinds, rows],
  );
  const download2 = () => {
    const lines = [[t("csv.type"), t("csv.row"), t("csv.label"), t("csv.result"), t("csv.reason")]];
    for (const r of rows) lines.push([t(`kind.${r.kind}`), String(r.row_index + 1), r.status === "failed" ? "" : (r.message ?? ""), t(`status.${r.status}`), r.status === "failed" ? t(`failure.${REASON_KEY(r.message)}`) : r.issues.map((i) => t(`issueShort.${i.split(":")[0]}`)).join(" ; ")]);
    download("halo-rapport-import.csv", toCsv(lines));
  };
  return (
    <div className="space-y-4" data-testid="import-report">
      {resumable && (
        <Card className="space-y-2 border-warning p-5" data-testid="import-resume">
          <p className="text-[15px] font-medium">{t("interrupted", { pending: rows.filter((r) => r.status === "pending").length })}</p>
          <Button disabled={pending} onClick={() => run(() => executeImport(jobId))} data-testid="import-resume-btn">
            {t("resume")}
          </Button>
        </Card>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-[17px] font-semibold">{t("reportTitle")}</h2>
          <Button size="sm" variant="outline" onClick={download2} data-testid="import-report-csv">
            <Download />
            {t("downloadFullReport")}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {kinds.map((k) => (
            <div key={k} className="rounded-md border border-line p-3 text-[14px]" data-testid={`import-result-${k}`}>
              <p className="font-semibold">{t(`kind.${k}`)}</p>
              {(["created", "linked", "ignored", "rejected", "failed", "reverted"] as const).map((s) =>
                stats[k][s] ? (
                  <p key={s} className={cn(s === "failed" || s === "rejected" ? "text-danger" : s === "created" ? "text-success" : "")}>
                    {t(`result.${s}`, { count: stats[k][s] })}
                  </p>
                ) : null,
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[14px]" data-testid="import-missions">
          {missions === null ? t("missionsNotCreated") : t("missionsCreated", { count: missions })}
        </p>
        <p className="mt-1 text-[13px] text-muted">{t("noneSent")}</p>
      </Card>

      {rows.some((r) => r.status === "failed" || r.status === "rejected") && (
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{t("failuresTitle")}</h2>
          <ul className="mt-2 divide-y divide-line text-[14px]">
            {rows
              .filter((r) => r.status === "failed" || r.status === "rejected")
              .slice(0, 300)
              .map((r) => (
                <li key={`${r.kind}-${r.row_index}`} className="py-2" data-testid="import-failure">
                  <span className="text-muted">
                    {t(`kindShort.${r.kind}`)} · {t("line", { n: r.row_index + 1 })} ·{" "}
                  </span>
                  {r.status === "failed" ? t(`failure.${REASON_KEY(r.message)}`) : <IssueList issues={r.issues} kind={r.kind} />}
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3 p-5" data-testid="import-revert">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <Undo2 className="size-5" />
          {t("revertTitle")}
        </h2>
        <p className="text-[14px] text-muted">{t("revertText")}</p>
        {reverted && <p className="text-[14px] text-success">{t("revertedAlready")}</p>}
        {!plan ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => revertImport(jobId, false), (d) => setPlan(d))} data-testid="import-revert-check">
            {t("revertCheck")}
          </Button>
        ) : (
          <div className="space-y-2 text-[14px]">
            <p data-testid="import-revert-plan">{t("revertPlan", { removable: plan.removable.length, kept: plan.kept.length })}</p>
            {plan.kept.length > 0 && (
              <ul className="space-y-0.5 text-[13px] text-muted">
                {plan.kept.slice(0, 50).map((k) => (
                  <li key={`${k.kind}-${k.row}`}>
                    {t(`kindShort.${k.kind}`)} · {t("line", { n: k.row + 1 })} : {t(`keptReason.${REASONS.includes(k.reason) ? k.reason : "modified_since"}`)}
                  </li>
                ))}
              </ul>
            )}
            {done !== null ? (
              <p className="text-success" data-testid="import-reverted">{t("revertDone", { count: done })}</p>
            ) : (
              <Button size="sm" variant="danger" disabled={pending || plan.removable.length === 0} onClick={() => run(() => revertImport(jobId, true), (d) => setDone(d.removable.length))} data-testid="import-revert-apply">
                {t("revertApply", { count: plan.removable.length })}
              </Button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      </Card>
    </div>
  );
}

function REASON_KEY(message: string | null) {
  return message === "stay_overlap" || message === "property_not_found" || message === "duplicate_reference" || message === "match_not_found" ? message : "other";
}

export function ImportHistoryRow({ job }: { job: { id: string; created_at: string; status: string; kinds: string[]; source_software: string | null; report: Record<string, number> } }) {
  const t = useTranslations("connected.import");
  const f = useFormatter();
  const created = Object.entries(job.report ?? {})
    .filter(([k]) => k.endsWith(":created"))
    .reduce((a, [, v]) => a + Number(v), 0);
  return (
    <span className="flex flex-wrap items-center gap-3" data-testid="import-history-row" data-status={job.status}>
      <FileSpreadsheet className="size-5 text-muted" />
      <span className="flex-1">
        <span className="block text-[15px] font-medium">
          {t(`softwareName.${job.source_software ?? "other"}`)} · {job.kinds.map((k) => t(`kind.${k}`)).join(", ")}
        </span>
        <span className="block text-[13px] text-muted">
          {f.dateTime(new Date(job.created_at), { dateStyle: "medium", timeStyle: "short" })}
          {job.status === "completed" || job.status === "reverted" ? ` · ${t("createdCount", { count: created })}` : ""}
        </span>
      </span>
      <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] font-semibold dark:bg-surface-hover">{t(`jobStatus.${job.status}`)}</span>
    </span>
  );
}
