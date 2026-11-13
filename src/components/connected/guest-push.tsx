"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BellRing } from "lucide-react";
import { guestPushState, guestPushSubscribe, guestPushUnsubscribe } from "@/lib/connected/guest-actions";
import { isIos, pushDeviceState, type PushDeviceState } from "@/lib/engine/push-support";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const b64ToUint8 = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

type View = PushDeviceState | "checking" | "on" | "unavailable";

/**
 * Notifications du voyageur sur CET appareil, liées au séjour (pas de compte). Quatre états affichés tels quels :
 * disponible (bouton), activées, refusées (réglages de l'appareil), impossibles (appareil, iPhone hors écran d'accueil,
 * service non configuré). La portée du service worker est la page du séjour : un toucher sur la notification la rouvre.
 */
export function GuestPush({ token, publicKey, available }: { token: string; publicKey: string | null; available: boolean }) {
  const t = useTranslations("guestSpace.push");
  const [view, setView] = useState<View>("checking");
  const [ios, setIos] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = Boolean(publicKey) && available;
  const scope = typeof window === "undefined" ? "" : window.location.pathname;

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const info = {
      ua: nav.userAgent,
      touchMac: /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1,
      standalone: window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
      hasServiceWorker: "serviceWorker" in nav,
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : null,
    };
    const base = pushDeviceState(info);
    void (async () => {
      setIos(isIos(info));
      if (base !== "ready" || !info.hasServiceWorker) return setView(base);
      const reg = await navigator.serviceWorker.getRegistration(window.location.pathname);
      const sub = await reg?.pushManager.getSubscription();
      // Inscription confirmée par la base pour CE séjour (pas seulement présente dans le navigateur)
      const on = sub ? await guestPushState(token, sub.endpoint) : false;
      setView(on ? "on" : "ready");
    })();
  }, [token]);

  const activate = async () => {
    setPending(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setView(perm === "denied" ? "denied" : "ready");
        return;
      }
      let sub: PushSubscription;
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope });
        await navigator.serviceWorker.ready;
        sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey!) }));
      } catch {
        setError(t("failed"));
        return;
      }
      const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      const r = await guestPushSubscribe(token, { endpoint: j.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" });
      if (r.ok) setView("on");
      else {
        await sub.unsubscribe();
        setError(r.error === "unavailable" ? t("linkUnavailable") : t("failed"));
      }
    } finally {
      setPending(false);
    }
  };

  const deactivate = async () => {
    setPending(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(scope);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const r = await guestPushUnsubscribe(token, sub.endpoint);
        await sub.unsubscribe();
        if (!r.ok && r.error !== "unavailable") return setError(t("failed"));
      }
      setView("ready");
    } finally {
      setPending(false);
    }
  };

  const state = !configured ? "not_configured" : view;
  const tone = state === "on" ? "bg-success-soft text-success" : state === "ready" || state === "checking" ? "bg-subtle text-muted dark:bg-surface-hover" : "bg-warning-soft text-warning";
  return (
    <Card className="p-5" data-testid="guest-push" data-state={state}>
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
        </div>
      </div>
      <p className={cn("mt-4 rounded-md px-3 py-2 text-[14px]", tone)} data-testid="guest-push-status">
        {t(`state.${state}`)}
      </p>
      {configured && state === "ios_install" && (
        <ol className="mt-3 list-decimal space-y-1 ps-5 text-[14px] text-muted" data-testid="guest-push-ios">
          <li>{t("ios.share")}</li>
          <li>{t("ios.add")}</li>
          <li>{t("ios.open")}</li>
        </ol>
      )}
      {configured && (state === "ready" || state === "on") && (
        <div className="mt-3">
          {state === "ready" ? (
            <Button size="sm" onClick={activate} disabled={pending} data-testid="guest-push-activate">
              {t("activate")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={deactivate} disabled={pending} data-testid="guest-push-deactivate">
              {t("deactivate")}
            </Button>
          )}
        </div>
      )}
      {ios && state === "on" && <p className="mt-2 text-[12px] text-muted">{t("ios.keep")}</p>}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
