"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

/** Lance une action serveur et affiche son VRAI résultat : erreur lisible, jamais de succès simulé. */
export function useRun() {
  const te = useTranslations("connected.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<R<T>>, onOk?: (data: T) => void) => {
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          const code = res.error.startsWith("conflict") ? "conflict" : res.error;
          setError(te.has(code) ? te(code) : te("server"));
          return;
        }
        onOk?.(res.data);
        router.refresh();
      } catch {
        setError(te("network"));
      }
    });
  };
  return { pending, error, setError, run };
}
