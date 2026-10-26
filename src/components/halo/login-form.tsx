"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Logo Google officiel (les couleurs de marque Google sont imposées par leurs règles). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
  );
}

export function LoginForm() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError(t("invalidEmail"));
      return;
    }
    setError(null);
    // Phase 2 : appel à Supabase Auth (lien magique). En attendant, on le dit clairement.
    toast(t("notConfigured"));
  };

  return (
    <div className="w-full">
      <form onSubmit={submit} noValidate className="space-y-3">
        <label htmlFor="email" className="block text-[13px] font-medium text-muted">
          {t("email")}
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "email-error" : "email-hint"}
            className={cn("h-12 ps-10 text-[16px]", error && "border-danger focus:border-danger focus:ring-danger-soft")}
          />
        </div>
        {error ? (
          <p id="email-error" role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : (
          <p id="email-hint" className="text-caption text-muted">
            {t("magicHint")}
          </p>
        )}
        <Button type="submit" size="xl" className="mt-2">
          {t("submit")}
          <ArrowRight className="rtl:-scale-x-100" />
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-caption text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        {t("or")}
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button type="button" variant="outline" size="xl" className="font-medium" onClick={() => toast(t("notConfigured"))}>
        <GoogleIcon />
        {t("google")}
      </Button>
    </div>
  );
}
