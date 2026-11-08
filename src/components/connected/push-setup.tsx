"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BellRing, Smartphone } from "lucide-react";
import { sendTestPush, subscribePush, unsubscribePush } from "@/lib/connected/push-actions";
import { deviceLabel, isAndroid, isIos, pushDeviceState, type PushDeviceState } from "@/lib/engine/push-support";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

export interface PushDevice {
  id: string;
  label: string | null;
  created_at: string;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  disabled_at: string | null;
}

const b64ToUint8 = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * Notifications push sur CET appareil : état réel (serveur configuré ? appareil compatible ? autorisation ?),
 * activation par la personne elle-même, essai vers ses propres appareils, liste de ses appareils.
 * Jamais « notification envoyée » : on affiche « acceptée par le service de notification » ou l'échec exact.
 */
export function PushSetup({ publicKey, devices, available }: { publicKey: string | null; devices: PushDevice[]; /** Migration 28 appliquée */ available: boolean }) {
  const t = useTranslations("connected.push");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [state, setState] = useState<PushDeviceState | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const configured = Boolean(publicKey) && available;

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const ua = nav.userAgent;
    const touchMac = /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
    const info = {
      ua,
      touchMac,
      standalone: window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
      hasServiceWorker: "serviceWorker" in nav,
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : null,
    };
    // Détection après le premier rendu (navigateur uniquement)
    void Promise.resolve().then(() => {
      setPlatform(isIos(info) ? "ios" : isAndroid(ua) ? "android" : "other");
      setState(pushDeviceState(info));
    });
    if (info.hasServiceWorker && info.hasPushManager) {
      void navigator.serviceWorker.getRegistration("/").then((reg) => reg?.pushManager.getSubscription().then((s) => setEndpoint(s?.endpoint ?? null)));
    }
  }, []);

  const activate = () =>
    run(async () => {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "ready");
        return { ok: false as const, error: "push_permission_refused" };
      }
      let sub: PushSubscription;
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey!) }));
      } catch {
        // Refus du navigateur ou du service de notification : rien n'est enregistré côté HALO
        return { ok: false as const, error: "push_subscribe_failed" };
      }
      const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      const r = await subscribePush({ endpoint: json.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", label: deviceLabel(navigator.userAgent) });
      if (r.ok) setEndpoint(json.endpoint);
      else await sub.unsubscribe();
      return r;
    });

  const deactivate = () =>
    run(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      const ep = sub?.endpoint ?? endpoint;
      await sub?.unsubscribe();
      const r = ep ? await unsubscribePush(ep) : { ok: true as const, data: undefined };
      if (r.ok) setEndpoint(null);
      return r;
    });

  const active = devices.filter((d) => !d.disabled_at);
  const here = endpoint != null;
  return (
    <Card className="p-5" data-testid="push-setup">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
        </div>
      </div>

      {/* État global : jamais de promesse si HALO ne peut pas envoyer */}
      <p
        className={cn("mt-4 rounded-md px-3 py-2 text-[14px]", configured ? (active.length ? "bg-success-soft text-success" : "bg-subtle text-muted dark:bg-surface-hover") : "bg-warning-soft text-warning")}
        data-testid="push-status"
        data-state={!available ? "migration" : !publicKey ? "not_configured" : active.length ? "active" : "no_device"}
      >
        {!available ? t("status.migration") : !publicKey ? t("status.notConfigured") : active.length ? t("status.active", { count: active.length }) : t("status.noDevice")}
      </p>

      {/* Cet appareil */}
      <div className="mt-4 rounded-lg border border-line p-4" data-testid="push-device" data-device-state={state ?? "checking"} data-platform={platform}>
        <p className="flex items-center gap-2 text-[15px] font-medium">
          <Smartphone className="size-4" aria-hidden />
          {t("thisDevice")}
        </p>
        {state === null ? (
          <p className="mt-1 text-[14px] text-muted">{t("checking")}</p>
        ) : here ? (
          <p className="mt-1 text-[14px] text-success" data-testid="push-here-on">{t("device.on")}</p>
        ) : (
          <p className="mt-1 text-[14px] text-muted" data-testid="push-device-help">{t(`device.${state}`)}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {configured && state === "ready" && !here && (
            <Button size="sm" onClick={activate} disabled={pending} data-testid="push-activate">
              {t("activate")}
            </Button>
          )}
          {here && (
            <Button size="sm" variant="ghost" onClick={deactivate} disabled={pending} data-testid="push-deactivate">
              {t("deactivate")}
            </Button>
          )}
          {/* Essai : vers MES appareils inscrits uniquement, résultat réel par appareil */}
          {configured && active.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => run(() => sendTestPush(), (d) => setTestResult(d.results.map((r) => t(`result.${r.status}`)).join(" · ")))} disabled={pending} data-testid="push-test">
              {t("test")}
            </Button>
          )}
        </div>
        {testResult && (
          <p role="status" className="mt-2 text-[13px]" data-testid="push-test-result">
            {testResult}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>

      {/* Mes appareils inscrits : dernier résultat réel */}
      {devices.length > 0 && (
        <ul className="mt-4 divide-y divide-line text-[14px]" data-testid="push-devices">
          {devices.map((d) => (
            <li key={d.id} className="py-2" data-testid="push-device-row">
              <span className="block font-medium">{d.label || t("unknownDevice")}</span>
              <span className="block text-[12px] text-muted">
                {d.disabled_at
                  ? t("deviceExpired")
                  : d.last_error && (!d.last_success_at || (d.last_error_at ?? "") > d.last_success_at)
                    ? t("deviceLastError", { date: f.dateTime(new Date(d.last_error_at!), { dateStyle: "medium", timeStyle: "short" }), error: d.last_error })
                    : d.last_success_at
                      ? t("deviceLastOk", { date: f.dateTime(new Date(d.last_success_at), { dateStyle: "medium", timeStyle: "short" }) })
                      : t("deviceNever")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4 text-[14px]" data-testid="push-help">
        <summary className="cursor-pointer font-medium">{t("help.title")}</summary>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
          <li>{t("help.iphone")}</li>
          <li>{t("help.android")}</li>
          <li>{t("help.computer")}</li>
          <li>{t("help.content")}</li>
          <li>{t("help.limits")}</li>
        </ul>
      </details>
    </Card>
  );
}
