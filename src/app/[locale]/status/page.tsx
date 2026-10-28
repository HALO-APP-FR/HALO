import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EnvBadge } from "@/components/connected/env-badge";
import { backendHealth } from "@/lib/connected/health";
import { isConnected } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** État vérifié du backend : uniquement des états (OK / échec / non configuré), jamais de valeur. */
export default async function StatusPage({ params }: PageProps<"/[locale]/status">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("status");
  const f = await getFormatter();
  const h = await backendHealth();
  return (
    <main className="mx-auto max-w-lg px-4 py-10" data-testid="status-page" data-ready={h.ready ? "yes" : "no"}>
      <EnvBadge />
      <h1 className="mt-4 text-title-1">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-muted">{isConnected() ? (h.ready ? t("ready") : t("notReady")) : t("demoOnly")}</p>
      {h.configured && (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
          {h.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 px-4 py-3" data-check={c.key} data-state={c.state}>
              {c.state === "ok" ? <CheckCircle2 className="mt-0.5 size-5 text-success" /> : c.state === "missing" ? <CircleDashed className="mt-0.5 size-5 text-warning" /> : <XCircle className="mt-0.5 size-5 text-danger" />}
              <span className="text-[15px]">
                <span className="block font-medium">{t(`check.${c.key}`)}</span>
                <span className="block text-[13px] text-muted">{t(`state.${c.state}`)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] text-faint">{t("checkedAt", { at: f.dateTime(new Date(h.at), { dateStyle: "short", timeStyle: "medium" }) })}</p>
      <Link href="/" className="mt-6 inline-block text-[14px] text-accent-text hover:underline">
        {t("back")}
      </Link>
    </main>
  );
}
