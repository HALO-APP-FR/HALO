"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { markStayMessagesRead } from "@/lib/connected/actions";

/**
 * Conversation ouverte : les messages AFFICHÉS sont marqués lus (pas ceux arrivés depuis).
 * Après confirmation du serveur, la page, le séjour et le compteur de l'accueil sont rafraîchis.
 */
export function MarkStayRead({ reservationId, ids }: { reservationId: string; ids: number[] }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markStayMessagesRead(reservationId, ids).then((r) => {
      if (r.ok) router.refresh();
    });
  }, [reservationId, ids, router]);
  return null;
}
