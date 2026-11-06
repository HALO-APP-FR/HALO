"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { PERIODS, STATUS_FILTERS, TYPES } from "@/lib/connected/mission-filters";

/**
 * Filtres de la liste des missions (responsable) : chaque filtre agit réellement sur la requête du serveur
 * (adresse partageable, retour arrière conservé). Aucun filtre décoratif.
 */
export function MissionFilters({ properties, period, status, type, property, q }: { properties: { id: string; name: string }[]; period: string; status: string; type: string; property: string; q: string }) {
  const t = useTranslations("connected.missionList");
  const tt = useTranslations("taskType");
  const tts = useTranslations("taskStatus");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q);
  const timer = useRef<number | null>(null);
  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  // Recherche : appliquée après une courte pause de frappe
  useEffect(() => {
    if (text === q) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => push({ q: text.trim() || null }), 350);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule la saisie déclenche la recherche
  }, [text]);
  const active = (status !== "todo" ? 1 : 0) + (type ? 1 : 0) + (property ? 1 : 0) + (q ? 1 : 0);
  return (
    <div className={cn("mb-4 space-y-2.5 transition-opacity", pending && "opacity-60")} data-testid="mission-filters">
      <Segmented
        label={t("period")}
        value={period}
        onChange={(v) => push({ period: v === "upcoming" ? null : v })}
        className="flex w-full md:inline-flex md:w-auto"
        options={PERIODS.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
          <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="ps-10" data-testid="mission-search" />
        </div>
        <Select aria-label={t("status")} value={status} onChange={(e) => push({ status: e.target.value === "todo" ? null : e.target.value })} data-testid="mission-filter-status">
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "todo" ? t("todo") : s === "all" ? t("allStatuses") : s === "done" ? t("toValidate") : tts(s)}
            </option>
          ))}
        </Select>
        <Select aria-label={t("type")} value={type} onChange={(e) => push({ type: e.target.value || null })} data-testid="mission-filter-type">
          <option value="">{t("allTypes")}</option>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {tt(x)}
            </option>
          ))}
          <option value="linen">{t("linenGroup")}</option>
        </Select>
        <Select aria-label={t("property")} value={property} onChange={(e) => push({ property: e.target.value || null })} className="col-span-2 md:col-span-1" data-testid="mission-filter-property">
          <option value="">{t("allProperties")}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      {active > 0 && (
        <button
          type="button"
          onClick={() => {
            setText("");
            push({ status: null, type: null, property: null, q: null });
          }}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text"
          data-testid="mission-filters-reset"
        >
          <X className="size-3.5" />
          {t("reset")}
        </button>
      )}
    </div>
  );
}
