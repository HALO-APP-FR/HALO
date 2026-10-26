"use client";

import { useHaloReady } from "@/lib/store/halo-store";
import { Skeleton } from "@/components/ui/skeleton";

/** Affiche un squelette tant que les données ne sont pas chargées. */
export function ReadyGate({ children, rows = 4 }: { children: React.ReactNode; rows?: number }) {
  const ready = useHaloReady();
  if (ready) return <>{children}</>;
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-5 w-32" />
      <div className="space-y-2 pt-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
