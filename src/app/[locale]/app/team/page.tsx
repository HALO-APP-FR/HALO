import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { InviteForm } from "@/components/connected/team-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";

export default async function TeamPage({ params }: PageProps<"/[locale]/app/team">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.team");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const { data } = await supabase.from("memberships").select("user_id, role, is_active, profiles(full_name)").eq("organization_id", org!.id).order("created_at");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="divide-y divide-line self-start">
          {(data ?? []).map((m) => {
            const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null;
            return (
              <div key={m.user_id} className="flex items-center gap-3 px-5 py-3.5" data-testid="member-row">
                <span className="flex-1 text-[15px] font-medium">{p?.full_name || t("noName")}</span>
                <span className="text-[13px] text-muted">{t(`roles.${m.role}`)}{m.is_active ? "" : ` · ${t("inactive")}`}</span>
              </div>
            );
          })}
        </Card>
        <InviteForm />
      </div>
    </>
  );
}
