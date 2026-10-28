import { getTranslations } from "next-intl/server";
import { Database, FlaskConical, ShieldCheck } from "lucide-react";
import { haloEnv, isConnected } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

/** Indique en permanence où l'on se trouve : démo (navigateur), préproduction (données fictives) ou production. */
export async function EnvBadge({ className }: { className?: string }) {
  const t = await getTranslations("connected.env");
  const env = isConnected() ? haloEnv() : "demo";
  const Icon = env === "demo" ? FlaskConical : env === "production" ? ShieldCheck : Database;
  return (
    <span
      data-testid="env-badge"
      data-env={env}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold",
        env === "production" ? "bg-success-soft text-success" : env === "demo" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent-text",
        className,
      )}
      title={t(`${env}Hint`)}
    >
      <Icon className="size-3.5" strokeWidth={2.2} />
      {t(env)}
    </span>
  );
}
