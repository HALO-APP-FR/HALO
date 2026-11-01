import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { LogoMark } from "@/components/halo/logo";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { Card } from "@/components/ui/card";
import { ReviewForm } from "@/components/connected/review-forms";
import { QUESTIONS } from "@/lib/engine/satisfaction";
import { supabaseAnon } from "@/lib/supabase/server";
import { isConnected } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "HALO", robots: { index: false, follow: false }, referrer: "no-referrer" };

interface Portal {
  status: "ok";
  kind: "guest" | "owner";
  organization: string;
  stay: { property: string; check_in_at: string; check_out_at: string; timezone: string } | null;
  owner: { name: string; properties: number } | null;
  link_valid_until: string;
  review: { overall: number; service_overall: number | null; ratings: Record<string, number>; comment: string | null; would_return: boolean | null; author_label: string | null; consent_publish: boolean; submitted_at: string; updated_at: string; editable: boolean } | null;
}

/** Avis par lien personnel (voyageur après son séjour, ou propriétaire). Rien n'est publié sans son accord. */
export default async function ReviewPortal({ params }: PageProps<"/[locale]/avis/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("reviewPortal");
  const f = await getFormatter();
  let data: Portal | { status: string } | null = null;
  let failed = false;
  if (isConnected() && /^[0-9a-f]{64}$/.test(token)) {
    const { data: d, error } = await supabaseAnon().rpc("review_portal", { token });
    if (error) failed = true;
    else data = d as Portal;
  }
  if (!data || data.status !== "ok") {
    return (
      <div className="grid min-h-dvh place-items-center bg-subtle px-4">
        <Card className="max-w-md p-6 text-center" data-testid="review-unavailable">
          <LogoMark className="mx-auto size-12 text-fg" />
          <h1 className="mt-5 text-title-2">{failed ? t("error.title") : t("unavailable.title")}</h1>
          <p className="mt-2 text-[15px] text-muted">{failed ? t("error.text") : t("unavailable.text")}</p>
        </Card>
      </div>
    );
  }
  const p = data as Portal;
  const tz = p.stay?.timezone ?? "Europe/Paris";
  const d = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeZone: tz });
  return (
    <div className="min-h-dvh bg-subtle">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <LogoMark className="size-8 text-fg" />
          <span className="flex-1 text-[15px] font-semibold">{p.organization}</span>
          <LocaleSwitcher variant="icon" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6" data-testid="review-portal" data-kind={p.kind}>
        <div>
          <h1 className="text-title-1">{t(`title.${p.kind}`)}</h1>
          <p className="mt-2 text-[15px] text-muted">
            {p.kind === "guest" && p.stay ? t("stayLine", { property: p.stay.property, from: d(p.stay.check_in_at), to: d(p.stay.check_out_at) }) : p.owner ? t("ownerLine", { name: p.owner.name, count: p.owner.properties }) : ""}
          </p>
        </div>
        {p.review && (
          <p className="rounded-xl border border-line bg-canvas p-4 text-[14px]" role="status" data-testid="review-existing">
            {t(`existing.${p.kind}`, { date: d(p.review.updated_at) })} {p.review.editable ? t("editableNote") : ""}
          </p>
        )}
        <Card className="p-5">
          <ReviewForm token={token} kind={p.kind} questions={QUESTIONS[p.kind]} initial={p.review} editable={p.review ? p.review.editable : true} />
        </Card>
        <p className="text-[12px] text-faint">{t(`privacy.${p.kind}`)}</p>
      </main>
    </div>
  );
}
