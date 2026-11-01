import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { ShowcaseEditor } from "@/components/connected/review-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { period, summarize, type ReviewRow } from "@/lib/engine/satisfaction";
import { SatisfactionNav } from "../sub-nav";

/** Vitrine : réglages, aperçu fidèle (mêmes règles que la page publique), publication explicite. */
export default async function ShowcaseAdmin({ params }: PageProps<"/[locale]/app/satisfaction/showcase">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.reviews.showcase");
  const tp = await getTranslations("showcasePage");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const [{ data: sc }, { data: chosen }, { data: cands }, { data: all }] = await Promise.all([
    supabase.from("showcases").select("*").eq("organization_id", o).maybeSingle(),
    supabase.from("showcase_testimonials").select("review_id, position").eq("organization_id", o).order("position"),
    supabase.from("reviews").select("id, kind, overall, comment, author_label").eq("organization_id", o).eq("source", "halo").eq("consent_publish", true).is("consent_withdrawn_at", null).not("comment", "is", null).order("review_date", { ascending: false }).limit(100),
    supabase.from("reviews").select("kind, source, verified, overall, ratings, would_return, review_date").eq("organization_id", o).limit(2000),
  ]);
  const months = (sc?.period_months as number) ?? 12;
  const p = period(months);
  const rows = (all ?? []) as unknown as ReviewRow[];
  const g = summarize(rows, "guest", p).verified;
  const ow = summarize(rows, "owner", p).verified;
  const day = (x: string) => f.dateTime(new Date(`${x}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const selected = (chosen ?? []).map((c) => (cands ?? []).find((r) => r.id === c.review_id)).filter(Boolean) as { id: string; kind: string; overall: number; comment: string; author_label: string | null }[];
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SatisfactionNav current="showcase" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <ShowcaseEditor
            initial={{
              slug: (sc?.slug as string) ?? "",
              title: (sc?.title as string) ?? org!.name,
              intro: (sc?.intro as string) ?? "",
              services: (sc?.services as string) ?? "",
              contact: (sc?.contact as string) ?? "",
              months,
              guest: (sc?.show_guest_score as boolean) ?? true,
              owner: (sc?.show_owner_score as boolean) ?? true,
              testimonials: (chosen ?? []).map((c) => c.review_id as string),
              publishedAt: (sc?.published_at as string) ?? null,
            }}
            candidates={(cands ?? []).map((c) => ({ id: c.id, kind: c.kind, overall: c.overall, comment: c.comment as string, author: c.author_label }))}
          />
        </Card>
        <Card className="p-5" data-testid="showcase-preview">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">{t("preview")}</p>
          <h2 className="mt-2 text-title-2">{(sc?.title as string) ?? org!.name}</h2>
          {sc?.intro && <p className="mt-2 whitespace-pre-wrap text-[14px]">{sc.intro as string}</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(sc?.show_guest_score ?? true) && (
              <div className="rounded-md border border-line p-3 text-[14px]">
                <p className="text-muted">{tp("score.guest")}</p>
                <p className="text-[20px] font-semibold">{g.count ? `${g.average}/5` : tp("noScore")}</p>
                <p className="text-[12px] text-muted">{tp("basedOn", { count: g.count, from: day(p.from), to: day(p.to) })}</p>
              </div>
            )}
            {(sc?.show_owner_score ?? true) && (
              <div className="rounded-md border border-line p-3 text-[14px]">
                <p className="text-muted">{tp("score.owner")}</p>
                <p className="text-[20px] font-semibold">{ow.count ? `${ow.average}/5` : tp("noScore")}</p>
                <p className="text-[12px] text-muted">{tp("basedOn", { count: ow.count, from: day(p.from), to: day(p.to) })}</p>
              </div>
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted">{tp("method")}</p>
          {selected.length > 0 && (
            <>
              <p className="mt-3 text-[12px] text-muted">{tp("selection")}</p>
              <ul className="mt-2 space-y-2">
                {selected.map((r) => (
                  <li key={r.id} className="rounded-md border border-line p-3 text-[14px]">
                    {r.overall}/5 — « {r.comment} » <span className="text-muted">· {r.author_label ?? tp(`anon.${r.kind}`)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-[12px] text-muted">{t("previewNote")}</p>
          {sc?.published_at && sc.slug && (
            <Link href={`/v/${sc.slug as string}`} className="mt-3 inline-block text-[14px] font-medium text-accent-text hover:underline" data-testid="showcase-public-link">
              {t("openPublic")}
            </Link>
          )}
        </Card>
      </div>
    </>
  );
}
