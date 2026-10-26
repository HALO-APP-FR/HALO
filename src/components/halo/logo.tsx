import { cn } from "@/lib/utils";

/** Marque HALO : un anneau (le « halo ») et le nom. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-fg", className)}>
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.25" />
        <circle cx="12" cy="12" r="3.25" fill="var(--accent)" />
      </svg>
      {!compact && <span className="text-[17px] font-bold tracking-[0.18em]">HALO</span>}
    </span>
  );
}
