"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { useParams } from "next/navigation";
import {
  acceptLaundryInvite,
  advanceLaundryOrder,
  cancelLaundryOrder,
  confirmLaundryOrder,
  createLaundryOrder,
  inviteLaundry,
  revokeLaundryInvite,
  resolveLaundryGap,
  revokeLaundryMember,
  saveLaundryPartner,
} from "@/lib/connected/laundry-actions";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

/** Étapes affichées (identiques côté conciergerie et blanchisseur) */
export const STEPS = ["sent", "received", "processing", "ready", "out_for_delivery", "delivered"] as const;
type Step = (typeof STEPS)[number] | "cancelled";

export interface OrderView {
  id: string;
  reference: string;
  partnerName: string;
  client?: string;
  status: Step;
  sentAt: string;
  expectedBackAt: string;
  deliveredAt: string | null;
  note: string | null;
  late: boolean;
  lines: { itemId: string; label: string; sent: number; received: number | null; returned: number | null; confirmed: number | null; resolved?: number; openGap?: number }[];
  events: { kind: string; side: "concierge" | "laundry"; at: string; note: string | null; actor?: string | null; data?: Record<string, unknown> | null }[];
}

const gapOf = (l: OrderView["lines"][number]) => [l.received, l.returned, l.confirmed].some((q) => q != null && q !== l.sent);

/** Frise des étapes : fait / en cours / à venir — lisible sur téléphone (pastilles numérotées + libellé courant) */
export function LaundrySteps({ status }: { status: Step }) {
  const t = useTranslations("connected.laundry");
  if (status === "cancelled") return <p className="text-[13px] font-medium text-muted" data-testid="laundry-steps" data-status="cancelled">{t("status.cancelled")}</p>;
  const cur = STEPS.indexOf(status);
  return (
    <div data-testid="laundry-steps" data-status={status}>
      <ol className="flex items-center gap-1" aria-label={t("stepsLabel")}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-1" aria-current={i === cur ? "step" : undefined} title={t(`status.${s}`)}>
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold", i < cur || s === "delivered" && i === cur ? "bg-success text-white" : i === cur ? "bg-accent text-on-accent" : "bg-subtle text-muted")}>
              {i < cur || (s === "delivered" && i === cur) ? <Check className="size-3.5" /> : i + 1}
            </span>
            {i < STEPS.length - 1 && <span className={cn("h-0.5 min-w-1 flex-1 rounded", i < cur ? "bg-success" : "bg-line")} />}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[13px] font-medium">{t(`status.${status}`)}</p>
    </div>
  );
}

