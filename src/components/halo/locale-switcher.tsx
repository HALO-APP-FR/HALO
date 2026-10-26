"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, type Locale } from "@/i18n/routing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/** Nom de chaque langue écrit dans cette langue (un Allemand cherche « Deutsch »). */
export function nativeName(locale: string) {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export function LocaleSwitcher({ variant = "button" }: { variant?: "button" | "row" | "icon" }) {
  const locale = useLocale();
  const t = useTranslations("language");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const change = (next: string) =>
    startTransition(() => router.replace(pathname, { locale: next as Locale }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "row" ? (
          <button className="flex h-12 w-full items-center justify-between rounded-md px-1 text-[17px]" disabled={pending}>
            <span className="flex items-center gap-3">
              <Globe className="size-5 text-muted" />
              {t("label")}
            </span>
            <span className="text-muted">{nativeName(locale)}</span>
          </button>
        ) : variant === "icon" ? (
          <Button variant="ghost" size="icon" disabled={pending} className="text-muted" aria-label={`${t("label")} : ${nativeName(locale)}`}>
            <Globe />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={pending} className="text-muted">
            <Globe />
            {nativeName(locale)}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={change}>
          {locales.map((l) => (
            <DropdownMenuRadioItem key={l} value={l}>
              {nativeName(l)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
