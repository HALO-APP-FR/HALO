import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { ValidationSettings } from "@/components/connected/planning-forms";
import { PrepQuestionsSettings, VipCriteriaSettings, type CriterionRow } from "@/components/connected/prep-forms";
import { Card } from "@/components/ui/card";
import { ImportEntry } from "@/components/connected/import-entry";
import { getContext, isManagerRole } from "@/lib/connected/context";

/** Réglages de l'organisation : ce qui est enregistré ici pilote le serveur (finish_task lit validation_task_types). */
export default async function SettingsPage({ params }: PageProps<"/[locale]/app/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.settings");
  const ti = await getTranslations("connected.import");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const [{ data }, { data: criteria }] = await Promise.all([
    supabase.from("organizations").select("validation_task_types, prep_questions").eq("id", org!.id).single(),
    supabase.from("vip_criteria").select("id, label, kind, min_stays, validity_days, guest_visible, editable_by, active").eq("organization_id", org!.id).order("label"),
  ]);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="max-w-2xl space-y-4">
        <ImportEntry title={ti("entryTitle")} text={ti("entryText")} />
        <ValidationSettings initial={(data?.validation_task_types as string[]) ?? []} />
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{t("prep.title")}</h2>
          <p className="mb-4 mt-1 text-[14px] text-muted">{t("prep.text")}</p>
          <PrepQuestionsSettings initial={(data?.prep_questions as string[]) ?? []} />
        </Card>
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{t("vip.title")}</h2>
          <p className="mb-4 mt-1 text-[14px] text-muted">{t("vip.text")}</p>
          <VipCriteriaSettings criteria={(criteria ?? []) as CriterionRow[]} isOwner={org!.role === "owner"} />
        </Card>
        <Card className="p-5" data-testid="ai-status">
          <h2 className="text-[17px] font-semibold">{t("ai.title")}</h2>
          <p className="mt-1 text-[14px] text-muted">{t("ai.text")}</p>
        </Card>
      </div>
    </>
  );
}
