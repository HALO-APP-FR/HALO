/**
 * Ce que permet CET appareil pour les notifications push — affiché tel quel, sans promesse.
 *  - iPhone / iPad : iOS ou iPadOS 16.4 minimum, et seulement depuis HALO installé sur l'écran d'accueil (Safari → Partager →
 *    « Sur l'écran d'accueil ») ; jamais dans Safari ni dans une autre application de navigation ;
 *  - Android : Chrome, Edge, Firefox, Samsung Internet — dans le navigateur ou installé ;
 *  - ordinateur : Chrome, Edge, Firefox, Safari 16+ (macOS 13+).
 */
export type PushDeviceState =
  /** Inscription possible maintenant */
  | "ready"
  /** iPhone/iPad : installer HALO sur l'écran d'accueil d'abord */
  | "ios_install"
  /** iPhone/iPad trop ancien (avant 16.4) */
  | "ios_too_old"
  /** Notifications refusées pour HALO dans les réglages de l'appareil ou du navigateur */
  | "denied"
  /** Navigateur sans notifications push */
  | "unsupported";

export interface DeviceInfo {
  ua: string;
  /** Mode application installée (display-mode: standalone, ou navigator.standalone sur iOS) */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied" | null;
  /** iPadOS se présente comme un Mac : écran tactile = iPad */
  touchMac?: boolean;
}

export function iosVersion(ua: string): number | null {
  const m = /(?:iPhone|iPad|iPod).*? OS (\d+)_(\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+).*Mobile.*Safari/.exec(ua);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}

export const isIos = (d: Pick<DeviceInfo, "ua" | "touchMac">) => /iPhone|iPad|iPod/.test(d.ua) || Boolean(d.touchMac);
export const isAndroid = (ua: string) => /Android/.test(ua);

export function pushDeviceState(d: DeviceInfo): PushDeviceState {
  if (isIos(d)) {
    const v = iosVersion(d.ua);
    if (v != null && v < 16.04) return "ios_too_old";
    if (!d.standalone) return "ios_install";
  }
  if (!d.hasServiceWorker || !d.hasPushManager || !d.hasNotification) return "unsupported";
  if (d.permission === "denied") return "denied";
  return "ready";
}

/** Nom lisible de l'appareil pour la liste « Mes appareils » (aucune empreinte, aucun identifiant) */
export function deviceLabel(ua: string, touchMac = false): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || touchMac ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}
