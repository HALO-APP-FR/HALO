import { cn } from "@/lib/utils";

/** Initiales (2 lettres max) ; « ? » sans nom. Aucune photo : HALO ne stocke pas de portrait des membres. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toLocaleUpperCase();
}

const TONES = ["bg-[#E8EEF9] text-[#1E3A8A]", "bg-[#EAF4EC] text-[#14532D]", "bg-[#F6EEE6] text-[#7C2D12]", "bg-[#F1ECF7] text-[#4C1D95]", "bg-[#E9F3F5] text-[#134E4A]"];

/** Pastille d'initiales, teinte stable par personne (lisibilité de la liste, pas d'information portée par la couleur). */
export function Avatar({ name, id, size = "md", className }: { name: string; id: string; size?: "sm" | "md" | "lg"; className?: string }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold dark:bg-surface-hover dark:text-fg",
        TONES[h % TONES.length],
        size === "sm" ? "size-8 text-[12px]" : size === "lg" ? "size-14 text-[19px]" : "size-10 text-[14px]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
