import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Star } from "lucide-react";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { Card } from "@/components/ui/card";
import { supabaseAnon } from "@/lib/supabase/server";
import { isConnected } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "HALO", referrer: "no-referrer" };

interface ScoreJ { count: number; average: number | null; from: string; to: string }
interface Showcase {
  status: "ok";
  organization: string;
  title: string;
  intro: string | null;
  services: string | null;
  contact: string | null;
  period_months: number;
  published_at: string;
  guest: ScoreJ | null;
  /** Service de la conciergerie (voyageurs ayant répondu à cette question) */
  service?: ScoreJ | null;
  owner: ScoreJ | null;
  testimonials: { kind: "guest" | "owner"; overall: number; comment: string; author: string; month: string }[];
}

/** Vitrine publique : publiée explicitement par l'organisation ; scores sur tous les avis vérifiés de la période. */
export default async function ShowcasePage({ params }: PageProps<"/[locale]/v/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("showcasePage");
  const f = await getFormatter();
  let s: Showcase | null = null;
  if (isConnected() && /^[a-z0-9-]{3,50}$/.test(slug)) {
    const { data } = await supabaseAnon().rpc("get_showcase", { s_slug: slug });
    if ((data as { status?: string } | null)?.status === "ok") s = data as Showcase;
  }
  if (!s) {
    return (
      <div className="grid min-h-dvh place-items-center bg-subtle px-4">
        <Card className="max-w-md p-6 text-center" data-testid="showcase-unavailable">
          <LogoMark className="mx-auto size-12 text-fg" />
          <h1 className="mt-5 text-title-2">{t("unavailable")}</h1>
        </Card>
      </div>
    );
  }
  const day = (x: string) => f.dateTime(new Date(`${x}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const month = (x: string) => f.dateTime(new Date(`${x}-15T12:00:00Z`), { month: "long", year: "numeric", timeZone: "UTC" });
  const scoreCard = ({ kind, sc }: { kind: "guest" | "service" | "owner"; sc: ScoreJ }) => (
    <Card className="p-5" data-testid={`showcase-score-${kind}`}>
      <p className="text-[13px] font-medium text-muted">{t(`score.${kind}`)}</p>
      {sc.count > 0 && sc.average != null ? (
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-title-1">{f.number(sc.average, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</span>
          <span className="text-[15px] text-muted">/ 5</span>
        </p>
      ) : (
        <p className="mt-1 text-[15px] text-muted">{t("noScore")}</p>
      )}
      <p className="mt-1 text-[13px] text-muted">{t("basedOn", { count: sc.count, from: day(sc.from), to: day(sc.to) })}</p>
    </Card>
  );
  return (
    <div className="min-h-dvh bg-subtle">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <LogoMark className="size-8 text-fg" />
          <span className="flex-1 text-[15px] font-semibold">{s.organization}</span>
          <LocaleSwitcher variant="icon" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8" data-testid="showcase">
        <div>
          <h1 className="text-title-1">{s.title}</h1>
          {s.intro && <p className="mt-3 whitespace-pre-wrap text-[16px]">{s.intro}</p>}
        </div>
        {(s.guest || s.owner) && (
          <div className="grid gap-3 sm:grid-cols-3">
            {s.guest && scoreCard({ kind: "guest", sc: s.guest })}
            {s.service && scoreCard({ kind: "service", sc: s.service })}
            {s.owner && scoreCard({ kind: "owner", sc: s.owner })}
          </div>
        )}
        <p className="text-[13px] text-muted" data-testid="showcase-method">{t("method")}</p>
        {s.services && (
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("services")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-[15px]">{s.services}</p>
          </Card>
        )}
        {s.testimonials.length > 0 && (
          <section>
            <h2 className="text-[17px] font-semibold">{t("testimonials")}</h2>
            <p className="mt-1 text-[13px] text-muted" data-testid="showcase-selection">{t("selection")}</p>
            <ul className="mt-3 space-y-3">
              {s.testimonials.map((x, i) => (
                <li key={i}>
                  <Card className="p-5" data-testid="showcase-testimonial-card">
                    <p className="flex items-center gap-1 text-[14px]">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={n <= x.overall ? "size-4 fill-accent text-accent" : "size-4 text-faint"} aria-hidden />
                      ))}
                      <span className="sr-only">{x.overall}/5</span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-[15px]">« {x.comment} »</p>
                    <p className="mt-2 text-[13px] text-muted">
                      {x.author === "guest" || x.author === "owner" ? t(`anon.${x.author}`) : x.author} · {t(`kind.${x.kind}`)} · {month(x.month)}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
        {s.contact && (
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">{t("contact")}</h2>
            <p className="mt-2 whitespace-pre-wrap text-[15px]">{s.contact}</p>
          </Card>
        )}
        <p className="text-[12px] text-faint">{t("withdraw")}</p>
      </main>
    </div>
  );
}
