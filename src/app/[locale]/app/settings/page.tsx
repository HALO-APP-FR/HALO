import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { ValidationSettings } from "@/components/connected/planning-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";

/** Réglages de l'organisation : ce qui est enregistré ici pilote le serveur (finish_task lit validation_task_types). */
export default async function SettingsPage({ params }: PageProps<"/[locale]/app/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.settings");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data } = await supabase.from("organizations").select("validation_task_types").eq("id", org!.id).single();
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="max-w-2xl">
        <ValidationSettings initial={(data?.validation_task_types as string[]) ?? []} />
      </div>
    </>
  );
}
