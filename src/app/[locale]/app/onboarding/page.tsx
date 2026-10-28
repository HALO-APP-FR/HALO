import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { OnboardingWizard, type WizardInitial } from "@/components/connected/onboarding-wizard";
import { getContext, isManagerRole } from "@/lib/connected/context";

export default async function OnboardingPage({ params }: PageProps<"/[locale]/app/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { supabase, org, profile, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data: o } = await supabase
    .from("organizations")
    .select("name, legal_name, country_code, address_line, postal_code, city, activity_type, unit_count, cleaning_model, linen_model, services_offered, frequent_issues, tools, onboarding")
    .eq("id", org!.id)
    .single();
  const initial: WizardInitial = {
    email: user?.email ?? "",
    profile: { full_name: profile?.full_name ?? "", job_title: profile?.job_title ?? "", phone: profile?.phone ?? "" },
    org: {
      name: o?.name ?? org!.name,
      legal_name: o?.legal_name ?? "",
      country_code: o?.country_code ?? "FR",
      address_line: o?.address_line ?? "",
      postal_code: o?.postal_code ?? "",
      city: o?.city ?? "",
      activity_type: o?.activity_type ?? null,
      unit_count: o?.unit_count ?? null,
      cleaning_model: o?.cleaning_model ?? null,
      linen_model: o?.linen_model ?? null,
      services_offered: o?.services_offered ?? [],
      frequent_issues: o?.frequent_issues ?? [],
      tools: o?.tools ?? [],
    },
    onboarding: (o?.onboarding ?? {}) as WizardInitial["onboarding"],
  };
  return <OnboardingWizard initial={initial} />;
}
