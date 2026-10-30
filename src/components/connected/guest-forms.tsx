"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { guestDeletePreparation, guestReplyService, guestReplyVip, guestReportProblem, guestRequestService, guestRequestVip, guestSavePreparation, guestSendMessage, type GuestResult } from "@/lib/connected/guest-actions";
import { Button } from "@/components/ui/button";
import { zonedTime } from "@/lib/connected/format";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function useGuestRun() {
  const t = useTranslations("guestSpace.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<GuestResult | { ok: false; error: "locked" }>, onOk: () => void) => {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return setError(t(r.error));
        onOk();
        router.refresh();
      } catch {
        setError(t("server"));
      }
    });
  };
  return { pending, error, run };
}

export function GuestRequestForm({ token, kinds, minDate, timeZone }: { token: string; kinds: string[]; minDate: string; timeZone: string }) {
  const t = useTranslations("guestSpace");
  const tk = useTranslations("serviceKind");
  const { pending, error, run } = useGuestRun();
  const [f, setF] = useState({ kind: kinds[0] ?? "other", when: "", people: 2, details: "" });
  const [ok, setOk] = useState(false);
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        run(() => guestRequestService(token, { kind: f.kind, startAt: zonedTime(f.when, timeZone).toISOString(), people: f.people, details: f.details }), () => (setOk(true), setF({ ...f, when: "", details: "" })));
      }}
    >
      <Field label={t("request.kind")} htmlFor="gr-kind" className="sm:col-span-2">
        <Select id="gr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("request.when")} htmlFor="gr-when">
        <Input id="gr-when" type="datetime-local" aria-describedby="gr-when-tz" min={minDate} value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} required />
        <p id="gr-when-tz" className="mt-1 text-[12px] text-muted">{t("request.localTime")}</p>
      </Field>
      <Field label={t("request.people")} htmlFor="gr-people">
        <Input id="gr-people" type="number" min={1} max={100} value={f.people} onChange={(e) => setF({ ...f, people: Number(e.target.value) })} />
      </Field>
      <Field label={t("request.details")} htmlFor="gr-details" className="sm:col-span-2">
        <Textarea id="gr-details" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={2000} placeholder={t("request.detailsPlaceholder")} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        {ok && <p role="status" className="text-[14px] text-success" data-testid="guest-request-ok">{t("request.sent")}</p>}
        <Button type="submit" className="ms-auto" disabled={pending || !f.when} data-testid="guest-request-send">
          {t("request.send")}
        </Button>
      </div>
    </form>
  );
}

