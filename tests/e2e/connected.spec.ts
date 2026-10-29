/**
 * Parcours CONNECTÉ de bout en bout, sur la préproduction locale (vraie base Postgres, vrai service
 * d'authentification, vraie API), avec des données fictives uniquement.
 *   node scripts/local-stack/stack.mjs start   puis   HALO_E2E_CONNECTED=1 npx playwright test connected
 * Couvre les 10 vérifications demandées : organisation, onboarding et reprise, logement et séjour,
 * accès voyageur limité, prestation, acceptation / refus / précisions, notifications et historique,
 * tentatives d'accès croisées, expiration et révocation, persistance après reconnexion et sur un autre appareil.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";

test.skip(!process.env.HALO_E2E_CONNECTED, "préproduction locale non démarrée");
test.describe.configure({ mode: "serial" });

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const run = Date.now().toString(36);
const managerA = `manager-a-${run}@halo.test`;
const managerB = `manager-b-${run}@halo.test`;
const agentA = `agent-a-${run}@halo.test`;
const guestEmail = `guest-${run}@halo.test`;
const s: Record<string, string> = {};

async function mailsFor(email: string) {
  return readdirSync(".local-stack/mails")
    .filter((f) => f.includes(email))
    .sort()
    .map((f) => JSON.parse(readFileSync(`.local-stack/mails/${f}`, "utf8")) as { subject: string; html?: string; text?: string });
}

async function signIn(page: Page, email: string, next = "") {
  await page.goto(`/fr/auth/sign-in${next}`);
  await expect(page.getByTestId("env-badge")).toHaveAttribute("data-env", "preprod-local");
  const before = (await mailsFor(email)).length;
  await page.getByLabel("Adresse e-mail professionnelle").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await expect(page.getByLabel("Code à 6 chiffres")).toBeVisible();
  let code: string | undefined;
  await expect
    .poll(async () => {
      const m = await mailsFor(email);
      code = m.length > before ? m.at(-1)!.html?.match(/<strong>(\d{6})<\/strong>/)?.[1] : undefined;
      return code;
    })
    .toBeTruthy();
  await page.getByLabel("Code à 6 chiffres").fill(code!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/fr\/(app|invite)/);
  await page.waitForLoadState("networkidle");
}

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
  return ctx.newPage();
}

test.beforeEach(({}, info) => test.skip(info.project.name !== "ordinateur", "un seul jeu de données fictives par exécution"));

test("1-2 · organisation créée, onboarding passé, interrompu puis repris", async ({ page }) => {
  await signIn(page, managerA);
  await expect(page.getByRole("heading", { name: "Créez votre espace" })).toBeVisible();
  await page.getByLabel("Nom commercial").fill(`Conciergerie Test ${run}`);
  await page.getByRole("button", { name: "Créer et configurer" }).click();

  await expect(page.getByTestId("onb-title")).toHaveText("Vous");
  await expect(page.getByText(`Connecté avec ${managerA}`)).toBeVisible(); // pas redemandé
  await page.getByLabel("Prénom et nom").fill("Camille Test");
  await page.getByTestId("onb-next").click();
  await expect(page.getByTestId("onb-title")).toHaveText("Votre organisation");
  await page.getByTestId("onb-skip").click(); // les informations légales ne bloquent pas
  await expect(page.getByTestId("onb-title")).toHaveText("Votre activité");
  await page.getByTestId("activity-concierge").click();
  await page.getByLabel("Nombre de logements").fill("8");
  await page.getByTestId("onb-next").click();
  await expect(page.getByTestId("onb-title")).toHaveText("Votre organisation au quotidien");
  // Question adaptée : accueil pour une conciergerie, pas de contrôle de chambres d'hôtel
  await expect(page.getByText("Accueillez-vous les voyageurs")).toBeVisible();
  await expect(page.getByText("Les chambres sont-elles contrôlées")).toHaveCount(0);
  await page.getByTestId("onb-later").click();

  // Reprise : carte à l'accueil, retour à l'étape interrompue, réponses conservées
  await expect(page.getByTestId("onboarding-resume")).toBeVisible();
  await page.getByTestId("onboarding-resume").click();
  await expect(page.getByTestId("onb-title")).toHaveText("Votre organisation au quotidien");
  await page.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByLabel("Nombre de logements")).toHaveValue("8");
  await page.getByTestId("onb-next").click();

  await page.getByTestId("cleaning-providers").click();
  await page.getByTestId("linen-laundry").click();
  await page.getByTestId("validation-turnover").click();
  await page.getByTestId("welcome-yes").click();
  await page.getByTestId("onb-next").click();
  await page.getByTestId("service-private_chef").click();
  await page.getByTestId("service-airport_transfer").click();
  await page.getByTestId("onb-next").click();
  await expect(page.getByTestId("issue-room_not_ready")).toHaveCount(0);
  await page.getByTestId("issue-damage").click();
  await page.getByTestId("onb-next").click();
  await page.getByTestId("channel-airbnb").click();
  await page.getByTestId("onb-next").click();

  // Propositions : expliquées, rien n'est enregistré avant confirmation
  await expect(page.getByTestId("onb-title")).toHaveText("Configuration proposée");
  await expect(page.getByTestId("proposal-validation")).toContainText("valider les ménages");
  await expect(page.getByTestId("onb-confirm")).toBeDisabled();
  const { data: before } = await admin.from("organizations").select("default_checklist, onboarding").eq("name", `Conciergerie Test ${run}`).single();
  expect(before!.default_checklist).toEqual([]);
  expect(before!.onboarding.config).toBeUndefined();
  await page.getByTestId("accept-task_types").click();
  await page.getByTestId("accept-checklist").click();
  await page.getByTestId("accept-validation").click();
  await page.getByTestId("ignore-alerts").click();
  await page.getByTestId("modify-linen").click();
  await page.getByLabel("Jours de rotation").fill("4");
  await page.getByTestId("onb-confirm").click();
  await expect(page.getByTestId("config-saved")).toBeVisible();

  const { data: org } = await admin.from("organizations").select("id, validation_task_types, linen_turnaround_days, services_offered, onboarding, default_checklist, activity_type, unit_count").eq("name", `Conciergerie Test ${run}`).single();
  s.orgA = org!.id;
  expect(org!.validation_task_types).toEqual(["turnover"]);
  expect(org!.linen_turnaround_days).toBe(4);
  expect(org!.services_offered).toEqual(["private_chef", "airport_transfer"]);
  expect(org!.activity_type).toBe("concierge");
  expect(org!.unit_count).toBe(8);
  expect(org!.onboarding.skipped).toContain("organization");
  expect(org!.onboarding.config.task_types).toContain("check_in");
  expect(org!.onboarding.config.alerts).toBeUndefined(); // ignorée → rien d'enregistré
  expect(JSON.stringify(org!.default_checklist)).toContain("Aucun dégât constaté");
});

test("3-4 · logement, séjour, missions générées et lien voyageur", async ({ page }) => {
  await signIn(page, managerA);
  await page.goto("/fr/app/properties");
  await page.getByLabel("Nom", { exact: true }).fill("Loft Canal");
  await page.getByLabel("Ville").fill("Paris");
  await page.getByTestId("property-create").click();
  await expect(page.getByRole("heading", { name: "Loft Canal" })).toBeVisible();
  await expect(page.getByText("Aucun dégât constaté")).toBeVisible(); // checklist confirmée appliquée
  await page.getByLabel("Mot d'accueil").fill("Bienvenue au Loft !");
  await page.getByLabel("Règles du logement").fill("Pas de fête.");
  await page.getByTestId("guide-save").click();
  await expect(page.getByText("Livret enregistré.")).toBeVisible();

  await page.goto("/fr/app/stays");
  // Échec serveur lisible, aucune réussite simulée
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(16, 0, 0, 0);
  const out = new Date(tomorrow.getTime() + 3 * 86_400_000);
  out.setHours(11, 0, 0, 0);
  await page.getByLabel("Nom du voyageur").fill("Alex Martin");
  await page.getByLabel("E-mail du voyageur").fill(guestEmail);
  await page.getByLabel("Arrivée").fill(local(out));
  await page.getByLabel("Départ").fill(local(tomorrow));
  await page.getByTestId("stay-create").click();
  await expect(page.getByText("Le départ doit être après l'arrivée.")).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/app\/stays$/);

  await page.getByLabel("Arrivée").fill(local(tomorrow));
  await page.getByLabel("Départ").fill(local(out));
  await page.getByTestId("stay-create").click();
  await expect(page.getByRole("heading", { name: "Alex Martin" })).toBeVisible();
  await page.waitForURL(/\/fr\/app\/stays\/[0-9a-f-]{36}$/);
  s.stayA = page.url().split("/").pop()!;
  await expect(page.getByText(/Ménage ·/)).toBeVisible();
  await expect(page.getByText(/Arrivée ·/)).toBeVisible(); // catégorie « accueil » confirmée à l'onboarding

  await page.getByTestId("link-create").click();
  const url = await page.getByTestId("guest-link-url").inputValue();
  expect(url).toMatch(/\/fr\/s\/[0-9a-f]{64}$/);
  s.tokenA = url.split("/").pop()!;
  await expect(page.getByTestId("link-status")).toContainText("Actif");
});

test("5-7 · prestation, précisions, acceptation, refus, modification, messages et notifications", async ({ page, browser }) => {
  const guest = await newPage(browser);
  await guest.goto(`/fr/s/${s.tokenA}`);
  await expect(guest.getByTestId("guest-space")).toContainText("Loft Canal");
  await expect(guest.getByText("Bienvenue au Loft !")).toBeVisible();
  await expect(guest.getByText("Pas de fête.")).toBeVisible();
  const when = new Date(Date.now() + 2 * 86_400_000);
  when.setHours(20, 0, 0, 0);
  await guest.getByLabel("Prestation").selectOption("private_chef");
  await guest.getByLabel("Date et heure souhaitées").fill(local(when));
  await guest.getByLabel("Précisions").fill("Dîner pour 2");
  await guest.getByTestId("guest-request-send").click();
  await expect(guest.getByTestId("guest-request-ok")).toBeVisible();
  await expect(guest.getByTestId("guest-service").first()).toHaveAttribute("data-status", "requested");
  await expect(guest.getByTestId("guest-service").first()).toContainText("Reçue, en attente");
  await expect.poll(async () => (await mailsFor(guestEmail)).map((m) => m.subject).join("|")).toContain("demande reçue");

  // Manager : demande signalée, précisions demandées avec note interne
  await signIn(page, managerA);
  await expect(page.getByTestId("home-services")).toContainText("1 demande de prestation à traiter");
  await page.goto("/fr/app/services");
  await page.getByTestId("services-todo").getByTestId("service-row").first().click();
  await page.waitForURL(/\/fr\/app\/services\/[0-9a-f-]{36}$/);
  s.serviceA = page.url().split("/").pop()!;
  await page.getByTestId("decide-info_requested").click();
  await page.getByTestId("decide-message").fill("Des allergies ?");
  await page.getByTestId("decide-note").fill("Client VIP, prévoir chef Marc");
  await expect(page.getByTestId("decide-preview")).toContainText("Des allergies ?");
  await expect(page.getByTestId("decide-preview")).not.toContainText("chef Marc");
  await expect(page.getByTestId("decide-preview")).toContainText(guestEmail);
  await page.getByTestId("decide-confirm").click();
  await expect(page.getByTestId("decide-done")).toBeVisible();
  await expect(page.locator("[data-visibility=internal]")).toContainText("chef Marc");
  await expect(page.getByTestId("outbox-row").first()).toHaveAttribute("data-status", "sent");

  // Voyageur : voit la question, jamais la note ; répond
  await guest.reload();
  await expect(guest.getByTestId("guest-news")).toBeVisible();
  await expect(guest.getByTestId("guest-service").first()).toContainText("Des allergies ?");
  await expect(guest.locator("body")).not.toContainText("chef Marc");
  await expect(guest.locator("body")).not.toContainText("VIP");
  await guest.getByTestId("guest-reply").fill("Pas d'arachides");
  await guest.getByTestId("guest-reply-send").click();
  await expect(guest.getByTestId("guest-service").first()).toContainText("Pas d'arachides");

  // Manager : la réponse revient au dossier, puis acceptation
  await page.reload();
  await expect(page.getByTestId("service-history")).toContainText("Pas d'arachides");
  await page.getByTestId("decide-confirmed").click();
  await page.getByTestId("decide-message").fill("Chef confirmé pour 20 h");
  await page.getByTestId("decide-confirm").click();
  await expect(page.getByTestId("decide-done")).toBeVisible();
  await guest.reload();
  await expect(guest.getByTestId("guest-service").first()).toHaveAttribute("data-status", "confirmed");
  await expect(guest.getByTestId("guest-service").first()).toContainText("Chef confirmé pour 20 h");

  // Modification par l'équipe : historique + voyageur prévenu
  await page.reload();
  await page.getByTestId("service-edit").click();
  await page.getByLabel("Personnes").fill("3");
  await page.getByLabel("Message au voyageur").fill("Ajout d'une personne");
  await page.getByTestId("service-edit-save").click();
  await expect(page.getByTestId("service-history")).toContainText("Ajout d'une personne");
  await guest.reload();
  await expect(guest.getByTestId("guest-service").first()).toContainText("Demande modifiée par l'équipe");

  // Seconde demande refusée avec motif communicable
  await guest.getByLabel("Prestation").selectOption("airport_transfer");
  await guest.getByLabel("Date et heure souhaitées").fill(local(when));
  await guest.getByTestId("guest-request-send").click();
  await expect(guest.getByTestId("guest-request-ok")).toBeVisible();
  await page.goto("/fr/app/services");
  await page.getByTestId("services-todo").getByTestId("service-row").first().click();
  await page.getByTestId("decide-declined").click();
  await page.getByTestId("decide-message").fill("Aucun chauffeur disponible ce soir-là");
  await page.getByTestId("decide-confirm").click();
  await expect(page.getByTestId("decide-done")).toBeVisible();
  await guest.reload();
  await expect(guest.locator("[data-status=declined]")).toContainText("Aucun chauffeur disponible");

  // Message de séjour, dans les deux sens
  await guest.getByTestId("guest-message").fill("Le wifi ne marche pas");
  await guest.getByTestId("guest-message-send").click();
  await expect(guest.getByTestId("guest-messages")).toContainText("Le wifi ne marche pas");
  await page.goto(`/fr/app/stays/${s.stayA}`);
  await expect(page.getByTestId("stay-messages")).toContainText("Le wifi ne marche pas");
  await page.getByLabel("Répondre au voyageur").fill("Redémarrez la box");
  await page.getByTestId("reply-send").click();
  await expect(page.getByText(/Publié dans l'espace voyageur/)).toBeVisible();
  await expect(page.getByTestId("stay-messages").locator("li")).toContainText(["Le wifi ne marche pas", "Redémarrez la box"]);
  await guest.reload();
  await expect(guest.getByTestId("guest-messages")).toContainText("Redémarrez la box");

  // Historique horodaté et e-mails réellement partis (boîte de test)
  const subjects = (await mailsFor(guestEmail)).map((m) => m.subject);
  for (const k of ["demande reçue", "une précision", "demande acceptée", "demande modifiée", "non retenue", "nouveau message"])
    expect(subjects.some((x) => x.includes(k)), k).toBe(true);
  const { data: outbox } = await admin.from("notification_outbox").select("status").eq("organization_id", s.orgA);
  expect(outbox!.every((o) => o.status === "sent")).toBe(true);
  await guest.context().close();
});

test("7b · échec d'envoi visible et relançable, jamais affiché « envoyé »", async ({ page, browser }) => {
  await signIn(page, managerA);
  const { data: p } = await admin.from("properties").select("id").eq("organization_id", s.orgA).single();
  const { data: r } = await admin
    .from("reservations")
    .insert({ organization_id: s.orgA, property_id: p!.id, guest_name: "Bounce Test", guest_email: `bounce-${run}@halo.test`, check_in_at: new Date(Date.now() + 86_400_000).toISOString(), check_out_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })
    .select("id")
    .single();
  await page.goto(`/fr/app/stays/${r!.id}`);
  await page.getByTestId("link-create").click();
  const token = (await page.getByTestId("guest-link-url").inputValue()).split("/").pop()!;
  const guest = await newPage(browser);
  await guest.goto(`/fr/s/${token}`);
  await guest.waitForLoadState("networkidle");
  await guest.getByLabel("Date et heure souhaitées").fill(local(new Date(Date.now() + 2 * 86_400_000)));
  await guest.getByTestId("guest-request-send").click();
  await expect(guest.getByTestId("guest-request-ok")).toBeVisible();
  await page.reload();
  const row = page.getByTestId("outbox-row").first();
  await expect(row).toHaveAttribute("data-status", "failed");
  await expect(row).toContainText("Échec d'envoi");
  await expect(row).not.toContainText("Envoyé");
  await row.getByTestId("outbox-retry").click();
  await expect(page.getByTestId("outbox-row").first()).toContainText("2 tentatives");
  await expect(page.getByTestId("outbox-row").first()).toHaveAttribute("data-status", "failed");
  await guest.context().close();
});

test("8 · cloisonnement : autre organisation, autre séjour, agent", async ({ page, browser }) => {
  // Organisation B, avec son propre séjour et son propre lien
  await signIn(page, managerB);
  await page.getByLabel("Nom commercial").fill(`Hôtel B ${run}`);
  await page.getByRole("button", { name: "Créer et configurer" }).click();
  await page.getByTestId("onb-later").click();
  await expect(page).toHaveURL(/\/fr\/app$/);
  // Les données de A n'existent pas pour B
  for (const path of [`/fr/app/stays/${s.stayA}`, `/fr/app/services/${s.serviceA}`]) {
    const res = await page.goto(path);
    expect(res!.status()).toBe(404);
  }
  await page.goto("/fr/app/stays");
  await expect(page.getByText("Alex Martin")).toHaveCount(0);
  const { data: orgB } = await admin.from("organizations").select("id").eq("name", `Hôtel B ${run}`).single();
  const { data: pB } = await admin.from("properties").insert({ organization_id: orgB!.id, name: "Chambre 12" }).select("id").single();
  await admin.from("guest_guides").insert({ organization_id: orgB!.id, property_id: pB!.id, enabled: true, welcome: "Secret B" });
  const { data: rB } = await admin
    .from("reservations")
    .insert({ organization_id: orgB!.id, property_id: pB!.id, guest_name: "Voyageur B", check_in_at: new Date(Date.now() + 86_400_000).toISOString(), check_out_at: new Date(Date.now() + 2 * 86_400_000).toISOString() })
    .select("id")
    .single();
  await page.goto(`/fr/app/stays/${rB!.id}`);
  await page.getByTestId("link-create").click();
  const tokenB = (await page.getByTestId("guest-link-url").inputValue()).split("/").pop()!;
  await anon.rpc("guest_request_service", { token: tokenB, s_kind: "other", s_start_at: new Date(Date.now() + 86_400_000).toISOString(), s_people: 1, s_details: "Demande B" });
  const { data: svcB } = await admin.from("service_requests").select("id").eq("organization_id", orgB!.id).single();

  // Le voyageur A ne peut ni lire ni écrire dans le séjour B, même en connaissant l'identifiant
  const guest = await newPage(browser);
  await guest.goto(`/fr/s/${s.tokenA}`);
  await expect(guest.locator("body")).not.toContainText("Secret B");
  await expect(guest.locator("body")).not.toContainText("Demande B");
  const cross = await anon.rpc("guest_reply_service", { token: s.tokenA, service: svcB!.id, message: "intrusion" });
  expect((cross.data as { status: string }).status).toBe("unavailable");
  // Lecture directe des tables : refusée à l'anonyme
  const direct = await anon.from("service_requests").select("id");
  expect(direct.data ?? []).toHaveLength(0);
  // Lien inventé
  await guest.goto(`/fr/s/${"0".repeat(64)}`);
  await expect(guest.getByTestId("guest-unavailable")).toBeVisible();
  await guest.context().close();

  // Agent de A : invité, ne voit que ses missions, jamais les séjours ni les prestations
  const pa = await newPage(browser);
  await signIn(pa, managerA);
  await pa.goto("/fr/app/team");
  await pa.getByTestId("invite-create").click();
  const invite = await pa.getByTestId("invite-url").inputValue();
  const agent = await newPage(browser);
  await signIn(agent, agentA, `?next=${encodeURIComponent(new URL(invite).pathname.replace("/fr", ""))}`);
  await agent.getByTestId("invite-accept").click();
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  await expect(agent.getByTestId("mission-row")).toHaveCount(0);
  const agentId = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === agentA)!.id;
  await admin.from("profiles").update({ full_name: "Sam Agent" }).eq("id", agentId);
  await pa.goto("/fr/app/missions");
  const turnover = pa.getByTestId("mission-row").filter({ hasText: "Ménage · Loft Canal" }).first();
  await turnover.getByTestId("assign-select").selectOption({ label: "Sam Agent" });
  await expect(turnover.getByTestId("assign-select")).toHaveValue(/.+/);
  await agent.reload();
  await expect(agent.getByTestId("mission-row")).toHaveCount(1);
  await expect(agent.getByTestId("mission-row")).toContainText("Ménage · Loft Canal");
  await agent.goto("/fr/app/stays");
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  await agent.goto("/fr/app/services");
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  await agent.getByTestId("task-start").click();
  await expect(agent.getByTestId("mission-row")).toContainText("En cours");
  await agent.context().close();
});

test("9 · révocation, remplacement et expiration du lien voyageur", async ({ page, browser }) => {
  await signIn(page, managerA);
  await page.goto(`/fr/app/stays/${s.stayA}`);
  const guest = await newPage(browser);
  await guest.goto(`/fr/s/${s.tokenA}`);
  await expect(guest.getByTestId("guest-space")).toBeVisible();

  await page.getByTestId("link-revoke").click();
  await expect(page.getByTestId("link-status")).toHaveText("Aucun lien actif.");
  await guest.reload();
  await expect(guest.getByTestId("guest-unavailable")).toBeVisible();
  const write = await anon.rpc("guest_send_message", { token: s.tokenA, message: "après révocation" });
  expect((write.data as { status: string }).status).toBe("unavailable");

  // Nouveau lien : fonctionne ; en créer un autre remplace proprement le précédent
  await page.getByTestId("link-create").click();
  await expect(page.getByTestId("link-status")).toContainText("Actif");
  const t2 = (await page.getByTestId("guest-link-url").inputValue()).split("/").pop()!;
  await page.getByTestId("link-create").click();
  await expect(page.getByTestId("guest-link-url")).not.toHaveValue(new RegExp(t2));
  const t3 = (await page.getByTestId("guest-link-url").inputValue()).split("/").pop()!;
  await guest.goto(`/fr/s/${t2}`);
  await expect(guest.getByTestId("guest-unavailable")).toBeVisible();
  await guest.goto(`/fr/s/${t3}`);
  await expect(guest.getByTestId("guest-space")).toBeVisible();
  await expect(guest.getByTestId("guest-messages")).toContainText("Redémarrez la box"); // même séjour, historique conservé

  // Expiration : on simule la fin du séjour (fenêtre de validité dépassée)
  const past = Date.now() - 86_400_000;
  await admin
    .from("guest_links")
    .update({ valid_from: new Date(past - 5 * 86_400_000).toISOString(), valid_until: new Date(past).toISOString() })
    .eq("reservation_id", s.stayA)
    .is("revoked_at", null);
  await guest.reload();
  await expect(guest.getByTestId("guest-unavailable")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("link-status")).toContainText("Expiré");
  await guest.context().close();
});

test("10 · persistance après déconnexion et sur un autre appareil", async ({ page, browser }) => {
  await signIn(page, managerA);
  await page.getByRole("button", { name: /Se déconnecter/ }).click();
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in/);
  // Autre « appareil » : nouveau navigateur, aucun stockage local partagé
  const other = await newPage(browser);
  await signIn(other, managerA);
  await other.goto("/fr/app/stays");
  await expect(other.getByText(/Alex Martin · Loft Canal/)).toBeVisible();
  await other.goto(`/fr/app/services/${s.serviceA}`);
  await expect(other.getByTestId("service-history")).toContainText("Pas d'arachides");
  await expect(other.locator("[data-visibility=internal]")).toContainText("chef Marc");
  await other.goto("/fr/app/properties");
  await expect(other.getByText("Loft Canal")).toBeVisible();
  // La démo reste séparée : aucune donnée connectée dans le stockage du navigateur
  const stored = await other.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain("Loft Canal");
  await other.context().close();
});

test("11 · démo et environnement connecté impossibles à confondre", async ({ browser }) => {
  const page = await newPage(browser);
  await page.context().clearCookies(); // aucun marqueur démo, aucune session
  await page.goto("/fr");
  await expect(page.getByTestId("connected-entry")).toBeVisible();
  await expect(page.getByRole("link", { name: /Espace Manager/ })).toHaveCount(0);
  for (const path of ["/fr/today", "/fr/a/today", "/fr/tasks", "/fr/properties", "/fr/a/profile", "/fr/g/abc", "/fr/settings"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/fr\/auth\/sign-in\?from=demo$/);
    await expect(page.getByTestId("from-demo")).toBeVisible();
  }
  for (const path of ["/fr/app", "/fr/app/stays", "/fr/app/services", "/fr/app/missions", "/fr/app/properties", "/fr/app/onboarding"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/fr\/auth\/sign-in$/);
  }
  // Entrée explicite dans la démo, étiquetée comme telle
  await page.goto("/fr/demo");
  await expect(page.getByTestId("demo-entry-badge")).toBeVisible();
  await page.getByTestId("demo-space").first().click();
  await expect(page).toHaveURL(/\/fr\/today$/);
  await page.goto("/fr/status");
  await expect(page.getByTestId("status-page")).toHaveAttribute("data-ready", "yes");
  await page.context().close();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP8z4AATAxEcQAAzQEJ/0qgqMAAAAAASUVORK5CYII=", "base64");

test("12 · compte rendu agent : checklist, photos réelles, correction puis validation", async ({ browser }) => {
  const agent = await newPage(browser);
  await signIn(agent, agentA);
  await agent.goto("/fr/app/missions");
  await agent.getByTestId("mission-link").first().click();
  await expect(agent.getByTestId("checklist-room").first()).toBeVisible();
  // Terminer est impossible tant que les photos obligatoires manquent
  await expect(agent.getByTestId("missing-photos")).toBeVisible();
  await expect(agent.getByTestId("mission-finish")).toBeDisabled();
  await agent.getByTestId("checklist-item").first().locator("button").first().click();
  const buttons = agent.getByTestId("photo-add");
  const n = await buttons.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const chooser = agent.waitForEvent("filechooser");
    await agent.getByTestId("photo-add").nth(i).click();
    await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await expect(agent.getByTestId("mission-photo")).toHaveCount(i + 1);
  }
  await expect(agent.getByTestId("missing-photos")).toHaveCount(0);
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByText(/Terminée, à valider/)).toBeVisible();
  const missionUrl = agent.url();

  // Manager : voit les preuves, demande une correction
  const m = await newPage(browser);
  await signIn(m, managerA);
  await m.goto(missionUrl);
  await expect(m.getByTestId("mission-photo")).toHaveCount(n);
  await m.getByTestId("correction-reason").fill("Refaire la salle de bain");
  await m.getByTestId("mission-correction").click();
  await expect(m.getByText(/Correction demandée/).first()).toBeVisible();

  // Agent : voit le motif, reprend et termine ; le manager valide
  await agent.reload();
  await expect(agent.getByText("Refaire la salle de bain")).toBeVisible();
  await agent.getByTestId("mission-start").click();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByText(/Terminée, à valider/)).toBeVisible();
  await m.reload();
  await m.getByTestId("mission-validate").click();
  await expect(m.getByText(/Validée/).first()).toBeVisible();

  // Un autre manager (autre organisation) ne peut pas ouvrir la mission ni ses photos
  const other = await newPage(browser);
  await signIn(other, managerB);
  const res = await other.goto(missionUrl);
  expect(res!.status()).toBe(404);
  for (const c of [agent, m, other]) await c.context().close();
});
