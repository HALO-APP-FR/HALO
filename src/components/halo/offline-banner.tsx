"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { CloudOff } from "lucide-react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function OfflineBanner() {
  const t = useTranslations("offline");
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-fg px-4 py-2 text-caption text-canvas">
      <CloudOff className="size-4" />
      {t("banner")}
    </div>
  );
}
