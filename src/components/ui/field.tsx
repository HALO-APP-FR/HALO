import * as React from "react";
import { cn } from "@/lib/utils";

/** Champ de formulaire : libellé + contrôle + aide ou erreur. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-[15px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

/** Liste déroulante native : parfaite au doigt sur téléphone, accessible par défaut. */
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-line bg-surface pe-9 ps-3 text-[15px] text-fg transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
