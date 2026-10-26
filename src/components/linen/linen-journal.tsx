"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, History } from "lucide-react";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/halo/empty-state";
import { useLinenName, useLocationName } from "./use-linen";

const REASON_TONE = {
  purchase: "accent",
  turnover_placed: "neutral",
  turnover_removed: "neutral",
  laundry_send: "warning",
  laundry_receive: "success",
  damaged: "danger",
  lost: "danger",
  adjustment: "info",
} as const;

/** Journal immuable : chaque pièce de linge est traçable. */
export function LinenJournal() {
  const t = useTranslations();
  const locale = useLocale();
  const name = useLinenName();
  const loc = useLocationName();
  const movements = useHalo((s) => s.linenMovements);
  const types = useHalo((s) => s.linenTypes);
  const [typeId, setTypeId] = useState("all");
  const [limit, setLimit] = useState(60);
  const list = movements
    .filter((m) => typeId === "all" || m.linenTypeId === typeId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">{t("linen.journalIntro")}</p>
        <Select aria-label={t("linen.item")} value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-56">
          <option value="all">{t("linen.allItems")}</option>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {name(ty)}
            </option>
          ))}
        </Select>
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={History} title={t("linen.noMovements")} />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {list.slice(0, limit).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 md:px-5">
              <span className="w-28 shrink-0 text-caption text-muted tabular">
                {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(m.createdAt))}
              </span>
              <Badge tone={REASON_TONE[m.reason]}>{t(`linenReason.${m.reason}`)}</Badge>
              <span className="min-w-0 flex-1 text-[14px]">
                <strong className="tabular">{m.qty}</strong> {name(types.find((x) => x.id === m.linenTypeId))}
                <span className="ms-2 inline-flex items-center gap-1 text-muted">
                  {loc(m.from)}
                  <ArrowRight className="size-3 rtl:-scale-x-100" />
                  {loc(m.to)}
                </span>
                {m.note && <span className="ms-2 text-muted">· {m.note}</span>}
              </span>
            </div>
          ))}
          {list.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 100)} className="w-full py-3 text-[14px] font-medium text-accent-text">
              {t("linen.showMore", { count: list.length - limit })}
            </button>
          )}
        </Card>
      )}
    </>
  );
}
