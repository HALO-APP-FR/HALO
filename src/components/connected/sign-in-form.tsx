"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Mail } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { sendSignInEmail, verifySignInCode } from "@/lib/connected/auth-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Connexion par e-mail : lien ET code à 6 chiffres (le lien peut s'ouvrir dans un autre navigateur). */
export function SignInForm({ initialError, next }: { initialError?: "link"; next?: string }) {
  const t = useTranslations("connected.signIn");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(initialError ? t("errors.link") : null);
  const [pending, start] = useTransition();

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await sendSignInEmail(email, locale, next);
      if (!res.ok) return setError(t(`errors.${res.error}`));
      setError(null);
      setStep("code");
    });
  };
  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await verifySignInCode(email, code);
      if (!res.ok) return setError(t(`errors.${res.error}`));
      router.replace(next && /^\/(app|invite)(\/[\w-]*)*$/.test(next) ? next : "/app");
      router.refresh();
    });
  };

  if (step === "code") {
    return (
      <form onSubmit={verify} className="space-y-4" noValidate>
        <p className="text-[15px]">{t("codeSent", { email })}</p>
        <Field label={t("code")} htmlFor="code" error={error ?? undefined}>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-12 text-center text-[22px] tracking-[0.4em] tabular"
            autoFocus
          />
        </Field>
        <Button type="submit" size="xl" disabled={pending || code.length !== 6}>
          {t("verify")}
          <ArrowRight className="rtl:-scale-x-100" />
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("email")}>
          {t("changeEmail")}
        </Button>
      </form>
    );
  }
  return (
    <form onSubmit={send} className="space-y-4" noValidate>
      <Field label={t("email")} htmlFor="email" error={error ?? undefined} hint={t("emailHint")}>
        <div className="relative">
          <Mail className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
          <Input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 ps-10 text-[16px]" />
        </div>
      </Field>
      <Button type="submit" size="xl" disabled={pending}>
        {t("send")}
        <ArrowRight className="rtl:-scale-x-100" />
      </Button>
    </form>
  );
}
