"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { addLinenItem, applyLinenTask, countLinen, moveLinen, saveLinenKit, seedLinenCatalogue, updateLinenItem } from "@/lib/connected/linen-actions";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";

type Item = { id: string; label: string; unit: string };
const LOCS = ["clean", "dirty", "laundry"] as const;

/** Inventaire : la quantité comptée devient le stock de l'emplacement (l'écart est historisé). */
export function LinenCountForm({ items, defaultItem }: { items: Item[]; defaultItem?: string }) {
  const t = useTranslations("connected.linenOps");
  const { pending, error, run } = useRun();
  const [item, setItem] = useState(defaultItem ?? items[0]?.id ?? "");
  const [loc, setLoc] = useState<(typeof LOCS)[number]>("clean");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [ok, setOk] = useState(false);
  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        run(() => countLinen(item, loc, Number(qty), note), () => (setOk(true), setQty(""), setNote("")));
      }}
      data-testid="linen-count-form"
    >
      <Field label={t("item")} htmlFor="lc-item" className="col-span-2">
        <Select id="lc-item" value={item} onChange={(e) => setItem(e.target.value)} data-testid="linen-count-item">
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("location")} htmlFor="lc-loc">
        <Select id="lc-loc" value={loc} onChange={(e) => setLoc(e.target.value as (typeof LOCS)[number])} data-testid="linen-count-location">
          {LOCS.map((l) => (
            <option key={l} value={l}>
              {t(`loc.${l}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("counted")} htmlFor="lc-qty">
        <Input id="lc-qty" type="number" min={0} max={100000} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required data-testid="linen-count-qty" />
      </Field>
      <Button type="submit" className="self-end" disabled={pending || qty === "" || !item} data-testid="linen-count-save">
        {t("countSave")}
      </Button>
      <div className="col-span-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("notePlaceholder")} aria-label={t("note")} />
      </div>
      {ok && <p role="status" className="text-[13px] text-success col-span-2" data-testid="linen-count-ok">{t("countOk")}</p>}
      {error && <p role="alert" className="text-[13px] text-danger col-span-2">{error}</p>}
    </form>
  );
}

/** Mouvements courants : envoi au blanchisseur, retour du blanchisseur, achat, perte. */
export function LinenMoveForm({ items }: { items: Item[] }) {
  const t = useTranslations("connected.linenOps");
  const { pending, error, run } = useRun();
  const [item, setItem] = useState(items[0]?.id ?? "");
  const [kind, setKind] = useState<"to_laundry" | "from_laundry" | "purchase" | "loss">("to_laundry");
  const [from, setFrom] = useState<(typeof LOCS)[number]>("clean");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [ok, setOk] = useState(false);
  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        run(() => moveLinen({ itemId: item, kind, from, qty: Number(qty), note }), () => (setOk(true), setQty(""), setNote("")));
      }}
      data-testid="linen-move-form"
    >
      <Field label={t("item")} htmlFor="lm-item" className="col-span-2">
        <Select id="lm-item" value={item} onChange={(e) => setItem(e.target.value)} data-testid="linen-move-item">
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("movement")} htmlFor="lm-kind" className="col-span-2">
        <Select id="lm-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="linen-move-kind">
          {(["to_laundry", "from_laundry", "purchase", "loss"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("qty")} htmlFor="lm-qty">
        <Input id="lm-qty" type="number" min={1} max={100000} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required data-testid="linen-move-qty" />
      </Field>
      <Button type="submit" className="self-end" disabled={pending || !(Number(qty) > 0) || !item} data-testid="linen-move-save">
        {t("moveSave")}
      </Button>
      {kind === "loss" && (
        <div className="col-span-2">
          <Field label={t("from")} htmlFor="lm-from">
            <Select id="lm-from" value={from} onChange={(e) => setFrom(e.target.value as (typeof LOCS)[number])}>
              {LOCS.map((l) => (
                <option key={l} value={l}>
                  {t(`loc.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="col-span-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("notePlaceholder")} aria-label={t("note")} />
      </div>
      <p className="text-[12px] text-muted col-span-2">{t(`kindHint.${kind}`)}</p>
      {ok && <p role="status" className="text-[13px] text-success col-span-2" data-testid="linen-move-ok">{t("moveOk")}</p>}
      {error && <p role="alert" className="text-[13px] text-danger col-span-2" data-testid="linen-move-error">{error}</p>}
    </form>
  );
}

/** Catalogue : articles, unité, retrait ; catalogue de départ modifiable. */
export function LinenCatalogue({ items }: { items: Item[] }) {
  const t = useTranslations("connected.linenOps");
  const { pending, error, run } = useRun();
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("pièce");
  return (
    <div className="space-y-3" data-testid="linen-catalogue">
      {items.length === 0 && (
        <div className="rounded-md border border-dashed border-line p-3 text-[14px]">
          <p>{t("catalogueEmpty")}</p>
          <Button size="sm" className="mt-2" disabled={pending} onClick={() => run(() => seedLinenCatalogue())} data-testid="linen-seed">
            {t("seed")}
          </Button>
        </div>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[14px]" data-testid="linen-item">
              <span className="min-w-0 flex-1 truncate font-medium">{i.label}</span>
              <span className="text-[13px] text-muted">{i.unit}</span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updateLinenItem(i.id, { active: false }))} data-testid="linen-item-remove">
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addLinenItem(label, unit), () => setLabel(""));
        }}
      >
        <Field label={t("newItem")} htmlFor="li-label" className="min-w-0 flex-1">
          <Input id="li-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={t("newItemPlaceholder")} data-testid="linen-item-label" />
        </Field>
        <Field label={t("unit")} htmlFor="li-unit" className="w-28">
          <Input id="li-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
        </Field>
        <Button type="submit" size="sm" disabled={pending || !label.trim()} data-testid="linen-item-add">
          {t("add")}
        </Button>
      </form>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}

/** Kit d'un logement : quantités nécessaires pour préparer une arrivée. */
export function LinenKitEditor({ properties, items, kits, initialProperty }: { properties: { id: string; name: string }[]; items: Item[]; kits: { propertyId: string; itemId: string; qty: number }[]; initialProperty?: string }) {
  const t = useTranslations("connected.linenOps");
  const { pending, error, run } = useRun();
  const [prop, setProp] = useState(initialProperty ?? properties[0]?.id ?? "");
  const current = (pid: string) => Object.fromEntries(items.map((i) => [i.id, String(kits.find((k) => k.propertyId === pid && k.itemId === i.id)?.qty ?? "")]));
  const [qty, setQty] = useState<Record<string, string>>(() => current(initialProperty ?? properties[0]?.id ?? ""));
  const [ok, setOk] = useState(false);
  if (!items.length) return <p className="text-[14px] text-muted">{t("kitNeedsCatalogue")}</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        run(() => saveLinenKit(prop, items.map((i) => ({ itemId: i.id, qty: Number(qty[i.id] || 0) }))), () => setOk(true));
      }}
      data-testid="linen-kit-form"
    >
      <Field label={t("property")} htmlFor="lk-prop">
        <Select
          id="lk-prop"
          value={prop}
          onChange={(e) => {
            setProp(e.target.value);
            setQty(current(e.target.value));
            setOk(false);
          }}
          data-testid="linen-kit-property"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <Field key={i.id} label={i.label} htmlFor={`lk-${i.id}`}>
            <Input id={`lk-${i.id}`} type="number" min={0} max={500} inputMode="numeric" value={qty[i.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} placeholder="0" data-testid="linen-kit-qty" />
          </Field>
        ))}
      </div>
      <Button type="submit" size="sm" disabled={pending || !prop} data-testid="linen-kit-save">
        {t("kitSave")}
      </Button>
      {ok && <p role="status" className="text-[13px] text-success" data-testid="linen-kit-ok">{t("kitOk")}</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </form>
  );
}

/** Mission linge terminée → stock (kit sorti du propre pour une livraison, entré au sale pour une collecte). */
export function ApplyLinenTaskButton({ taskId, label }: { taskId: string; label: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyLinenTask(taskId))} data-testid="linen-apply-task">
        {label}
      </Button>
      {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
    </span>
  );
}
