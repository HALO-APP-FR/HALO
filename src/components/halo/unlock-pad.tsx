"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PinPad } from "./pin-pad";

export function UnlockPad() {
  const t = useTranslations("auth");
  const [attempt, setAttempt] = useState(0);
  return (
    <PinPad
      key={attempt}
      onComplete={() => {
        // Phase 2 : vérification serveur du code pour cet appareil.
        toast(t("notConfigured"));
        setAttempt((a) => a + 1);
      }}
    />
  );
}
