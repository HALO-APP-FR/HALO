"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { signInTestAccount } from "@/lib/connected/auth-actions";
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
    </form>
  );
}
