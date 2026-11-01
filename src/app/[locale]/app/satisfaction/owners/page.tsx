import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { OwnerForm, OwnerReviewLink } from "@/components/connected/review-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { SatisfactionNav } from "../sub-nav";

/** Propriétaires et relation de gestion : seul un propriétaire relié à un logement géré peut être sollicité. */
export default async function OwnersPage({ params }: PageProps<"/[locale]/app/satisfaction/owners">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.reviews.owners");
  const f = await getFormatter();
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const o = org!.id;
  const [{ data: owners }, { data: links }, { data: props }, { data: reviews }] = await Promise.all([
    supabase.from("property_owners").select("id, name, email, phone, created_at").eq("organization_id", o).order("name"),
    supabase.from("owner_properties").select("owner_id, property_id").eq("organization_id", o),
    supabase.from("properties").select("id, name").eq("organization_id", o).order("name"),
    supabase.from("reviews").select("owner_id, overall, submitted_at").eq("organization_id", o).eq("kind", "owner").eq("source", "halo").order("submitted_at", { ascending: false }),
  ]);
  const pName = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SatisfactionNav current="owners" />
      <Card className="mb-4 p-4 text-[13px] text-muted" data-testid="owners-limits">
        {t("limits")}
      </Card>
      <div className="mb-4">
        <OwnerForm owner={null} properties={(props ?? []) as { id: string; name: string }[]} />
      </div>
      <div className="space-y-3">
        {(owners ?? []).length === 0 && <Card className="p-5 text-[15px] text-muted">{t("empty")}</Card>}
        {(owners ?? []).map((ow) => {
          const ids = (links ?? []).filter((l) => l.owner_id === ow.id).map((l) => l.property_id as string);
          const last = (reviews ?? []).find((r) => r.owner_id === ow.id);
          return (
            <Card key={ow.id} className="p-5" data-testid="owner-row">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{ow.name}</p>
                  <p className="text-[13px] text-muted">
                    {ow.email ?? t("noEmail")}
                    {ow.phone ? ` · ${ow.phone}` : ""}
                  </p>
                  <p className="mt-1 text-[13px]">{ids.length ? ids.map((i) => pName.get(i)).join(", ") : <span className="text-warning">{t("noProperty")}</span>}</p>
                  {last && <p className="mt-1 text-[13px] text-muted">{t("lastReview", { overall: last.overall, date: f.dateTime(new Date(last.submitted_at), { dateStyle: "medium" }) })}</p>}
                </div>
                <OwnerForm owner={{ id: ow.id, name: ow.name, email: ow.email, phone: ow.phone, propertyIds: ids }} properties={(props ?? []) as { id: string; name: string }[]} />
              </div>
              <div className="mt-3">
                <OwnerReviewLink ownerId={ow.id} hasEmail={Boolean(ow.email)} linked={ids.length > 0} />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
