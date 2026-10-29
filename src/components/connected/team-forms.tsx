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

export function AcceptInvite({ token, defaultName = "", defaultPhone = "" }: { token: string; defaultName?: string; defaultPhone?: string }) {
  const t = useTranslations("connected.team");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  return (
    <form
      className="space-y-3 text-start"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => acceptInvitation(token, name, phone), () => router.replace("/app"));
      }}
    >
      {/* L'équipe doit savoir qui est qui : le nom est demandé, le téléphone proposé */}
      <Field label={t("yourName")} htmlFor="inv-name" hint={t("yourNameHint")}>
        <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={120} data-testid="invite-name" />
      </Field>
      <Field label={t("yourPhone")} htmlFor="inv-phone" hint={t("yourPhoneHint")}>
        <Input id="inv-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={32} data-testid="invite-phone" />
      </Field>
      <Button type="submit" size="xl" className="w-full" disabled={pending || !name.trim()} data-testid="invite-accept">
        {t("accept")}
      </Button>
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </form>
  );
}
