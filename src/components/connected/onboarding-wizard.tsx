"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, Info, Sparkles } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { applyConfiguration, saveOnboarding, type OnboardingSave } from "@/lib/connected/actions";
import {
  ACTIVITY_TYPES,
  ALERTS,
  SERVICE_KINDS,
  TASK_TYPES,
  channelOptions,
  isHotelLike,
  issueOptions,
  proposeConfiguration,
  type ActivityType,
  type Answers,
  type ChecklistRoom,
  type Proposal,
} from "@/lib/onboarding/propose";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type OrgFields = NonNullable<OnboardingSave["org"]> & { name: string; country_code: string };
export interface WizardInitial {
  email: string;
  profile: { full_name: string; job_title: string; phone: string };
  org: OrgFields & { activity_type: ActivityType | null; unit_count: number | null; cleaning_model: string | null; linen_model: string | null };
  onboarding: { step?: string; skipped?: string[]; answers?: Record<string, string | boolean | null>; completed_at?: string };
}

type Step = "profile" | "organization" | "activity" | "operations" | "services" | "issues" | "channels" | "proposals";
type Decision = "accepted" | "modified" | "ignored";

function Choice({ selected, onClick, children, testId }: { selected: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-start text-[15px] transition-colors",
        selected ? "border-accent bg-accent-soft text-fg" : "border-line bg-surface hover:bg-surface-hover",
      )}
    >
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-sm border", selected ? "border-accent bg-accent text-on-accent" : "border-line")}>
        {selected && <Check className="size-3.5" />}
      </span>
      {children}
    </button>
  );
}

