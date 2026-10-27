"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { allTimezones, COUNTRY_TZ, sortedCountries, timezoneLabel } from "@/lib/domain/geo";
import { DEFAULT_VALIDATION_TYPES, TASK_TYPES, type TaskType } from "@/lib/domain/types";
import { SwitchRow } from "@/components/ui/switch";
import { useHalo } from "@/lib/store/halo-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { ThemeSwitcher } from "@/components/halo/theme-switcher";
import { MapsAppSelect } from "@/components/halo/directions-button";
import { CRITICAL_KINDS, KIND_AUDIENCE, NOTIFICATION_KINDS } from "@/lib/engine/notifications";

export function Settings() {
  return (
    <ReadyGate>
      <SettingsInner />
    </ReadyGate>
  );
}

function SettingsInner() {
  const t = useTranslations();
  const locale = useLocale();
  const org = useHalo((s) => s.org);
  const [draft, setDraft] = useState(org);
  const [confirm, setConfirm] = useState<"reset" | "empty" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(org);

  return (
    <>
      <PageHeader title={t("nav.settings")} />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.organization")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label={t("settings.orgName")} htmlFor="o-name">
              <Input id="o-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t("property.country")} htmlFor="o-country">
              <Select
                id="o-country"
                value={draft.countryCode}
                onChange={(e) => setDraft({ ...draft, countryCode: e.target.value, timezone: COUNTRY_TZ[e.target.value] ?? draft.timezone })}
              >
                {sortedCountries(locale).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.defaultTimezone")} htmlFor="o-tz" hint={t("settings.defaultTimezoneHint")}>
              <Select id="o-tz" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
                {allTimezones().map((tz) => (
                  <option key={tz} value={tz}>
                    {timezoneLabel(tz, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            {dirty && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setDraft(org)}>
                  {t("form.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    useHalo.getState().updateOrg({ ...draft, name: draft.name.trim() || org.name });
                    toast(t("form.saved"));
                  }}
                >
                  {t("form.save")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("cycle.settingsTitle")}</CardTitle>
              <p className="mt-1 text-caption text-muted">{t("cycle.settingsHint")}</p>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-line">
            {TASK_TYPES.map((type) => {
              const rules = org.validationTaskTypes ?? DEFAULT_VALIDATION_TYPES;
              return (
                <SwitchRow
                  key={type}
                  id={`val-${type}`}
                  label={t(`taskType.${type}`)}
                  description={rules.includes(type) ? t("cycle.ruleOn") : t("cycle.ruleOff")}
                  checked={rules.includes(type)}
                  onCheckedChange={(on) => {
                    const next: TaskType[] = on ? [...rules.filter((x) => x !== type), type] : rules.filter((x) => x !== type);
                    useHalo.getState().updateOrg({ validationTaskTypes: next });
                    setDraft((d) => ({ ...d, validationTaskTypes: next }));
                  }}
                />
              );
            })}
          </CardContent>
        </Card>

        <NotificationSettings />

        <Card>
          <CardHeader>
            <CardTitle>{t("profile.preferences")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[15px]">{t("language.label")}</span>
              <LocaleSwitcher />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[15px]">{t("theme.label")}</span>
              <ThemeSwitcher />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="maps-app" className="text-[15px]">
                {t("directions.defaultApp")}
              </label>
              <MapsAppSelect className="w-56" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.demoTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[14px] text-muted">{t("settings.demoText")}</p>
            {confirm ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft p-3">
                <span className="flex-1 text-[14px] text-danger">{confirm === "reset" ? t("settings.confirmReset") : t("settings.confirmEmpty")}</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    const s = useHalo.getState();
                    if (confirm === "reset") s.resetDemo(locale);
                    else s.startEmpty();
                    setConfirm(null);
                    toast(t("settings.done"));
                  }}
                >
                  {t("settings.confirm")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  {t("form.cancel")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setConfirm("reset")}>
                  <RotateCcw />
                  {t("settings.resetDemo")}
                </Button>
                <Button variant="outline" className="text-danger" onClick={() => setConfirm("empty")}>
                  <Trash2 />
                  {t("settings.startEmpty")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Préférences de notification : seuls les canaux réellement disponibles sont activables. */
function NotificationSettings() {
  const t = useTranslations();
  const muted = useHalo((s) => s.notificationMuted);
  const kinds = NOTIFICATION_KINDS.filter((k) => KIND_AUDIENCE[k] === "manager");
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("inbox.settingsTitle")}</CardTitle>
          <p className="mt-1 text-caption text-muted">{t("inbox.settingsHint")}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y divide-line">
          {kinds.map((k) => {
            const critical = CRITICAL_KINDS.includes(k);
            return (
              <SwitchRow
                key={k}
                id={`notif-${k}`}
                label={t(`inbox.type.${k}`)}
                description={critical ? t("inbox.criticalLocked") : t("inbox.inApp")}
                checked={critical || !muted.includes(k)}
                disabled={critical}
                onCheckedChange={(on) => useHalo.getState().setNotificationMuted(k, !on)}
              />
            );
          })}
        </div>
        <ul className="space-y-1 rounded-lg bg-subtle p-3 text-caption text-muted dark:bg-surface-hover">
          <li>{t("inbox.channelInApp")}</li>
          <li>{t("inbox.channelEmail")}</li>
          <li>{t("inbox.channelPush")}</li>
          <li>{t("inbox.channelSms")}</li>
        </ul>
      </CardContent>
    </Card>
  );
}

