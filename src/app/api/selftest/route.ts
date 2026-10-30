import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, haloEnv, isConnected } from "@/lib/supabase/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/connected/outbox";
import { geocode, nearbyPlaces } from "@/lib/connected/osm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AUTO-TEST DE PRÉPRODUCTION, exécuté sur le vrai backend du déploiement.
 * - Inexistant en production (404) ; protégé par un jeton (SELFTEST_TOKEN, Vercel, préversion uniquement).
 * - Crée des comptes et organisations FICTIFS (adresses @halo.invalid, aucun e-mail envoyé),
 *   vérifie persistance, cloisonnement des rôles et des organisations, accès voyageur, puis SUPPRIME tout.
 * - Ne renvoie que des résultats (vrai / faux), jamais de valeur secrète.
 */
type Check = { name: string; ok: boolean; detail?: string };

function tokenOk(given: string | null) {
  const expected = process.env.SELFTEST_TOKEN ?? "";
  if (!expected || !given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const fresh = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/** Session réelle : utilisateur créé confirmé, puis lien de connexion généré côté serveur (aucun envoi) et vérifié. */
async function session(admin: SupabaseClient, email: string, createdIds: string[]) {
  const existing = createdIds.length;
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ue && !/already/i.test(ue.message)) throw new Error(`createUser: ${ue.message}`);
  if (u?.user && createdIds.length === existing) createdIds.push(u.user.id);
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (le || !link.properties?.hashed_token) throw new Error(`generateLink: ${le?.message}`);
  const client = fresh();
  const { error: ve } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
  if (ve) throw new Error(`verifyOtp: ${ve.message}`);
  return client;
}

export async function GET(request: NextRequest) {
  if (haloEnv() === "production" || !isConnected()) return new NextResponse(null, { status: 404 });
  if (!tokenOk(new URL(request.url).searchParams.get("token"))) return new NextResponse(null, { status: 404 });
  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "server_key_missing" });

  const run = randomBytes(4).toString("hex");
  const realEmail = new URL(request.url).searchParams.get("email") === "1";
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
  const users: string[] = [];
  const orgs: string[] = [];
  const stored: string[] = [];
  const origin = new URL(request.url).origin;

  try {
    // 0. Retour de connexion : l'URL de ce déploiement est-elle autorisée par l'authentification ?
    const { data: probe } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: `selftest-${run}-probe@halo.invalid`,
      options: { redirectTo: `${origin}/api/auth/callback?next=/fr/app` },
    });
    if (probe?.user) users.push(probe.user.id);
    const redirect = new URL(probe?.properties?.action_link ?? "http://x").searchParams.get("redirect_to") ?? "";
    check("auth_redirect_url_allowed", redirect.startsWith(`${origin}/api/auth/callback`), redirect ? new URL(redirect).origin : "none");

    // 1. Manager A : organisation, logement, livret, séjour, lien voyageur
    const a1 = await session(admin, `selftest-${run}-manager-a@halo.invalid`, users);
    const { data: orgA, error: oe } = await a1.rpc("create_organization", { org_name: `SELFTEST A ${run}` });
    check("manager_creates_organization", !oe && Boolean(orgA), oe?.message);
    orgs.push(orgA as string);
    const { data: pA, error: pe } = await a1.from("properties").insert({ organization_id: orgA, name: `Logement A ${run}` }).select("id").single();
    check("manager_creates_property", !pe && Boolean(pA), pe?.message);
    const { error: ge } = await a1.from("guest_guides").insert({ organization_id: orgA, property_id: pA!.id, enabled: true, welcome: `Bienvenue A ${run}` });
    check("manager_writes_guide", !ge, ge?.message);
    const inAt = new Date(Date.now() + 86_400_000).toISOString();
    const outAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    // email=1 : le voyageur fictif reçoit VRAIMENT les e-mails (adresse « +selftest » de l'expéditeur configuré)
    const from = /<([^>]+)>/.exec(process.env.EMAIL_FROM ?? "")?.[1] ?? process.env.EMAIL_FROM ?? "";
    const guestEmail = realEmail && from.includes("@") ? from.replace("@", `+selftest-${run}@`) : null;
    const { data: rA, error: re } = await a1
      .from("reservations")
      .insert({ organization_id: orgA, property_id: pA!.id, guest_name: "Voyageur A", guest_email: guestEmail, check_in_at: inAt, check_out_at: outAt })
      .select("id")
      .single();
    check("manager_creates_stay", !re && Boolean(rA), re?.message);
    const { data: tokenA, error: le } = await a1.rpc("create_guest_link", { org: orgA, reservation: rA!.id });
    check("manager_creates_guest_link", !le && typeof tokenA === "string", le?.message);

    // 2. Persistance : nouvelle connexion, nouveau client sans état partagé (autre appareil)
    const a2 = await session(admin, `selftest-${run}-manager-a@halo.invalid`, users);
    const { data: again } = await a2.from("reservations").select("id, guest_name").eq("id", rA!.id).maybeSingle();
    check("data_persists_after_new_sign_in", again?.guest_name === "Voyageur A");

    // 3. Autre organisation : rien de A n'est lisible ni modifiable
    const b = await session(admin, `selftest-${run}-manager-b@halo.invalid`, users);
    const { data: orgB } = await b.rpc("create_organization", { org_name: `SELFTEST B ${run}` });
    orgs.push(orgB as string);
    const { data: bReads } = await b.from("reservations").select("id").eq("id", rA!.id);
    check("other_org_cannot_read_stay", (bReads ?? []).length === 0);
    const { data: bUpd } = await b.from("properties").update({ name: "piraté" }).eq("id", pA!.id).select("id");
    check("other_org_cannot_update_property", (bUpd ?? []).length === 0);
    const { error: bLink } = await b.rpc("create_guest_link", { org: orgA, reservation: rA!.id });
    check("other_org_cannot_create_guest_link", Boolean(bLink));

    // 4. Agent de A : invité, ne voit ni séjours ni demandes ni messages
    const { data: inv } = await a1.rpc("create_invitation", { org: orgA, invite_role: "agent", invite_position: "housekeeper" });
    const ag = await session(admin, `selftest-${run}-agent-a@halo.invalid`, users);
    const { error: noName } = await ag.rpc("accept_invitation", { raw_token: inv as string, member_name: " " });
    check("invitation_requires_name", Boolean(noName));
    const { error: acc } = await ag.rpc("accept_invitation", { raw_token: inv as string, member_name: `Agent ${run}`, member_phone: "+33600000000" });
    check("agent_accepts_invitation", !acc, acc?.message);
    const { data: agProfile } = await a1.from("profiles").select("full_name").eq("id", (await ag.auth.getUser()).data.user!.id).single();
    check("agent_name_visible_to_manager", agProfile?.full_name === `Agent ${run}`);
    const [{ data: agStays }, { data: agLinks }] = await Promise.all([ag.from("reservations").select("id"), ag.from("guest_links").select("id")]);
    check("agent_cannot_read_stays_or_guest_links", (agStays ?? []).length === 0 && (agLinks ?? []).length === 0);
    const { error: agDecide } = await ag.rpc("create_guest_link", { org: orgA, reservation: rA!.id });
    check("agent_cannot_manage_guest_links", Boolean(agDecide));

    // 4b. Mission de l'agent : photo obligatoire réellement déposée (stockage privé), puis fin de mission
    const { data: room } = await a1.from("checklist_rooms").insert({ organization_id: orgA, property_id: pA!.id, name: "Salle de bain" }).select("id").single();
    const { data: item } = await a1.from("checklist_items").insert({ organization_id: orgA, room_id: room!.id, label: "Propre", photo_required: true }).select("id").single();
    const agentId = (await ag.auth.getUser()).data.user!.id;
    const { data: task, error: tke } = await a1
      .from("tasks")
      .insert({ organization_id: orgA, property_id: pA!.id, type: "turnover", status: "assigned", assignee_id: agentId, window_start: inAt, window_end: outAt, duration_min: 60 })
      .select("id")
      .single();
    check("manager_assigns_mission", !tke && Boolean(task), tke?.message);
    await ag.rpc("start_task", { org: orgA, task: task!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    const { data: early } = await ag.rpc("finish_task", { org: orgA, task: task!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    check("finish_refused_without_required_photo", early === "missing_photos", String(early));
    const { data: path } = await ag.rpc("begin_upload", { org: orgA, f_kind: "task_photo", f_mime: "image/jpeg", f_size: 4, task: task!.id, item: item!.id, room: room!.id });
    const { error: upErr } = await ag.storage.from("org-files").upload(path as string, new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    if (!upErr) stored.push(path as string);
    check("agent_uploads_photo_to_private_storage", !upErr, upErr?.message);
    const { data: fin } = await ag.rpc("finish_task", { org: orgA, task: task!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    check("agent_finishes_mission_with_photo", fin === "applied", String(fin));
    const { data: mUrl } = await a1.storage.from("org-files").createSignedUrl(path as string, 60);
    check("manager_reads_photo", Boolean(mUrl?.signedUrl));
    const { data: bUrl } = await b.storage.from("org-files").createSignedUrl(path as string, 60);
    check("other_org_cannot_read_photo", !bUrl?.signedUrl);
    const { data: forgedUp } = await b.storage.from("org-files").upload(`${orgA}/task/${task!.id}/forged.jpg`, new Blob([new Uint8Array([1])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    if (forgedUp) stored.push(`${orgA}/task/${task!.id}/forged.jpg`);
    check("other_org_cannot_upload_into_mission", !forgedUp);

    // 4c. Validation pilotée par le réglage (maintenance comprise), créneaux et absences contrôlés par la base
    await a1.from("organizations").update({ validation_task_types: ["turnover", "maintenance"] }).eq("id", orgA);
    const soon = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    const { data: mt } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: soon(-30), window_end: soon(180), duration_min: 30 }).select("id").single();
    await ag.rpc("start_task", { org: orgA, task: mt!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    await ag.rpc("finish_task", { org: orgA, task: mt!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    const { data: mtRow } = await a1.from("tasks").select("status").eq("id", mt!.id).single();
    check("maintenance_waits_for_manager_validation", mtRow?.status === "done", mtRow?.status);
    const { error: selfVal } = await ag.rpc("validate_task", { org: orgA, task: mt!.id });
    check("agent_cannot_validate_own_mission", Boolean(selfVal));
    const { data: val } = await a1.rpc("validate_task", { org: orgA, task: mt!.id });
    check("manager_validates_mission", val === "applied", String(val));
    const { error: shortErr } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "turnover", window_start: soon(60), window_end: soon(61), duration_min: 90 });
    check("window_shorter_than_duration_refused", Boolean(shortErr));
    const { data: ab, error: abe } = await a1.rpc("save_absence", { org: orgA, client: crypto.randomUUID(), a_scope: "member", a_member: agentId, a_kind: "leave", a_start: soon(0), a_end: soon(300) });
    check("manager_records_absence", !abe && (ab as { status: string })?.status === "accepted", abe?.message);
    const { error: busy } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: soon(30), window_end: soon(150), duration_min: 60 });
    check("absent_agent_cannot_be_assigned", Boolean(busy) && String(busy?.message).includes("assignee_unavailable"), busy?.message);
    await a1.rpc("cancel_absence", { org: orgA, absence: (ab as { id: string }).id });

    // 5. Voyageur (sans compte, par son lien)
    const guest = fresh();
    const { data: gs } = await guest.rpc("get_guest_stay", { token: tokenA as string });
    const gsj = gs as { status: string; guide?: { welcome?: string } };
    check("guest_opens_own_stay", gsj?.status === "ok" && gsj.guide?.welcome === `Bienvenue A ${run}`);
    const { data: req } = await guest.rpc("guest_request_service", { token: tokenA as string, s_kind: "other", s_start_at: outAt, s_people: 2, s_details: `Demande ${run}` });
    check("guest_requests_service", (req as { status: string })?.status === "ok");
    const { data: gTables, error: gTablesErr } = await guest.from("service_requests").select("id");
    check("guest_cannot_read_tables_directly", Boolean(gTablesErr) || (gTables ?? []).length === 0);
    const { data: forged } = await guest.rpc("get_guest_stay", { token: "f".repeat(64) });
    check("forged_link_refused", (forged as { status: string })?.status === "unavailable");

    // 6. Réponse du manager : précisions + note interne ; le voyageur voit la question, jamais la note
    const { data: svc } = await a1.from("service_requests").select("id").eq("organization_id", orgA).single();
    const { data: dec, error: de } = await a1.rpc("decide_service", { org: orgA, service: svc!.id, new_status: "info_requested", guest_message: `Question ${run}`, internal_note: `NOTE-INTERNE-${run}` });
    check("manager_requests_details", !de && (dec as { status: string })?.status === "ok", de?.message);
    const { data: after } = await guest.rpc("get_guest_stay", { token: tokenA as string });
    const txt = JSON.stringify(after);
    check("guest_sees_question_not_internal_note", txt.includes(`Question ${run}`) && !txt.includes(`NOTE-INTERNE-${run}`));
    const { data: bSvc } = await b.from("service_requests").select("id").eq("id", svc!.id);
    check("other_org_cannot_read_service", (bSvc ?? []).length === 0);

    // 6b. Incidents : problème signalé par le voyageur, invisible pour une autre organisation, résolu par l'équipe
    const { data: gp } = await guest.rpc("guest_report_problem", { token: tokenA as string, i_category: "breakdown", i_description: `Panne ${run}`, i_urgent: true });
    check("guest_reports_problem", (gp as { status: string })?.status === "ok");
    const { data: bInc } = await b.from("incidents").select("id");
    check("other_org_cannot_read_incidents", (bInc ?? []).length === 0);
    const { data: aInc } = await a1.from("incidents").select("id").eq("organization_id", orgA).eq("source", "guest").single();
    const { data: rs, error: rse } = await a1.rpc("resolve_incident", { org: orgA, incident: aInc!.id, i_resolution: `INTERNE-${run}`, i_guest_message: `Réparé ${run}` });
    const { data: gProblems } = await guest.rpc("guest_problems", { token: tokenA as string });
    const gpt = JSON.stringify(gProblems);
    check("guest_sees_resolution_not_internal_note", !rse && (rs as { status: string })?.status === "ok" && gpt.includes(`Réparé ${run}`) && !gpt.includes(`INTERNE-${run}`));

    // 6c. Notifications : chaque événement crée un envoi traçable ; l'équipe est prévenue des demandes et problèmes voyageur
    const { data: outA } = await admin.from("notification_outbox").select("template, status, last_error, recipient").eq("organization_id", orgA);
    const tpl = (name: string) => (outA ?? []).filter((o) => o.template === name);
    check("team_notified_of_guest_request", tpl("team_service_requested").length > 0 && tpl("team_service_requested").every((o) => o.status !== "sent" || !o.recipient.endsWith(".invalid")));
    check("team_notified_of_guest_problem", tpl("team_guest_problem").length > 0);
    check("team_notified_of_mission_to_validate", tpl("team_task_to_validate").length > 0);
    check("agent_notified_of_assignment", tpl("agent_task_assigned").length > 0);
    check("fictitious_addresses_never_sent", (outA ?? []).filter((o) => o.recipient.endsWith(".invalid")).every((o) => o.status === "failed" && o.last_error === "undeliverable_test_address"));
    if (guestEmail) {
      await processOutbox(orgA);
      const { data: sentRows } = await admin.from("notification_outbox").select("template, status, last_error").eq("organization_id", orgA).eq("recipient", guestEmail);
      const ok = (sentRows ?? []).length >= 3 && (sentRows ?? []).every((o) => o.status === "sent");
      check("guest_emails_really_sent", ok, (sentRows ?? []).map((o) => `${o.template}:${o.status}${o.last_error ? `(${o.last_error})` : ""}`).join(",").slice(0, 300));
    }

    // 6d. Messagerie interne liée à une mission : l'agent lit et répond, ni l'autre organisation ni le voyageur n'y accèdent
    const { data: th, error: the } = await a1.rpc("start_team_thread", { org: orgA, client: crypto.randomUUID(), recipients: [agentId], ctx_kind: "task", ctx_id: task!.id, body: `Consigne ${run}`, is_urgent: false });
    check("manager_writes_to_agent_about_mission", !the && Boolean((th as { thread?: string })?.thread), the?.message);
    const threadId = (th as { thread?: string } | null)?.thread ?? "";
    const { data: agMsgs } = await ag.from("team_messages").select("body").eq("thread_id", threadId);
    check("agent_reads_message", (agMsgs ?? []).some((m) => m.body === `Consigne ${run}`));
    const { error: rep } = await ag.rpc("post_team_message", { org: orgA, thread: threadId, client: crypto.randomUUID(), body: `Reçu ${run}`, is_urgent: false });
    const { data: mMsgs } = await a1.from("team_messages").select("body").eq("thread_id", threadId);
    check("manager_sees_agent_reply", !rep && (mMsgs ?? []).some((m) => m.body === `Reçu ${run}`), rep?.message);
    const [{ data: bMsgs }, { error: bPost }, { data: gMsgs, error: gErr }] = await Promise.all([
      b.from("team_messages").select("id").eq("thread_id", threadId),
      b.rpc("post_team_message", { org: orgA, thread: threadId, client: crypto.randomUUID(), body: "intrusion" }),
      guest.from("team_messages").select("id"),
    ]);
    check("other_org_cannot_read_or_write_conversation", (bMsgs ?? []).length === 0 && Boolean(bPost));
    check("guest_cannot_read_internal_messages", Boolean(gErr) || (gMsgs ?? []).length === 0);

    // 6e. Lieux autour du logement : uniquement ceux du logement du séjour
    await a1.from("properties").update({ latitude: 48.8606, longitude: 2.3376 }).eq("id", pA!.id);
    await a1.from("property_places").insert({ organization_id: orgA, property_id: pA!.id, source: "manager", category: "food", name: `Café ${run}`, latitude: 48.861, longitude: 2.338 });
    const { data: gp2 } = await guest.rpc("guest_places", { token: tokenA as string });
    const names = ((gp2 as { places?: { name: string; distance_m: number }[] } | null)?.places ?? []).map((x) => x.name);
    check("guest_sees_places_of_own_property", names.includes(`Café ${run}`));
    const { data: forgedPlaces } = await guest.rpc("guest_places", { token: "f".repeat(64) });
    check("forged_link_sees_no_places", (forgedPlaces as { status: string })?.status === "unavailable");

    // 6f. Fournisseur réel de lieux (OpenStreetMap) joignable depuis ce serveur
    const g = await geocode({ addressLine: "10 Rue de Rivoli", postalCode: "75004", city: "Paris", countryCode: "FR" });
    check("openstreetmap_geocoding_works", g.ok && Math.abs(g.lat - 48.855) < 0.02, g.ok ? `${g.lat},${g.lng}` : g.error);
    const near = await nearbyPlaces(48.8606, 2.3376);
    check("openstreetmap_places_work", near.ok && near.places.length > 0 && Boolean(near.dataDate), near.ok ? `${near.places.length} lieux via ${near.source}, données du ${near.dataDate}` : `${near.error} (${near.detail})`);

    // 7. Révocation
    const { data: links } = await a1.from("guest_links").select("id").eq("reservation_id", rA!.id).is("revoked_at", null);
    await a1.rpc("revoke_guest_link", { org: orgA, link: links![0].id });
    const { data: revoked } = await guest.rpc("get_guest_stay", { token: tokenA as string });
    check("revoked_link_refused", (revoked as { status: string })?.status === "unavailable");
  } catch (e) {
    check("run_completed", false, e instanceof Error ? e.message.slice(0, 200) : "error");
  } finally {
    // Nettoyage : rien de fictif ne reste en base
    let cleaned = true;
    const why: string[] = [];
    if (stored.length) {
      const { error } = await admin.storage.from("org-files").remove(stored);
      if (error) {
        cleaned = false;
        why.push(`storage: ${error.message}`);
      }
    }
    for (const id of orgs.filter(Boolean)) {
      const { error } = await admin.from("organizations").delete().eq("id", id);
      if (error) {
        cleaned = false;
        why.push(`org: ${error.message}`);
      }
    }
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        cleaned = false;
        why.push(`user: ${error.message}`);
      }
    }
    check("test_data_deleted", cleaned, why.join(" | ").slice(0, 300) || undefined);
  }
  return NextResponse.json({ ok: checks.every((c) => c.ok), run, at: new Date().toISOString(), checks });
}
