"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { setNotificationPref } from "@/lib/connected/actions";
import { Card } from "@/components/ui/card";
import { useRun } from "./use-run";

export interface PrefRow {
  event: string;
  email: boolean;
  /** Urgences : l'e-mail part toujours pour elles, même préférence coupée. */
  critical: "always" | "urgent_only" | null;
}

/**
 * Préférences de notification de la personne connectée, enregistrées et appliquées par la base.
 * Canaux : « Dans HALO » (compteurs et pages, toujours actif), e-mail (si un service d'envoi est configuré),
 * SMS et notifications push : indisponibles tant qu'aucun fournisseur n'est configuré.
 */
export function NotificationPrefs({ rows, emailReady }: { rows: PrefRow[]; emailReady: boolean }) {
  const t = useTranslations("connected.prefs");
  return (
    <Card className="p-5" data-testid="notification-prefs">
      <h2 className="text-[17px] font-semibold">{t("title")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2" data-testid="channels">
        <p className="rounded-md bg-success-soft px-3 py-2 text-success">{t("channel.inApp")}</p>
        <p className={emailReady ? "rounded-md bg-success-soft px-3 py-2 text-success" : "rounded-md bg-warning-soft px-3 py-2 text-warning"} data-testid="channel-email">
          {emailReady ? t("channel.emailOk") : t("channel.emailOff")}
        </p>
        <p className="rounded-md bg-subtle px-3 py-2 text-muted dark:bg-surface-hover" data-testid="channel-sms">{t("channel.sms")}</p>
        <p className="rounded-md bg-subtle px-3 py-2 text-muted dark:bg-surface-hover" data-testid="channel-push">{t("channel.push")}</p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((r) => (
          <PrefItem key={r.event} row={r} disabled={!emailReady} />
        ))}
      </ul>
    </Card>
  );
}

function PrefItem({ row, disabled }: { row: PrefRow; disabled: boolean }) {
  const t = useTranslations("connected.prefs");
  const { pending, error, run } = useRun();
  const [on, setOn] = useState(row.email);
  const locked = row.critical === "always";
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-testid="pref-row" data-event={row.event}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{t(`event.${row.event}`)}</span>
        {row.critical && (
          <span className="flex items-center gap-1 text-[12px] text-muted">
            <Lock className="size-3" />
            {t(locked ? "alwaysSent" : "urgentAlwaysSent")}
          </span>
        )}
      </span>
      <label className="flex items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          checked={locked || on}
          disabled={locked || pending || disabled}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            // Échec serveur : la case revient à l'état réellement enregistré
            run(async () => {
              const r = await setNotificationPref(row.event, v);
              if (!r.ok) setOn(!v);
              return r;
            });
          }}
          data-testid="pref-email"
        />
        {t("byEmail")}
      </label>
      {error && <p role="alert" className="basis-full text-[13px] text-danger">{error}</p>}
    </li>
  );
}
