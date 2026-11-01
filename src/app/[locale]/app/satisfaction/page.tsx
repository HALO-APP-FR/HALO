import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { ImportedReviewForm, ReviewFollow } from "@/components/connected/review-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { QUESTIONS, period, summarize, type ReviewKind, type ReviewRow, type Score } from "@/lib/engine/satisfaction";
import { cn } from "@/lib/utils";
import { SatisfactionNav } from "./sub-nav";

const MONTHS = [3, 6, 12, 24];

export default async function SatisfactionPage({ params, searchParams }: PageProps<"/[locale]/app/satisfaction">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("connected.reviews");
  const tq = await getTranslations("reviewPortal.q");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const kind: ReviewKind = sp.kind === "owner" ? "owner" : "guest";
  const months = MONTHS.includes(Number(sp.months)) ? Number(sp.months) : 12;
  const filter = sp.filter === "to_handle" ? "to_handle" : sp.filter === "low" ? "low" : "all";
  const p = period(months);
  const [{ data: rows, error }, { data: props }] = await Promise.all([
    supabase
      .from("reviews")
      .select("id, kind, source, verified, overall, ratings, comment, would_return, author_label, consent_publish, consent_withdrawn_at, imported_from, review_date, submitted_at, updated_at, follow_status, follow_note, follow_at, incident_id, reservation_id, property_id, owner_id, properties(name), reservations(guest_name), property_owners(name)")
      .eq("organization_id", o)
      .eq("kind", kind)
      .gte("review_date", p.from)
      .order("review_date", { ascending: false })
      .limit(500),
    supabase.from("properties").select("id, name").eq("organization_id", o).order("name"),
  ]);
  const all = rows ?? [];
  const sum = summarize(all as unknown as ReviewRow[], kind, p);
  const list = all.filter((r) => (filter === "to_handle" ? r.follow_status === "to_handle" : filter === "low" ? r.overall <= 2 : true));
  const toHandle = all.filter((r) => r.follow_status === "to_handle").length;
  const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);
  const day = (x: string) => f.dateTime(new Date(`${x}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const q = (k: Record<string, string | number>) => {
    const u = new URLSearchParams({ kind, months: String(months), filter, ...Object.fromEntries(Object.entries(k).map(([a, b]) => [a, String(b)])) });
    return `/app/satisfaction?${u.toString()}`;
  };
  const avg = (n: number | null) => (n == null ? "—" : f.number(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const scoreBlock = ({ sc, title, testId }: { sc: Score; title: string; testId: string }) => (
    <Card className="p-5" data-testid={testId} data-count={sc.count}>
      <p className="text-[13px] font-medium text-muted">{title}</p>
      {sc.count === 0 ? (
        <p className="mt-2 text-[15px] text-muted">{t("noReviews")}</p>
      ) : (
        <>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-title-1" data-testid={`${testId}-avg`}>{avg(sc.average)}</span>
            <span className="text-muted">/ 5</span>
          </p>
          <p className="text-[13px] text-muted">{t("count", { count: sc.count })}</p>
          <div className="mt-3 space-y-1">
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <div key={n} className="flex items-center gap-2 text-[12px]">
                <span className="w-6 text-muted">{n}★</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-subtle dark:bg-surface-hover">
                  <span className="block h-full bg-accent" style={{ width: `${(sc.distribution[n] / sc.count) * 100}%` }} />
                </span>
                <span className="w-6 text-end">{sc.distribution[n]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SatisfactionNav current="reviews" />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[14px]">
        {(["guest", "owner"] as const).map((k) => (
          <Link key={k} href={`/app/satisfaction?kind=${k}&months=${months}`} className={cn("rounded-full px-3 py-1", kind === k ? "bg-fg text-canvas" : "bg-subtle dark:bg-surface-hover")} data-testid={`sat-kind-${k}`}>
            {t(`kindName.${k}`)}
          </Link>
        ))}
        <span className="mx-2 text-faint">|</span>
        {MONTHS.map((m) => (
          <Link key={m} href={q({ months: m })} className={cn("rounded-full px-3 py-1", months === m ? "bg-fg text-canvas" : "bg-subtle dark:bg-surface-hover")}>
            {t("months", { count: m })}
          </Link>
        ))}
      </div>
      <p className="mb-3 text-[13px] text-muted" data-testid="sat-period">
        {t("periodLine", { from: day(p.from), to: day(p.to) })}
      </p>
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {scoreBlock({ sc: sum.verified, title: t("verifiedTitle"), testId: "sat-verified" })}
        <Card className="p-5 md:col-span-1">
          <p className="text-[13px] font-medium text-muted">{t("byQuestion")}</p>
          <ul className="mt-2 space-y-1.5 text-[14px]" data-testid="sat-questions">
            {QUESTIONS[kind].map((k) => {
              const x = sum.verified.questions[k];
              return (
                <li key={k} className="flex justify-between gap-2">
                  <span>{tq(k)}</span>
                  <span className="text-muted">
                    {avg(x.average)} · {t("unanswered", { count: x.unanswered })}
                  </span>
                </li>
              );
            })}
            <li className="flex justify-between gap-2 border-t border-line pt-1.5">
              <span>{t(`returnShort.${kind}`)}</span>
              <span className="text-muted">
                {t("yesNo", { yes: sum.verified.wouldReturn.yes, no: sum.verified.wouldReturn.no, none: sum.verified.wouldReturn.unanswered })}
              </span>
            </li>
          </ul>
        </Card>
        {scoreBlock({ sc: sum.imported, title: t("importedTitle"), testId: "sat-imported" })}
      </div>
      <p className="mt-2 text-[12px] text-muted">{t("method")}</p>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-[14px]">
        <h2 className="me-2 text-[17px] font-semibold">{t("listTitle")}</h2>
        {(["all", "to_handle", "low"] as const).map((k) => (
          <Link key={k} href={q({ filter: k })} className={cn("rounded-full px-3 py-1", filter === k ? "bg-fg text-canvas" : "bg-subtle dark:bg-surface-hover")} data-testid={`sat-filter-${k}`}>
            {t(`filter.${k}`)}
            {k === "to_handle" && toHandle > 0 ? ` (${toHandle})` : ""}
          </Link>
        ))}
      </div>
      <div className="mt-3">
        <ImportedReviewForm properties={(props ?? []) as { id: string; name: string }[]} />
      </div>
      <div className="mt-4 space-y-3">
        {list.length === 0 && <Card className="p-5 text-[15px] text-muted">{t("emptyList")}</Card>}
        {list.map((r) => {
          const prop = one(r.properties) as { name: string } | null;
          const guest = one(r.reservations) as { guest_name: string | null } | null;
          const owner = one(r.property_owners) as { name: string } | null;
          const ratings = (r.ratings ?? {}) as Record<string, number>;
          return (
            <Card key={r.id} className={cn("p-5", r.overall <= 2 && r.follow_status !== "handled" && "border-danger")} data-testid="review-row" data-follow={r.follow_status} data-source={r.source}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[13px] font-semibold", r.overall <= 2 ? "bg-danger-soft text-danger" : r.overall >= 4 ? "bg-success-soft text-success" : "bg-subtle")}>{r.overall}/5</span>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] dark:bg-surface-hover">{r.source === "imported" ? t("importedBadge", { from: r.imported_from ?? "—" }) : t("verifiedBadge")}</span>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] dark:bg-surface-hover">{t(`followState.${r.follow_status}`)}</span>
                {r.consent_publish && !r.consent_withdrawn_at && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] text-accent-text">{t("consentGiven")}</span>}
                {r.consent_withdrawn_at && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[12px]">{t("consentWithdrawn")}</span>}
                <span className="text-[13px] text-muted">
                  {day(r.review_date)}
                  {prop ? ` · ${prop.name}` : ""}
                  {guest?.guest_name ? ` · ${guest.guest_name}` : ""}
                  {owner ? ` · ${owner.name}` : ""}
                </span>
              </div>
              {Object.keys(ratings).length > 0 && (
                <p className="mt-2 text-[13px] text-muted">
                  {Object.entries(ratings)
                    .map(([k, v]) => `${tq(k)} ${v}/5`)
                    .join(" · ")}
                </p>
              )}
              {r.comment ? <p className="mt-2 whitespace-pre-wrap text-[15px]">{r.comment}</p> : <p className="mt-2 text-[14px] text-muted">{t("noComment")}</p>}
              {r.would_return != null && <p className="mt-1 text-[13px]">{t(`returnAnswer.${kind}.${r.would_return ? "yes" : "no"}`)}</p>}
              {r.source === "halo" && r.updated_at && r.submitted_at && r.updated_at > r.submitted_at && (
                <p className="mt-1 text-[12px] text-faint">{t("editedByAuthor", { date: f.dateTime(new Date(r.updated_at), { dateStyle: "short" }) })}</p>
              )}
              {r.follow_note && (
                <p className="mt-2 rounded-md bg-subtle p-2 text-[13px] dark:bg-surface-hover" data-testid="review-follow-note">
                  <strong>{t("followNote")} :</strong> {r.follow_note}
                </p>
              )}
              <div className="flex flex-wrap gap-4 text-[14px]">
                {r.reservation_id && (
                  <Link href={`/app/stays/${r.reservation_id}`} className="mt-2 text-accent-text hover:underline">
                    {t("openStay")}
                  </Link>
                )}
                {r.incident_id && (
                  <Link href="/app/incidents" className="mt-2 text-accent-text hover:underline" data-testid="review-incident-link">
                    {t("openIncident")}
                  </Link>
                )}
              </div>
              <ReviewFollow id={r.id} status={r.follow_status} note={r.follow_note} hasIncident={Boolean(r.incident_id)} canIncident={Boolean(r.property_id) && r.kind === "guest"} />
            </Card>
          );
        })}
      </div>
      <p className="mt-6 text-[12px] text-muted">{t("noBlame")}</p>
    </>
  );
}
