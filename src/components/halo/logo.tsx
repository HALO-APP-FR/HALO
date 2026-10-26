import { cn } from "@/lib/utils";

/**
 * Marque HALO — symbole « Rotation » : deux arcs, le départ et l'arrivée,
 * qui forment ensemble le cycle d'une rotation.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 shrink-0", className)} aria-hidden>
      <path d="M9.09 19.99A8.5 8.5 0 0 1 9.09 4.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M14.91 4.01A8.5 8.5 0 0 1 14.91 19.99" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-fg", className)}>
      <LogoMark />
      {!compact && <span className="text-[17px] font-bold tracking-[0.18em]">HALO</span>}
    </span>
  );
}

/** Symbole animé : les arcs se dessinent en tournant à l'apparition (et au survol). */
export function AnimatedLogoMark({ className, label }: { className?: string; label: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("halo-mark-animated shrink-0", className)} role="img" aria-label={label}>
      <g className="halo-spin">
        <path className="halo-arc" d="M9.09 19.99A8.5 8.5 0 0 1 9.09 4.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path className="halo-arc halo-arc-2" d="M14.91 4.01A8.5 8.5 0 0 1 14.91 19.99" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}
