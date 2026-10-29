import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { AbsenceForm, AbsenceList, ProfileForm, type AbsenceRow } from "@/components/connected/planning-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { MapsAppSetting } from "@/components/connected/directions";
import { NotificationPrefs, type PrefRow } from "@/components/connected/notification-prefs";
import { emailConfigured } from "@/lib/connected/outbox";
import { Field } from "@/components/ui/field";
import type { MapsApp } from "@/lib/engine/directions";

const MANAGER_EVENTS: [string, PrefRow["critical"]][] = [
  ["team_task_to_validate", null],
  ["team_service_requested", null],
  ["team_guest_reply", null],
  ["team_guest_message", null],
  ["team_guest_problem", "urgent_only"],
  ["team_agent_blocker", "always"],
  ["team_absence_requested", null],
  ["chat_message", "urgent_only"],
];
const AGENT_EVENTS: [string, PrefRow["critical"]][] = [
  ["agent_task_assigned", null],
  ["agent_correction_requested", null],
  ["chat_message", "urgent_only"],
];

/** Mon profil et mes absences : chacun gère les siennes ; le responsable décide des demandes. */
export default async function ProfilePage({ params }: PageProps<"/[locale]/app/profile">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.profile");
  const ta = await getTranslations("connected.absences");
  const { supabase, org, user, profile } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  // La base ne renvoie à un agent que ses propres absences et les fermetures d'équipe
  const td = await getTranslations("directions");
  const { data: prefs } = await supabase.from("notification_prefs").select("event, email").eq("organization_id", org!.id).eq("user_id", user!.id);
  const prefRows: PrefRow[] = (isManagerRole(org!.role) ? MANAGER_EVENTS : AGENT_EVENTS).map(([event, critical]) => ({
    event,
    critical,
    email: prefs?.find((p) => p.event === event)?.email ?? true,
  }));
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
          <Card className="p-5" data-testid="maps-setting">
            <Field label={td("defaultApp")} htmlFor="maps-app" hint={td("privacy")}>
              <MapsAppSetting value={((profile as { maps_app?: string | null } | null)?.maps_app as MapsApp | null) ?? null} />
            </Field>
          </Card>
          <NotificationPrefs rows={prefRows} emailReady={emailConfigured()} />
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
