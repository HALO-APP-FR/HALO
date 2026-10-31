import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { ImportHistoryRow, ImportStart, TemplateLinks } from "@/components/connected/import-flow";
import { getContext, isManagerRole } from "@/lib/connected/context";

/** « Vous utilisez déjà un logiciel ? » : préparation, reprise et historique des imports (responsables). */
export default async function ImportPage({ params }: PageProps<"/[locale]/app/import">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.import");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data: jobs } = await supabase.from("import_jobs").select("id, created_at, status, kinds, source_software, report").eq("organization_id", org!.id).order("created_at", { ascending: false }).limit(50);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <ImportStart />
          <Card className="p-5" data-testid="import-history">
            <h2 className="text-[17px] font-semibold">{t("historyTitle")}</h2>
            {(jobs ?? []).length === 0 && <p className="mt-2 text-[14px] text-muted">{t("historyEmpty")}</p>}
            <ul className="mt-2 divide-y divide-line">
              {(jobs ?? []).map((j) => (
                <li key={j.id}>
                  <Link href={`/app/import/${j.id}`} className="block py-3 hover:bg-surface-hover">
                    <ImportHistoryRow job={j as never} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="text-[17px] font-semibold">{t("templatesTitle")}</h2>
            <p className="text-[14px] text-muted">{t("templatesText")}</p>
            <TemplateLinks />
          </Card>
          <Card className="space-y-2 p-5 text-[14px]" data-testid="import-privacy">
            <h2 className="text-[17px] font-semibold">{t("privacyTitle")}</h2>
            <p>{t("privacy1")}</p>
            <p>{t("privacy2")}</p>
            <p>{t("privacy3")}</p>
            <p>{t("privacy4")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
