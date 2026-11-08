import { describe, expect, it } from "vitest";
import { deviceLabel, pushDeviceState, type DeviceInfo } from "@/lib/engine/push-support";

const IPHONE_17 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_16_3 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const full: Omit<DeviceInfo, "ua"> = { standalone: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default" };

describe("notifications push : ce que permet l'appareil", () => {
  it("iPhone dans Safari : installer HALO sur l'écran d'accueil d'abord", () => {
    expect(pushDeviceState({ ...full, ua: IPHONE_17, hasPushManager: false })).toBe("ios_install");
  });
  it("iPhone installé (iOS 16.4+) : possible", () => {
    expect(pushDeviceState({ ...full, ua: IPHONE_17, standalone: true })).toBe("ready");
  });
  it("iPhone avant iOS 16.4 : impossible, dit clairement", () => {
    expect(pushDeviceState({ ...full, ua: IPHONE_16_3, standalone: true })).toBe("ios_too_old");
  });
  it("Android dans Chrome : possible sans installation", () => {
    expect(pushDeviceState({ ...full, ua: ANDROID })).toBe("ready");
  });
  it("notifications refusées : expliqué, pas de bouton trompeur", () => {
    expect(pushDeviceState({ ...full, ua: ANDROID, permission: "denied" })).toBe("denied");
  });
  it("navigateur sans push", () => {
    expect(pushDeviceState({ ...full, ua: ANDROID, hasPushManager: false })).toBe("unsupported");
  });
  it("nom d'appareil lisible", () => {
    expect(deviceLabel(IPHONE_17)).toBe("iPhone · Safari");
    expect(deviceLabel(ANDROID)).toBe("Android · Chrome");
  });
});
