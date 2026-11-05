"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { updateMember } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { useRun } from "./use-run";

const POSITIONS = ["housekeeper", "inspector", "maintenance", "laundry", "concierge", "driver", "chef", "other"] as const;
const COLLABS = ["internal", "freelance", "partner_company"] as const;

/** Fiche ouverte en lecture ; « Modifier » ouvre le poste et le type de collaboration (droits vérifiés par la base). */
export function MemberEdit({ memberId, position, collaboration }: { memberId: string; position: string | null; collaboration: string | null }) {
  const t = useTranslations("connected.member.edit");
  const tp = useTranslations("position");
  const tc = useTranslations("collaboration");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(position ?? "");
  const [col, setCol] = useState(collaboration ?? "");
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="member-edit-open">
        <Pencil />
        {t("open")}
      </Button>
    );
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateMember(memberId, pos || null, col || null), () => setOpen(false));
      }}
      data-testid="member-edit"
    >
      <Field label={t("position")} htmlFor="m-pos">
        <Select id="m-pos" value={pos} onChange={(e) => setPos(e.target.value)} data-testid="member-edit-position">
          <option value="">{t("none")}</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {tp(p)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("collaboration")} htmlFor="m-col">
        <Select id="m-col" value={col} onChange={(e) => setCol(e.target.value)} data-testid="member-edit-collaboration">
          <option value="">{t("none")}</option>
          {COLLABS.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="member-edit-save">
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
        <span className="text-[13px] text-muted">{t("hint")}</span>
      </div>
      {error && <p role="alert" className="text-[14px] text-danger sm:col-span-2">{error}</p>}
    </form>
  );
}
