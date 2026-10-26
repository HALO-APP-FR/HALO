"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, PackageCheck, Plus, Send, Trash2, Truck } from "lucide-react";
import type { LaundryOrder, LaundryOrderLine } from "@/lib/domain/types";
import { laundryDiscrepancies, qtyAt, suggestLaundryLines } from "@/lib/engine/linen";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EmptyState } from "@/components/halo/empty-state";
import { useLinenData, useLinenName, useMoney } from "./use-linen";

const STATUS_TONE = { draft: "neutral", sent: "warning", received: "success" } as const;

/** Crée un bon pré-rempli avec tout le linge sale, et renvoie son id. */
export function useNewLaundryOrder() {
  const t = useTranslations();
  const { stock, types } = useLinenData(7);
  return () => {
    const lines = suggestLaundryLines(stock, types);
    if (lines.length === 0) {
      toast(t("linen.nothingDirty"));
      return null;
    }
    return useHalo.getState().createLaundryOrder(lines);
  };
}

export function LinenLaundry({ openOrderId, setOpenOrderId }: { openOrderId: string | null; setOpenOrderId: (id: string | null) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const orders = useHalo((s) => s.laundryOrders);
  const settings = useHalo((s) => s.linenSettings);
  const newOrder = useNewLaundryOrder();
  const fmt = (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) : "—");

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">
          {settings.laundryName ? t("linen.laundryPartner", { name: settings.laundryName, days: settings.turnaroundDays }) : t("linen.laundryNoPartner")}
        </p>
        <Button
          onClick={() => {
            const id = newOrder();
            if (id) setOpenOrderId(id);
          }}
        >
          <Plus />
          {t("linen.newOrder")}
        </Button>
      </div>
      {orders.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={t("linen.noOrders")} text={t("linen.noOrdersText")} />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {orders.map((o) => {
            const pieces = o.lines.reduce((n, l) => n + l.sent, 0);
            const issues = o.status === "received" ? laundryDiscrepancies(o) : [];
            return (
              <button key={o.id} type="button" onClick={() => setOpenOrderId(o.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3.5 text-start hover:bg-surface-hover md:px-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-subtle text-muted dark:bg-surface-hover">
                  {o.status === "received" ? <PackageCheck className="size-5" /> : <Truck className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{o.reference}</span>
                    <Badge tone={STATUS_TONE[o.status]}>{t(`linen.order_${o.status}`)}</Badge>
                    {issues.length > 0 && (
                      <Badge tone="danger">
                        <AlertTriangle className="size-3" />
                        {t("linen.issues", { count: issues.reduce((n, i) => n + i.lost + i.damaged, 0) })}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-caption text-muted">
                    {t("linen.pieces", { count: pieces })} ·{" "}
                    {o.status === "draft"
                      ? t("linen.createdOn", { date: fmt(o.createdAt) })
                      : o.status === "sent"
                        ? t("linen.expectedOn", { date: fmt(o.expectedAt) })
                        : t("linen.receivedOn", { date: fmt(o.receivedAt) })}
                  </span>
                </span>
              </button>
            );
          })}
        </Card>
      )}
      {openOrderId && <OrderSheet orderId={openOrderId} onClose={() => setOpenOrderId(null)} />}
    </>
  );
}

function OrderSheet({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const order = useHalo((s) => s.laundryOrders.find((o) => o.id === orderId));
  if (!order) return null;
  return <OrderSheetInner key={`${order.id}-${order.status}`} order={order} onClose={onClose} />;
}

function OrderSheetInner({ order, onClose }: { order: LaundryOrder; onClose: () => void }) {
  const t = useTranslations();
  const name = useLinenName();
  const money = useMoney();
  const { stock, types } = useLinenData(7);
  const [lines, setLines] = useState<LaundryOrderLine[]>(() =>
    order.status === "sent" ? order.lines.map((l) => ({ ...l, received: l.received ?? l.sent, damaged: l.damaged ?? 0 })) : order.lines,
  );
  const { updateLaundryOrder, sendLaundryOrder, receiveLaundryOrder, deleteLaundryOrder } = useHalo.getState();
  const setLine = (i: number, patch: Partial<LaundryOrderLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cost = lines.reduce((n, l) => n + l.sent * (types.find((x) => x.id === l.linenTypeId)?.laundryCost ?? 0), 0);
  const issues = order.status === "received" ? laundryDiscrepancies(order) : [];
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={order.reference}
        description={order.status === "draft" ? t("linen.draftHint") : order.status === "sent" ? t("linen.receiveHint") : t(`linen.order_${order.status}`)}
        closeLabel={t("common.close")}
      >
        <div className="space-y-4 pt-2">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-line text-micro text-muted">
                <th scope="col" className="py-2 pe-2 text-start font-semibold">{t("linen.item")}</th>
                <th scope="col" className="w-20 py-2 pe-2 text-end font-semibold">{t("linen.sent")}</th>
                {order.status !== "draft" && <th scope="col" className="w-20 py-2 pe-2 text-end font-semibold">{t("linen.received")}</th>}
                {order.status !== "draft" && <th scope="col" className="w-20 py-2 text-end font-semibold">{t("linen.damaged")}</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const ty = types.find((x) => x.id === l.linenTypeId);
                const lost = order.status === "sent" ? Math.max(0, l.sent - (l.received ?? 0) - (l.damaged ?? 0)) : 0;
                return (
                  <tr key={l.linenTypeId} className="border-b border-line last:border-b-0">
                    <td className="py-2 pe-2">
                      <span className="font-medium">{name(ty)}</span>
                      {order.status === "draft" && <span className="block text-caption text-muted">{t("linen.dirtyAvailable", { count: qtyAt(stock, "dirty", l.linenTypeId) })}</span>}
                      {lost > 0 && <span className="block text-caption text-danger">{t("linen.missingPieces", { count: lost })}</span>}
                    </td>
                    <td className="py-2 pe-2 text-end">
                      {order.status === "draft" ? (
                        <Input type="number" inputMode="numeric" min={0} aria-label={t("linen.sent")} value={l.sent} onChange={(e) => setLine(i, { sent: num(e.target.value) })} className="h-9 text-end tabular" />
                      ) : (
                        <span className="font-semibold tabular">{l.sent}</span>
                      )}
                    </td>
                    {order.status === "sent" && (
                      <>
                        <td className="py-2 pe-2">
                          <Input type="number" inputMode="numeric" min={0} max={l.sent} aria-label={t("linen.received")} value={l.received ?? 0} onChange={(e) => setLine(i, { received: Math.min(l.sent, num(e.target.value)) })} className="h-9 text-end tabular" />
                        </td>
                        <td className="py-2">
                          <Input type="number" inputMode="numeric" min={0} aria-label={t("linen.damaged")} value={l.damaged ?? 0} onChange={(e) => setLine(i, { damaged: num(e.target.value) })} className="h-9 text-end tabular" />
                        </td>
                      </>
                    )}
                    {order.status === "received" && (
                      <>
                        <td className="py-2 pe-2 text-end tabular">{l.received ?? 0}</td>
                        <td className="py-2 text-end tabular">{l.damaged ?? 0}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="flex justify-between text-[14px]">
            <span className="text-muted">{t("linen.orderCost")}</span>
            <span className="font-semibold tabular">{money(cost)}</span>
          </p>

          {issues.length > 0 && (
            <div className="rounded-lg bg-danger-soft p-3 text-[14px]">
              <p className="font-semibold text-danger">{t("linen.discrepancies")}</p>
              <ul className="mt-1 space-y-0.5">
                {issues.map((d) => (
                  <li key={d.linenTypeId}>
                    {name(types.find((x) => x.id === d.linenTypeId))} : {d.lost > 0 && t("linen.lostCount", { count: d.lost })}
                    {d.lost > 0 && d.damaged > 0 && ", "}
                    {d.damaged > 0 && t("linen.damagedCount", { count: d.damaged })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {order.status === "draft" && (
            <div className="grid gap-2">
              <Button
                size="xl"
                onClick={() => {
                  updateLaundryOrder(order.id, lines);
                  sendLaundryOrder(order.id);
                  toast(t("linen.orderSent"));
                  onClose();
                }}
                disabled={lines.every((l) => l.sent === 0)}
              >
                <Send />
                {t("linen.send")}
              </Button>
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => {
                  deleteLaundryOrder(order.id);
                  onClose();
                }}
              >
                <Trash2 />
                {t("linen.deleteDraft")}
              </Button>
            </div>
          )}
          {order.status === "sent" && (
            <Button
              size="xl"
              onClick={() => {
                receiveLaundryOrder(order.id, lines);
                toast(t("linen.orderReceived"));
              }}
            >
              <Check />
              {t("linen.receive")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
