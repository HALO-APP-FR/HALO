"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { resetNotificationPrefs, setNotificationPref } from "@/lib/connected/actions";
import { setPushPref } from "@/lib/connected/push-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRun } from "./use-run";

export interface PrefRow {
  event: string;
  /** Où l'événement reste visible dans HALO, quel que soit le réglage e-mail. */
  where: string;
  email: boolean;
  /** Push : null = aucun push pour cet événement ; sinon préférence enregistrée (oui par défaut) */
  push: boolean | null;
  /** Urgences : l'e-mail part toujours pour elles, même préférence coupée. */
  critical: "always" | "urgent_only" | null;
}

/**
 * Préférences de notification de la personne connectée, enregistrées et appliquées par la base.
 * Canaux : « Dans HALO » (compteurs et pages, toujours actif), e-mail (si un service d'envoi est configuré),
 * SMS et notifications push : indisponibles tant qu'aucun fournisseur n'est configuré.
 */
export function NotificationPrefs({ rows, emailReady, push }: { rows: PrefRow[]; emailReady: boolean; /** État push réel : non configuré, aucun appareil, ou N appareils actifs */ push: { state: "migration" | "not_configured" | "no_device" | "active"; devices: number } }) {
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
        <p className={push.state === "active" ? "rounded-md bg-success-soft px-3 py-2 text-success" : "rounded-md bg-subtle px-3 py-2 text-muted dark:bg-surface-hover"} data-testid="channel-push" data-state={push.state}>
          {push.state === "active" ? t("channel.pushOn", { count: push.devices }) : push.state === "no_device" ? t("channel.pushNoDevice") : t("channel.push")}
        </p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((r) => (
          <PrefItem key={`${r.event}-${r.email}-${r.push}`} row={r} disabled={!emailReady} pushReady={push.state === "active"} />
        ))}
      </ul>
      <ResetPrefs />
    </Card>
  );
}

function ResetPrefs() {
  const t = useTranslations("connected.prefs");
  const { pending, error, run } = useRun();
  const [done, setDone] = useState(false);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button size="sm" variant="outline" onClick={() => run(() => resetNotificationPrefs(), () => setDone(true))} disabled={pending} data-testid="prefs-reset">
        {t("reset")}
      </Button>
      <span className="text-[13px] text-muted">{done ? t("resetDone") : t("resetHint")}</span>
      {error && <span role="alert" className="text-[13px] text-danger">{error}</span>}
    </div>
  );
}

function PrefItem({ row, disabled, pushReady }: { row: PrefRow; disabled: boolean; pushReady: boolean }) {
  const t = useTranslations("connected.prefs");
  const { pending, error, run } = useRun();
  const [on, setOn] = useState(row.email);
  const [pushOn, setPushOn] = useState(row.push ?? false);
  const locked = row.critical === "always";
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-testid="pref-row" data-event={row.event}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{t(`event.${row.event}`)}</span>
        <span className="block text-[12px] text-muted" data-testid="pref-where">{t("visibleIn", { where: row.where })}</span>
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
      {row.push !== null && (
        <label className="flex items-center gap-2 text-[14px]" title={pushReady ? undefined : t("pushNeedsDevice")}>
          <input
            type="checkbox"
            checked={pushReady && pushOn}
            disabled={!pushReady || pending}
            onChange={(e) => {
              const v = e.target.checked;
              setPushOn(v);
              run(async () => {
                const r = await setPushPref(row.event, v);
                if (!r.ok) setPushOn(!v);
                return r;
              });
            }}
            data-testid="pref-push"
          />
          {t("byPush")}
        </label>
      )}
      {error && <p role="alert" className="basis-full text-[13px] text-danger">{error}</p>}
    </li>
  );
}
