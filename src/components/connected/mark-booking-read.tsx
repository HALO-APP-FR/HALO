"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { markBookingRead } from "@/lib/connected/booking-actions";

/** Demande ouverte par un responsable : marquée lue après confirmation du serveur. */
export function MarkBookingRead({ id }: { id: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markBookingRead(id).then((r) => r.ok && router.refresh());
  }, [id, router]);
  return null;
}
