"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const DATE_TYPES = new Set(["date", "datetime-local", "time", "month", "week"]);

/**
 * Champ de saisie. Pour les champs de date et d'heure contrôlés, la valeur AFFICHÉE fait foi :
 * si elle change sans que React le voie (valeur posée par un outil, un gestionnaire de mots de passe,
 * un sélecteur natif sur certains navigateurs), l'état du formulaire est resynchronisé sur la saisie
 * réelle, à l'entrée, à la validation et à la sortie du champ. Sans cela, le formulaire enverrait
 * l'ancienne date (cause de l'anomalie du 4/11 : « 05/11 » affiché, 4/11 enregistré).
 */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = React.useRef<HTMLInputElement>(null);
  const onChange = props.onChange;
  const value = props.value;
  const watch = DATE_TYPES.has(String(props.type ?? "")) && typeof onChange === "function" && value !== undefined;
  const latest = React.useRef({ onChange, value });
  React.useEffect(() => {
    latest.current = { onChange, value };
  });
  React.useEffect(() => {
    const el = ref.current;
    if (!watch || !el) return;
    const sync = () => {
      const { onChange: cb, value: v } = latest.current;
      if (cb && el.value !== String(v ?? "")) cb({ target: el, currentTarget: el } as unknown as React.ChangeEvent<HTMLInputElement>);
    };
    for (const ev of ["input", "change", "blur"]) el.addEventListener(ev, sync);
    // Un formulaire soumis prend la valeur affichée, même si aucun événement n'a été émis
    const form = el.form;
    form?.addEventListener("submit", sync, true);
    return () => {
      for (const ev of ["input", "change", "blur"]) el.removeEventListener(ev, sync);
      form?.removeEventListener("submit", sync, true);
    };
  }, [watch]);
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-line bg-surface px-3 text-[15px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
}
