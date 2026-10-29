"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { prepareTestScenario, signInTestAccount } from "@/lib/connected/auth-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Préproduction uniquement : entrer sous un compte de test fictif, sans adresse e-mail réelle. */
export function TestAccountForm({ next }: { next?: string }) {
  const t = useTranslations("connected.testAccount");
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [scenario, setScenario] = useState<{ agentLabel: string; guestPath: string | null; existed: boolean } | null>(null);
  const locale = useLocale();
  return (
    <form
      className="mt-4 rounded-xl border border-dashed border-line-strong bg-surface p-5"
      data-testid="test-account"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await signInTestAccount(name);
          if (!res.ok) return setError(t(`errors.${res.error}`));
          router.replace(next && /^\/(app|invite)(\/[\w-]*)*$/.test(next) ? next : "/app");
          router.refresh();
        });
      }}
    >
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <FlaskConical className="size-4 text-accent-text" />
        {t("title")}
      </p>
      <p className="mt-1 text-[13px] text-muted">{t("text")}</p>
      <Field label={t("name")} htmlFor="test-name" hint={t("hint")} error={error ?? undefined} className="mt-3">
        <Input id="test-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="manager" autoComplete="off" />
      </Field>
      <Button type="submit" variant="outline" className="mt-3 w-full" disabled={pending || !name.trim()} data-testid="test-account-submit">
        {t("submit")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="mt-2 w-full"
        disabled={pending || !name.trim()}
        data-testid="test-scenario-submit"
        onClick={() =>
          start(async () => {
            const res = await prepareTestScenario(name);
            if (!res.ok) return setError(t(`errors.${res.error}`));
            setError(null);
            setScenario(res);
          })
        }
      >
        {t("scenario")}
      </Button>
      {scenario && (
        <div className="mt-3 space-y-2 rounded-md border border-accent bg-accent-soft p-3 text-[14px]" data-testid="test-scenario-ready">
          <p className="font-semibold">{scenario.existed ? t("scenarioExisted") : t("scenarioReady")}</p>
          <p>{t("scenarioAgent", { name: scenario.agentLabel })}</p>
          {scenario.guestPath && (
            <p className="break-all">
              {t("scenarioGuest")}{" "}
              <a href={`/${locale}${scenario.guestPath}`} target="_blank" rel="noreferrer" className="font-medium underline" data-testid="test-scenario-guest">
                {typeof window !== "undefined" ? window.location.origin : ""}/{locale}
                {scenario.guestPath}
              </a>
            </p>
          )}
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await signInTestAccount(name);
                if (!res.ok) return setError(t(`errors.${res.error}`));
                router.replace("/app");
                router.refresh();
              })
            }
            data-testid="test-scenario-continue"
          >
            {t("scenarioContinue")}
          </Button>
        </div>
      )}
    </form>
  );
}