export function GuestReply({ token, serviceId, question }: { token: string; serviceId: string; question: boolean }) {
  const t = useTranslations("guestSpace");
  const { pending, error, run } = useGuestRun();
  const [body, setBody] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => guestReplyService(token, serviceId, body), () => setBody(""));
      }}
    >
      <Field label={question ? t("reply.answer") : t("reply.add")} htmlFor={`rep-${serviceId}`}>
        <Textarea id={`rep-${serviceId}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="guest-reply" />
      </Field>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      <Button type="submit" size="sm" disabled={pending || !body.trim()} data-testid="guest-reply-send">
        {t("reply.send")}
      </Button>
    </form>
  );
}

export function GuestMessageForm({ token }: { token: string }) {
  const t = useTranslations("guestSpace");
  const { pending, error, run } = useGuestRun();
  const [body, setBody] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => guestSendMessage(token, body), () => setBody(""));
      }}
    >
      <Field label={t("contact.label")} htmlFor="gm" hint={t("contact.hint")}>
        <Textarea id="gm" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid="guest-message" />
      </Field>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      <Button type="submit" disabled={pending || !body.trim()} data-testid="guest-message-send">
        {t("contact.send")}
      </Button>
    </form>
  );
}

const PROBLEM_CATEGORIES = ["breakdown", "cleanliness", "leak", "missing_item", "access", "noise", "pests", "damage", "other"] as const;

export function GuestProblemForm({ token }: { token: string }) {
  const t = useTranslations("guestSpace");
  const tc = useTranslations("connected.incidents.category");
  const { pending, error, run } = useGuestRun();
  const [f, setF] = useState({ category: "breakdown", description: "", urgent: false });
  const [ok, setOk] = useState(false);
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        run(() => guestReportProblem(token, { ...f, description: f.description.trim() }), () => (setOk(true), setF({ category: "breakdown", description: "", urgent: false })));
      }}
    >
      <Field label={t("problem.category")} htmlFor="gp-cat">
        <Select id="gp-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {PROBLEM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("problem.description")} htmlFor="gp-desc">
        <Textarea id="gp-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} data-testid="guest-problem-description" />
      </Field>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} />
        {t("problem.urgent")}
      </label>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      {ok && <p role="status" className="text-[14px] text-success" data-testid="guest-problem-ok">{t("problem.sent")}</p>}
      <Button type="submit" disabled={pending || f.description.trim().length < 3} data-testid="guest-problem-send">
        {t("problem.send")}
      </Button>
    </form>
  );
}

const INTERESTS = ["food", "activities", "relax", "culture", "family", "nature", "sport", "shopping", "local"] as const;
const STYLES = ["calm", "discovery", "family", "romantic", "business"] as const;
const WISHES = ["restaurant", "experience", "airport_transfer", "driver", "grocery", "extra_cleaning", "extra_linen", "private_chef", "spa", "babysitter"] as const;
const BUDGETS = ["moderate", "comfort", "premium"] as const;
const LANGS = ["fr", "en", "es", "pt", "it", "de"] as const;
type Answers = { adults?: number; children?: number; babies?: number; interests?: string[]; style?: string; services?: string[]; budget?: string; constraints?: string; other?: string; language?: string };

/**
 * « Préparons votre séjour » : court, facultatif, enregistrable à tout moment.
 * Les réponses servent uniquement à l'équipe qui prépare ce séjour ; rien n'est réservé automatiquement.
 */
export function GuestPrepForm({
  token,
  questions,
  initial,
  status,
  updatedAt,
  editable,
  stay,
}: {
  token: string;
  questions: string[];
  initial: Answers;
  status: string;
  updatedAt: string | null;
  editable: boolean;
  stay: { adults: number; children: number; babies: number };
}) {
  const t = useTranslations("guestSpace.prep");
  const tk = useTranslations("serviceKind");
  const f = useFormatter();
  const { pending, error, run } = useGuestRun();
  const [a, setA] = useState<Answers>({ adults: stay.adults, children: stay.children, babies: stay.babies, ...initial });
  const [done, setDone] = useState<"saved" | "sent" | "deleted" | null>(null);
  const on = (q: string) => questions.includes(q);
  const toggle = (k: "interests" | "services", v: string) => {
    const cur = a[k] ?? [];
    setA({ ...a, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const chip = (k: "interests" | "services", v: string, label: string) => {
    const sel = (a[k] ?? []).includes(v);
    return (
      <label key={v} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[14px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${sel ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface"}`}>
        <input type="checkbox" className="sr-only" checked={sel} disabled={!editable} onChange={() => toggle(k, v)} data-testid={`prep-${k}-${v}`} />
        {label}
      </label>
    );
  };
  const submitted = status === "submitted";
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => guestSavePreparation(token, a as Record<string, unknown>, true), () => setDone("sent"));
      }}
      aria-describedby="prep-why"
      data-testid="guest-prep"
    >
      <div className="space-y-1">
        <p className="text-[15px]">{t("intro")}</p>
        <p className="text-[14px] font-medium">{t("notConfirmed")}</p>
        <p id="prep-why" className="text-[13px] text-muted">{t("why")}</p>
        {updatedAt && <p className="text-[13px] text-muted" data-testid="prep-updated">{t(submitted ? "sentOn" : "savedOn", { date: f.dateTime(new Date(updatedAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>}
        {!editable && <p className="text-[13px] text-warning" data-testid="prep-locked">{t("locked")}</p>}
      </div>
      {on("guests") && (
        <fieldset className="space-y-2">
          <legend className="text-[15px] font-semibold">{t("guests")}</legend>
          <div className="grid grid-cols-3 gap-3">
            {(["adults", "children", "babies"] as const).map((k) => (
              <Field key={k} label={t(`guestsKinds.${k}`)} htmlFor={`prep-${k}`}>
                <Input id={`prep-${k}`} type="number" min={0} max={30} inputMode="numeric" value={a[k] ?? 0} disabled={!editable} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
        </fieldset>
      )}
      {on("interests") && (
        <fieldset className="space-y-2">
          <legend className="text-[15px] font-semibold">{t("interests")} <span className="text-[13px] font-normal text-muted">({t("optional")})</span></legend>
          <div className="flex flex-wrap gap-2">{INTERESTS.map((v) => chip("interests", v, t(`interest.${v}`)))}</div>
        </fieldset>
      )}
      {on("style") && (
        <Field label={`${t("style")} (${t("optional")})`} htmlFor="prep-style">
          <Select id="prep-style" value={a.style ?? ""} disabled={!editable} onChange={(e) => setA({ ...a, style: e.target.value || undefined })} data-testid="prep-style">
            <option value="">{t("skip")}</option>
            {STYLES.map((v) => (
              <option key={v} value={v}>
                {t(`styles.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {on("services") && (
        <fieldset className="space-y-2">
          <legend className="text-[15px] font-semibold">{t("services")} <span className="text-[13px] font-normal text-muted">({t("optional")})</span></legend>
          <p className="text-[13px] text-muted">{t("servicesHint")}</p>
          <div className="flex flex-wrap gap-2">{WISHES.map((v) => chip("services", v, tk(v)))}</div>
        </fieldset>
      )}
      {on("budget") && (
        <Field label={`${t("budget")} (${t("optional")})`} htmlFor="prep-budget" hint={t("budgetHint")}>
          <Select id="prep-budget" value={a.budget ?? ""} disabled={!editable} onChange={(e) => setA({ ...a, budget: e.target.value || undefined })}>
            <option value="">{t("noAnswer")}</option>
            {BUDGETS.map((v) => (
              <option key={v} value={v}>
                {t(`budgets.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {on("constraints") && (
        <Field label={`${t("constraints")} (${t("optional")})`} htmlFor="prep-constraints" hint={t("constraintsHint")}>
          <Textarea id="prep-constraints" value={a.constraints ?? ""} maxLength={1000} disabled={!editable} onChange={(e) => setA({ ...a, constraints: e.target.value })} />
        </Field>
      )}
      {on("other") && (
        <Field label={`${t("other")} (${t("optional")})`} htmlFor="prep-other">
          <Textarea id="prep-other" value={a.other ?? ""} maxLength={1000} disabled={!editable} onChange={(e) => setA({ ...a, other: e.target.value })} data-testid="prep-other" />
        </Field>
      )}
      {on("language") && (
        <Field label={`${t("language")} (${t("optional")})`} htmlFor="prep-lang">
          <Select id="prep-lang" value={a.language ?? ""} disabled={!editable} onChange={(e) => setA({ ...a, language: e.target.value || undefined })}>
            <option value="">{t("noAnswer")}</option>
            {LANGS.map((v) => (
              <option key={v} value={v}>
                {v.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending} data-testid="prep-send">
            {submitted ? t("update") : t("send")}
          </Button>
          {!submitted && (
            <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => guestSavePreparation(token, a as Record<string, unknown>, false), () => setDone("saved"))} data-testid="prep-save">
              {t("saveDraft")}
            </Button>
          )}
          {(submitted || status === "in_progress") && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => guestDeletePreparation(token), () => (setA({}), setDone("deleted")))} data-testid="prep-delete">
              {t("delete")}
            </Button>
          )}
        </div>
      )}
      {done && (
        <p role="status" className="text-[14px] text-success" data-testid="prep-done">
          {t(`done.${done}`)}
        </p>
      )}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </form>
  );
}

/** Accueil VIP : une demande d'étude, jamais une confirmation tant que l'équipe n'a pas décidé. */
export function GuestVip({
  token,
  motifs,
  request,
  confirmed,
}: {
  token: string;
  motifs: { id: string; label: string }[];
  request: { status: string; message: string | null } | null;
  confirmed: boolean;
}) {
  const t = useTranslations("guestSpace.vip");
  const { pending, error, run } = useGuestRun();
  const [motif, setMotif] = useState(motifs[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  if (confirmed)
    return (
      <p className="rounded-lg bg-success-soft p-3 text-[15px] font-medium text-success" data-testid="vip-confirmed">
        {t("confirmed")}
      </p>
    );
  if (request && (request.status === "pending" || request.status === "info_requested"))
    return (
      <div className="space-y-2" data-testid="vip-pending">
        <p className="text-[15px] font-medium">{t("sent")}</p>
        <p className="text-[14px] text-muted">{request.status === "pending" ? t("pending") : t("question")}</p>
        {request.status === "info_requested" && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => guestReplyVip(token, reply), () => setReply(""));
            }}
          >
            {request.message && <p className="text-[15px]">« {request.message} »</p>}
            <Field label={t("answer")} htmlFor="vip-reply">
              <Textarea id="vip-reply" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={300} data-testid="vip-reply" />
            </Field>
            <Button type="submit" size="sm" disabled={pending || !reply.trim()} data-testid="vip-reply-send">
              {t("send")}
            </Button>
          </form>
        )}
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => guestRequestVip(token, motif || null, note), () => setNote(""));
      }}
      data-testid="vip-form"
    >
      {request?.status === "refused" && (
        <p className="rounded-lg bg-subtle p-3 text-[14px] dark:bg-surface-hover" data-testid="vip-refused">
          {t("refused")}
          {request.message && <span className="mt-1 block">« {request.message} »</span>}
        </p>
      )}
      <p className="text-[14px] text-muted">{t("text")}</p>
      {motifs.length > 0 && (
        <Field label={t("motif")} htmlFor="vip-motif">
          <Select id="vip-motif" value={motif} onChange={(e) => setMotif(e.target.value)} data-testid="vip-motif">
            {motifs.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="">{t("otherMotif")}</option>
          </Select>
        </Field>
      )}
      <Field label={t("note")} htmlFor="vip-note">
        <Input id="vip-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} data-testid="vip-note" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending} data-testid="vip-request">
        {t("request")}
      </Button>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </form>
  );
}
