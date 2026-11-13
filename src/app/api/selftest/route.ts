import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, haloEnv, isConnected } from "@/lib/supabase/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/connected/outbox";
import { geocode, nearbyPlaces } from "@/lib/connected/osm";
import { pushConfigured, sendPush } from "@/lib/connected/push";
import { loadLinenOps } from "@/lib/connected/linen-data";
import { statusesOf, typesOf } from "@/lib/connected/mission-filters";

export const dynamic = "force-dynamic";
// Préproduction distante : ~150 appels séquentiels vers la base ; 60 s ne suffisaient plus (504 le 12/11). Limite Hobby + Fluid : 300 s.
export const maxDuration = 300;

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
      // Plage déjà ouverte : le ménage peut démarrer (règle ferme, migration 19)
      .insert({ organization_id: orgA, property_id: pA!.id, type: "turnover", status: "assigned", assignee_id: agentId, window_start: new Date(Date.now() - 3_600_000).toISOString(), window_end: outAt, duration_min: 60 })
      .select("id")
      .single();
    check("manager_assigns_mission", !tke && Boolean(task), tke?.message);
    await ag.rpc("start_task", { org: orgA, task: task!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    const { data: early } = await ag.rpc("finish_task", { org: orgA, task: task!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
    check("finish_refused_without_required_photo", early === "missing_photos" || early === "missing:photos", String(early));
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
    // 4e. Mission trop longue (migration 21) : réponse de l'agent affecté seulement, heure de fin proposée
    //     puis décidée par un responsable ; le statut et le temps ne changent pas automatiquement
    {
      const { data: ot } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: soon(-240), window_end: soon(240), duration_min: 30 }).select("id").single();
      await ag.rpc("start_task", { org: orgA, task: ot!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
      const { data: oc, error: oce } = await ag.rpc("task_overrun_continue", { org: orgA, task: ot!.id });
      check("overrun_continue_by_assigned_agent", !oce && oc === "applied", oce ? `${oce.code}:${oce.message}` : String(oc));
      const { error: ocB } = await b.rpc("task_overrun_continue", { org: orgA, task: ot!.id });
      check("overrun_continue_refused_other_org", Boolean(ocB));
      // Mission démarrée à l'instant : heure proposée = maintenant (marge d'horloge tolérée par la base)
      const { data: pr, error: pre } = await ag.rpc("propose_task_end", { org: orgA, task: ot!.id, ended_at: new Date(Date.now() + 20_000).toISOString(), note: null });
      const { error: selfDecide } = await ag.rpc("decide_task_end", { org: orgA, task: ot!.id, accept: true });
      const { data: dec } = await a1.rpc("decide_task_end", { org: orgA, task: ot!.id, accept: true });
      const { data: otRow } = await a1.from("tasks").select("status, end_proposal_status").eq("id", ot!.id).single();
      check("end_time_proposed_then_decided_by_manager", !pre && pr === "applied" && Boolean(selfDecide) && dec === "applied" && otRow?.status === "in_progress" && otRow?.end_proposal_status === "accepted", pre ? `${pre.code}:${pre.message}` : `${pr} ${dec} ${otRow?.status} ${otRow?.end_proposal_status}`);
    }
    // 4f. Mission oubliée (migration 23) : régularisation motivée par un responsable (jamais validée),
    //     réponse tardive de l'agent sans effet, annulation motivée d'une mission commencée
    {
      const mk = async () => {
        const { data } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: soon(-240), window_end: soon(240), duration_min: 30 }).select("id").single();
        await ag.rpc("start_task", { org: orgA, task: data!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
        return data!.id as string;
      };
      const rt = await mk();
      const endAt = new Date(Date.now() + 20_000).toISOString();
      const { error: rNoWhy } = await a1.rpc("regularize_task_end", { org: orgA, task: rt, ended_at: endAt, reason: " " });
      const { error: rAgent } = await ag.rpc("regularize_task_end", { org: orgA, task: rt, ended_at: endAt, reason: "selftest" });
      const { error: rOther } = await b.rpc("regularize_task_end", { org: orgA, task: rt, ended_at: endAt, reason: "selftest" });
      const { data: rg, error: rge } = await a1.rpc("regularize_task_end", { org: orgA, task: rt, ended_at: endAt, reason: `Selftest ${run} (fictif)` });
      const { data: rRow } = await a1.from("tasks").select("status, validated_at, regularized_reason").eq("id", rt).single();
      const { data: rEv } = await a1.from("task_events").select("kind, note").eq("task_id", rt).eq("kind", "end_regularized");
      check(
        "manager_regularizes_forgotten_mission",
        !rge && rg === "applied" && rNoWhy?.code === "22023" && Boolean(rAgent) && Boolean(rOther) && rRow?.status === "done" && rRow?.validated_at === null && (rEv ?? []).length === 1,
        rge ? (rge.code === "PGRST202" ? "migration 23 absente" : `${rge.code}:${rge.message}`) : `${rg} ${rNoWhy?.code} ${rRow?.status} ${(rEv ?? []).length}`,
      );
      const { data: lateC } = await ag.rpc("task_overrun_continue", { org: orgA, task: rt });
      const { data: lateP } = await ag.rpc("propose_task_end", { org: orgA, task: rt, ended_at: new Date().toISOString(), note: null });
      check("late_answer_ignored_after_regularization", lateC === "stale" && lateP === "stale", `${lateC} ${lateP}`);
      const ct = await mk();
      const { error: cNoWhy } = await a1.rpc("cancel_task", { org: orgA, task: ct, reason: null });
      const { data: cc, error: cce } = await a1.rpc("cancel_task", { org: orgA, task: ct, reason: `Selftest ${run} (fictif)` });
      const { data: cRow } = await a1.from("tasks").select("status, cancel_reason").eq("id", ct).single();
      check("manager_cancels_started_mission_with_reason", !cce && cc === "applied" && cNoWhy?.code === "22023" && cRow?.status === "cancelled", cce ? (cce.code === "PGRST202" ? "migration 23 absente" : `${cce.code}:${cce.message}`) : `${cc} ${cNoWhy?.code} ${cRow?.status}`);
      // 4g. Migration 33 : rappel de dépassement préparé par le serveur (une seule fois, rien après annulation),
      //     réattribution motivée d'une mission commencée
      if (admin) {
        const ot = await mk();
        await admin.from("tasks").update({ started_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq("id", ot);
        const { error: swe } = await admin.rpc("overrun_sweep");
        if (swe) {
          check("overrun_reminder_prepared_once", false, swe.code === "PGRST202" ? "migration 33 absente" : `${swe.code}:${swe.message}`);
          // L'agent ne peut avoir qu'une mission en cours : on libère avant la suite
          await a1.rpc("cancel_task", { org: orgA, task: ot, reason: `Selftest ${run} (fictif)` });
        }
        else {
          await admin.rpc("overrun_sweep");
          const tpls = async () => ((await admin.from("notification_outbox").select("template").eq("organization_id", orgA).eq("payload->>path", `/app/missions/${ot}`).in("template", ["agent_task_overrun", "team_task_overrun"])).data ?? []).map((r) => r.template as string).sort().join(",");
          const first = await tpls();
          await a1.rpc("cancel_task", { org: orgA, task: ot, reason: `Selftest ${run} (fictif)` });
          await admin.from("tasks").update({ overrun_reminded_at: null, overrun_alerted_at: null }).eq("id", ot);
          await admin.rpc("overrun_sweep");
          const after = await tpls();
          check("overrun_reminder_prepared_once", first === "agent_task_overrun,team_task_overrun" && after === first, `${first} → ${after}`);
        }
        const rt2 = await mk();
        const managerId = (await a1.auth.getUser()).data.user!.id;
        const { error: noWhy } = await a1.rpc("reassign_started_task", { org: orgA, task: rt2, member: managerId, reason: " " });
        const { error: byAgent } = await ag.rpc("reassign_started_task", { org: orgA, task: rt2, member: managerId, reason: "selftest" });
        const { data: ra, error: rae } = await a1.rpc("reassign_started_task", { org: orgA, task: rt2, member: managerId, reason: `Selftest ${run} (fictif)` });
        const { data: raRow } = await a1.from("tasks").select("status, assignee_id, started_at").eq("id", rt2).single();
        const { data: lateAg } = await ag.rpc("task_overrun_continue", { org: orgA, task: rt2 });
        check(
          "manager_reassigns_started_mission",
          !rae && Boolean(noWhy) && Boolean(byAgent) && raRow?.status === "assigned" && raRow?.assignee_id === managerId && raRow?.started_at === null && lateAg !== "applied",
          rae ? (rae.code === "PGRST202" ? "migration 33 absente" : `${rae.code}:${rae.message}`) : `${JSON.stringify(ra)} ${raRow?.status} ${String(lateAg)}`,
        );
        await a1.rpc("cancel_task", { org: orgA, task: rt2, reason: `Selftest ${run} (fictif)` });
      }
    }
    // 4d. Règles de mission (migration 19) : ménage impossible avant sa plage, même par appel direct ;
    //     livraison de linge avant l'heure conseillée = confirmation demandée
    {
      const { data: ft } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "turnover", status: "assigned", assignee_id: agentId, window_start: inAt, window_end: outAt, duration_min: 60 }).select("id").single();
      const { data: st1, error: se1 } = await ag.rpc("start_task", { org: orgA, task: ft!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString(), early_ack: true });
      const { data: ftRow } = await a1.from("tasks").select("status").eq("id", ft!.id).single();
      check("firm_start_refused_before_window", !se1 && String(st1).startsWith("too_early:") && ftRow?.status === "assigned", se1 ? `${se1.code}:${se1.message}` : `${st1} ${ftRow?.status}`);
      const { data: lt } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "linen_delivery", status: "assigned", assignee_id: agentId, window_start: inAt, window_end: outAt, duration_min: 20 }).select("id").single();
      const { data: st2, error: se2 } = await ag.rpc("start_task", { org: orgA, task: lt!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
      check("recommended_start_needs_confirmation", !se2 && String(st2).startsWith("early_confirm:"), se2 ? `${se2.code}:${se2.message}` : String(st2));
    }
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

    // 6d bis. Notifications push (migration 28) — appareils SIMULÉS (adresses injoignables) pour l'agent et le responsable,
    // puis les 5 événements prioritaires réellement déclenchés. Prouve : événement → notification préparée → push tenté,
    // journalisé, jamais « accepté » ; préférence coupée respectée ; appareils invisibles pour l'autre organisation.
    // Ne prouve PAS la réception sur un téléphone (impossible ici).
    {
      const subA = await ag.rpc("push_subscribe", { ep: `https://push.halo.invalid/ag-${run}`, key_p256dh: "B".repeat(87), key_auth: "A".repeat(22), device: "selftest agent" });
      const subM = await a1.rpc("push_subscribe", { ep: `https://push.halo.invalid/m-${run}`, key_p256dh: "B".repeat(87), key_auth: "A".repeat(22), device: "selftest manager" });
      if (subA.error || subM.error) check("push_events_reach_push_pipeline", false, subA.error?.code === "PGRST202" ? "migration 28 absente" : `${subA.error?.message ?? ""} ${subM.error?.message ?? ""}`);
      else {
        const since = new Date().toISOString();
        // 1) mission assignée, 2) modifiée
        const { data: pt } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: soon(-30), window_end: soon(240), duration_min: 30 }).select("id").single();
        await a1.from("tasks").update({ window_end: soon(300) }).eq("id", pt!.id);
        // 3) correction demandée (mission terminée puis renvoyée)
        await ag.rpc("start_task", { org: orgA, task: pt!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
        await ag.rpc("finish_task", { org: orgA, task: pt!.id, action_id: crypto.randomUUID(), client_at: new Date().toISOString() });
        const { error: ce } = await a1.rpc("request_correction", { org: orgA, task: pt!.id, reason: `Correction ${run}`, redo_items: null });
        // 4) message urgent de l'agent au responsable
        await ag.rpc("post_team_message", { org: orgA, thread: threadId, client: crypto.randomUUID(), body: `Urgent ${run}`, is_urgent: true });
        // 5) incident et demande voyageur
        await guest.rpc("guest_report_problem", { token: tokenA as string, i_category: "breakdown", i_description: `Panne push ${run}`, i_urgent: true });
        await guest.rpc("guest_request_service", { token: tokenA as string, s_kind: "other", s_start_at: outAt, s_people: 1, s_details: `Demande push ${run}` });
        // La file traite 20 notifications par passage : on la vide entièrement
        for (let i = 0; i < 10 && ((await processOutbox(orgA)).processed ?? 0) > 0; i++);
        const { data: dl } = await admin.from("push_deliveries").select("category, status, user_id").eq("organization_id", orgA).gte("created_at", since);
        const cats = [...new Set((dl ?? []).map((d) => d.category))].sort();
        const want = ["correction", "guest_request", "incident", "mission", "urgent_message"];
        check("push_events_reach_push_pipeline", want.every((c) => cats.includes(c)) && (dl ?? []).every((d) => d.status !== "accepted"), `${cats.join(",")} · ${[...new Set((dl ?? []).map((d) => d.status))].join(",")} · ${pushConfigured() ? "clés configurées" : "clés absentes"}${ce ? ` · correction:${ce.message}` : ""}`);
        // Préférence push coupée par l'agent : plus de push pour cet événement (l'e-mail suit son propre réglage)
        await ag.rpc("set_push_pref", { org: orgA, ev: "agent_task_assigned", by_push: false });
        const before = new Date().toISOString();
        await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: soon(60), window_end: soon(240), duration_min: 30 });
        for (let i = 0; i < 10 && ((await processOutbox(orgA)).processed ?? 0) > 0; i++);
        const { data: dl2 } = await admin.from("push_deliveries").select("id").eq("user_id", agentId).eq("category", "mission").gte("created_at", before);
        const { data: bSubs } = await b.from("push_subscriptions").select("id");
        check("push_preference_off_respected_and_devices_private", (dl2 ?? []).length === 0 && (bSubs ?? []).length === 0, `${(dl2 ?? []).length} push après refus`);
        await ag.rpc("push_unsubscribe", { ep: `https://push.halo.invalid/ag-${run}` });
        await a1.rpc("push_unsubscribe", { ep: `https://push.halo.invalid/m-${run}` });
      }
    }

    // 6e. Lieux autour du logement : uniquement ceux du logement du séjour
    await a1.from("properties").update({ latitude: 48.8606, longitude: 2.3376 }).eq("id", pA!.id);
    await a1.from("property_places").insert({ organization_id: orgA, property_id: pA!.id, source: "manager", category: "food", name: `Café ${run}`, latitude: 48.861, longitude: 2.338 });
    const { data: gp2 } = await guest.rpc("guest_places", { token: tokenA as string });
    const names = ((gp2 as { places?: { name: string; distance_m: number }[] } | null)?.places ?? []).map((x) => x.name);
    check("guest_sees_places_of_own_property", names.includes(`Café ${run}`));
    const { data: forgedPlaces } = await guest.rpc("guest_places", { token: "f".repeat(64) });
    check("forged_link_sees_no_places", (forgedPlaces as { status: string })?.status === "unavailable");
    // 6f. Linge opérationnel (migration 26) — parcours complet sur données isolées (organisation de test) :
    // article → kit → stock + mouvement → besoin d'un séjour confirmé → manque → filtre « missions linge sans agent »,
    // et cas de données manquantes (aucun « prêt » sans kit ni stock connus). Droits : agent et autre organisation.
    {
      const { data: li, error: lie } = await a1.from("linen_items").insert({ organization_id: orgA, label: `Drap ${run}`, unit: "pièce" }).select("id").single();
      if (lie) check("linen_stock_by_movements", false, lie.code === "PGRST205" || lie.code === "42P01" ? "migration 26 absente" : `${lie.code}:${lie.message}`);
      else {
        const { data: pL } = await a1.from("properties").insert({ organization_id: orgA, name: `Linge ${run}` }).select("id").single();
        const { data: pU } = await a1.from("properties").insert({ organization_id: orgA, name: `Sans kit ${run}` }).select("id").single();
        const { error: ke } = await a1.from("property_linen_kits").insert({ organization_id: orgA, property_id: pL!.id, item_id: li!.id, qty: 4 });
        await a1.rpc("linen_count", { org: orgA, item: li!.id, loc: "clean", counted: 10, note: "selftest" });
        const { error: over } = await a1.rpc("linen_move", { org: orgA, item: li!.id, from_loc: "clean", to_loc: "laundry", qty: 50, kind: "to_laundry", note: null, property: null, task: null });
        await a1.rpc("linen_move", { org: orgA, item: li!.id, from_loc: "clean", to_loc: "laundry", qty: 4, kind: "to_laundry", note: null, property: null, task: null });
        const { data: st } = await a1.rpc("linen_stock", { org: orgA });
        const mine = ((st ?? []) as { item_id: string; location: string; qty: number }[]).filter((r) => r.item_id === li!.id).map((r) => `${r.location}=${r.qty}`).sort().join(",");
        check("linen_stock_by_movements", !ke && mine === "clean=6,laundry=4" && Boolean(over), `${ke?.code ?? "kit ok"} ${mine}`);
        // Besoins : deux arrivées confirmées dans le logement à kit (2 × 4 = 8 > 6 propres) → manque daté ;
        // une arrivée dans le logement sans kit → besoin inconnu, jamais « prêt »
        await a1.from("reservations").insert([
          { organization_id: orgA, property_id: pL!.id, guest_name: "Linge 1", check_in_at: soon(60 * 24 * 2), check_out_at: soon(60 * 24 * 3) },
          { organization_id: orgA, property_id: pL!.id, guest_name: "Linge 2", check_in_at: soon(60 * 24 * 4), check_out_at: soon(60 * 24 * 5) },
          { organization_id: orgA, property_id: pU!.id, guest_name: "Sans kit", check_in_at: soon(60 * 24 * 2), check_out_at: soon(60 * 24 * 3) },
        ]);
        const ops = await loadLinenOps(a1, orgA, new Date());
        const plan = ops.available ? ops.plan : null;
        const need = plan?.needs.find((n) => n.itemId === li!.id);
        const kinds = (plan?.alerts ?? []).map((a) => `${a.kind}${"propertyId" in a && a.propertyId === pU!.id ? ":sans-kit" : ""}`);
        check("linen_needs_and_shortage_for_confirmed_stays", need?.need === 8 && kinds.includes("shortage") && kinds.includes("no_kit:sans-kit") && plan?.complete === false, `besoin ${need?.need} · alertes ${[...new Set(kinds)].join(",")} · complet ${plan?.complete}`);
        // Filtre « missions linge sans agent » : même requête que l'écran Missions (type=linen, status=unassigned)
        const w = { organization_id: orgA, property_id: pL!.id, is_auto_generated: false, status: "unassigned", window_start: soon(60), window_end: soon(60 * 30), duration_min: 30 };
        await a1.from("tasks").insert([{ ...w, type: "linen_delivery", title: `L ${run}` }, { ...w, type: "turnover", title: `M ${run}` }]);
        const { data: filtered } = await a1.from("tasks").select("title, type").eq("organization_id", orgA).in("type", typesOf("linen")).in("status", statusesOf("unassigned")!).like("title", `% ${run}`);
        check("linen_unassigned_filter_shows_only_linen", (filtered ?? []).map((x) => x.title).join(",") === `L ${run}`, JSON.stringify(filtered));
        const { data: agItems } = await ag.from("linen_items").select("id").eq("organization_id", orgA);
        const { error: agCount } = await ag.rpc("linen_count", { org: orgA, item: li!.id, loc: "clean", counted: 99, note: null });
        check("agent_cannot_read_or_change_linen", (agItems ?? []).length === 0 && Boolean(agCount));
        const { data: bItems } = await b.from("linen_items").select("id").eq("organization_id", orgA);
        const { data: bKits } = await b.from("property_linen_kits").select("item_id").eq("organization_id", orgA);
        const { error: bMove } = await b.rpc("linen_move", { org: orgA, item: li!.id, from_loc: "clean", to_loc: null, qty: 1, kind: "loss", note: null, property: null, task: null });
        check("other_org_cannot_read_or_change_linen", (bItems ?? []).length === 0 && (bKits ?? []).length === 0 && Boolean(bMove));
      }
    }
    // 6f bis. Inventaire concurrent (migration 31) et blanchisseur externe (migration 32) : deux conciergeries (A, B),
    // deux blanchisseurs (lavA invité par A, lavB invité par B) — comptes fictifs créés puis supprimés.
    {
      const { data: it, error: ie } = await a1.from("linen_items").insert({ organization_id: orgA, label: `Housse ${run}` }).select("id").single();
      if (ie) check("linen_count_never_overwrites_concurrent_change", false, "migration 26 absente");
      else {
        await a1.rpc("linen_count", { org: orgA, item: it!.id, loc: "dirty", counted: 10, note: null });
        await a1.rpc("linen_move", { org: orgA, item: it!.id, from_loc: "dirty", to_loc: null, qty: 2, kind: "loss", note: null, property: null, task: null });
        const { data: stale, error: se } = await a1.rpc("linen_count", { org: orgA, item: it!.id, loc: "dirty", counted: 15, note: null, expected: 10 });
        check("linen_count_never_overwrites_concurrent_change", !se && (stale as { status: string; current: number })?.status === "stale" && (stale as { current: number }).current === 8, se ? (se.code === "PGRST202" ? "migration 31 absente" : se.message) : JSON.stringify(stale));
        const { data: pa, error: pe } = await a1.rpc("laundry_partner_save", { org: orgA, partner: null, p_name: `Lav A ${run}`, p_contact: null, p_email: null, p_active: true });
        if (pe) check("laundry_partner_sees_only_own_orders", false, pe.code === "PGRST202" ? "migration 32 absente" : pe.message);
        else {
          const { data: pb } = await b.rpc("laundry_partner_save", { org: orgB, partner: null, p_name: `Lav B ${run}`, p_contact: null, p_email: null, p_active: true });
          const lavAEmail = `selftest-${run}-lav-a@halo.invalid`;
          const lavBEmail = `selftest-${run}-lav-b@halo.invalid`;
          const { data: tA } = await a1.rpc("laundry_invite", { org: orgA, partner: pa, p_contact: "Lav A", p_email: lavAEmail });
          const { data: tB } = await b.rpc("laundry_invite", { org: orgB, partner: pb, p_contact: "Lav B", p_email: lavBEmail });
          const lavA = await session(admin, lavAEmail, users);
          const lavB = await session(admin, lavBEmail, users);
          const { data: wrong } = await lavB.rpc("laundry_accept_invite", { raw_token: tA });
          await lavA.rpc("laundry_accept_invite", { raw_token: tA });
          await lavB.rpc("laundry_accept_invite", { raw_token: tB });
          check("laundry_invitation_is_nominative", (wrong as { status: string })?.status === "wrong_account", JSON.stringify(wrong));
          const { data: itB } = await b.from("linen_items").insert({ organization_id: orgB, label: `Drap B ${run}` }).select("id").single();
          await b.rpc("linen_count", { org: orgB, item: itB!.id, loc: "dirty", counted: 3, note: null });
          const back = new Date(Date.now() + 2 * 86_400_000).toISOString();
          const { data: oA } = await a1.rpc("laundry_order_create", { org: orgA, partner: pa, lines: [{ item: it!.id, qty: 6 }], back_at: back, p_note: null });
          const { data: oB } = await b.rpc("laundry_order_create", { org: orgB, partner: pb, lines: [{ item: itB!.id, qty: 3 }], back_at: back, p_note: null });
          const idA = (oA as { id: string }).id;
          const { data: seenA } = await lavA.rpc("laundry_my_orders");
          const { data: seenB } = await lavB.rpc("laundry_my_orders");
          const { error: cross } = await lavB.rpc("laundry_order_advance", { oid: idA, to_status: "received", lines: [{ item: it!.id, qty: 6 }], p_note: null });
          const { data: agOrders } = await ag.from("laundry_orders").select("id");
          const { data: bOrders } = await b.from("laundry_orders").select("id").eq("organization_id", orgA);
          const { data: lavTables } = await lavA.from("properties").select("id");
          const ids = (x: unknown) => ((x ?? []) as { id: string }[]).map((o) => o.id);
          check(
            "laundry_partner_sees_only_own_orders",
            ids(seenA).join() === idA && ids(seenB).join() === (oB as { id: string }).id && Boolean(cross) && (agOrders ?? []).length === 0 && (bOrders ?? []).length === 0 && (lavTables ?? []).length === 0,
            `A:${ids(seenA).length} B:${ids(seenB).length} croisé:${cross?.code ?? "accepté"}`,
          );
          // Étapes + écart + réception constatée → stock
          await lavA.rpc("laundry_order_advance", { oid: idA, to_status: "received", lines: [{ item: it!.id, qty: 5 }], p_note: null });
          for (const st of ["processing", "ready"]) await lavA.rpc("laundry_order_advance", { oid: idA, to_status: st, lines: null, p_note: null });
          await lavA.rpc("laundry_order_advance", { oid: idA, to_status: "out_for_delivery", lines: [{ item: it!.id, qty: 5 }], p_note: null });
          const { data: conf } = await a1.rpc("laundry_order_confirm", { org: orgA, oid: idA, lines: [{ item: it!.id, qty: 5 }], p_note: null });
          const { data: stk } = await a1.rpc("linen_stock", { org: orgA });
          const mine = ((stk ?? []) as { item_id: string; location: string; qty: number }[]).filter((r) => r.item_id === it!.id).map((r) => `${r.location}=${r.qty}`).sort().join(",");
          const { data: ev } = await a1.from("laundry_order_events").select("kind").eq("order_id", idA);
          check("laundry_order_steps_gap_and_stock", mine === "clean=5,dirty=2,laundry=1" && ((conf as { gaps: unknown[] })?.gaps ?? []).length === 1 && (ev ?? []).filter((e) => e.kind === "discrepancy").length >= 2, `${mine} · ${(ev ?? []).map((e) => e.kind).join(",")}`);
        }
      }
    }
    // 6g. Alentours avant l'arrivée (migration 25) : ni adresse ni coordonnées du logement transmises
    {
      const { data: zr } = await a1.from("reservations").insert({ organization_id: orgA, property_id: pA!.id, guest_name: `Zone ${run}`, check_in_at: soon(60 * 24 * 30), check_out_at: soon(60 * 24 * 33) }).select("id").single();
      const { data: zt } = zr ? await a1.rpc("create_guest_link", { org: orgA, reservation: zr.id }) : { data: null };
      const { data: zp } = zt ? await guest.rpc("guest_places", { token: zt as string }) : { data: null };
      const z = zp as { full?: boolean; zone?: { lat: number } | null; property?: { lat: unknown; address: unknown } } | null;
      const raw = JSON.stringify(zp ?? {});
      check("guest_zone_before_arrival_hides_property", z?.full === false && z.property?.lat == null && z.property?.address == null && !raw.includes("48.8606") && !raw.includes("2.3376"), z?.zone ? "zone" : "sans zone (migration 25 absente ?)");
      // 6g bis. Recommandations avant l'arrivée (migration 27) : choix de l'équipe, texte qui situe le logement masqué, aucun point sur la carte
      if (zt) {
        const { error: ve } = await a1.from("property_places").insert([
          { organization_id: orgA, property_id: pA!.id, source: "manager", category: "activities", name: `Visible ${run}`, address: "1 place publique", latitude: 48.8680, longitude: 2.3376, description: "à 5 min à pied du logement", note: "Gratuit le dimanche", guest_visibility: "booking" },
          { organization_id: orgA, property_id: pA!.id, source: "manager", category: "food", name: `Arrivée ${run}`, address: "2 place publique", latitude: 48.8680, longitude: 2.3380, guest_visibility: "access" },
        ]);
        if (ve) check("guest_recommendations_before_arrival_follow_team_choice", false, ve.code === "PGRST204" || ve.code === "42703" ? "migration 27 absente" : `${ve.code}:${ve.message}`);
        else {
          const { data: vp } = await guest.rpc("guest_places", { token: zt as string });
          const list = ((vp as { places?: { name: string; description: string | null; note: string | null; lat: number | null }[] } | null)?.places ?? []).filter((x) => x.name.endsWith(run));
          const v = list.find((x) => x.name === `Visible ${run}`);
          check("guest_recommendations_before_arrival_follow_team_choice", list.length === 1 && !!v && v.description == null && v.note === "Gratuit le dimanche" && v.lat == null, JSON.stringify(list.map((x) => x.name)));
        }
      }
    }
    // 6e bis. Favoris du voyageur (migration 22) : liés au séjour, refusés avec un lien inventé
    {
      const { data: pl } = await a1.from("property_places").select("id").eq("property_id", pA!.id).eq("name", `Café ${run}`).single();
      const { data: fav, error: fe } = await guest.rpc("guest_place_favorite", { token: tokenA as string, place: pl!.id, fav: true });
      const { data: gp3 } = await guest.rpc("guest_places", { token: tokenA as string });
      const { data: forgedFav } = await guest.rpc("guest_place_favorite", { token: "f".repeat(64), place: pl!.id, fav: true });
      check("guest_favorite_saved_with_stay", !fe && (fav as { status: string })?.status === "ok" && ((gp3 as { favorites?: string[] })?.favorites ?? []).includes(pl!.id), fe ? `${fe.code}:${fe.message}` : JSON.stringify(fav));
      check("forged_link_cannot_add_favorite", (forgedFav as { status: string } | null)?.status === "unavailable");
    }

    // 6f. Fournisseur réel de lieux (OpenStreetMap) joignable depuis ce serveur
    const g = await geocode({ addressLine: "10 Rue de Rivoli", postalCode: "75004", city: "Paris", countryCode: "FR" });
    check("openstreetmap_geocoding_works", g.ok && Math.abs(g.lat - 48.855) < 0.02, g.ok ? `${g.lat},${g.lng}` : g.error);
    const near = await nearbyPlaces(48.8606, 2.3376);
    // Overpass public refuse les serveurs d'hébergement (406) : l'import passe alors par le navigateur du responsable.
    // Ce contrôle vérifie que le serveur obtient des lieux (Geoapify configuré) OU que le refus est bien celui attendu.
    const blocked = !near.ok && !process.env.GEOAPIFY_API_KEY && /overpass-api\.de:406/.test(near.detail ?? "");
    // Détail complet (Photon puis Overpass) pour savoir quelle source a répondu ou échoué
    check("places_provider_server_side", near.ok || blocked, near.ok ? `${near.places.length} lieux via ${near.source}` : `${blocked ? "refus Overpass (406) ; import par le navigateur du responsable" : near.error} — essais : ${near.detail}`);

    // 7. Révocation
    const { data: links } = await a1.from("guest_links").select("id").eq("reservation_id", rA!.id).is("revoked_at", null);
    await a1.rpc("revoke_guest_link", { org: orgA, link: links![0].id });
    const { data: revoked } = await guest.rpc("get_guest_stay", { token: tokenA as string });
    check("revoked_link_refused", (revoked as { status: string })?.status === "unavailable");

    // 8. Réservation directe (migration 14) : lien dédié, demande, cloisonnement, aucune confirmation sans acceptation
    const { data: bTok, error: bte } = await a1.rpc("create_booking_link", { org: orgA, reservation: rA!.id });
    check("manager_creates_booking_link", !bte && typeof bTok === "string", bte?.message);
    if (typeof bTok === "string") {
      const d0 = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
      const d1 = new Date(Date.now() + 203 * 86_400_000).toISOString().slice(0, 10);
      const sub = { token: bTok, client: crypto.randomUUID(), d_in: d0, d_out: d1, n_adults: 2, n_children: 0, n_babies: 0, c_name: "Voyageur A", c_email: `selftest-${run}-guest@halo.invalid`, c_phone: null, msg: null };
      const { data: bs } = await guest.rpc("booking_submit", sub);
      const { data: bs2 } = await guest.rpc("booking_submit", sub);
      const reqId = (bs as { id?: string } | null)?.id;
      check("guest_sends_booking_request_once", (bs as { status: string })?.status === "ok" && (bs2 as { replayed?: boolean })?.replayed === true && (bs2 as { id?: string })?.id === reqId);
      const { data: bOther } = await b.from("booking_requests").select("id").eq("id", reqId ?? "");
      const { error: bDecide } = await b.rpc("booking_decide", { org: orgA, request: reqId, act: "decline" });
      check("other_org_cannot_read_or_decide_booking", (bOther ?? []).length === 0 && Boolean(bDecide));
      const { data: early } = await a1.rpc("booking_confirm", { org: orgA, request: reqId, ack_calendars: true });
      check("booking_not_confirmed_without_acceptance", (early as { status: string })?.status === "not_accepted");
    }
    // 9. Arrivée anticipée sur la vraie base : action indispensable liée à une mission de préparation non attribuée
    //    (configuration du retest du 2/11), puis confirmation explicite. Le détail renvoie l'erreur réelle éventuelle.
    {
      const day = (h: number, m = 0) => {
        const d = new Date(Date.now() + 300 * 86_400_000);
        d.setUTCHours(h, m, 0, 0);
        return d.toISOString();
      };
      const { data: rT } = await a1.from("reservations").insert({ organization_id: orgA, property_id: pA!.id, guest_name: "Voyageur horaire", check_in_at: day(15), check_out_at: new Date(Date.parse(day(10)) + 3 * 86_400_000).toISOString() }).select("id").single();
      const { data: prepTask } = await a1.from("tasks").insert({ organization_id: orgA, property_id: pA!.id, next_reservation_id: rT!.id, type: "other", title: "Préparation (selftest)", is_auto_generated: false, window_start: day(13, 30), window_end: day(15), duration_min: 60 }).select("id").single();
      await a1.from("stay_prep_actions").insert({ organization_id: orgA, reservation_id: rT!.id, title: "Préparer (selftest)", kind: "task", blocking: true, due_at: day(15), task_id: prepTask?.id ?? null });
      const { data: tT } = await a1.rpc("create_guest_link", { org: orgA, reservation: rT!.id });
      const { data: sv } = await guest.rpc("guest_request_service", { token: tT as string, s_kind: "early_checkin", s_start_at: day(12), s_people: 1, s_details: null });
      const svId = (sv as { id?: string } | null)?.id;
      const { data: chk, error: ce } = await a1.rpc("timing_check", { org: orgA, service: svId });
      const cj = chk as { risks?: string[]; blocking?: string[] } | null;
      check("timing_check_lists_constraints", !ce && Array.isArray(cj?.risks), ce ? `${ce.code}:${ce.message}` : `risques ${JSON.stringify(cj?.risks)} blocages ${JSON.stringify(cj?.blocking)}`);
      const { data: dec, error: de2 } = await a1.rpc("timing_decide", { org: orgA, service: svId, act: "confirm", ack: true, expected_at: day(15) });
      const st = (dec as { status?: string } | null)?.status;
      check("timing_decide_with_prep_mission", !de2 && (st === "applied" || st === "not_feasible"), de2 ? `${de2.code}:${de2.message}` : `${st}`);
      // 10. Horaires successifs (migration 18) : une seconde confirmation remplace la première, sans fausse alerte
      if (st === "applied") {
        const { data: sv2 } = await guest.rpc("guest_request_service", { token: tT as string, s_kind: "early_checkin", s_start_at: day(11), s_people: 1, s_details: null });
        const sv2Id = (sv2 as { id?: string } | null)?.id;
        const { data: dec2, error: de3 } = await a1.rpc("timing_decide", { org: orgA, service: sv2Id, act: "confirm", ack: true, expected_at: day(12) });
        const { data: states, error: se } = await a1.rpc("timing_states", { org: orgA, reservation: rT!.id });
        const stOf = (id?: string) => ((states as { service: string; state: string }[] | null) ?? []).find((x) => x.service === id)?.state;
        const { data: inc } = await a1.rpc("timing_inconsistencies", { org: orgA });
        const falseAlert = ((inc as { reservation: string }[] | null) ?? []).some((x) => x.reservation === rT!.id);
        check("timing_successive_superseded", !de3 && !se && (dec2 as { status?: string } | null)?.status === "applied" && stOf(svId) === "superseded" && stOf(sv2Id) === "applied" && !falseAlert,
          de3 ? `${de3.code}:${de3.message}` : se ? `${se.code}:${se.message}` : `${(dec2 as { status?: string } | null)?.status} ${stOf(svId)}/${stOf(sv2Id)} alerte:${falseAlert}`);
      }
    }
    const { data: bReviews } = await b.from("reviews").select("id").eq("organization_id", orgA);
    check("other_org_cannot_read_reviews", (bReviews ?? []).length === 0);
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
