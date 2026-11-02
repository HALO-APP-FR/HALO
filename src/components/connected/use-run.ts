"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

/** Lance une action serveur et affiche son VRAI résultat : erreur lisible, jamais de succès simulé. */
export function useRun() {
  const te = useTranslations("connected.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Une action réussie ailleurs sur la page rend les erreurs précédentes obsolètes : elles disparaissent
  const id = useId();
  useEffect(() => {
    const clear = () => setError(null);
    window.addEventListener("halo:action-ok", clear);
    return () => window.removeEventListener("halo:action-ok", clear);
  }, []);
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
        // L'identifiant d'origine permet aux autres blocs de la page d'effacer leurs messages devenus obsolètes
        window.dispatchEvent(new CustomEvent("halo:action-ok", { detail: id }));
        router.refresh();
      } catch {
        setError(te("network"));
      }
    });
  };
  return { pending, error, setError, run, id };
}
