"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Building2, CheckCircle2, PackageCheck, ShoppingBag, Truck, WashingMachine } from "lucide-react";
import { kitCost, parLevelTarget, qtyAt, qtyInProperties, type ForecastRow } from "@/lib/engine/linen";
import { addDaysToKey } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLinenData, useLinenName, useMoney } from "./use-linen";

function Tile({ label, value, icon: Icon, tone, onClick }: { label: string; value: number; icon: typeof Truck; tone?: "danger" | "accent"; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border border-line bg-surface p-4 text-start shadow-card transition-colors hover:bg-surface-hover md:p-5">
      <span className="flex items-center justify-between">
        <span className="text-caption text-muted">{label}</span>
        <Icon className={cn("size-4", tone === "danger" && value > 0 ? "text-danger" : tone === "accent" ? "text-accent-text" : "text-faint")} strokeWidth={1.9} />
      </span>
      <span className={cn("mt-1 block text-[26px] font-bold tabular md:text-display", tone === "danger" && value > 0 && "text-danger")}>{value}</span>
    </button>
  );
}

/** Deux horizons distincts : bilan sur 7 jours, et premier manque daté (ménage par ménage). */
function Outcome({ r, fmtShort }: { r: ForecastRow; fmtShort: (k: string) => string }) {
  const t = useTranslations();
  return (
    <>
      {r.gap < 0 ? (
        <Badge tone="danger">{t("linen.missing7", { count: -r.gap })}</Badge>
      ) : (
        <span className={cn("text-[14px] font-semibold tabular", r.gap > 0 ? "text-success" : "text-muted")}>
          {r.gap > 0 ? t("linen.surplusQty", { count: r.gap }) : t("linen.balanced")}
        </span>
      )}
      {r.shortageDay && (
        <span className="mt-0.5 block text-caption font-medium text-danger">
          {t("linen.firstShortage", { count: (r.needAtShortage ?? 0) - (r.availableAtShortage ?? 0), day: fmtShort(r.shortageDay) })}
        </span>
      )}
    </>
  );
}

