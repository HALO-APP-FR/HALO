import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Préproduction : scénario de test complet, créé À TRAVERS LES VRAIES FONCTIONS de la base (sessions réelles,
 * règles d'accès appliquées), avec des identités fictives (@halo.invalid) :
 * manager + agent, organisation configurée, logement avec livret et checklist, séjour d'arrivée demain,
 * ménage assigné à l'agent, lien voyageur. Le linge n'est pas planifié : à faire depuis l'accueil.
 */
const fresh = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function sessionFor(admin: SupabaseClient, email: string, fullName: string) {
  const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error && !/already/i.test(error.message)) throw new Error(error.message);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const c = fresh();
  const { data: s, error: ve } = await c.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "email" });
  if (ve || !s.user) throw new Error(ve?.message ?? "session");
  await c.from("profiles").update({ full_name: fullName }).eq("id", s.user.id);
  return { client: c, userId: s.user.id, created: Boolean(u?.user) };
}

const at = (daysFromNow: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export async function buildTestScenario(slug: string): Promise<{ managerEmail: string; agentLabel: string; guestToken: string | null; existed: boolean }> {
  const admin = supabaseAdmin();
  if (!admin) throw new Error("server_key_missing");
  const managerEmail = `test-${slug}@halo.invalid`;
  const agentLabel = `${slug}-agent`;
  const m = await sessionFor(admin, managerEmail, "Manager test");
  const { data: existing } = await m.client.from("memberships").select("organization_id").eq("user_id", m.userId).limit(1);
  if (existing?.length) return { managerEmail, agentLabel, guestToken: null, existed: true };

  const { data: org, error: oe } = await m.client.rpc("create_organization", { org_name: `Conciergerie test — ${slug}` });
  if (oe) throw new Error(oe.message);
  const checklist = [
    { room: "Séjour", items: [{ label: "Séjour rangé", photo_required: true }, { label: "Poussière", photo_required: false }] },
    { room: "Cuisine", items: [{ label: "Cuisine propre", photo_required: true }, { label: "Réfrigérateur vidé", photo_required: false }] },
    { room: "Chambre", items: [{ label: "Lit fait", photo_required: true }, { label: "Linge changé", photo_required: false }] },
    { room: "Salle de bain", items: [{ label: "Salle de bain propre", photo_required: true }, { label: "Serviettes", photo_required: false }] },
  ];
  await m.client
    .from("organizations")
    .update({
      activity_type: "concierge",
      unit_count: 1,
      cleaning_model: "providers",
      linen_model: "laundry",
      services_offered: ["private_chef", "airport_transfer", "grocery", "other"],
      validation_task_types: ["turnover"],
      default_checklist: checklist,
      onboarding: { step: "done", completed_at: new Date().toISOString(), config: { task_types: ["turnover", "linen_delivery", "linen_pickup"] } },
    })
    .eq("id", org);

  // Agent invité puis accepté avec sa propre session
  const { data: invite } = await m.client.rpc("create_invitation", { org, invite_role: "agent", invite_position: "housekeeper" });
  const a = await sessionFor(admin, `test-${agentLabel}@halo.invalid`, "Agent test");
  const { error: ae } = await a.client.rpc("accept_invitation", { raw_token: invite as string });
  if (ae) throw new Error(ae.message);

  const { data: p, error: pe } = await m.client
    .from("properties")
    .insert({ organization_id: org, name: "Appartement test", address_line: "1 rue de la Paix", city: "Paris", default_check_in: "16:00", default_check_out: "11:00", cleaning_duration_min: 90 })
    .select("id")
    .single();
  if (pe) throw new Error(pe.message);
  await m.client.from("guest_guides").insert({
    organization_id: org,
    property_id: p.id,
    enabled: true,
    welcome: "Bienvenue ! (logement de test, données fictives)",
    house_rules: "Pas de fête, pas de fumée.",
    checkout_instructions: "Laissez les clés sur la table.",
    wifi_name: "HALO-test",
    wifi_password: "test-wifi",
  });
  for (const [i, room] of checklist.entries()) {
    const { data: r } = await m.client.from("checklist_rooms").insert({ organization_id: org, property_id: p.id, name: room.room, sort: i }).select("id").single();
    await m.client.from("checklist_items").insert(room.items.map((it, j) => ({ organization_id: org, room_id: r!.id, label: it.label, photo_required: it.photo_required, sort: j })));
  }
  const { data: prev } = await m.client
    .from("reservations")
    .insert({ organization_id: org, property_id: p.id, guest_name: "Voyageur sortant", adults: 2, check_in_at: at(-2, 16), check_out_at: at(1, 11) })
    .select("id")
    .single();
  const { data: next, error: re } = await m.client
    .from("reservations")
    .insert({ organization_id: org, property_id: p.id, guest_name: "Voyageur test", adults: 2, check_in_at: at(1, 16), check_out_at: at(4, 11) })
    .select("id")
    .single();
  if (re) throw new Error(re.message);
  await m.client.from("tasks").insert({
    organization_id: org,
    property_id: p.id,
    reservation_id: prev!.id,
    next_reservation_id: next.id,
    type: "turnover",
    status: "assigned",
    assignee_id: a.userId,
    is_auto_generated: false,
    window_start: at(1, 11),
    window_end: at(1, 16),
    duration_min: 90,
  });
  const { data: token } = await m.client.rpc("create_guest_link", { org, reservation: next.id });
  return { managerEmail, agentLabel, guestToken: (token as string) ?? null, existed: false };
}
