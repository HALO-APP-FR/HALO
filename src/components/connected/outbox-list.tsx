"use client";

import { useFormatter, useTranslations } from "next-intl";
import { retryNotification } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { useRun } from "./use-run";

export interface OutboxItem {
  id: string;
  template: string;
  recipient: string;
  status: "pending" | "sent" | "failed" | "not_configured" | "skipped";
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at?: string | null;
}

/** État RÉEL des e-mails au voyageur : « envoyé » uniquement si le fournisseur a accepté le message. */
export function OutboxList({ items }: { items: OutboxItem[] }) {
  const t = useTranslations("connected.outbox");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  // Même fuseau que le chat et les historiques (celui de l'organisation), jamais celui du navigateur
  const fmt = (d: string) => f.dateTime(new Date(d), { dateStyle: "short", timeStyle: "short" });
  if (!items.length) return <p className="text-[14px] text-muted">{t("empty")}</p>;
  const tone = { sent: "text-success", pending: "text-muted", failed: "text-danger", not_configured: "text-warning", skipped: "text-muted" } as const;
  return (
    <div>
      <ul className="divide-y divide-line">
        {items.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[14px]" data-testid="outbox-row" data-status={o.status}>
            <span className="flex-1">
              {t(`template.${o.template}`)} · <span className="text-muted">{o.recipient}</span>
              <span className="block text-[12px] text-faint">{fmt(o.created_at)}{o.attempts > 1 ? ` · ${t("attempts", { n: o.attempts })}` : ""}</span>
            </span>
            <span className={`font-medium ${tone[o.status]}`}>{t(`status.${o.status}`)}</span>
            {(o.status === "failed" || o.status === "not_configured") && o.last_error !== "undeliverable_test_address" && o.template !== "prep_invite" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryNotification(o.id))} data-testid="outbox-retry">
                {t("retry")}
              </Button>
            )}
            {o.template === "prep_invite" && (o.status === "failed" || o.status === "not_configured") && (
              <span className="w-full text-[12px] text-muted">{t("inviteResend")}</span>
            )}
            {o.status === "skipped" && (
              <span className="w-full text-[12px] text-muted" data-testid="outbox-skipped">
                {t("skippedReason")}
              </span>
            )}
            {o.status === "failed" && o.last_error && (
              <span className="w-full text-[12px] text-danger" data-testid="outbox-error">
                {o.last_error === "undeliverable_test_address" ? t("testAddress") : o.last_error === "link_not_kept_send_new_invite" ? t("inviteNotKept") : o.last_error}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}
