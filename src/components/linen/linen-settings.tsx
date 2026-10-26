"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { BedSize, LinenCategory, LinenRule, LinenType } from "@/lib/domain/types";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { BED_SIZES } from "@/components/halo/property-create-sheet";
import { useLinenName, useMoney } from "./use-linen";

const CATEGORIES: LinenCategory[] = ["bed", "bath", "kitchen", "baby", "other"];

export function useRuleLabel() {
  const t = useTranslations();
  return (rule: LinenRule) => {
    if (rule.kind === "per_bed")
      return Object.entries(rule.qtyBySize)
        .filter(([, q]) => q)
        .map(([size, q]) => `${q} × ${t(`bed.${size}`).toLocaleLowerCase()}`)
        .join(", ");
    if (rule.kind === "per_guest") return t("linen.rulePerGuest", { qty: rule.qty });
    if (rule.kind === "per_baby") return t("linen.rulePerBaby", { qty: rule.qty });
    return t("linen.ruleFixed", { qty: rule.qty });
  };
}

export function LinenSettingsPanel() {
  const t = useTranslations();
  const name = useLinenName();
  const money = useMoney();
  const ruleLabel = useRuleLabel();
  const types = useHalo((s) => s.linenTypes);
  const settings = useHalo((s) => s.linenSettings);
  const [editing, setEditing] = useState<LinenType | "new" | null>(null);
  const [draft, setDraft] = useState(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("linen.items")}</CardTitle>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            {t("linen.addItem")}
          </Button>
        </CardHeader>
        <CardContent className="pt-2">
          <ul className="divide-y divide-line">
            {types.map((ty) => (
              <li key={ty.id}>
                <button type="button" onClick={() => setEditing(ty)} className="flex w-full items-center gap-3 py-3 text-start">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold">{name(ty)}</span>
                      <Badge>{t(`linenCategory.${ty.category}`)}</Badge>
                      {!ty.active && <Badge tone="warning">{t("linen.inactive")}</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-muted">{ruleLabel(ty.rule)}</span>
                  </span>
                  <span className="shrink-0 text-end text-caption text-muted">
                    <span className="block font-semibold text-fg tabular">{money(ty.laundryCost)}</span>
                    {t("linen.perWash")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t("linen.laundry")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t("linen.laundryName")} htmlFor="l-name">
            <Input id="l-name" value={draft.laundryName} onChange={(e) => setDraft({ ...draft, laundryName: e.target.value })} />
          </Field>
          <Field label={t("linen.turnaround")} htmlFor="l-days" hint={t("linen.turnaroundHint")}>
            <Input id="l-days" type="number" min={1} max={14} value={draft.turnaroundDays} onChange={(e) => setDraft({ ...draft, turnaroundDays: Math.min(14, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label={t("linen.currency")} htmlFor="l-cur">
            <Select id="l-cur" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
              {["EUR", "CHF", "GBP", "USD", "CAD", "MAD", "BRL", "AUD"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {dirty && (
            <Button
              className="w-full"
              onClick={() => {
                useHalo.getState().updateLinenSettings(draft);
                toast(t("form.saved"));
              }}
            >
              {t("form.save")}
            </Button>
          )}
        </CardContent>
      </Card>

      {editing && <LinenTypeSheet type={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LinenTypeSheet({ type, onClose }: { type?: LinenType; onClose: () => void }) {
  const t = useTranslations();
  const name = useLinenName();
  const [label, setLabel] = useState(type ? name(type) : "");
  const [category, setCategory] = useState<LinenCategory>(type?.category ?? "bath");
  const [ruleKind, setRuleKind] = useState<LinenRule["kind"]>(type?.rule.kind ?? "per_guest");
  const [qty, setQty] = useState(type && type.rule.kind !== "per_bed" ? type.rule.qty : 1);
  const [bySize, setBySize] = useState<Partial<Record<BedSize, number>>>(type?.rule.kind === "per_bed" ? type.rule.qtyBySize : { double: 1 });
  const [laundryCost, setLaundryCost] = useState(type?.laundryCost ?? 1);
  const [purchaseCost, setPurchaseCost] = useState(type?.purchaseCost ?? 10);
  const [active, setActive] = useState(type?.active ?? true);
  const money = (v: string) => Math.max(0, Math.round((Number(v.replace(",", ".")) || 0) * 100) / 100);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const rule: LinenRule = ruleKind === "per_bed" ? { kind: "per_bed", qtyBySize: bySize } : { kind: ruleKind, qty: Math.max(1, qty) };
    const { addLinenType, updateLinenType } = useHalo.getState();
    // Renommer un article du catalogue en fait un article libre (le nom saisi prime)
    const renamed = type?.key && label.trim() !== name(type);
    const data = { name: label.trim(), category, rule, laundryCost, purchaseCost, active, ...(renamed ? { key: undefined } : {}) };
    if (type) updateLinenType(type.id, data);
    else addLinenType(data);
    toast(t("form.saved"));
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={type ? name(type) : t("linen.addItem")} closeLabel={t("common.close")}>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <Field label={t("linen.itemName")} htmlFor="t-name">
            <Input id="t-name" value={label} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field label={t("linen.category")} htmlFor="t-cat">
            <Select id="t-cat" value={category} onChange={(e) => setCategory(e.target.value as LinenCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`linenCategory.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("linen.rule")} htmlFor="t-rule" hint={t("linen.ruleHint")}>
            <Select id="t-rule" value={ruleKind} onChange={(e) => setRuleKind(e.target.value as LinenRule["kind"])}>
              {(["per_bed", "per_guest", "per_baby", "fixed"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`linen.ruleKind_${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          {ruleKind === "per_bed" ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {BED_SIZES.map((size) => (
                <li key={size} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="text-[15px]">{t(`bed.${size}`)}</span>
                  <Input
                    type="number"
                    min={0}
                    max={6}
                    aria-label={t(`bed.${size}`)}
                    value={bySize[size] ?? 0}
                    onChange={(e) => setBySize({ ...bySize, [size]: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
                    className="h-9 w-20 text-end tabular"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Field label={t("linen.qtyPerUnit")} htmlFor="t-qty">
              <Input id="t-qty" type="number" min={1} max={10} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("linen.laundryCost")} htmlFor="t-lc">
              <Input id="t-lc" inputMode="decimal" defaultValue={laundryCost} onBlur={(e) => setLaundryCost(money(e.target.value))} />
            </Field>
            <Field label={t("linen.purchaseCost")} htmlFor="t-pc">
              <Input id="t-pc" inputMode="decimal" defaultValue={purchaseCost} onBlur={(e) => setPurchaseCost(money(e.target.value))} />
            </Field>
          </div>
          <SwitchRow id="t-active" label={t("linen.activeItem")} description={t("linen.activeItemHint")} checked={active} onCheckedChange={setActive} />
          <Button type="submit" size="xl">
            {t("form.save")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
