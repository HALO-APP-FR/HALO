"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";
import { savePhoto, usePhotoUrl } from "@/lib/store/photos";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PhotoThumb({ id, onRemove, size = "md", label }: { id: string; onRemove?: () => void; size?: "sm" | "md" | "lg"; label?: string }) {
  const t = useTranslations("photos");
  const url = usePhotoUrl(id);
  const dims = { sm: "size-12", md: "size-16", lg: "size-24" }[size];
  return (
    <span className={cn("relative inline-block shrink-0 overflow-hidden rounded-md border border-line bg-subtle", dims)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- photo locale (blob), pas d'optimisation serveur possible
        <img src={url} alt={label ?? t("photo")} className="size-full object-cover" />
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute end-0.5 top-0.5 grid size-6 place-items-center rounded-full bg-black/60 text-white"
          aria-label={t("remove")}
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/** Bouton « ajouter une photo » : appareil photo du téléphone ou galerie. */
export function AddPhotoButton({
  onAdded,
  label,
  className,
  compact = false,
}: {
  onAdded: (id: string) => void;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("photos");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50",
          compact ? "size-9" : "h-16 min-w-16 px-3",
          className,
        )}
        aria-label={label ?? t("add")}
        title={label ?? t("add")}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {!compact && <span>{label ?? t("add")}</span>}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          try {
            for (const f of files) onAdded(await savePhoto(f));
          } catch {
            toast(t("error"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