function LinesTable({ o, editable, onChange, values }: { o: OrderView; editable?: "received" | "returned" | "confirmed"; values?: Record<string, string>; onChange?: (id: string, v: string) => void }) {
  const t = useTranslations("connected.laundry");
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[300px] text-[13px]" data-testid="laundry-lines">
        <thead>
          <tr className="text-[10px] text-muted">
            <th />
            <th className="pt-1 text-end font-normal">{t("col.yours")}</th>
            <th colSpan={2} className="pt-1 text-end font-normal">{t("col.declaredByLaundry")}</th>
            <th className="pt-1 text-end font-normal">{t("col.yours")}</th>
          </tr>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1 text-start font-medium">{t("col.item")}</th>
            <th className="py-1 text-end font-medium">{t("col.sent")}</th>
            <th className="py-1 text-end font-medium">{t("col.received")}</th>
            <th className="py-1 text-end font-medium">{t("col.returned")}</th>
            <th className="py-1 text-end font-medium">{t("col.confirmed")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {o.lines.map((l) => (
            <tr key={l.itemId} data-testid="laundry-line" data-gap={gapOf(l) ? "yes" : "no"}>
              <td className="py-1.5 font-medium">{l.label}</td>
              <td className="py-1.5 text-end tabular">{l.sent}</td>
              {(["received", "returned", "confirmed"] as const).map((k) => (
                <td key={k} className={cn("py-1.5 text-end tabular", l[k] != null && l[k] !== l.sent && "font-semibold text-danger")}>
                  {editable === k ? (
                    <Input
                      type="number"
                      min={0}
                      max={k === "confirmed" ? l.sent : 100000}
                      inputMode="numeric"
                      className="ms-auto h-8 w-20 text-end"
                      value={values?.[l.itemId] ?? ""}
                      onChange={(e) => onChange?.(l.itemId, e.target.value)}
                      aria-label={`${t(`col.${k}`)} · ${l.label}`}
                      data-testid={`laundry-qty-${k}`}
                    />
                  ) : (
                    (l[k] ?? "—")
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ o }: { o: OrderView }) {
  const t = useTranslations("connected.laundry");
  const f = useFormatter();
  return (
    <details className="mt-2 text-[13px]" data-testid="laundry-history">
      <summary className="cursor-pointer font-medium text-accent-text">{t("history", { count: o.events.length })}</summary>
      <ol className="mt-1 space-y-1 border-s border-line ps-3">
        {o.events.map((e, i) => (
          <li key={i} data-testid="laundry-event" data-kind={e.kind} data-side={e.side}>
            <span className="text-muted tabular">{f.dateTime(new Date(e.at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> ·{" "}
            <span className={e.kind === "discrepancy" ? "font-semibold text-danger" : "font-medium"}>{t(`event.${e.kind}`)}</span>
            <span className="text-muted"> · {e.side === "laundry" ? (e.actor ? t("byLaundryNamed", { name: e.actor }) : t("byLaundry")) : e.actor ? e.actor : t("byConcierge")}</span>
            {e.kind === "gap_resolved" && e.data && (
              <span className="text-muted"> · {t(e.data.outcome === "found" ? "gapFoundQty" : "gapLostQty", { qty: Number(e.data.qty) || 0 })}</span>
            )}
            {e.note && <span className="text-muted"> · « {e.note} »</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function Header({ o, side }: { o: OrderView; side: "concierge" | "laundry" }) {
  const t = useTranslations("connected.laundry");
  const f = useFormatter();
  const d = (x: string) => f.dateTime(new Date(x), { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">
          {o.reference} · {side === "concierge" ? o.partnerName : o.client}
        </p>
        <p className="text-[13px] text-muted">
          {t("sentOn", { date: d(o.sentAt) })} · {o.status === "delivered" && o.deliveredAt ? t("deliveredOn", { date: d(o.deliveredAt) }) : t("backBy", { date: d(o.expectedBackAt) })}
        </p>
        {o.note && <p className="text-[13px] text-muted">« {o.note} »</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {o.late && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[12px] font-semibold text-danger" data-testid="laundry-late">{t("late")}</span>}
        {o.lines.some(gapOf) &&
          (side === "concierge" && o.status === "delivered" && o.lines.every((l) => (l.openGap ?? 0) === 0) && o.lines.some((l) => (l.resolved ?? 0) > 0) ? (
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[12px] font-semibold text-success" data-testid="laundry-gap-resolved">{t("gapResolved")}</span>
          ) : (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning" data-testid="laundry-gap">{t("gap")}</span>
          ))}
      </div>
    </div>
  );
}

/** Commande vue par la conciergerie : étapes, quantités, historique ; annulation (avant réception) et réception constatée. */
export function LaundryOrderCard({ o }: { o: OrderView }) {
  const t = useTranslations("connected.laundry");
  const { pending, error, run } = useRun();
  const canConfirm = o.status === "ready" || o.status === "out_for_delivery";
  // Reprise anticipée (reçu ou en traitement) : le linge revient au SALE ; action secondaire, repliée
  const canTakeBack = o.status === "received" || o.status === "processing";
  const [takingBack, setTakingBack] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(o.lines.map((l) => [l.itemId, String(l.returned ?? l.sent)])));
  const [note, setNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<number | null>(null);
  return (
    <li id={`order-${o.id}`} className="scroll-mt-20 px-4 py-3 md:px-5" data-testid="laundry-order" data-reference={o.reference} data-status={o.status}>
      <Header o={o} side="concierge" />
      <div className="mt-2">
        <LaundrySteps status={o.status} />
      </div>
      <div className="mt-2">
        <LinesTable o={o} editable={canConfirm || takingBack ? "confirmed" : undefined} values={qty} onChange={(id, v) => setQty((q) => ({ ...q, [id]: v }))} />
      </div>
      {o.status === "out_for_delivery" && <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent-text" data-testid="laundry-next-confirm">{t("nextConfirm")}</p>}
      {canTakeBack && !takingBack && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setTakingBack(true)} data-testid="laundry-takeback">
          {t("takeBack")}
        </Button>
      )}
      {takingBack && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <p className="basis-full text-[12px] text-muted">{t("takeBackHint")}</p>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("confirmNote")} aria-label={t("confirmNote")} className="min-w-0 flex-1 basis-48" />
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => confirmLaundryOrder(o.id, o.lines.map((l) => ({ itemId: l.itemId, qty: Number(qty[l.itemId] || 0) })), note), (d) => (setResult(d.gaps), setTakingBack(false)))} data-testid="laundry-takeback-confirm">
            {t("takeBackConfirm")}
          </Button>
        </div>
      )}
      {o.status === "delivered" && o.lines.some((l) => (l.openGap ?? 0) > 0) && (
        <div className="mt-2 space-y-2 rounded-md border border-warning/40 bg-warning-soft/40 p-3" data-testid="laundry-open-gap">
          <p className="text-[13px] font-medium">{t("openGapTitle")}</p>
          {o.lines.filter((l) => (l.openGap ?? 0) > 0).map((l) => (
            <GapLine key={l.itemId} orderId={o.id} itemId={l.itemId} label={l.label} open={l.openGap!} />
          ))}
        </div>
      )}
      {canConfirm && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("confirmNote")} aria-label={t("confirmNote")} className="min-w-0 flex-1 basis-48" />
          <Button size="sm" disabled={pending} onClick={() => run(() => confirmLaundryOrder(o.id, o.lines.map((l) => ({ itemId: l.itemId, qty: Number(qty[l.itemId] || 0) })), note), (d) => setResult(d.gaps))} data-testid="laundry-confirm">
            {t("confirm")}
          </Button>
          <p className="basis-full text-[12px] text-muted">{t("confirmHint")}</p>
        </div>
      )}
      {o.status === "sent" &&
        (cancelling ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t("cancelReason")} aria-label={t("cancelReason")} className="min-w-0 flex-1 basis-48" data-testid="laundry-cancel-reason" />
            <Button size="sm" variant="outline" disabled={pending || !reason.trim()} onClick={() => run(() => cancelLaundryOrder(o.id, reason))} data-testid="laundry-cancel-confirm">
              {t("cancelConfirm")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setCancelling(true)} data-testid="laundry-cancel">
            {t("cancel")}
          </Button>
        ))}
      {result != null && (
        <p role="status" className={cn("mt-2 text-[13px]", result ? "text-warning" : "text-success")} data-testid="laundry-confirm-result">
          {result ? t("confirmedWithGaps", { count: result }) : t("confirmedOk")}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
      <History o={o} />
    </li>
  );
}

/** Manque restant après réception : perdu (sort du stock) ou retrouvé (rejoint le propre), jamais plus que le manque. */
function GapLine({ orderId, itemId, label, open }: { orderId: string; itemId: string; label: string; open: number }) {
  const t = useTranslations("connected.laundry");
  const { pending, error, run } = useRun();
  const [qty, setQty] = useState(String(open));
  const n = Number(qty);
  const ok = Number.isInteger(n) && n > 0 && n <= open;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="laundry-gap-line" data-open={open}>
      <span className="min-w-0 flex-1 basis-40">{t("openGapLine", { label, count: open })}</span>
      <Input type="number" min={1} max={open} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 w-16 text-end" aria-label={t("openGapQty", { label })} data-testid="laundry-gap-qty" />
      <Button size="sm" variant="outline" disabled={pending || !ok} onClick={() => run(() => resolveLaundryGap(orderId, itemId, n, "found", ""))} data-testid="laundry-gap-found">
        {t("gapFound")}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || !ok} onClick={() => run(() => resolveLaundryGap(orderId, itemId, n, "lost", ""))} data-testid="laundry-gap-lost">
        {t("gapLost")}
      </Button>
      {error && <span role="alert" className="basis-full text-danger">{error}</span>}
    </div>
  );
}

/** Prochaine action du blanchisseur : principale, et « prêt » en option pendant le traitement. */
const NEXT: Partial<Record<Step, Step>> = { sent: "received", received: "processing", processing: "out_for_delivery", ready: "out_for_delivery" };

/** Commande vue par le blanchisseur : une seule action possible, l'étape suivante (quantités à la réception et au départ). */
export function PartnerOrderCard({ o }: { o: OrderView }) {
  const t = useTranslations("connected.laundry");
  const { pending, error, run } = useRun();
  const next = NEXT[o.status];
  const withQty = next === "received" || next === "out_for_delivery";
  const send = (to: Step, lines: boolean) =>
    run(() => advanceLaundryOrder(o.id, to, lines ? o.lines.map((l) => ({ itemId: l.itemId, qty: Number(qty[l.itemId] || 0) })) : null, note), (d) => setGaps(d.gaps));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(o.lines.map((l) => [l.itemId, String((next === "out_for_delivery" ? l.received : null) ?? l.sent)])));
  const [note, setNote] = useState("");
  const [gaps, setGaps] = useState<number | null>(null);
  return (
    <li className="rounded-xl border border-line bg-surface p-4 shadow-card" data-testid="partner-order" data-reference={o.reference} data-status={o.status}>
      <Header o={o} side="laundry" />
      <div className="mt-3">
        <LaundrySteps status={o.status} />
      </div>
      <div className="mt-3">
        <LinesTable o={o} editable={withQty ? (next === "received" ? "received" : "returned") : undefined} values={qty} onChange={(id, v) => setQty((q) => ({ ...q, [id]: v }))} />
      </div>
      {next && (
        <div className="mt-3 space-y-2">
          {withQty && <p className="text-[12px] text-muted">{t(next === "received" ? "declareReceived" : "declareReturned")}</p>}
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("partnerNote")} aria-label={t("partnerNote")} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" disabled={pending} onClick={() => send(next, withQty)} data-testid="partner-advance" data-next={next}>
              {t(`action.${next}`)}
            </Button>
            {o.status === "processing" && (
              <Button variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={() => send("ready", false)} data-testid="partner-ready">
                {t("action.ready")}
              </Button>
            )}
          </div>
        </div>
      )}
      {o.status === "out_for_delivery" && <p className="mt-3 text-[13px] text-muted">{t("waitingConfirm")}</p>}
      {/* Écart déclaré : affiché à partir des données (et non d'un état local), même après changement d'étape */}
      {(() => {
        const n = gaps ?? o.lines.filter((l) => [l.received, l.returned].some((q) => q != null && q !== l.sent)).length;
        return n > 0 && o.status !== "delivered" && o.status !== "cancelled" ? (
          <p role="status" className="mt-2 text-[13px] text-warning" data-testid="partner-gap-sent">
            {t("gapReported", { count: n })}
          </p>
        ) : null;
      })()}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
      <History o={o} />
    </li>
  );
}

export function LaundryPartnerForm() {
  const t = useTranslations("connected.laundry");
  const { pending, error, run } = useRun();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      className="grid gap-2 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveLaundryPartner({ name, contactName: contact, contactEmail: email }), () => (setName(""), setContact(""), setEmail("")));
      }}
      data-testid="laundry-partner-form"
    >
      <Field label={t("partnerName")} htmlFor="lp-name">
        <Input id="lp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required data-testid="laundry-partner-name" />
      </Field>
      <Field label={t("contactName")} htmlFor="lp-contact">
        <Input id="lp-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
      </Field>
      <Field label={t("contactEmail")} htmlFor="lp-email">
        <Input id="lp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
      </Field>
      <Button type="submit" size="sm" className="sm:col-span-3 sm:justify-self-start" disabled={pending || !name.trim()} data-testid="laundry-partner-add">
        {t("partnerAdd")}
      </Button>
      {error && <p role="alert" className="text-[13px] text-danger sm:col-span-3">{error}</p>}
    </form>
  );
}

/** Invitation nominative : nom et adresse ; le lien n'ouvre l'accès qu'au compte de cette adresse. */
export function LaundryInviteForm({ partnerId, defaultName = "", defaultEmail = "" }: { partnerId: string; defaultName?: string; defaultEmail?: string }) {
  const t = useTranslations("connected.laundry");
  const { locale } = useParams<{ locale: string }>();
  const { pending, error, run } = useRun();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2" data-testid="laundry-invite">
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setCopied(false);
          run(() => inviteLaundry(partnerId, name, email, locale), (d) => setUrl(d.url));
        }}
      >
        <Field label={t("inviteName")} htmlFor={`li-n-${partnerId}`}>
          <Input id={`li-n-${partnerId}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required data-testid="laundry-invite-name" />
        </Field>
        <Field label={t("inviteEmail")} htmlFor={`li-e-${partnerId}`}>
          <Input id={`li-e-${partnerId}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required data-testid="laundry-invite-email" />
        </Field>
        <Button type="submit" size="sm" disabled={pending || !name.trim() || !email.trim()} data-testid="laundry-invite-send">
          {t("inviteCreate")}
        </Button>
      </form>
      {url && (
        <div className="rounded-md border border-line bg-subtle p-2 text-[13px] dark:bg-surface-hover" data-testid="laundry-invite-link">
          <p className="text-muted">{t("inviteLinkHint", { email })}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate" data-testid="laundry-invite-url">{url}</code>
            <Button size="sm" variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
              <Copy className="size-4" /> {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function RevokeLaundryAccess({ kind, partnerId, id }: { kind: "invite" | "member"; partnerId: string; id: string }) {
  const t = useTranslations("connected.laundry");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => (kind === "invite" ? revokeLaundryInvite(id) : revokeLaundryMember(partnerId, id)))} data-testid={`laundry-revoke-${kind}`}>
        {t(kind === "invite" ? "revokeInvite" : "revokeMember")}
      </Button>
      {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
    </span>
  );
}

/** Nouvelle commande : articles et quantités (linge sale disponible indiqué), date de retour prévue. */
export function LaundryOrderForm({ partners, items, dirty, defaultBackAt }: { partners: { id: string; name: string }[]; items: { id: string; label: string }[]; dirty: Record<string, number>; defaultBackAt: string }) {
  const t = useTranslations("connected.laundry");
  const { pending, error, run } = useRun();
  const [partner, setPartner] = useState(partners[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [back, setBack] = useState(defaultBackAt);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  if (!partners.length) return <p className="text-[14px] text-muted">{t("needPartner")}</p>;
  if (!items.length) return <p className="text-[14px] text-muted">{t("needItems")}</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        run(
          () => createLaundryOrder({ partnerId: partner, lines: items.map((i) => ({ itemId: i.id, qty: Number(qty[i.id] || 0) })), expectedBackAt: new Date(back).toISOString(), note }),
          (d) => (setDone(d.reference), setQty({}), setNote("")),
        );
      }}
      data-testid="laundry-order-form"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t("partner")} htmlFor="lo-partner">
          <Select id="lo-partner" value={partner} onChange={(e) => setPartner(e.target.value)} data-testid="laundry-order-partner">
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("backAt")} htmlFor="lo-back">
          <Input id="lo-back" type="datetime-local" value={back} onChange={(e) => setBack(e.target.value)} required data-testid="laundry-order-back" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <Field key={i.id} label={i.label} htmlFor={`lo-${i.id}`} hint={t("dirtyAvailable", { qty: dirty[i.id] ?? 0 })}>
            <Input id={`lo-${i.id}`} type="number" min={0} max={100000} inputMode="numeric" value={qty[i.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} placeholder="0" data-testid="laundry-order-qty" data-item={i.label} />
          </Field>
        ))}
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("orderNote")} aria-label={t("orderNote")} />
      <Button type="submit" size="sm" disabled={pending || !partner || !items.some((i) => Number(qty[i.id] || 0) > 0)} data-testid="laundry-order-send">
        {t("orderSend")}
      </Button>
      {done && <p role="status" className="text-[13px] text-success" data-testid="laundry-order-ok">{t("orderOk", { reference: done })}</p>}
      {error && <p role="alert" className="text-[13px] text-danger" data-testid="laundry-order-error">{error}</p>}
    </form>
  );
}

/** Acceptation de l'invitation nominative (page publique du lien, compte connecté). */
export function AcceptLaundryInvite({ token }: { token: string }) {
  const t = useTranslations("connected.laundry");
  const { locale } = useParams<{ locale: string }>();
  const { pending, error, run } = useRun();
  const [res, setRes] = useState<{ status: string; email?: string } | null>(null);
  if (res?.status === "ok") {
    return (
      <div data-testid="laundry-invite-accepted">
        <p className="text-[15px]">{t("acceptedText")}</p>
        <a href={`/${locale}/laundry`} className="mt-4 inline-flex h-10 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-on-accent" data-testid="laundry-go">
          {t("goOrders")}
        </a>
      </div>
    );
  }
  return (
    <div>
      <Button className="w-full" disabled={pending} onClick={() => run(() => acceptLaundryInvite(token), (d) => setRes(d))} data-testid="laundry-accept">
        {t("accept")}
      </Button>
      {res?.status === "wrong_account" && <p role="alert" className="mt-3 text-[14px] text-danger" data-testid="laundry-wrong-account">{t("wrongAccount", { email: res.email ?? "" })}</p>}
      {res?.status === "invalid" && <p role="alert" className="mt-3 text-[14px] text-danger" data-testid="laundry-invite-invalid">{t("inviteInvalid")}</p>}
      {error && <p role="alert" className="mt-3 text-[14px] text-danger">{error}</p>}
    </div>
  );
}