export function LinenOverview({ goTo, onNewOrder }: { goTo: (tab: string) => void; onNewOrder: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const name = useLinenName();
  const money = useMoney();
  const { stock, forecast, upcoming, types, orders, settings, todayKey } = useLinenData(7);
  const properties = useHalo((s) => s.properties);
  // Si le sale part aujourd'hui, il revient au plus tôt ce jour-là (délai de la blanchisserie)
  const sendNowReturnKey = addDaysToKey(todayKey, settings.turnaroundDays);

  const sum = (loc: "clean" | "dirty" | "laundry") => types.reduce((n, ty) => n + Math.max(0, qtyAt(stock, loc, ty.id)), 0);
  const inProps = types.reduce((n, ty) => n + Math.max(0, qtyInProperties(stock, ty.id)), 0);
  const shortages = forecast.filter((r) => r.shortageDay).sort((a, b) => (a.shortageDay ?? "").localeCompare(b.shortageDay ?? ""));
  const fmtShort = (k: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
  const weekCost = upcoming.reduce((n, u) => n + kitCost(u.kit, types), 0);
  const avgCost = upcoming.length ? weekCost / upcoming.length : 0;
  const dirty = sum("dirty");
  const fmtDay = (k: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
  const sentOrders = orders.filter((o) => o.status === "sent");
  const nowIso = new Date().toISOString();
  const lateOrders = sentOrders.filter((o) => o.expectedAt && o.expectedAt < nowIso);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Alerte de rupture : l'information n°1 */}
      {shortages.length > 0 ? (
        <Card className="border-danger/40 bg-danger-soft/60">
          <CardContent className="flex flex-wrap items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-danger text-white">
              <AlertTriangle className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-title-3">{t("linen.shortageTitle", { count: shortages.length })}</p>
              <ul className="mt-2 space-y-1 text-[15px]">
                {shortages.slice(0, 4).map((r) => (
                  <li key={r.linenTypeId}>
                    <strong>{name(types.find((x) => x.id === r.linenTypeId))}</strong>{" "}
                    {t("linen.shortageLine", {
                      day: fmtDay(r.shortageDay!),
                      missing: (r.needAtShortage ?? 0) - (r.availableAtShortage ?? 0),
                      need: r.needAtShortage ?? 0,
                      available: r.availableAtShortage ?? 0,
                    })}
                    {/* Prochaine action réellement utile pour CE manque */}
                    <span className="block text-[14px] text-muted">
                      {r.dirty > 0 && sendNowReturnKey < r.shortageDay!
                        ? t("linen.adviceSend", { qty: r.dirty, day: fmtShort(sendNowReturnKey) })
                        : r.dirty > 0
                          ? t("linen.adviceBuyLate", { missing: (r.needAtShortage ?? 0) - (r.availableAtShortage ?? 0), day: fmtShort(sendNowReturnKey) })
                          : t("linen.adviceBuy", { missing: (r.needAtShortage ?? 0) - (r.availableAtShortage ?? 0) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              {dirty > 0 && (
                <Button onClick={onNewOrder}>
                  <Truck />
                  {t("linen.sendDirty")}
                </Button>
              )}
              <Button variant="secondary" onClick={() => goTo("stock")}>
                <ShoppingBag />
                {t("linen.buy")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : lateOrders.length > 0 ? (
        <Card className="border-warning/40 bg-warning-soft/60">
          <CardContent className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="size-6 shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-[15px] font-medium">{t("linen.lateOrders", { count: lateOrders.length })}</p>
            <Button variant="secondary" onClick={() => goTo("laundry")}>
              <Truck />
              {t("linen.tabLaundry")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-success/30 bg-success-soft/50">
          <CardContent className="flex items-center gap-3">
            <CheckCircle2 className="size-6 shrink-0 text-success" />
            <p className="text-[15px] font-medium">{t("linen.allGood")}</p>
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
        <Tile label={t("linen.loc_clean")} value={sum("clean")} icon={PackageCheck} tone="accent" onClick={() => goTo("stock")} />
        <Tile label={t("linen.inProperties")} value={inProps} icon={Building2} onClick={() => goTo("kits")} />
        <Tile label={t("linen.loc_dirty")} value={dirty} icon={WashingMachine} tone="danger" onClick={onNewOrder} />
        <Tile label={t("linen.loc_laundry")} value={sum("laundry")} icon={Truck} onClick={() => goTo("laundry")} />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("linen.needs7")}</CardTitle>
              <p className="mt-1 text-caption text-muted">
                {t("linen.needs7Hint", { count: upcoming.length })} · {t("linen.returnRule")}
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {forecast.length === 0 ? (
              <p className="py-6 text-center text-[15px] text-muted">{t("linen.noNeeds")}</p>
            ) : (
              <>
              {/* Téléphone : une ligne lisible par article, le bilan d'abord */}
              <ul className="divide-y divide-line md:hidden">
                {forecast
                  .slice()
                  .sort((a, b) => Number(Boolean(b.shortageDay)) - Number(Boolean(a.shortageDay)) || (a.shortageDay ?? "").localeCompare(b.shortageDay ?? "") || a.gap - b.gap)
                  .map((r) => (
                    <li key={r.linenTypeId} className="py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 text-[15px] font-medium">{name(types.find((x) => x.id === r.linenTypeId))}</span>
                        <span className="shrink-0 text-end">
                          <Outcome r={r} fmtShort={fmtShort} />
                        </span>
                      </div>
                      <p className="mt-0.5 text-caption text-muted tabular">
                        {t("linen.need7")} {r.need} · {t("linen.cleanNow")} {r.clean} · {t("linen.target")} {parLevelTarget(properties, types, r.linenTypeId)}
                        {r.dirty > 0 && ` · ${t("linen.dirtyToSend")} ${r.dirty}`}
                        {r.returns.map((ret) => ` · ${t("linen.returnShort")} ${ret.qty} ${ret.late ? t("linen.lateReturn") : fmtShort(ret.dayKey)}`).join("")}
                      </p>
                    </li>
                  ))}
              </ul>
              <div className="-mx-5 hidden overflow-x-auto px-5 md:block">
                <table className="w-full min-w-[640px] text-[14px]">
                  <thead>
                    <tr className="border-b border-line text-micro text-muted">
                      <th scope="col" className="py-2.5 pe-3 text-start font-semibold">{t("linen.item")}</th>
                      <th scope="col" className="py-2.5 pe-3 text-end font-semibold">{t("linen.need7")}</th>
                      <th scope="col" className="py-2.5 pe-3 text-end font-semibold">{t("linen.cleanNow")}</th>
                      <th scope="col" className="py-2.5 pe-3 text-end font-semibold">{t("linen.dirtyToSend")}</th>
                      <th scope="col" className="py-2.5 pe-3 text-end font-semibold">{t("linen.atLaundryReturn")}</th>
                      <th scope="col" className="py-2.5 pe-3 text-end font-semibold">{t("linen.target")}</th>
                      <th scope="col" className="py-2.5 text-end font-semibold">{t("linen.outcome7")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast
                      .slice()
                      .sort((a, b) => Number(Boolean(b.shortageDay)) - Number(Boolean(a.shortageDay)) || (a.shortageDay ?? "").localeCompare(b.shortageDay ?? "") || a.gap - b.gap)
                      .map((r) => {
                        const ty = types.find((x) => x.id === r.linenTypeId);
                        return (
                          <tr key={r.linenTypeId} className="border-b border-line align-top last:border-b-0">
                            <td className="py-2.5 pe-3 font-medium">{name(ty)}</td>
                            <td className="py-2.5 pe-3 text-end tabular">{r.need}</td>
                            <td className="py-2.5 pe-3 text-end tabular">{r.clean}</td>
                            <td className="py-2.5 pe-3 text-end tabular text-muted">{r.dirty || "—"}</td>
                            <td className="py-2.5 pe-3 text-end tabular">
                              {r.returns.length === 0 ? (
                                <span className="text-muted">{r.atLaundry || "—"}</span>
                              ) : (
                                r.returns.map((ret) => (
                                  <span key={ret.dayKey} className={cn("block", ret.late ? "text-danger" : "text-muted")}>
                                    {ret.qty} · {ret.late ? t("linen.lateReturn") : fmtShort(ret.dayKey)}
                                  </span>
                                ))
                              )}
                            </td>
                            <td className="py-2.5 pe-3 text-end tabular text-muted">{parLevelTarget(properties, types, r.linenTypeId)}</td>
                            <td className="py-2.5 text-end">
                              <Outcome r={r} fmtShort={fmtShort} />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("linen.costs")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] text-muted">{t("linen.costPerRotation")}</span>
                <span className="text-title-3 tabular">{money(avgCost)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] text-muted">{t("linen.cost7")}</span>
                <span className="text-title-3 tabular">{money(weekCost)}</span>
              </div>
              <p className="text-caption text-muted">{t("linen.costHint")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("linen.laundry")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-2">
              {sentOrders.length === 0 ? (
                <p className="text-[14px] text-muted">{t("linen.noOrderOut")}</p>
              ) : (
                sentOrders.map((o) => (
                  <button key={o.id} type="button" onClick={() => goTo("laundry")} className="flex w-full items-center justify-between rounded-md bg-subtle px-3 py-2 text-start text-[14px] dark:bg-surface-hover">
                    <span className="font-semibold">{o.reference}</span>
                    <span className={cn(o.expectedAt && o.expectedAt < nowIso ? "font-medium text-danger" : "text-muted")}>
                      {t("linen.pieces", { count: o.lines.reduce((n, l) => n + l.sent, 0) })} ·{" "}
                      {o.expectedAt && o.expectedAt < nowIso
                        ? t("linen.lateReturn")
                        : o.expectedAt && new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(new Date(o.expectedAt))}
                    </span>
                  </button>
                ))
              )}
              {dirty > 0 && (
                <Button variant="secondary" className="mt-2 w-full" onClick={onNewOrder}>
                  <Truck />
                  {t("linen.prepareOrder", { count: dirty })}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
