"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { reportIncident } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { useRun } from "./use-run";

const CATEGORIES = ["blocker", "missing_supplies", "damage", "breakdown", "leak", "missing_item", "other"] as const;

/** Signaler un blocage, un manque de matériel ou un dégât depuis la mission : il arrive chez le responsable. */
export function ReportIncident({ taskId, reported }: { taskId: string; reported: { id: string; category: string; status: string; description: string }[] }) {
  const t = useTranslations("connected.incidents");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: "blocker", description: "", urgent: false });
  const [sent, setSent] = useState(false);
  return (
    <Card className="p-4" data-testid="report-incident">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <TriangleAlert className="size-5 text-warning" />
          {t("reportTitle")}
        </h2>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => (setOpen(true), setSent(false))} data-testid="report-open">
            {t("report")}
          </Button>
        )}
      </div>
      {reported.length > 0 && (
        <ul className="mt-2 space-y-1 text-[14px]">
          {reported.map((r) => (
            <li key={r.id} data-testid="reported-incident">
              {t(`category.${r.category}`)} — <span className="text-muted">{t(`status.${r.status}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {sent && <p role="status" className="mt-2 text-[14px] text-success">{t("reported")}</p>}
      {open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => reportIncident(taskId, f.category, f.description.trim(), f.urgent), () => (setOpen(false), setSent(true), setF({ category: "blocker", description: "", urgent: false })));
          }}
        >
          <Field label={t("categoryLabel")} htmlFor="inc-cat">
            <Select id="inc-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("description")} htmlFor="inc-desc">
            <Textarea id="inc-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} data-testid="report-description" />
          </Field>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} data-testid="report-urgent" />
            {t("urgentLabel")}
          </label>
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || f.description.trim().length < 3} data-testid="report-send">
              {t("send")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
