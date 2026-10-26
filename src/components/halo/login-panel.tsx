"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoginForm } from "./login-form";
import { PinPad } from "./pin-pad";
import { cn } from "@/lib/utils";

type Role = "manager" | "agent";

/** Un numéro est plausible s'il contient entre 8 et 15 chiffres (norme internationale E.164). */
export function isPlausiblePhone(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 && /^[+\d\s().-]+$/.test(value.trim());
}

export function LoginPanel({ initialRole = "manager" }: { initialRole?: Role }) {
  const t = useTranslations("auth");
  const [role, setRole] = useState<Role>(initialRole);

  return (
    <div>
      <div role="radiogroup" aria-label={t("roleLabel")} className="mb-6 grid grid-cols-2 rounded-md bg-subtle p-1 dark:bg-surface-hover">
        {(["manager", "agent"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            onClick={() => setRole(r)}
            className={cn(
              "h-10 rounded-[9px] text-[14px] font-semibold text-muted transition-all duration-150",
              role === r && "bg-surface text-fg shadow-card dark:bg-line",
            )}
          >
            {r === "manager" ? t("roleManager") : t("roleAgent")}
          </button>
        ))}
      </div>
      {role === "manager" ? <LoginForm /> : <AgentLogin />}
    </div>
  );
}

function AgentLogin() {
  const t = useTranslations("auth");
  const [step, setStep] = useState<"phone" | "pin">("phone");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (step === "pin") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setStep("phone")}
          className="-ms-2 mb-4 flex h-10 items-center gap-1.5 rounded-md px-2 text-[14px] font-medium text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("back")}
        </button>
        <div className="text-center">
          <h2 className="text-title-2">{t("pinTitle")}</h2>
          <p className="mt-1 text-body text-muted">{t("pinHint")}</p>
        </div>
        <div className="mt-8">
          <PinPad
            key={attempt}
            onComplete={() => {
              // Phase 2 : vérification serveur (code haché, appareil reconnu, blocage après 5 essais).
              toast(t("notConfigured"));
              setAttempt((a) => a + 1);
            }}
          />
        </div>
        <p className="mt-8 text-center text-caption text-muted">{t("pinForgot")}</p>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPlausiblePhone(phone)) {
          setError(t("invalidPhone"));
          return;
        }
        setError(null);
        setStep("pin");
      }}
      className="space-y-3"
    >
      <label htmlFor="phone" className="block text-[13px] font-medium text-muted">
        {t("phone")}
      </label>
      <div className="relative">
        <Phone className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t("phonePlaceholder")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "phone-error" : "phone-hint"}
          className={cn("h-12 ps-10 text-[16px] tabular", error && "border-danger focus:border-danger focus:ring-danger-soft")}
        />
      </div>
      {error ? (
        <p id="phone-error" role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : (
        <p id="phone-hint" className="text-caption text-muted">
          {t("agentFirstTime")}
        </p>
      )}
      <Button type="submit" size="xl" className="mt-2">
        {t("continue")}
        <ArrowRight className="rtl:-scale-x-100" />
      </Button>
    </form>
  );
}
