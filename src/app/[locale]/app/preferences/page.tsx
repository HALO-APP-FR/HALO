import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/halo/page-header";
import { MapsAppSetting } from "@/components/connected/directions";
import { NotificationPrefs, type PrefRow } from "@/components/connected/notification-prefs";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { emailConfigured } from "@/lib/connected/outbox";
import type { MapsApp } from "@/lib/engine/directions";

/** Événements réellement émis par HALO, par rôle ; « critical » : urgences toujours envoyées par e-mail. */
const MANAGER_EVENTS: [string, PrefRow["critical"], string][] = [
  ["team_task_to_validate", null, "home"],
  ["team_assignment_conflict", null, "team"],
  ["team_absence_requested", null, "team"],
  ["chat_message", "urgent_only", "messages"],
  ["team_guest_message", null, "stays"],
  ["team_service_requested", null, "services"],
  ["team_guest_reply", null, "services"],
  ["team_guest_problem", "urgent_only", "incidents"],
  ["team_agent_blocker", "always", "incidents"],
  ["team_stay_changed", null, "stays"],
];
const AGENT_EVENTS: [string, PrefRow["critical"], string][] = [
  ["agent_task_assigned", null, "missions"],
  ["agent_task_changed", null, "missions"],
  ["agent_correction_requested", null, "missions"],
  ["agent_absence_decided", null, "profile"],
  ["chat_message", "urgent_only", "messages"],
];

/** Préférences personnelles : application d'itinéraire et notifications (chacun les siennes, appliquées par le serveur). */
export default async function PreferencesPage({ params }: PageProps<"/[locale]/app/preferences">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.prefs");
  const td = await getTranslations("directions");
  const { supabase, org, user, profile } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  const { data: prefs } = await supabase.from("notification_prefs").select("event, email").eq("organization_id", org!.id).eq("user_id", user!.id);
  const rows: PrefRow[] = (isManagerRole(org!.role) ? MANAGER_EVENTS : AGENT_EVENTS).map(([event, critical, where]) => ({
    event,
    critical,
    where: t(`where.${where}`),
    email: prefs?.find((p) => p.event === event)?.email ?? true,
  }));
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <div className="grid max-w-3xl gap-4">
        <Card className="p-5" data-testid="maps-setting">
          <Field label={td("defaultApp")} htmlFor="maps-app" hint={td("privacy")}>
            <MapsAppSetting value={((profile as { maps_app?: string | null } | null)?.maps_app as MapsApp | null) ?? null} />
          </Field>
        </Card>
        <NotificationPrefs rows={rows} emailReady={emailConfigured()} />
      </div>
    </>
  );
}
