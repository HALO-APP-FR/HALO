"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

export const PIN_LENGTH = 6;

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supporté */
  }
}

/**
 * Clavier de code PIN pensé pour le terrain : grosses touches (72 px), utilisable
 * d'une main ou avec des gants, sans ouvrir le clavier du téléphone.
 * Le clavier physique fonctionne aussi (chiffres + retour arrière).
 */
export function PinPad({
  onComplete,
  disabled = false,
  errorKey = 0,
}: {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  /** Incrémenté par le parent pour signaler un code refusé (vibration + secousse + remise à zéro). */
  errorKey?: number;
}) {
  const t = useTranslations("auth");
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  // Code refusé : on secoue et on vide (déclenché par le parent).
  const [lastError, setLastError] = useState(errorKey);
  if (errorKey !== lastError) {
    setLastError(errorKey);
    setPin("");
    setShake(true);
  }

  const press = useCallback(
    (digit: string) => {
      if (disabled || pin.length >= PIN_LENGTH) return;
      vibrate(8);
      const next = pin + digit;
      setPin(next);
      if (next.length === PIN_LENGTH) {
        // Laisse le dernier point s'afficher avant de valider
        setTimeout(() => onComplete(next), 120);
      }
    },
    [disabled, pin, onComplete],
  );

  const erase = useCallback(() => {
    if (disabled) return;
    vibrate(5);
    setPin((current) => current.slice(0, -1));
  }, [disabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") erase();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, erase]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="flex flex-col items-center">
      <div
        className={cn("flex gap-3.5", shake && "halo-shake")}
        onAnimationEnd={() => setShake(false)}
        role="status"
        aria-live="polite"
        aria-label={t("pinProgress", { count: pin.length })}
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-3.5 rounded-full border-2 transition-all duration-150",
              i < pin.length ? "scale-110 border-fg bg-fg" : "border-line-strong",
            )}
            aria-hidden
          />
        ))}
      </div>

      <div className="mt-10 grid grid-cols-3 gap-x-6 gap-y-4">
        {keys.map((k) => (
          <PinKey key={k} label={t("pinDigit", { digit: k })} onPress={() => press(k)} disabled={disabled}>
            {k}
          </PinKey>
        ))}
        <span aria-hidden />
        <PinKey label={t("pinDigit", { digit: "0" })} onPress={() => press("0")} disabled={disabled}>
          0
        </PinKey>
        <button
          type="button"
          onClick={erase}
          disabled={disabled || pin.length === 0}
          aria-label={t("pinDelete")}
          className="grid size-[72px] place-items-center rounded-full text-muted transition-opacity active:bg-subtle disabled:opacity-30 dark:active:bg-surface-hover"
        >
          <Delete className="size-7 rtl:-scale-x-100" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}

function PinKey({
  children,
  onPress,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className="grid size-[72px] select-none place-items-center rounded-full bg-surface text-[30px] font-medium tabular shadow-card ring-1 ring-line transition-transform duration-100 active:scale-95 active:bg-subtle disabled:opacity-40 dark:active:bg-surface-hover"
    >
      {children}
    </button>
  );
}
