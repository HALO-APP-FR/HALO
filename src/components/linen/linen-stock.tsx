"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardList, ShoppingBag } from "lucide-react";
import type { LinenLocationId, LinenType } from "@/lib/domain/types";
import { parLevelTarget, qtyAt, qtyInProperties } from "@/lib/engine/linen";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLinenData, useLinenName, useLocationName, useMoney } from "./use-linen";

export function LinenStock() {
  const t = useTranslations();
  const name = useLinenName();
  const properties = useHalo((s) => s.properties);
  const { stock, types } = useLinenData(7);
  const [action, setAction] = useState<{ kind: "buy" | "count"; type: LinenType } | null>(null);

  const rows = types
    .filter((ty) => ty.active)
    .map((ty) => {
      const clean = qtyAt(stock, "clean", ty.id);
      const inProps = qtyInProperties(stock, ty.id);
      const dirty = qtyAt(stock, "dirty", ty.id);
      const laundry = qtyAt(stock, "laundry", ty.id);
      const total = clean + inProps + dirty + laundry;
      const target = parLevelTarget(properties, types, ty.id);
      return { ty, clean, inProps, dirty, laundry, total, target, gap: total - target };
    });

  const gapBadge = (gap: number, target: number) =>
    target === 0 ? <span className="text-muted">—</span> : gap < 0 ? <Badge tone="danger">{gap}</Badge> : <span className="font-semibold text-success tabular">+{gap}</span>;

  return (
    <>
      <p className="mb-3 text-[14px] text-muted">{t("linen.stockIntro")}</p>
      {/* Ordinateur */}
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line text-micro text-muted">
              <th scope="col" className="px-5 py-3 text-start font-semibold">{t("linen.item")}</th>
              <th scope="col" className="py-3 pe-4 text-end font-semibold">{t("linen.loc_clean")}</th>
              <th scope="col" className="py-3 pe-4 text-end font-semibold">{t("linen.inProperties")}</th>
              <th scope="col" className="py-3 pe-4 text-end font-semibold">{t("linen.loc_dirty")}</th>
              <th scope="col" className="py-3 pe-4 text-end font-semibold">{t("linen.loc_laundry")}</th>
              <th scope="col" className="py-3 pe-4 text-end font-semibold">{t("linen.total")}</th>
              <th scope="col" className="py-3 pe-4 text-end font-semibold">{t("linen.target")}</th>
              <th scope="col" className="py-3 pe-5 text-end font-semibold">{t("linen.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ty.id} className="border-b border-line last:border-b-0">
                <td className="px-5 py-3 font-medium">{name(r.ty)}</td>
                <td className={cn("py-3 pe-4 text-end font-semibold tabular", r.clean <= 0 && "text-danger")}>{r.clean}</td>
                <td className="py-3 pe-4 text-end tabular text-muted">{r.inProps}</td>
                <td className="py-3 pe-4 text-end tabular text-muted">{r.dirty}</td>
                <td className="py-3 pe-4 text-end tabular text-muted">{r.laundry}</td>
                <td className="py-3 pe-4 text-end font-semibold tabular">{r.total}</td>
                <td className="py-3 pe-4 text-end tabular">
                  {r.target} <span className="ms-1">{gapBadge(r.gap, r.target)}</span>
                </td>
                <td className="py-3 pe-5 text-end">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "buy", type: r.ty })}>
                      <ShoppingBag />
                      {t("linen.buyShort")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "count", type: r.ty })}>
                      <ClipboardList />
                      {t("linen.countShort")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Téléphone */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.ty.id} className="rounded-lg border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold">{name(r.ty)}</span>
              {gapBadge(r.gap, r.target)}
            </div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                [t("linen.loc_clean"), r.clean],
                [t("linen.inPropertiesShort"), r.inProps],
                [t("linen.loc_dirty"), r.dirty],
                [t("linen.loc_laundry"), r.laundry],
              ].map(([label, v]) => (
                <div key={label as string} className="rounded-md bg-subtle py-2 dark:bg-surface-hover">
                  <dd className="text-[17px] font-semibold tabular">{v}</dd>
                  <dt className="truncate px-1 text-[11px] text-muted">{label}</dt>
                </div>
              ))}
            </dl>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "buy", type: r.ty })}>
                <ShoppingBag />
                {t("linen.buyShort")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "count", type: r.ty })}>
                <ClipboardList />
                {t("linen.countShort")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {action && <StockActionSheet kind={action.kind} type={action.type} onClose={() => setAction(null)} />}
    </>
  );
}

function StockActionSheet({ kind, type, onClose }: { kind: "buy" | "count"; type: LinenType; onClose: () => void }) {
  const t = useTranslations();
  const name = useLinenName();
  const money = useMoney();
  const locName = useLocationName();
  const properties = useHalo((s) => s.properties);
  const { stock } = useLinenData(7);
  const [qty, setQty] = useState(kind === "buy" ? 10 : qtyAt(stock, "clean", type.id));
  const [location, setLocation] = useState<LinenLocationId>("clean");
  const [note, setNote] = useState("");
  const current = qtyAt(stock, location, type.id);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={kind === "buy" ? t("linen.buyTitle") : t("linen.countTitle")} description={name(type)} closeLabel={t("common.close")}>
        <form
          className="space-y-4 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const { purchaseLinen, adjustLinen } = useHalo.getState();
            if (kind === "buy") {
              if (qty <= 0) return;
              purchaseLinen(type.id, qty);
              toast(t("linen.bought", { count: qty }));
            } else {
              adjustLinen(location, type.id, Math.max(0, qty), note.trim() || undefined);
              toast(t("linen.counted"));
            }
            onClose();
          }}
        >
          {kind === "count" && (
            <Field label={t("linen.where")} htmlFor="c-loc">
              <Select
                id="c-loc"
                value={location}
                onChange={(e) => {
                  const loc = e.target.value as LinenLocationId;
                  setLocation(loc);
                  setQty(qtyAt(stock, loc, type.id));
                }}
              >
                {(["clean", "dirty", "laundry"] as LinenLocationId[]).map((l) => (
                  <option key={l} value={l}>
                    {locName(l)}
                  </option>
                ))}
                {properties
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={`property:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <Field
            label={kind === "buy" ? t("linen.qtyBought") : t("linen.qtyCounted")}
            htmlFor="c-qty"
            hint={kind === "buy" ? t("linen.buyHint", { cost: money(qty * type.purchaseCost) }) : t("linen.countHint", { count: current })}
          >
            <Input id="c-qty" type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))} className="h-12 text-[17px] tabular" autoFocus />
          </Field>
          {kind === "count" && qty !== current && (
            <p className={cn("rounded-lg p-3 text-[14px]", qty < current ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
              {t("linen.countDelta", { delta: qty - current > 0 ? `+${qty - current}` : String(qty - current) })}
            </p>
          )}
          {kind === "count" && (
            <Field label={t("linen.note")} htmlFor="c-note">
              <Input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("linen.notePlaceholder")} />
            </Field>
          )}
          <Button type="submit" size="xl">
            {kind === "buy" ? t("linen.confirmBuy") : t("linen.confirmCount")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
