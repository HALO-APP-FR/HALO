"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

/** Sélecteur segmenté Clair / Sombre / Système. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const t = useTranslations("theme");
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const options = [
    { value: "light", label: t("light"), icon: Sun },
    { value: "dark", label: t("dark"), icon: Moon },
    { value: "system", label: t("system"), icon: Monitor },
  ] as const;

  return (
    <div role="radiogroup" aria-label={t("label")} className={cn("inline-flex rounded-md bg-subtle p-0.5 dark:bg-surface-hover", className)}>
      {options.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium text-muted transition-all duration-150",
              active && "bg-surface text-fg shadow-card dark:bg-line",
            )}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
