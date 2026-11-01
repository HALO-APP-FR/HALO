"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, Star } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { addImportedReview, createReviewLink, followReview, publishShowcase, saveOwner, saveShowcase, submitReview } from "@/lib/connected/review-actions";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

function Stars({ value, onChange, label, id }: { value: number | null; onChange: (v: number | null) => void; label: string; id: string }) {
  const t = useTranslations("reviewPortal");
  return (
    <fieldset className="space-y-1" data-testid={`stars-${id}`}>
      <legend className="text-[14px] font-medium">{label}</legend>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={t("starsLabel", { n })}
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className="rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            data-testid={`star-${id}-${n}`}
          >
            <Star className={cn("size-7", value != null && n <= value ? "fill-accent text-accent" : "text-faint")} />
          </button>
        ))}
        {value != null && <span className="ms-2 text-[13px] text-muted">{value}/5</span>}
      </div>
    </fieldset>
  );
}

/** Formulaire de l'auteur (voyageur ou propriétaire) : note globale obligatoire, le reste facultatif. */
export function ReviewForm({
  token,
  kind,
  questions,
  initial,
  editable,
}: {
  token: string;
  kind: "guest" | "owner";
  questions: string[];
  initial: { overall: number; ratings: Record<string, number>; comment: string | null; would_return: boolean | null; author_label: string | null; consent_publish: boolean } | null;
  editable: boolean;
}) {
  const t = useTranslations("reviewPortal");
  const te = useTranslations("reviewPortal.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [overall, setOverall] = useState<number | null>(initial?.overall ?? null);
  const [ratings, setRatings] = useState<Record<string, number | null>>(initial?.ratings ?? {});
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [ret, setRet] = useState<boolean | null>(initial?.would_return ?? null);
  const [label, setLabel] = useState(initial?.author_label ?? "");
  const [consent, setConsent] = useState(initial?.consent_publish ?? false);
  if (!editable && initial) return <p className="text-[14px] text-muted" data-testid="review-locked">{t("locked")}</p>;
  return (
    <form
      className="space-y-5"
      data-testid="review-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!overall) return setError(te("overall_required"));
        setError(null);
        setOk(false);
        start(async () => {
          try {
            const clean = Object.fromEntries(Object.entries(ratings).filter(([, v]) => typeof v === "number")) as Record<string, number>;
            const r = await submitReview(token, { overall, ratings: clean, comment, wouldReturn: ret, label, consent });
            if (!r.ok) return setError(te.has(r.error) ? te(r.error) : te("server"));
            setOk(true);
            router.refresh();
          } catch {
            setError(te("network"));
          }
        });
      }}
    >
      <Stars id="overall" value={overall} onChange={setOverall} label={t(`overall.${kind}`)} />
      <div className="grid gap-4 sm:grid-cols-2">
        {questions.map((q) => (
          <Stars key={q} id={q} value={ratings[q] ?? null} onChange={(v) => setRatings({ ...ratings, [q]: v })} label={t(`q.${q}`)} />
        ))}
      </div>
      <p className="text-[12px] text-muted">{t("optional")}</p>
      <fieldset>
        <legend className="text-[14px] font-medium">{t(`return.${kind}`)}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {([true, false, null] as const).map((v) => (
            <Button key={String(v)} type="button" size="sm" variant={ret === v ? "primary" : "outline"} onClick={() => setRet(v)} aria-pressed={ret === v} data-testid={`return-${String(v)}`}>
              {v === true ? t("yes") : v === false ? t("no") : t("noAnswer")}
            </Button>
          ))}
        </div>
      </fieldset>
      <Field label={t("comment")} htmlFor="rv-comment">
        <Textarea id="rv-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} data-testid="review-comment" />
      </Field>
      <div className="rounded-md border border-line p-3">
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="review-consent" />
          <span>{t("consent")}</span>
        </label>
        {consent && (
          <Field label={t("label")} htmlFor="rv-label" hint={t("labelHint")} className="mt-3">
            <Input id="rv-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} data-testid="review-label" />
          </Field>
        )}
        <p className="mt-2 text-[12px] text-muted">{t("consentHint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {error && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
        {ok && (
          <p role="status" className="text-[14px] text-success" data-testid="review-ok">
            {t("thanks")}
          </p>
        )}
        <Button type="submit" className="ms-auto" disabled={pending} data-testid="review-send">
          {initial ? t("update") : t("send")}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Côté équipe
// ---------------------------------------------------------------------------
export function ReviewFollow({ id, note, hasIncident, canIncident }: { id: string; status: string; note: string | null; hasIncident: boolean; canIncident: boolean }) {
  const t = useTranslations("connected.reviews");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ status: "handled", note: note ?? "", incident: false });
  if (!open)
    return (
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)} data-testid="review-follow-open">
        {t("follow")}
      </Button>
    );
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => followReview(id, f.status as "new" | "to_handle" | "handled", f.note, f.incident), () => setOpen(false));
      }}
    >
      <Field label={t("followStatus")} htmlFor={`fs-${id}`}>
        <Select id={`fs-${id}`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="review-follow-status">
          {["to_handle", "handled", "new"].map((s) => (
            <option key={s} value={s}>
              {t(`followState.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("followNote")} htmlFor={`fn-${id}`} hint={t("followNoteHint")}>
        <Textarea id={`fn-${id}`} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} />
      </Field>
      {!hasIncident && canIncident && (
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={f.incident} onChange={(e) => setF({ ...f, incident: e.target.checked })} data-testid="review-make-incident" />
          <span>{t("makeIncident")}</span>
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="review-follow-save">
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </form>
  );
}

export function ImportedReviewForm({ properties }: { properties: { id: string; name: string }[] }) {
  const t = useTranslations("connected.reviews");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const blank = { kind: "guest" as "guest" | "owner", overall: 5, comment: "", from: "", date: "", propertyId: "" };
  const [f, setF] = useState(blank);
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="imported-open">
        {t("importedAdd")}
      </Button>
    );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addImportedReview({ ...f, propertyId: f.propertyId || null }), () => (setOpen(false), setF(blank)));
      }}
    >
      <p className="text-[13px] text-muted sm:col-span-2">{t("importedText")}</p>
      <Field label={t("kind")} htmlFor="ir-kind">
        <Select id="ir-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "guest" | "owner" })}>
          <option value="guest">{t("kindName.guest")}</option>
          <option value="owner">{t("kindName.owner")}</option>
        </Select>
      </Field>
      <Field label={t("overallShort")} htmlFor="ir-overall">
        <Select id="ir-overall" value={f.overall} onChange={(e) => setF({ ...f, overall: Number(e.target.value) })}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n}/5
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("importedFrom")} htmlFor="ir-from" hint={t("importedFromHint")}>
        <Input id="ir-from" value={f.from} maxLength={80} onChange={(e) => setF({ ...f, from: e.target.value })} required data-testid="imported-from" />
      </Field>
      <Field label={t("importedDate")} htmlFor="ir-date">
        <Input id="ir-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required data-testid="imported-date" />
      </Field>
      <Field label={t("property")} htmlFor="ir-prop" className="sm:col-span-2">
        <Select id="ir-prop" value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })}>
          <option value="">{t("noProperty")}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("comment")} htmlFor="ir-comment" className="sm:col-span-2">
        <Textarea id="ir-comment" value={f.comment} maxLength={2000} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="imported-save">
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && <p role="alert" className="text-[14px] text-danger sm:col-span-2">{error}</p>}
    </form>
  );
}

export function OwnerForm({ owner, properties }: { owner: { id: string; name: string; email: string | null; phone: string | null; propertyIds: string[] } | null; properties: { id: string; name: string }[] }) {
  const t = useTranslations("connected.reviews.owners");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: owner?.name ?? "", email: owner?.email ?? "", phone: owner?.phone ?? "", propertyIds: owner?.propertyIds ?? [] });
  if (!open)
    return (
      <Button size="sm" variant={owner ? "ghost" : "primary"} onClick={() => setOpen(true)} data-testid={owner ? "owner-edit" : "owner-add"}>
        {owner ? t("edit") : t("add")}
      </Button>
    );
  return (
    <form
      className="mt-3 grid w-full gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveOwner({ id: owner?.id ?? null, ...f }), () => setOpen(false));
      }}
      data-testid="owner-form"
    >
      <Field label={t("name")} htmlFor={`on-${owner?.id ?? "new"}`}>
        <Input id={`on-${owner?.id ?? "new"}`} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="owner-name" />
      </Field>
      <Field label={t("email")} htmlFor={`oe-${owner?.id ?? "new"}`} hint={t("emailHint")}>
        <Input id={`oe-${owner?.id ?? "new"}`} type="email" value={f.email} maxLength={254} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="owner-email" />
      </Field>
      <Field label={t("phone")} htmlFor={`op-${owner?.id ?? "new"}`}>
        <Input id={`op-${owner?.id ?? "new"}`} value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="text-[13px] font-medium text-muted">{t("properties")}</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {properties.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={f.propertyIds.includes(p.id)}
                onChange={(e) => setF({ ...f, propertyIds: e.target.checked ? [...f.propertyIds, p.id] : f.propertyIds.filter((x) => x !== p.id) })}
                data-testid="owner-property"
              />
              {p.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-muted">{t("propertiesHint")}</p>
      </fieldset>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="owner-save">
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && <p role="alert" className="text-[14px] text-danger sm:col-span-2">{error}</p>}
    </form>
  );
}

export function OwnerReviewLink({ ownerId, hasEmail, linked }: { ownerId: string; hasEmail: boolean; linked: boolean }) {
  const t = useTranslations("connected.reviews.owners");
  const tl = useTranslations("connected.link");
  const tj = useTranslations("connected.link.journey");
  const locale = useLocale();
  const { pending, error, run } = useRun();
  const [url, setUrl] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!linked) return <p className="text-[13px] text-muted">{t("needProperty")}</p>;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {hasEmail && (
          <Button size="sm" disabled={pending} data-testid="owner-review-send" onClick={() => run(() => createReviewLink("owner", ownerId, true, locale), (d) => (setDel(d.delivery), setUrl(`${origin}/${locale}/avis/${d.token}`)))}>
            {t("askReview")}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={pending} data-testid="owner-review-copy" onClick={() => run(() => createReviewLink("owner", ownerId, false, locale), (d) => (setDel(null), setUrl(`${origin}/${locale}/avis/${d.token}`)))}>
          {t("copyLink")}
        </Button>
      </div>
      {del && (
        <p className="text-[13px]" data-testid="owner-review-delivery" data-status={del}>
          {tj("sent")} · {tj(`delivery.${["sent", "pending", "failed", "not_configured", "skipped"].includes(del) ? del : "failed"}`)}
        </p>
      )}
      {url && (
        <div className="rounded-md border border-accent bg-accent-soft p-3">
          <p className="text-[13px] font-medium">{tl("copyOnce")}</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="owner-review-url" />
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
              <Copy />
              {copied ? tl("copied") : tl("copy")}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}

export interface ShowcaseState {
  slug: string;
  title: string;
  intro: string;
  services: string;
  contact: string;
  months: number;
  guest: boolean;
  owner: boolean;
  testimonials: string[];
  publishedAt: string | null;
}

export function ShowcaseEditor({ initial, candidates }: { initial: ShowcaseState; candidates: { id: string; kind: string; overall: number; comment: string; author: string | null }[] }) {
  const t = useTranslations("connected.reviews.showcase");
  const { pending, error, run } = useRun();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify({ ...f, publishedAt: null }) !== JSON.stringify({ ...initial, publishedAt: null });
  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          run(() => saveShowcase(f), () => setSaved(true));
        }}
        data-testid="showcase-form"
      >
        <Field label={t("slug")} htmlFor="sc-slug" hint={t("slugHint")}>
          <Input id="sc-slug" value={f.slug} pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} required data-testid="showcase-slug" />
        </Field>
        <Field label={t("titleField")} htmlFor="sc-title">
          <Input id="sc-title" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} required data-testid="showcase-title" />
        </Field>
        <Field label={t("intro")} htmlFor="sc-intro" className="sm:col-span-2">
          <Textarea id="sc-intro" value={f.intro} maxLength={2000} onChange={(e) => setF({ ...f, intro: e.target.value })} />
        </Field>
        <Field label={t("services")} htmlFor="sc-services">
          <Textarea id="sc-services" value={f.services} maxLength={1000} onChange={(e) => setF({ ...f, services: e.target.value })} />
        </Field>
        <Field label={t("contact")} htmlFor="sc-contact" hint={t("contactHint")}>
          <Textarea id="sc-contact" value={f.contact} maxLength={300} onChange={(e) => setF({ ...f, contact: e.target.value })} />
        </Field>
        <Field label={t("period")} htmlFor="sc-months">
          <Select id="sc-months" value={f.months} onChange={(e) => setF({ ...f, months: Number(e.target.value) })}>
            {[3, 6, 12, 24, 36].map((m) => (
              <option key={m} value={m}>
                {t("months", { count: m })}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-[13px] font-medium text-muted">{t("scores")}</legend>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={f.guest} onChange={(e) => setF({ ...f, guest: e.target.checked })} />
            {t("showGuest")}
          </label>
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={f.owner} onChange={(e) => setF({ ...f, owner: e.target.checked })} />
            {t("showOwner")}
          </label>
          <p className="text-[12px] text-muted">{t("scoresHint")}</p>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] font-medium text-muted">{t("testimonials")}</legend>
          <p className="text-[12px] text-muted">{t("testimonialsHint")}</p>
          {candidates.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">{t("noCandidates")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex items-start gap-2 text-[14px]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={f.testimonials.includes(c.id)}
                      onChange={(e) => setF({ ...f, testimonials: e.target.checked ? [...f.testimonials, c.id] : f.testimonials.filter((x) => x !== c.id) })}
                      data-testid="showcase-testimonial"
                    />
                    <span>
                      <span className="font-medium">
                        {c.overall}/5 · {c.author ?? t(`anon.${c.kind}`)}
                      </span>{" "}
                      — {c.comment}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending || !dirty} data-testid="showcase-save">
            {t("save")}
          </Button>
          {saved && !dirty && <span className="text-[13px] text-success">{t("saved")}</span>}
          {dirty && <span className="text-[13px] text-muted">{t("unsaved")}</span>}
        </div>
      </form>
      <div className="rounded-lg border border-line p-4" data-testid="showcase-publish">
        <p className="text-[14px] font-medium">{initial.publishedAt ? t("isPublished") : t("notPublished")}</p>
        <p className="mt-1 text-[13px] text-muted">{t("publishText")}</p>
        <div className="mt-3 flex gap-2">
          {initial.publishedAt ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => publishShowcase(false))} data-testid="showcase-unpublish">
              {t("unpublish")}
            </Button>
          ) : (
            <Button size="sm" disabled={pending || dirty || !initial.slug} onClick={() => run(() => publishShowcase(true))} data-testid="showcase-publish-btn">
              {t("publish")}
            </Button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}
