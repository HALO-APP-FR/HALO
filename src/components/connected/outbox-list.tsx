"use client";

import { useLocale, useTranslations } from "next-intl";
import { retryNotification } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { useRun } from "./use-run";

export interface OutboxItem {
  id: string;
  template: string;
  recipient: string;
  status: "pending" | "sent" | "failed" | "not_configured";
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at?: string | null;
}

/** État RÉEL des e-mails au voyageur : « envoyé » uniquement si le fournisseur a accepté le message. */
export function OutboxList({ items }: { items: OutboxItem[] }) {
  const t = useTranslations("connected.outbox");
  const locale = useLocale();
  const { pending, error, run } = useRun();
  const fmt = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
  if (!items.length) return <p className="text-[14px] text-muted">{t("empty")}</p>;
  const tone = { sent: "text-success", pending: "text-muted", failed: "text-danger", not_configured: "text-warning" } as const;
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
            {(o.status === "failed" || o.status === "not_configured") && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryNotification(o.id))} data-testid="outbox-retry">
                {t("retry")}
              </Button>
            )}
            {o.status === "failed" && o.last_error && <span className="w-full text-[12px] text-danger">{o.last_error}</span>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}
