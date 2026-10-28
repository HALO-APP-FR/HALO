"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createOrganization } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function CreateOrgCard() {
  const t = useTranslations("connected");
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="mx-auto max-w-md p-6">
      <h1 className="text-title-2">{t("createOrg.title")}</h1>
      <p className="mt-1 text-[15px] text-muted">{t("createOrg.text")}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await createOrganization(name);
            if (!res.ok) return setError(t(`errors.${res.error}`));
            router.push("/app/onboarding");
            router.refresh();
          });
        }}
      >
        <Field label={t("createOrg.name")} htmlFor="org-name" error={error ?? undefined}>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Button type="submit" size="xl" disabled={pending || !name.trim()}>
          {t("createOrg.submit")}
        </Button>
      </form>
    </Card>
  );
}
