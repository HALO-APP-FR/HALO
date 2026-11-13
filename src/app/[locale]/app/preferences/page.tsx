import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/halo/page-header";
import { MapsAppSetting } from "@/components/connected/directions";
import { NotificationPrefs, type PrefRow } from "@/components/connected/notification-prefs";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { emailConfigured } from "@/lib/connected/outbox";
import { PUSH_EVENTS, PUSH_LOCKED, pushPublicKey } from "@/lib/connected/push";
import { PushSetup, type PushDevice } from "@/components/connected/push-setup";
import type { MapsApp } from "@/lib/engine/directions";

/** Événements réellement émis par HALO, par rôle ; « critical » : urgences toujours envoyées par e-mail. */
const MANAGER_EVENTS: [string, PrefRow["critical"], string][] = [
  ["team_task_to_validate", null, "home"],
  ["team_task_overrun", null, "missions"],
  ["team_laundry", null, "linen"],
  ["team_assignment_conflict", null, "team"],
  ["team_absence_requested", null, "team"],
  ["chat_message", "urgent_only", "messages"],
  ["team_guest_message", null, "stays"],
  ["team_service_requested", null, "services"],
  ["team_guest_reply", null, "services"],
  ["team_guest_problem", "urgent_only", "incidents"],
  ["team_agent_blocker", "always", "incidents"],
  ["team_stay_changed", null, "stays"],
  ["team_prep_submitted", null, "stays"],
  ["team_prep_updated", null, "stays"],
  ["team_vip_requested", null, "stays"],
  ["team_booking_requested", null, "bookings"],
  ["team_low_review", null, "satisfaction"],
];
const AGENT_EVENTS: [string, PrefRow["critical"], string][] = [
  ["agent_task_assigned", null, "missions"],
  ["agent_task_changed", null, "missions"],
  ["agent_correction_requested", null, "missions"],
  ["agent_task_overrun", null, "missions"],
  ["agent_task_validated", null, "missions"],
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
  const [{ data: prefs, error: prefErr }, { data: devices, error: devErr }] = await Promise.all([
    supabase.from("notification_prefs").select("event, email, push").eq("organization_id", org!.id).eq("user_id", user!.id),
    supabase.from("push_subscriptions").select("id, label, created_at, last_success_at, last_error, last_error_at, disabled_at").eq("user_id", user!.id).order("created_at"),
  ]);
  // Migration 28 absente : préférences e-mail seules, push présenté comme indisponible (jamais promis)
  const pushAvailable = !prefErr && !devErr;
  const { data: prefsEmail } = pushAvailable ? { data: prefs } : await supabase.from("notification_prefs").select("event, email").eq("organization_id", org!.id).eq("user_id", user!.id);
  const publicKey = pushPublicKey();
  const activeDevices = (devices ?? []).filter((d) => !d.disabled_at).length;
  const pushState = !pushAvailable ? "migration" : !publicKey ? "not_configured" : activeDevices ? "active" : "no_device";
  const rows: PrefRow[] = (isManagerRole(org!.role) ? MANAGER_EVENTS : AGENT_EVENTS).map(([event, critical, where]) => ({
    event,
    critical,
    where: t(`where.${where}`),
    email: prefsEmail?.find((p) => p.event === event)?.email ?? true,
    push: PUSH_EVENTS.has(event) ? (PUSH_LOCKED.has(event) ? true : ((prefs as { event: string; push?: boolean }[] | null)?.find((p) => p.event === event)?.push ?? true)) : null,
    pushLocked: PUSH_LOCKED.has(event),
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
        <PushSetup publicKey={pushAvailable ? publicKey : null} devices={(devices ?? []) as PushDevice[]} available={pushAvailable} />
        <NotificationPrefs rows={rows} emailReady={emailConfigured()} push={{ state: pushState, devices: activeDevices }} />
      </div>
    </>
  );
}
