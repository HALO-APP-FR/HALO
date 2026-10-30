import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { AbsenceForm, AbsenceList, ProfileForm, type AbsenceRow } from "@/components/connected/planning-forms";
import { getContext } from "@/lib/connected/context";
import { Link } from "@/i18n/navigation";

/** Mon profil et mes absences : chacun gère les siennes ; le responsable décide des demandes. */
export default async function ProfilePage({ params }: PageProps<"/[locale]/app/profile">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.profile");
  const ta = await getTranslations("connected.absences");
  const { supabase, org, user, profile } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  // La base ne renvoie à un agent que ses propres absences et les fermetures d'équipe
  const { data } = await supabase.from("absences").select("*").eq("organization_id", org!.id).order("starts_at", { ascending: false }).limit(100);
  const rows: AbsenceRow[] = (data ?? []).map((a) => ({
    id: a.id,
    who: a.scope === "team" ? ta("wholeTeam") : t("me"),
    kind: a.kind,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: a.status,
    unplanned: a.unplanned,
    reason: a.reason,
    canDecide: false,
    canCancel: a.member_id === user!.id && (a.status === "pending" || a.status === "accepted") && new Date(a.ends_at) > new Date(),
    impacts: [],
  }));
  const missing = [!profile?.full_name?.trim() && t("name"), !profile?.phone?.trim() && t("phone")].filter(Boolean) as string[];
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={missing.length ? t("missing", { fields: missing.join(", ") }) : t("complete")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <ProfileForm name={profile?.full_name ?? ""} phone={profile?.phone ?? ""} />
          <Link href="/app/preferences" className="block rounded-xl border border-line bg-surface p-4 text-[15px] hover:bg-surface-hover" data-testid="profile-prefs-link">
            {t("prefsLink")}
          </Link>
          <AbsenceForm manager={false} members={[]} selfId={user!.id} />
        </div>
        <Card className="self-start p-5" data-testid="my-absences">
          <h2 className="text-[17px] font-semibold">{ta("mine")}</h2>
          <div className="mt-2">
            <AbsenceList rows={rows} empty={ta("noneMine")} />
          </div>
        </Card>
      </div>
    </>
  );
}