export function OnboardingWizard({ initial }: { initial: WizardInitial }) {
  const t = useTranslations("connected.onb");
  const te = useTranslations("connected.errors");
  const ts = useTranslations("serviceKind");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState(initial.profile);
  const [org, setOrg] = useState(initial.org);
  const [answers, setAnswers] = useState<Record<string, string | boolean | null>>(initial.onboarding.answers ?? {});

  const steps = useMemo<Step[]>(() => {
    const s: Step[] = ["profile", "organization", "activity", "operations", "services", "issues"];
    if (channelOptions(org.activity_type).length) s.push("channels");
    s.push("proposals");
    return s;
  }, [org.activity_type]);
  const resumeAt = steps.includes(initial.onboarding.step as Step) ? (initial.onboarding.step as Step) : "profile";
  const [step, setStep] = useState<Step>(initial.onboarding.completed_at ? "proposals" : resumeAt);
  const idx = steps.indexOf(step);
  const hotel = isHotelLike(org.activity_type);

  const toggle = (list: string[] | undefined, v: string) => ((list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]);

  function payloadFor(s: Step): Omit<OnboardingSave, "state"> {
    switch (s) {
      case "profile":
        return { profile: { full_name: profile.full_name.trim(), job_title: profile.job_title.trim() || undefined, phone: profile.phone.trim() || undefined } };
      case "organization":
        return {
          org: {
            name: org.name.trim() || initial.org.name,
            legal_name: org.legal_name?.trim() || undefined,
            country_code: org.country_code,
            address_line: org.address_line?.trim() || undefined,
            postal_code: org.postal_code?.trim() || undefined,
            city: org.city?.trim() || undefined,
          },
        };
      case "activity":
        return { org: { ...(org.activity_type ? { activity_type: org.activity_type } : {}), unit_count: org.unit_count } };
      case "operations":
        return {
          org: { ...(org.cleaning_model ? { cleaning_model: org.cleaning_model } : {}), ...(org.linen_model ? { linen_model: org.linen_model } : {}) },
          answers: { validation_policy: answers.validation_policy ?? null, welcome_service: answers.welcome_service ?? null, room_inspection: answers.room_inspection ?? null },
        };
      case "services":
        return { org: { services_offered: org.services_offered ?? [] } };
      case "issues":
        return { org: { frequent_issues: (org.frequent_issues ?? []).filter((i) => issueOptions(org.activity_type).includes(i)) } };
      case "channels":
        return { org: { tools: org.tools ?? [] } };
      default:
        return {};
    }
  }

  function go(next: Step | "later", opts: { skip?: boolean } = {}) {
    setError(null);
    start(async () => {
      const data = opts.skip ? {} : payloadFor(step);
      const res = await saveOnboarding({ ...data, state: { step: next === "later" ? step : next, skipped: opts.skip ? [step] : [] } });
      if (!res.ok) return setError(te(res.error));
      if (next === "later") {
        router.push("/app");
        router.refresh();
      } else setStep(next);
    });
  }
  const nextStep = steps[idx + 1] ?? "proposals";

  const radio = (name: string, options: readonly string[], value: string | null | undefined, set: (v: string) => void, labelKey: string) => (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t(`${labelKey}.label`)}>
      {options.map((o) => (
        <Choice key={o} selected={value === o} onClick={() => set(o)} testId={`${name}-${o}`}>
          {t(`${labelKey}.${o}`)}
        </Choice>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-muted" data-testid="onb-progress">
          {t("progress", { n: idx + 1, total: steps.length })}
        </p>
        <Button variant="ghost" size="sm" onClick={() => go("later")} disabled={pending} data-testid="onb-later">
          {t("later")}
        </Button>
      </div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-subtle dark:bg-surface-hover">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
      </div>

      {step === "proposals" ? (
        <Proposals initial={initial} org={org} answers={answers} onBack={() => setStep(steps[idx - 1])} />
      ) : (
        <Card className="p-5 md:p-7">
          <h1 className="text-title-2" data-testid="onb-title">
            {t(`${step}.title`)}
          </h1>
          <p className="mt-1 text-[15px] text-muted">{t(`${step}.text`)}</p>
          <div className="mt-6 space-y-5">
            {step === "profile" && (
              <>
                <p className="rounded-md bg-subtle px-3 py-2 text-[14px] text-muted dark:bg-surface-hover">{t("profile.known", { email: initial.email })}</p>
                <Field label={t("profile.fullName")} htmlFor="p-name">
                  <Input id="p-name" value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} autoComplete="name" />
                </Field>
                <Field label={t("profile.jobTitle")} htmlFor="p-job" hint={t("optional")}>
                  <Input id="p-job" value={profile.job_title} onChange={(e) => setProfile({ ...profile, job_title: e.target.value })} />
                </Field>
                <Field label={t("profile.phone")} htmlFor="p-phone" hint={t("profile.phoneHint")}>
                  <Input id="p-phone" type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} autoComplete="tel" />
                </Field>
              </>
            )}
            {step === "organization" && (
              <>
                <Field label={t("organization.name")} htmlFor="o-name">
                  <Input id="o-name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
                </Field>
                <Field label={t("organization.legalName")} htmlFor="o-legal" hint={t("optional")}>
                  <Input id="o-legal" value={org.legal_name ?? ""} onChange={(e) => setOrg({ ...org, legal_name: e.target.value })} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                  <Field label={t("organization.country")} htmlFor="o-country">
                    <Select id="o-country" value={org.country_code} onChange={(e) => setOrg({ ...org, country_code: e.target.value })}>
                      {["FR", "BE", "CH", "LU", "MC", "ES", "PT", "IT", "DE", "GB", "US", "CA", "MA"].map((c) => (
                        <option key={c} value={c}>
                          {t(`countries.${c}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("organization.address")} htmlFor="o-addr" hint={t("optional")}>
                    <Input id="o-addr" value={org.address_line ?? ""} onChange={(e) => setOrg({ ...org, address_line: e.target.value })} autoComplete="street-address" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                  <Field label={t("organization.postalCode")} htmlFor="o-zip">
                    <Input id="o-zip" value={org.postal_code ?? ""} onChange={(e) => setOrg({ ...org, postal_code: e.target.value })} autoComplete="postal-code" />
                  </Field>
                  <Field label={t("organization.city")} htmlFor="o-city">
                    <Input id="o-city" value={org.city ?? ""} onChange={(e) => setOrg({ ...org, city: e.target.value })} />
                  </Field>
                </div>
                <p className="flex gap-2 text-[14px] text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  {t("organization.noLegal")}
                </p>
              </>
            )}
            {step === "activity" && (
              <>
                {radio("activity", ACTIVITY_TYPES, org.activity_type, (v) => setOrg({ ...org, activity_type: v as ActivityType }), "activity")}
                <Field label={hotel ? t("activity.roomCount") : t("activity.unitCount")} htmlFor="a-units" hint={t("activity.approx")}>
                  <Input
                    id="a-units"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={org.unit_count ?? ""}
                    onChange={(e) => setOrg({ ...org, unit_count: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                    className="max-w-40"
                  />
                </Field>
              </>
            )}
            {step === "operations" && (
              <>
                <div className="space-y-2">
                  <p className="text-[13px] font-medium text-muted">{t("cleaning.label")}</p>
                  {radio("cleaning", ["internal", "providers", "both"], org.cleaning_model, (v) => setOrg({ ...org, cleaning_model: v }), "cleaning")}
                </div>
                <div className="space-y-2">
                  <p className="text-[13px] font-medium text-muted">{t("linen.label")}</p>
                  {radio("linen", ["internal", "laundry", "both", "none"], org.linen_model, (v) => setOrg({ ...org, linen_model: v }), "linen")}
                </div>
                <div className="space-y-2">
                  <p className="text-[13px] font-medium text-muted">{t("validation.label")}</p>
                  {radio("validation", ["all", "turnover", "none"], answers.validation_policy as string, (v) => setAnswers({ ...answers, validation_policy: v }), "validation")}
                </div>
                {hotel ? (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-muted">{t("roomInspection.label")}</p>
                    {radio("inspection", ["yes", "no"], answers.room_inspection == null ? null : answers.room_inspection ? "yes" : "no", (v) => setAnswers({ ...answers, room_inspection: v === "yes" }), "yesNo")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-muted">{t("welcome.label")}</p>
                    {radio("welcome", ["yes", "no"], answers.welcome_service == null ? null : answers.welcome_service ? "yes" : "no", (v) => setAnswers({ ...answers, welcome_service: v === "yes" }), "yesNo")}
                  </div>
                )}
              </>
            )}
            {step === "services" && (
              <div className="grid gap-2 sm:grid-cols-2">
                {SERVICE_KINDS.map((k) => (
                  <Choice key={k} selected={(org.services_offered ?? []).includes(k)} onClick={() => setOrg({ ...org, services_offered: toggle(org.services_offered, k) })} testId={`service-${k}`}>
                    {ts(k)}
                  </Choice>
                ))}
              </div>
            )}
            {step === "issues" && (
              <div className="grid gap-2 sm:grid-cols-2">
                {issueOptions(org.activity_type).map((k) => (
                  <Choice key={k} selected={(org.frequent_issues ?? []).includes(k)} onClick={() => setOrg({ ...org, frequent_issues: toggle(org.frequent_issues, k) })} testId={`issue-${k}`}>
                    {t(`issues.${k}`)}
                  </Choice>
                ))}
              </div>
            )}
            {step === "channels" && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {channelOptions(org.activity_type).map((k) => (
                    <Choice key={k} selected={(org.tools ?? []).includes(k)} onClick={() => setOrg({ ...org, tools: toggle(org.tools, k) })} testId={`channel-${k}`}>
                      {t(`channels.${k}`)}
                    </Choice>
                  ))}
                </div>
                <p className="flex gap-2 text-[14px] text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  {t("channels.notConnected")}
                </p>
              </>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-4 text-[14px] text-danger">
              {error}
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-2">
            {idx > 0 && (
              <Button variant="ghost" onClick={() => setStep(steps[idx - 1])} disabled={pending}>
                <ChevronLeft className="rtl:-scale-x-100" />
                {t("back")}
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="outline" onClick={() => go(nextStep, { skip: true })} disabled={pending} data-testid="onb-skip">
              {t("skip")}
            </Button>
            <Button onClick={() => go(nextStep)} disabled={pending || (step === "profile" && !profile.full_name.trim())} data-testid="onb-next">
              {t("next")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Proposals({ initial, org, answers, onBack }: { initial: WizardInitial; org: WizardInitial["org"]; answers: Record<string, string | boolean | null>; onBack: () => void }) {
  const t = useTranslations("connected.onb");
  const te = useTranslations("connected.errors");
  const tt = useTranslations("taskType");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const base = useMemo(() => {
    const a: Answers = {
      activity_type: org.activity_type,
      unit_count: org.unit_count,
      cleaning_model: org.cleaning_model as Answers["cleaning_model"],
      linen_model: org.linen_model as Answers["linen_model"],
      validation_policy: (answers.validation_policy as Answers["validation_policy"]) ?? null,
      welcome_service: (answers.welcome_service as boolean | null) ?? null,
      room_inspection: (answers.room_inspection as boolean | null) ?? null,
      services_offered: org.services_offered,
      frequent_issues: org.frequent_issues,
    };
    return proposeConfiguration(a, (k) => t(`labels.${k}`));
  }, [org, answers, t]);

  const [values, setValues] = useState<Record<string, Proposal["value"]>>(() => Object.fromEntries(base.proposals.map((p) => [p.id, p.value])));
  const [decisions, setDecisions] = useState<Record<string, Decision | undefined>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const done = Boolean(initial.onboarding.completed_at);

  const decided = base.proposals.every((p) => decisions[p.id]);
  const keep = (id: string) => decisions[id] === "accepted" || decisions[id] === "modified";

  function confirm() {
    setError(null);
    start(async () => {
      const res = await applyConfiguration({
        decisions: Object.fromEntries(base.proposals.map((p) => [p.id, decisions[p.id] ?? "ignored"])) as Record<string, Decision>,
        ...(keep("task_types") ? { task_types: values.task_types as string[] } : {}),
        ...(keep("checklist") ? { default_checklist: values.checklist as ChecklistRoom[] } : {}),
        ...(keep("validation") ? { validation_task_types: values.validation as string[] } : {}),
        ...(keep("alerts") ? { alerts: values.alerts as string[] } : {}),
        ...(keep("linen") ? { linen_turnaround_days: values.linen as number } : {}),
      });
      if (!res.ok) return setError(te(res.error));
      router.push("/app/properties?first=1");
      router.refresh();
    });
  }

  const setDecision = (id: string, d: Decision) => {
    setDecisions((s) => ({ ...s, [id]: d }));
    if (d !== "modified") setEditing((e) => (e === id ? null : e));
    if (d === "accepted") setValues((v) => ({ ...v, [id]: base.proposals.find((p) => p.id === id)!.value }));
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 md:p-7">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-text">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h1 className="text-title-2" data-testid="onb-title">
              {t("proposals.title")}
            </h1>
            <p className="mt-1 text-[15px] text-muted">{t("proposals.text")}</p>
          </div>
        </div>
        {done && <p className="mt-4 rounded-md bg-subtle px-3 py-2 text-[14px] text-muted dark:bg-surface-hover">{t("proposals.alreadyDone")}</p>}
      </Card>

      {base.proposals.map((p) => {
        const d = decisions[p.id];
        const v = values[p.id];
        return (
          <Card key={p.id} className={cn("p-5", d === "ignored" && "opacity-60")} data-testid={`proposal-${p.id}`}>
            <h2 className="text-[17px] font-semibold">{t(`proposals.${p.id}.title`)}</h2>
            <ul className="mt-2 space-y-1">
              {p.reasons.map((r) => (
                <li key={r} className="flex gap-2 text-[14px] text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>{t(`why.${r}`)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-md border border-line p-3 text-[15px]">
              {editing === p.id ? (
                editor(p.id, v, (nv) => setValues((s) => ({ ...s, [p.id]: nv })))
              ) : (
                preview(p.id, v)
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant={d === "accepted" ? "primary" : "outline"} onClick={() => setDecision(p.id, "accepted")} data-testid={`accept-${p.id}`}>
                {t("proposals.accept")}
              </Button>
              <Button
                size="sm"
                variant={d === "modified" ? "primary" : "outline"}
                onClick={() => {
                  setDecision(p.id, "modified");
                  setEditing(p.id);
                }}
                data-testid={`modify-${p.id}`}
              >
                {t("proposals.modify")}
              </Button>
              <Button size="sm" variant={d === "ignored" ? "secondary" : "ghost"} onClick={() => setDecision(p.id, "ignored")} data-testid={`ignore-${p.id}`}>
                {t("proposals.ignore")}
              </Button>
            </div>
          </Card>
        );
      })}

      <Card className="p-5">
        <h2 className="text-[17px] font-semibold">{t("proposals.summary")}</h2>
        <p className="mt-1 text-[14px] text-muted">
          {decided
            ? t("proposals.summaryText", { kept: base.proposals.filter((p) => keep(p.id)).length, total: base.proposals.length })
            : t("proposals.decideAll")}
        </p>
        <p className="mt-2 text-[14px] text-muted">{t("proposals.next")}</p>
        {error && (
          <p role="alert" className="mt-3 text-[14px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onBack} disabled={pending}>
            <ChevronLeft className="rtl:-scale-x-100" />
            {t("back")}
          </Button>
          <span className="flex-1" />
          <Button onClick={confirm} disabled={pending || !decided} data-testid="onb-confirm">
            {t("proposals.confirm")}
          </Button>
        </div>
      </Card>
    </div>
  );

  function preview(id: string, value: Proposal["value"]) {
    if (id === "checklist")
      return (
        <ul className="space-y-2">
          {(value as ChecklistRoom[]).map((r) => (
            <li key={r.room}>
              <span className="font-medium">{r.room}</span>
              <span className="text-muted"> — {r.items.map((i) => (i.photo_required ? `${i.label} (${t("proposals.photo")})` : i.label)).join(", ")}</span>
            </li>
          ))}
        </ul>
      );
    if (id === "linen") return <span>{t("proposals.linen.value", { days: value as number })}</span>;
    if (id === "alerts") return <span>{(value as string[]).map((a) => t(`alerts.${a}`)).join(" · ")}</span>;
    const list = value as string[];
    return <span>{list.length ? list.map((x) => tt(x)).join(" · ") : t("proposals.validation.none")}</span>;
  }

  function editor(id: string, value: Proposal["value"], onChange: (v: Proposal["value"]) => void) {
    if (id === "linen")
      return (
        <Field label={t("proposals.linen.days")} htmlFor="linen-days">
          <Input id="linen-days" type="number" min={0} max={30} className="max-w-32" value={value as number} onChange={(e) => onChange(Math.min(30, Math.max(0, Number(e.target.value))))} />
        </Field>
      );
    if (id === "checklist")
      return (
        <div className="space-y-3">
          {(value as ChecklistRoom[]).map((r, ri) => (
            <div key={ri} className="space-y-1.5">
              <Input
                aria-label={t("proposals.room")}
                value={r.room}
                onChange={(e) => onChange((value as ChecklistRoom[]).map((x, i) => (i === ri ? { ...x, room: e.target.value } : x)))}
                className="font-medium"
              />
              {r.items.map((it, ii) => (
                <div key={ii} className="flex items-center gap-2 ps-3">
                  <Input
                    aria-label={t("proposals.item")}
                    value={it.label}
                    onChange={(e) =>
                      onChange((value as ChecklistRoom[]).map((x, i) => (i === ri ? { ...x, items: x.items.map((y, j) => (j === ii ? { ...y, label: e.target.value } : y)) } : x)))
                    }
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted">
                    <input
                      type="checkbox"
                      checked={it.photo_required}
                      onChange={(e) =>
                        onChange((value as ChecklistRoom[]).map((x, i) => (i === ri ? { ...x, items: x.items.map((y, j) => (j === ii ? { ...y, photo_required: e.target.checked } : y)) } : x)))
                      }
                    />
                    {t("proposals.photo")}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange((value as ChecklistRoom[]).map((x, i) => (i === ri ? { ...x, items: x.items.filter((_, j) => j !== ii) } : x)).filter((x) => x.items.length))}
                  >
                    {t("proposals.remove")}
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    const options = id === "alerts" ? ALERTS : TASK_TYPES;
    const list = value as string[];
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <Choice key={o} selected={list.includes(o)} onClick={() => onChange((list.includes(o) ? list.filter((x) => x !== o) : [...list, o]) as Proposal["value"])}>
            {id === "alerts" ? t(`alerts.${o}`) : tt(o)}
          </Choice>
        ))}
      </div>
    );
  }
}
