"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { acceptInvitation, inviteMember } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";

export function InviteForm() {
  const t = useTranslations("connected.team");
  const locale = useLocale();
  const { pending, error, run } = useRun();
  const [role, setRole] = useState<"agent" | "manager">("agent");
  const [url, setUrl] = useState<string | null>(null);
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">{t("invite")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("inviteText")}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label={t("role")} htmlFor="inv-role" className="min-w-40">
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as "agent" | "manager")}>
            <option value="agent">{t("roles.agent")}</option>
            <option value="manager">{t("roles.manager")}</option>
          </Select>
        </Field>
        <Button onClick={() => run(() => inviteMember(role, role === "agent" ? "housekeeper" : null), (d) => setUrl(`${window.location.origin}/${locale}/invite/${d.token}`))} disabled={pending} data-testid="invite-create">
          {t("createLink")}
        </Button>
      </div>
      {url && (
        <div className="mt-3 rounded-md border border-accent bg-accent-soft p-3">
          <p className="text-[13px] font-medium">{t("copyOnce")}</p>
          <Input readOnly value={url} className="mt-2" data-testid="invite-url" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </Card>
  );
}

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations("connected.team");
  const router = useRouter();
  const { pending, error, run } = useRun();
  return (
    <div className="space-y-3">
      <Button size="xl" onClick={() => run(() => acceptInvitation(token), () => router.replace("/app"))} disabled={pending} data-testid="invite-accept">
        {t("accept")}
      </Button>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}
