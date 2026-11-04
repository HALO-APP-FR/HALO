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
import { createServer, type Server } from "node:http";

test.skip(!process.env.HALO_E2E_CONNECTED, "préproduction locale non démarrée");
test.describe.configure({ mode: "serial", timeout: 90_000 });

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
  await expect(page.getByRole("link", { name: "Ménage", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Arrivée", exact: true })).toBeVisible(); // catégorie « accueil » confirmée à l'onboarding

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
  await guest.getByLabel("Précisions", { exact: true }).fill("Dîner pour 2");
  await guest.getByTestId("guest-request-send").click();
  await expect(guest.getByTestId("guest-request-ok")).toBeVisible();
  await expect(guest.getByTestId("guest-service").first()).toHaveAttribute("data-status", "requested");
  await expect(guest.getByTestId("guest-service").first()).toContainText("Demande reçue");
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
  await expect(page.getByTestId("decide-saved")).toBeVisible();
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
  await expect(page.getByTestId("decide-saved")).toBeVisible();
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
  await expect(page.getByTestId("decide-saved")).toBeVisible();
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
  // Logement à part : un séjour qui chevaucherait celui d'Alex dans le même logement serait refusé (règle du 29/10)
  const { data: p } = await admin.from("properties").insert({ organization_id: s.orgA, name: "Studio Bounce" }).select("id").single();
  await admin.from("guest_guides").insert({ organization_id: s.orgA, property_id: p!.id, enabled: true });
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
  // Envoi au voyageur (adresse refusée par le fournisseur) ; les envois à l'équipe sont listés à part
  const row = page.getByTestId("outbox-row").filter({ hasText: `bounce-${run}` }).first();
  await expect(row).toHaveAttribute("data-status", "failed");
  await expect(row).toContainText("Échec d'envoi");
  await expect(row).not.toContainText("Envoyé");
  await row.getByTestId("outbox-retry").click();
  await expect(row).toContainText("2 tentatives");
  await expect(row).toHaveAttribute("data-status", "failed");
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
  // Le nom est demandé à l'arrivée dans l'équipe (sinon le manager verrait « Sans nom »)
  await expect(agent.getByTestId("invite-accept")).toBeDisabled();
  await agent.getByTestId("invite-name").fill("Sam Agent");
  await agent.getByTestId("invite-phone").fill("06 12 34 56 78");
  await agent.getByTestId("invite-accept").click();
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  await expect(agent.getByTestId("mission-row")).toHaveCount(0);
  await expect(agent.getByTestId("profile-incomplete")).toHaveCount(0);
  await pa.goto("/fr/app/team");
  await expect(pa.getByTestId("member-row").filter({ hasText: "Sam Agent" })).toContainText("06 12 34 56 78");
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
  // Ménage avant le départ du voyageur précédent : refus expliqué (règle ferme, appliquée par la base)
  await agent.getByTestId("task-start").click();
  await expect(agent.getByTestId("task-too-early")).toContainText("Pas avant le");
  await expect(agent.getByTestId("mission-row")).toContainText("À faire");
  // Dérogation du responsable (motif obligatoire, tracé), puis démarrage
  await turnover.getByTestId("mission-link").click();
  await pa.getByTestId("early-allow-open").click();
  await pa.getByTestId("early-allow-reason").fill("Voyageur précédent parti plus tôt (test fictif)");
  await pa.getByTestId("early-allow-confirm").click();
  await expect(pa.getByTestId("mission-derogation")).toContainText("Voyageur précédent parti plus tôt");
  await expect(pa.locator("[data-testid=history-event][data-kind=early_start_allowed]")).toContainText("vous — « Voyageur précédent parti plus tôt");
  await agent.reload();
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
  // Pages de démo ouvertes sans entrée explicite : connexion, puis retour à la page RÉELLE équivalente
  for (const [path, next] of [["/fr/today", "%2Fapp"], ["/fr/a/today", "%2Fapp%2Fmissions"], ["/fr/tasks", "%2Fapp%2Fmissions"], ["/fr/properties", "%2Fapp%2Fproperties"], ["/fr/g/abc", "%2Fapp"], ["/fr/settings", "%2Fapp%2Fonboarding"]]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`/fr/auth/sign-in\\?next=${next}$`));
  }
  await expect(page.getByTestId("sign-in-next")).toBeVisible();
  // Pages connectées sans session : connexion, puis retour à la page demandée
  for (const path of ["/fr/app/stays", "/fr/app/services", "/fr/app/missions", "/fr/app/properties", "/fr/app/onboarding"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`/fr/auth/sign-in\\?next=${encodeURIComponent(path.slice(3))}$`));
  }
  await page.goto("/fr/app");
  await expect(page).toHaveURL(/\/fr\/auth\/sign-in\?next=%2Fapp$/);
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
  // Terminer quand même : la base refuse, explique ce qui manque, rien n'est perdu
  await agent.getByTestId("checklist-item").first().locator("button").first().click();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.locator("[data-testid=task-missing] [data-missing=photos]")).toBeVisible();
  await expect(agent.getByTestId("task-missing")).toContainText("Ce que vous avez déjà saisi est conservé");
  await expect(agent.getByTestId("checklist-item").first().locator("button").first()).toHaveAttribute("aria-pressed", "true");
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
  await expect(agent.getByText("Terminée, à valider", { exact: true })).toBeVisible();
  const missionUrl = agent.url();

  // Manager : voit les preuves, demande une correction
  const m = await newPage(browser);
  await signIn(m, managerA);
  await m.goto(missionUrl);
  await expect(m.getByTestId("mission-photo")).toHaveCount(n);
  await m.getByTestId("correction-reason").fill("Refaire la salle de bain");
  await m.getByTestId("mission-correction").click();
  await expect(m.getByText("Correction demandée", { exact: true }).first()).toBeVisible();

  // Agent : voit le motif, reprend et termine ; le manager valide
  await agent.reload();
  await expect(agent.getByTestId("correction-reason-shown")).toContainText("Refaire la salle de bain");
  await agent.getByTestId("mission-start").click();
  // Les anciennes photos ne comptent plus : nouvelle preuve exigée, l'ancienne reste visible en historique
  await expect(agent.getByTestId("missing-photos")).toBeVisible();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.locator("[data-testid=task-missing] [data-missing=photos]")).toBeVisible();
  await expect(agent.getByTestId("old-photos").first()).toBeVisible();
  for (let i = 0; i < n; i++) {
    const chooser = agent.waitForEvent("filechooser");
    await agent.getByTestId("photo-add").nth(i).click();
    await (await chooser).setFiles({ name: "photo2.png", mimeType: "image/png", buffer: PNG });
    await expect(agent.getByTestId("mission-photo")).toHaveCount(i + 1);
  }
  await expect(agent.getByTestId("missing-photos")).toHaveCount(0);
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByText("Terminée, à valider", { exact: true })).toBeVisible();
  // L'agent sait que sa correction est partie ; l'historique dit « correction renvoyée »
  await expect(agent.getByTestId("mission-sent")).toContainText("Correction envoyée au responsable");
  await expect(agent.locator("[data-testid=history-event][data-kind=resubmitted]")).toBeVisible();
  await expect(agent.locator("[data-testid=history-event][data-kind=correction_requested]")).toContainText("Refaire la salle de bain");
  await m.reload();
  await m.getByTestId("mission-validate").click();
  await expect(m.getByText(/Validée/).first()).toBeVisible();
  await agent.reload();
  await expect(agent.getByTestId("mission-validated")).toBeVisible();

  // Un autre manager (autre organisation) ne peut pas ouvrir la mission ni ses photos
  const other = await newPage(browser);
  await signIn(other, managerB);
  const res = await other.goto(missionUrl);
  expect(res!.status()).toBe(404);
  for (const c of [agent, m, other]) await c.context().close();
});

test("13 · compte de test de préproduction : connexion sans e-mail, retour à la page demandée, même compte sur un autre appareil", async ({ browser }) => {
  const a = await newPage(browser);
  await a.context().clearCookies();
  await a.goto("/fr/app/properties");
  await expect(a).toHaveURL(/next=%2Fapp%2Fproperties/);
  await a.getByLabel("Nom du compte de test").fill(`revue ${run}`);
  await a.getByTestId("test-account-submit").click();
  // Retour vers la page demandée ; sans organisation encore, l'application renvoie d'abord à la création d'espace
  await expect(a).toHaveURL(/\/fr\/app(\/properties)?$/);
  // Nouveau compte sans organisation : la page le renvoie à la création d'espace
  await a.goto("/fr/app");
  await a.getByLabel("Nom commercial").fill(`Revue ${run}`);
  await a.getByRole("button", { name: "Créer et configurer" }).click();
  await expect(a.getByTestId("onb-title")).toBeVisible();
  const b = await newPage(browser);
  await b.context().clearCookies();
  await b.goto("/fr/auth/sign-in");
  await b.getByLabel("Nom du compte de test").fill(`revue ${run}`);
  await b.getByTestId("test-account-submit").click();
  await expect(b).toHaveURL(/\/fr\/app$/);
  await expect(b.getByRole("heading", { name: `Revue ${run}` })).toBeVisible();
  for (const c of [a, b]) await c.context().close();
});

test("14 · logement prêt ? arrivées réelles, ménage manquant, incidents agent et voyageur jusqu'à résolution", async ({ browser }) => {
  const m = await newPage(browser);
  await signIn(m, managerA);
  // Premier séjour du logement : aucun ménage avant l'arrivée → bloquée, action « Créer le ménage »
  const row = m.getByTestId("arrival-row").filter({ hasText: "Alex Martin" });
  await expect(row).toHaveAttribute("data-state", "blocked");
  await expect(row).toContainText("Aucun ménage relié à ce séjour");
  await row.getByTestId("create-cleaning").click();
  await expect(row).toContainText("Ménage sans agent");

  // Agent : signale un manque de matériel urgent depuis sa mission
  const agent = await newPage(browser);
  await signIn(agent, agentA);
  await agent.goto("/fr/app/missions");
  await agent.getByTestId("mission-link").first().click();
  await agent.getByTestId("report-open").click();
  await agent.getByLabel("Type de problème").selectOption("missing_supplies");
  await agent.getByTestId("report-description").fill("Plus de produit vaisselle");
  await agent.getByTestId("report-urgent").check();
  await agent.getByTestId("report-send").click();
  await expect(agent.getByText("Signalé : votre responsable est prévenu.")).toBeVisible();
  await expect(agent.getByTestId("reported-incident")).toContainText("Manque de matériel");

  // Manager : le voit, le prend en charge, le résout
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-incidents")).toContainText("1 incident ou blocage ouvert");
  await m.goto("/fr/app/incidents");
  const inc = m.getByTestId("incident-row").filter({ hasText: "Plus de produit vaisselle" });
  await inc.getByTestId("incident-take").click();
  await expect(inc).toHaveAttribute("data-status", "in_progress");
  await inc.getByTestId("incident-resolve-open").click();
  await inc.getByTestId("incident-resolution").fill("Livraison de produits à 14 h");
  await inc.getByTestId("incident-resolve").click();
  await expect(inc).toHaveAttribute("data-status", "resolved");

  // Voyageur : signale un problème, l'équipe répond, il voit la réponse (pas la note interne) et reçoit l'e-mail
  await m.goto(`/fr/app/stays/${s.stayA}`);
  await m.getByTestId("link-create").click();
  const token = (await m.getByTestId("guest-link-url").inputValue()).split("/").pop()!;
  const guest = await newPage(browser);
  await guest.goto(`/fr/s/${token}`);
  await guest.waitForLoadState("networkidle");
  await guest.getByLabel("Type de problème").selectOption("breakdown");
  await guest.getByTestId("guest-problem-description").fill("Le chauffe-eau ne marche pas");
  await guest.getByTestId("guest-problem-send").click();
  await expect(guest.getByTestId("guest-problem-ok")).toBeVisible();
  await expect(guest.getByTestId("guest-problem").first()).toHaveAttribute("data-status", "open");
  await m.goto("/fr/app/incidents");
  const gi = m.getByTestId("incident-row").filter({ hasText: "Le chauffe-eau ne marche pas" });
  await gi.getByTestId("incident-resolve-open").click();
  await gi.getByTestId("incident-resolution").fill("Plombier Dupont, 90 €");
  await gi.getByTestId("incident-guest-message").fill("Un plombier est passé, l'eau chaude est revenue.");
  await gi.getByTestId("incident-resolve").click();
  await expect(gi).toHaveAttribute("data-status", "resolved");
  await guest.reload();
  await expect(guest.getByTestId("guest-problem").first()).toHaveAttribute("data-status", "resolved");
  await expect(guest.getByTestId("guest-problem").first()).toContainText("l'eau chaude est revenue");
  await expect(guest.locator("body")).not.toContainText("90 €");
  await expect.poll(async () => (await mailsFor(guestEmail)).map((x) => x.subject).join("|")).toContain("votre signalement est résolu");
  for (const c of [m, agent, guest]) await c.context().close();
});

test("15 · linge (blanchisserie) et maintenance comptent dans « logement prêt »", async ({ browser }) => {
  const m = await newPage(browser);
  await signIn(m, managerA);
  // Assigner le ménage créé au test 14 → le point suivant apparaît : le linge (organisation avec blanchisserie)
  await m.goto("/fr/app/missions");
  const unassigned = m.getByTestId("mission-row").filter({ hasText: "Ménage · Loft Canal" }).filter({ has: m.locator('select[data-testid="assign-select"] option[value=""]:checked') });
  await unassigned.first().getByTestId("assign-select").selectOption({ label: "Sam Agent" });
  await m.goto("/fr/app");
  const row = m.getByTestId("arrival-row").filter({ hasText: "Alex Martin" });
  await expect(row).toContainText("Linge : rien de prévu avant l'arrivée");
  // Fiche préremplie vérifiée avant création : échéance = arrivée, début conseillé, inconnues signalées
  await row.getByTestId("plan-linen").click();
  await expect(row.getByTestId("linen-deadline")).toContainText("À livrer avant l'arrivée du voyageur");
  await expect(row.getByTestId("linen-unknown")).toContainText("Non connu de HALO");
  await expect(row.getByTestId("linen-assignee")).toHaveValue("");
  await row.getByTestId("linen-confirm").dblclick();
  await expect(m.getByTestId("arrival-row").filter({ hasText: "Alex Martin" })).toContainText("Linge : personne n'est assigné");
  // Double clic : une seule livraison
  const { data: stayA } = await admin.from("reservations").select("id").eq("guest_name", "Alex Martin").order("created_at", { ascending: false }).limit(1).single();
  expect((await admin.from("tasks").select("id", { count: "exact", head: true }).eq("next_reservation_id", stayA!.id).eq("type", "linen_delivery")).count).toBe(1);

  // Un dégât signalé → intervention de maintenance planifiée, reliée à l'arrivée, visible par l'agent
  const agent = await newPage(browser);
  await signIn(agent, agentA);
  await agent.goto("/fr/app/missions");
  await agent.getByTestId("mission-link").first().click();
  await agent.getByTestId("report-open").click();
  await agent.getByLabel("Type de problème").selectOption("leak");
  await agent.getByTestId("report-description").fill("Fuite sous l'évier");
  await agent.getByTestId("report-send").click();
  await expect(agent.getByText("Signalé : votre responsable est prévenu.")).toBeVisible();
  await m.goto("/fr/app/incidents");
  const inc = m.getByTestId("incident-row").filter({ hasText: "Fuite sous l'évier" });
  await inc.getByTestId("incident-plan-open").click();
  await inc.getByTestId("incident-plan-assignee").selectOption({ label: "Sam Agent" });
  await inc.getByTestId("incident-plan").click();
  await expect(inc).toHaveAttribute("data-status", "in_progress");
  await expect(inc.getByTestId("incident-intervention")).toBeVisible();
  await agent.goto("/fr/app/missions");
  const mission = agent.getByTestId("mission-row").filter({ hasText: "Maintenance · Loft Canal" });
  await expect(mission).toHaveCount(1);
  await mission.getByTestId("mission-link").click();
  await expect(agent.getByTestId("mission-notes")).toContainText("Fuite sous l'évier");
  for (const c of [m, agent]) await c.context().close();
});

test("16 · scénario de test complet, journal des envois et affectation hors fenêtre confirmée", async ({ browser }) => {
  const m = await newPage(browser);
  await m.context().clearCookies();
  await m.goto("/fr/auth/sign-in");
  await m.getByLabel("Nom du compte de test").fill(`scen ${run}`);
  await m.getByTestId("test-scenario-submit").click();
  await expect(m.getByTestId("test-scenario-ready")).toBeVisible();
  const guestHref = await m.getByTestId("test-scenario-guest").getAttribute("href");
  await m.getByTestId("test-scenario-continue").click();
  await expect(m).toHaveURL(/\/fr\/app$/);
  await expect(m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" })).toContainText("Linge : rien de prévu");

  // Voyageur : demande → l'équipe est prévenue (adresse fictive : échec tracé, jamais « envoyé »)
  const guest = await newPage(browser);
  await guest.goto(guestHref!);
  await guest.waitForLoadState("networkidle");
  await guest.getByLabel("Date et heure souhaitées").fill(local(new Date(Date.now() + 2 * 86_400_000)));
  await guest.getByTestId("guest-request-send").click();
  await expect(guest.getByTestId("guest-request-ok")).toBeVisible();
  await m.goto("/fr/app/notifications");
  const row = m.getByTestId("outbox-row").filter({ hasText: "Équipe : nouvelle demande" });
  await expect(row.first()).toHaveAttribute("data-status", "failed");
  await expect(row.first()).toContainText("Adresse fictive");

  // Agent du scénario : retrouve sa mission
  const agent = await newPage(browser);
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`scen-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/missions");
  await expect(agent.getByTestId("mission-row")).toContainText("Ménage · Appartement test");

  // Mission dont la fenêtre est dépassée : affectation impossible sans nouvelle fin confirmée
  const { data: t } = await admin.from("tasks").select("id, organization_id, property_id").eq("type", "turnover").eq("is_auto_generated", false).order("created_at", { ascending: false }).limit(1).single();
  const past = Date.now() - 3 * 3_600_000;
  await admin.from("tasks").insert({ organization_id: t!.organization_id, property_id: t!.property_id, type: "other", window_start: new Date(past - 3_600_000).toISOString(), window_end: new Date(past).toISOString(), duration_min: 30 });
  await m.goto("/fr/app/missions");
  const late = m.getByTestId("mission-row").filter({ hasText: "Autre · Appartement test" });
  await late.getByTestId("assign-select").selectOption({ label: "Agent test" });
  await expect(late.getByTestId("out-of-window")).toBeVisible();
  await late.getByTestId("out-of-window-confirm").click();
  await expect(late.getByTestId("out-of-window")).toHaveCount(0);
  await expect(late.getByTestId("assign-select")).toHaveValue(/.+/);
  for (const c of [m, guest, agent]) await c.context().close();
});

test("17 · validation par type, créneau lisible et corrigé, absences et fermeture sans réaffectation automatique", async ({ browser }) => {
  const m = await newPage(browser);
  await m.context().clearCookies();
  await m.goto("/fr/auth/sign-in");
  await m.getByLabel("Nom du compte de test").fill(`abs ${run}`);
  await m.getByTestId("test-scenario-submit").click();
  await expect(m.getByTestId("test-scenario-ready")).toBeVisible();
  await m.getByTestId("test-scenario-continue").click();
  await expect(m).toHaveURL(/\/fr\/app$/);
  const agentUser = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === `test-abs-${run}-agent@halo.invalid`)!;
  const { data: mem } = await admin.from("memberships").select("organization_id").eq("user_id", agentUser.id).single();
  const org = mem!.organization_id as string;
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();

  // 1. Réglage explicite par type : la maintenance passe par une validation (appliqué par le serveur)
  await m.goto("/fr/app/settings");
  await m.getByTestId("validation-maintenance-on").click();
  await m.getByTestId("validation-save").click();
  await expect(m.getByTestId("validation-settings")).toContainText("Réglage enregistré");
  const { data: o } = await admin.from("organizations").select("validation_task_types").eq("id", org).single();
  expect(o!.validation_task_types).toContain("maintenance");

  const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  const { data: mt } = await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "maintenance", status: "assigned", assignee_id: agentUser.id, title: "Chaudière", window_start: at(-30), window_end: at(180), duration_min: 30 }).select("id").single();
  const agent = await newPage(browser);
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`abs-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto(`/fr/app/missions/${mt!.id}`);
  await expect(agent.getByTestId("mission-validation-rule")).toHaveText("Validation par un responsable");
  await agent.getByTestId("mission-start").click();
  await expect(agent.getByTestId("mission-finish")).toBeVisible();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByTestId("mission-finish")).toHaveCount(0);
  await expect.poll(async () => (await admin.from("tasks").select("status").eq("id", mt!.id).single()).data?.status).toBe("done");
  await m.goto(`/fr/app/missions/${mt!.id}`);
  await m.getByTestId("mission-validate").click();
  await expect.poll(async () => (await admin.from("tasks").select("status").eq("id", mt!.id).single()).data?.status).toBe("validated");
  await m.reload();
  await expect(m.getByTestId("mission-history")).toContainText("Terminée, à valider");
  await expect(m.getByTestId("mission-history")).toContainText("Validée");

  // 2. Créneau : fenêtre et durée séparées, date de fin affichée, correction tracée
  const { data: ménage } = await admin.from("tasks").select("id, window_start, window_end, duration_min").eq("organization_id", org).eq("type", "turnover").eq("assignee_id", agentUser.id).limit(1).single();
  await m.goto(`/fr/app/missions/${ménage!.id}`);
  await expect(m.getByTestId("mission-duration")).toHaveText(/\d/);
  await m.getByTestId("window-edit").click();
  const start = new Date(ménage!.window_start);
  await m.getByTestId("window-end").fill(local(new Date(start.getTime() + 30 * 60_000)));
  await expect(m.getByTestId("window-save")).toBeDisabled(); // plus court que la durée : impossible
  await m.getByTestId("window-end").fill(local(new Date(start.getTime() + (ménage!.duration_min + 60) * 60_000)));
  await m.getByTestId("window-reason").fill("Arrivée avancée");
  await m.getByTestId("window-save").click();
  await expect(m.getByTestId("window-editor")).toHaveCount(0);
  await expect(m.getByTestId("mission-history")).toContainText("Créneau modifié");
  await expect(m.getByTestId("mission-history")).toContainText("Arrivée avancée");

  // 3. Absence demandée par l'agent : en attente, les responsables sont prévenus, une mission est concernée
  const { data: today } = await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "other", status: "assigned", assignee_id: agentUser.id, window_start: at(30), window_end: at(150), duration_min: 60 }).select("id").single();
  await agent.goto("/fr/app/profile");
  const tomorrow = local(new Date(Date.now() + 86_400_000)).slice(0, 10);
  await agent.getByTestId("absence-to").fill(tomorrow);
  await agent.getByTestId("absence-reason").fill("Rendez-vous");
  await agent.getByTestId("absence-save").click();
  await expect(agent.getByTestId("absence-saved")).toContainText("en attente");
  await agent.reload();
  await expect(agent.getByTestId("my-absences").getByTestId("absence-status").first()).toHaveText("En attente");
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-absenceRequests")).toContainText("1 demande d'absence à décider");
  await m.goto("/fr/app/notifications");
  await expect(m.getByTestId("outbox-row").filter({ hasText: "Équipe : demande d'absence" }).first()).toBeVisible();

  // 4. Le responsable accepte : la mission déjà attribuée n'est PAS réaffectée, le conflit est listé
  await m.goto("/fr/app/team");
  const req = m.getByTestId("absence-row").filter({ hasText: "Agent test" }).first();
  await expect(req.getByTestId("absence-impacts")).toBeVisible();
  await req.getByTestId("absence-accept").click();
  await expect(m.getByTestId("absence-row").filter({ hasText: "Agent test" }).first().getByTestId("absence-status")).toHaveText("Acceptée");
  await expect(m.getByTestId("availability-conflicts")).toBeVisible();
  await expect(m.getByTestId("availability-conflict").first()).toContainText("absence acceptée");
  expect((await admin.from("tasks").select("assignee_id").eq("id", today!.id).single()).data?.assignee_id).toBe(agentUser.id);
  await expect(m.getByTestId("member-row").filter({ hasText: "Agent test" }).getByTestId("member-absent")).toBeVisible();
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-availability")).toContainText("à réorganiser");

  // 5. Nouvelle mission sur la période : l'agent absent n'est pas proposé (et la base refuserait)
  await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "inspection", window_start: at(60), window_end: at(240), duration_min: 45 });
  await m.goto("/fr/app/missions");
  const insp = m.getByTestId("mission-row").filter({ hasText: "Contrôle · Appartement test" });
  const opt = insp.getByTestId("assign-select").locator("option", { hasText: "Agent test" });
  await expect(opt).toBeDisabled();
  await expect(opt).toContainText("indisponible : Congé");
  await expect(insp.getByTestId("assign-hidden")).toContainText("1 personne indisponible");
  const blocked = await admin.from("tasks").update({ assignee_id: agentUser.id, status: "assigned" }).eq("organization_id", org).eq("type", "inspection").select("id");
  expect(blocked.error?.message).toContain("assignee_unavailable");

  // 6. Fermeture d'équipe : signalée, rien n'est déplacé ni supprimé
  await m.goto("/fr/app/team");
  await m.getByTestId("absence-who").selectOption("team");
  await m.getByTestId("absence-to").fill(tomorrow);
  await m.getByTestId("absence-save").click();
  await expect(m.getByTestId("absence-saved")).toContainText("prise en compte");
  await m.reload();
  await expect(m.getByTestId("absence-row").filter({ hasText: "Toute l'équipe" }).first()).toContainText("Fermeture d'équipe");
  await expect(m.getByTestId("availability-conflict").filter({ hasText: "Contrôle" })).toContainText("fermeture d'équipe");
  const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org).neq("status", "cancelled");
  expect(count).toBeGreaterThanOrEqual(4);

  // 7. Annulations : plus rien ne bloque
  while ((await m.getByTestId("absence-cancel").count()) > 0) {
    const n = await m.getByTestId("absence-cancel").count();
    await m.getByTestId("absence-cancel").first().click();
    await expect(m.getByTestId("absence-cancel")).toHaveCount(n - 1);
  }
  await m.reload();
  await expect(m.getByTestId("availability-conflicts")).toHaveCount(0);
  for (const c of [m, agent]) await c.context().close();
});

/**
 * Simulation LOCALE du fournisseur OpenStreetMap (préproduction locale sans accès Internet) :
 * NOMINATIM_URL et OVERPASS_URL de .env.local pointent ici. Le vrai fournisseur est vérifié en ligne
 * par l'auto-test (openstreetmap_geocoding_works, openstreetmap_places_work).
 */
let osm: Server | null = null;
let overpassDown = false;
const OSM_PORT = 54390;
function startOsm() {
  if (osm) return;
  osm = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    // Import depuis le navigateur du responsable (fournisseur appelé côté client) : autorisation CORS comme Overpass
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url?.startsWith("/search")) return res.end(JSON.stringify([{ lat: "48.8606", lon: "2.3376", display_name: "1 Rue de la Paix, Paris" }]));
    // Photon (repli) : mêmes lieux au format GeoJSON, filtrés par étiquette demandée
    if (req.url?.startsWith("/reverse")) {
      const tags = new URL(req.url, "http://x").searchParams.getAll("osm_tag");
      const all = [
        { id: 201, lat: 48.8611, lon: 2.3381, key: "amenity", value: "cafe", name: "Café Photon", street: "Rue Été" },
        { id: 202, lat: 48.8601, lon: 2.3369, key: "amenity", value: "pharmacy", name: "Pharmacie Photon" },
      ];
      return res.end(JSON.stringify({ features: all.filter((p) => tags.includes(`${p.key}:${p.value}`)).map((p) => ({ geometry: { coordinates: [p.lon, p.lat] }, properties: { name: p.name, osm_type: "N", osm_id: p.id, osm_key: p.key, osm_value: p.value, street: p.street, city: "Paris" } })) }));
    }
    if (overpassDown) {
      res.statusCode = 406;
      return res.end("Not Acceptable");
    }
    res.end(
      JSON.stringify({
        osm3s: { timestamp_osm_base: "2026-10-28T10:00:00Z" },
        elements: [
          { type: "node", id: 101, lat: 48.8611, lon: 2.3381, tags: { amenity: "cafe", name: "Café de l'Opéra", "addr:housenumber": "2", "addr:street": "Rue Été", "addr:city": "Paris", opening_hours: "Mo-Su 07:00-22:00" } },
          { type: "node", id: 102, lat: 48.8601, lon: 2.3369, tags: { amenity: "pharmacy", name: "Pharmacie Centrale" } },
          { type: "node", id: 103, lat: 48.8615, lon: 2.3390, tags: { railway: "station", name: "Gare Fictive" } },
          { type: "node", id: 104, lat: 48.9500, lon: 2.3376, tags: { amenity: "restaurant", name: "Hors périmètre" } },
        ],
      }),
    );
  }).listen(OSM_PORT);
}
test.beforeAll(async () => {
  if (process.env.HALO_E2E_CONNECTED) startOsm();
});
test.afterAll(() => {
  osm?.close();
  osm = null;
});

test("18 · missions à valider, messages lus, messagerie interne, itinéraires, préférences et lieux autour du logement", async ({ browser }) => {
  const m = await newPage(browser);
  await m.context().clearCookies();
  await m.goto("/fr/auth/sign-in");
  await m.getByLabel("Nom du compte de test").fill(`ops ${run}`);
  await m.getByTestId("test-scenario-submit").click();
  await expect(m.getByTestId("test-scenario-ready")).toBeVisible();
  const guestHref = (await m.getByTestId("test-scenario-guest").getAttribute("href"))!;
  await m.getByTestId("test-scenario-continue").click();
  await expect(m).toHaveURL(/\/fr\/app$/);
  const agentUser = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === `test-ops-${run}-agent@halo.invalid`)!;
  const { data: mem } = await admin.from("memberships").select("organization_id").eq("user_id", agentUser.id).single();
  const org = mem!.organization_id as string;
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  const { data: ménage } = await admin.from("tasks").select("id").eq("organization_id", org).eq("type", "turnover").limit(1).single();

  // A. Lieux : localisation et import OpenStreetMap, lieu vérifié par l'équipe, lieu masqué
  await m.goto(`/fr/app/properties/${prop!.id}`);
  await m.getByTestId("places-locate").click();
  await expect(m.getByTestId("places-coords")).toContainText("48.86060");
  await m.getByTestId("places-import").click();
  await expect(m.getByTestId("places-imported")).toContainText("3 lieux importés"); // le lieu hors périmètre est écarté
  await m.getByTestId("place-name").fill("Boulangerie Fraîche");
  await m.getByTestId("place-category").selectOption("shops");
  await m.getByTestId("place-address").fill("4 rue de l'Écluse, Paris");
  await m.getByTestId("place-note").fill("Croissants dès 7 h");
  await m.getByTestId("place-add").click();
  await expect(m.getByTestId("place-row").filter({ hasText: "Boulangerie Fraîche" })).toBeVisible();
  await m.getByTestId("place-row").filter({ hasText: "Gare Fictive" }).getByTestId("place-toggle").click();
  await expect(m.getByTestId("place-row").filter({ hasText: "Gare Fictive" }).getByTestId("place-toggle")).toHaveText("Afficher");

  // B. Voyageur : lieux de son logement, filtre, itinéraire, refus de géolocalisation sans blocage
  const guestCtx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
  const guest = await guestCtx.newPage();
  await guest.goto(guestHref);
  const around = guest.getByTestId("guest-around");
  await expect(around).toBeVisible();
  await expect(around.getByTestId("around-place")).toHaveCount(3);
  await expect(around.getByTestId("around-place").first()).toContainText("Boulangerie Fraîche"); // conseil de l'équipe d'abord
  await expect(around.getByTestId("around-place").filter({ hasText: "Gare Fictive" })).toHaveCount(0); // masqué
  await expect(around.getByTestId("around-place").filter({ hasText: "Hors périmètre" })).toHaveCount(0);
  await expect(around.getByTestId("around-sources")).toContainText("Données OpenStreetMap du 28 oct. 2026");
  await expect(around.getByTestId("around-place").filter({ hasText: "Pharmacie Centrale" }).getByTestId("around-source")).toHaveText("Proposé automatiquement (OpenStreetMap)");
  await expect(around.getByTestId("around-place").filter({ hasText: "Pharmacie Centrale" }).getByTestId("around-hours")).toContainText("Horaires non communiqués");
  await expect(around.getByTestId("places-map")).toBeVisible();
  await around.getByTestId("around-filter-food").click();
  await expect(around.getByTestId("around-place")).toHaveCount(1);
  const cafe = around.getByTestId("around-place").first();
  await expect(cafe).toContainText("Café de l'Opéra");
  await expect(cafe.getByTestId("around-distance")).toContainText("< 100 m"); // distance arrondie, jamais une fausse précision
  await expect(cafe.getByTestId("around-hours")).toContainText("Mo-Su 07:00-22:00");
  expect(await cafe.getByTestId("around-go-google").getAttribute("href")).toContain("48.861100%2C2.338100");
  await expect(around.getByTestId("around-geolocate")).toHaveCount(0); // aucune position demandée au voyageur
  await guestCtx.close();
  const located = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
  const g2 = await located.newPage();
  await g2.goto(guestHref);

  // C. Messages voyageur : lus à l'ouverture, compteurs cohérents
  await g2.getByTestId("guest-message").fill("Où sont les serviettes ?");
  await g2.getByTestId("guest-message-send").click();
  await m.goto("/fr/app/stays");
  const row = m.getByTestId("stay-row").filter({ hasText: "Voyageur test" });
  await expect(row.getByTestId("stay-unread")).toHaveText("1 nouveau message");
  await row.click();
  await expect(m.getByTestId("stay-message").filter({ hasText: "serviettes" })).toHaveAttribute("data-unread", "1");
  await expect(m.getByTestId("stay-message").filter({ hasText: "serviettes" })).toContainText("lu par l'équipe"); // après confirmation serveur
  await m.goto("/fr/app/stays");
  await expect(m.getByTestId("stay-row").filter({ hasText: "Voyageur test" }).getByTestId("stay-unread")).toHaveCount(0);
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-messages")).toContainText("Aucun message voyageur non lu");
  await located.close();

  // D. Messagerie interne liée à la mission
  await m.goto(`/fr/app/missions/${ménage!.id}`);
  await m.getByTestId("mission-chat-new").click();
  await expect(m.getByTestId("chat-context")).toHaveValue(`task:${ménage!.id}`);
  await m.getByTestId("chat-to").first().check();
  await m.getByTestId("chat-first").fill("Le code du local poubelles a changé, demande-le-moi.");
  await m.getByTestId("chat-start").click();
  await expect(m).toHaveURL(/\/fr\/app\/messages\/[0-9a-f-]{36}$/);
  await expect(m.getByTestId("chat-message")).toHaveCount(1);
  await expect(m.getByTestId("chat-read-state")).toHaveText(" · non lu");

  const agent = await newPage(browser);
  await agent.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    };
  });
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`ops-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/missions");
  await expect(agent.getByTestId("nav-chat-unread")).toHaveText("1");
  await agent.goto(`/fr/app/missions/${ménage!.id}`);
  const thread = agent.getByTestId("mission-chat");
  await expect(thread.getByTestId("chat-message")).toContainText("local poubelles");
  await expect(thread.getByTestId("chat-message")).toContainText("Nouveau");
  await thread.getByTestId("chat-body").fill("Bien reçu, je vous appelle.");
  await thread.getByTestId("chat-send").click();
  await expect(thread.getByTestId("chat-message").filter({ hasText: "Bien reçu" })).toBeVisible();
  // Coupure réseau : le message reste « en attente », jamais affiché comme envoyé, puis part au retour du réseau
  await agent.context().setOffline(true);
  await thread.getByTestId("chat-body").fill("Message écrit sans réseau");
  await thread.getByTestId("chat-send").click();
  await expect(thread.getByTestId("chat-pending")).toHaveAttribute("data-state", "offline");
  await expect(thread.getByTestId("chat-message").filter({ hasText: "sans réseau" })).toHaveCount(0);
  await agent.context().setOffline(false);
  await agent.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(thread.getByTestId("chat-pending")).toHaveCount(0);
  await expect(thread.getByTestId("chat-message").filter({ hasText: "sans réseau" })).toHaveCount(1);
  const { count: sansReseau } = await admin.from("team_messages").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("body", "Message écrit sans réseau");
  expect(sansReseau).toBe(1); // aucun doublon

  await m.goto("/fr/app");
  await expect(m.getByTestId("home-chats")).toContainText("1 conversation d'équipe non lue");
  await m.getByTestId("home-cta-chats").click();
  await m.getByTestId("chat-row").first().click();
  await expect(m.getByTestId("chat-message").filter({ hasText: "Bien reçu" })).toContainText("Nouveau");
  await expect(m.getByTestId("chat-message").filter({ hasText: "local poubelles" }).getByTestId("chat-read-state")).toHaveText(" · lu");
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-chats")).toContainText("Aucun message d'équipe non lu");

  // E. Itinéraire : trois applications, choix par défaut conservé après reconnexion
  await agent.goto(`/fr/app/missions/${ménage!.id}`);
  await agent.getByTestId("directions-menu").click();
  await agent.getByTestId("directions-apple").click();
  await agent.getByTestId("directions-menu").click();
  await agent.getByTestId("directions-google").click();
  await agent.getByTestId("directions-menu").click();
  await agent.getByTestId("directions-waze").click();
  const opened = await agent.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened[0]).toMatch(/^https:\/\/maps\.apple\.com\/\?daddr=48\.860600%2C2\.337600/);
  expect(opened[1]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=48\.860600%2C2\.337600/);
  expect(opened[2]).toBe("https://waze.com/ul?ll=48.860600%2C2.337600&navigate=yes");
  await agent.goto("/fr/app/preferences");
  await agent.getByTestId("maps-app").selectOption("waze");
  await expect.poll(async () => (await admin.from("profiles").select("maps_app").eq("id", agentUser.id).single()).data?.maps_app).toBe("waze");
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`ops-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto(`/fr/app/missions/${ménage!.id}`);
  await expect(agent.getByTestId("directions-waze")).toHaveAttribute("data-default", "1");

  // F. Préférences de notification : enregistrées, appliquées par le serveur, canaux non configurés signalés
  await agent.goto("/fr/app/preferences");
  await expect(agent.getByTestId("channel-sms")).toContainText("indisponible");
  await expect(agent.getByTestId("channel-push")).toContainText("indisponibles");
  const pref = agent.locator('[data-testid="pref-row"][data-event="agent_task_assigned"]');
  await pref.getByTestId("pref-email").uncheck();
  await expect.poll(async () => (await admin.from("notification_prefs").select("email").eq("user_id", agentUser.id).eq("event", "agent_task_assigned").maybeSingle()).data?.email).toBe(false);
  await agent.reload();
  await expect(agent.locator('[data-testid="pref-row"][data-event="agent_task_assigned"]').getByTestId("pref-email")).not.toBeChecked();
  const before = (await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("template", "agent_task_assigned").neq("status", "skipped")).count ?? 0;
  const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  const { data: mt } = await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "maintenance", window_start: at(-30), window_end: at(240), duration_min: 30 }).select("id").single();
  await admin.from("tasks").update({ assignee_id: agentUser.id, status: "assigned" }).eq("id", mt!.id);
  const after = (await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("template", "agent_task_assigned").neq("status", "skipped")).count ?? 0;
  expect(after).toBe(before); // préférence appliquée par la base
  const { data: skipped } = await admin.from("notification_outbox").select("status, last_error").eq("organization_id", org).eq("template", "agent_task_assigned").eq("status", "skipped");
  expect(skipped?.[0]?.last_error).toBe("disabled_by_preference"); // le journal dit pourquoi
  await m.goto("/fr/app/notifications");
  await expect(m.getByTestId("outbox-row").filter({ hasText: "Agent : mission attribuée" }).filter({ has: m.getByTestId("outbox-skipped") }).first()).toContainText("Le destinataire a désactivé cet e-mail");

  // G. Missions à valider : alerte à l'accueil dès la fin, ouverture directe, disparition après validation
  await admin.from("organizations").update({ validation_task_types: ["turnover", "maintenance"] }).eq("id", org);
  await agent.goto(`/fr/app/missions/${mt!.id}`);
  await agent.getByTestId("mission-start").click();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByTestId("mission-finish")).toHaveCount(0);
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-toValidate")).toContainText("1 mission à valider");
  await m.getByTestId("home-cta-toValidate").click();
  await expect(m).toHaveURL(/\/fr\/app\/missions\?status=done$/);
  await expect(m.getByTestId("mission-row")).toHaveCount(1);
  await expect(m.getByTestId("mission-row")).toContainText("Maintenance");
  await m.getByTestId("mission-link").click();
  await m.getByTestId("mission-validate").click();
  await expect.poll(async () => (await admin.from("tasks").select("status").eq("id", mt!.id).single()).data?.status).toBe("validated");
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-toValidate")).toContainText("Aucune mission à valider");
  const { data: mails } = await admin.from("notification_outbox").select("recipient").eq("organization_id", org).eq("template", "team_task_to_validate");
  expect((mails ?? []).length).toBeGreaterThan(0); // notification générée à la fin de la mission
  for (const c of [m, agent]) await c.context().close();
});

test("19 · recommandations (modifier, propriétaire, sans coordonnées, automatiques désactivées), itinéraire sans adresse, conflit sur la mission, préférences rétablies, lecture par destinataire", async ({ browser }) => {
  const m = await newPage(browser);
  await m.context().clearCookies();
  await m.goto("/fr/auth/sign-in");
  await m.getByLabel("Nom du compte de test").fill(`reco ${run}`);
  await m.getByTestId("test-scenario-submit").click();
  await expect(m.getByTestId("test-scenario-ready")).toBeVisible();
  const guestHref = (await m.getByTestId("test-scenario-guest").getAttribute("href"))!;
  await m.getByTestId("test-scenario-continue").click();
  await expect(m).toHaveURL(/\/fr\/app$/);
  const agentUser = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === `test-reco-${run}-agent@halo.invalid`)!;
  const { data: mem } = await admin.from("memberships").select("organization_id").eq("user_id", agentUser.id).single();
  const org = mem!.organization_id as string;
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  const { data: ménage } = await admin.from("tasks").select("id").eq("organization_id", org).eq("type", "turnover").limit(1).single();

  // A. Logement non localisé : la recommandation manuelle reste pleinement utilisable, sans distance ni carte inventées
  await m.goto(`/fr/app/properties/${prop!.id}`);
  await expect(m.getByTestId("places-coords")).toContainText("non localisé");
  await m.getByTestId("place-name").fill("Marché couvert");
  await m.getByTestId("place-category").selectOption("shops");
  await m.getByTestId("place-source").selectOption("owner");
  await m.getByTestId("place-address").fill("Place de l'Hôtel-de-Ville, Paris");
  await m.getByTestId("place-description").fill("Produits frais du mardi au dimanche");
  await m.getByTestId("place-add").click();
  const row = m.getByTestId("place-row").filter({ hasText: "Marché couvert" });
  await expect(row).toContainText("Conseil du propriétaire");
  await expect(row).toContainText("sans distance");
  // Modifier
  await row.getByTestId("place-edit").click();
  await m.getByTestId("place-note").fill("Arriver avant 11 h");
  await m.getByTestId("place-add").click();
  await expect(m.getByTestId("place-row").filter({ hasText: "Marché couvert" })).toBeVisible();
  await expect.poll(async () => (await admin.from("property_places").select("note").eq("property_id", prop!.id).eq("name", "Marché couvert").single()).data?.note).toBe("Arriver avant 11 h");

  const guest = await newPage(browser);
  await guest.goto(guestHref);
  const around = guest.getByTestId("guest-around");
  await expect(around.getByTestId("around-origin")).toContainText("pas encore localisé");
  await expect(around.getByTestId("places-map")).toHaveCount(0); // pas de fausse carte
  const marche = around.getByTestId("around-place").filter({ hasText: "Marché couvert" });
  await expect(marche.getByTestId("around-source")).toHaveText("Conseil du propriétaire");
  await expect(marche).toContainText("Produits frais du mardi au dimanche");
  await expect(marche).toContainText("Arriver avant 11 h");
  await expect(marche.getByTestId("around-distance")).toHaveCount(0); // aucune distance inventée
  expect(decodeURIComponent((await marche.getByTestId("around-go-waze").getAttribute("href"))!)).toContain("Place de l'Hôtel-de-Ville, Paris");

  // B. Panne du fournisseur : message clair, les recommandations manuelles restent visibles
  await m.getByTestId("places-lat").fill("48.8606");
  await m.getByTestId("places-lng").fill("2.3376");
  await m.getByTestId("places-save-coords").click();
  await expect(m.getByTestId("places-coords")).toContainText("saisi par l'équipe");
  osm?.close(); // fournisseur injoignable
  osm = null;
  await m.getByTestId("places-import").click();
  await expect(m.getByTestId("places-import-error")).toContainText("OpenStreetMap ne répond pas", { timeout: 30_000 });
  await guest.reload();
  await expect(guest.getByTestId("around-place").filter({ hasText: "Marché couvert" })).toBeVisible();

  // C. Recommandations automatiques désactivées pour ce logement
  await admin.from("property_places").insert({ organization_id: org, property_id: prop!.id, source: "openstreetmap", external_id: "node/999", category: "food", name: "Bistrot importé", latitude: 48.8608, longitude: 2.3378 });
  await guest.reload();
  await expect(guest.getByTestId("around-place").filter({ hasText: "Bistrot importé" })).toHaveCount(1);
  await m.reload();
  await m.getByTestId("places-auto").uncheck();
  await expect(m.getByTestId("places-auto-off")).toBeVisible();
  await expect.poll(async () => (await admin.from("properties").select("auto_places").eq("id", prop!.id).single()).data?.auto_places).toBe(false);
  await guest.reload();
  await expect(guest.getByTestId("around-place").filter({ hasText: "Bistrot importé" })).toHaveCount(0);
  await expect(guest.getByTestId("around-place").filter({ hasText: "Marché couvert" })).toHaveCount(1);
  await guest.context().close();

  // D. Itinéraire impossible sans adresse : action désactivée et expliquée
  await admin.from("properties").update({ address_line: null, latitude: null, longitude: null }).eq("id", prop!.id);
  await m.goto(`/fr/app/missions/${ménage!.id}`);
  await expect(m.getByTestId("directions-disabled")).toBeDisabled();
  await expect(m.getByTestId("directions-missing")).toContainText("Adresse du logement manquante");
  await admin.from("properties").update({ address_line: "1 rue de la Paix" }).eq("id", prop!.id);

  // E. Absence acceptée après l'affectation : conflit visible sur la mission, actions proposées, refus serveur
  const { data: mm } = await admin.from("tasks").select("window_start, window_end").eq("id", ménage!.id).single();
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
  await m.goto("/fr/app/team");
  await m.getByTestId("absence-who").selectOption({ label: "Agent test" });
  await m.getByTestId("absence-from").fill(day(mm!.window_start));
  await m.getByTestId("absence-to").fill(day(mm!.window_end));
  await m.getByTestId("absence-save").click();
  await expect(m.getByTestId("absence-saved")).toBeVisible();
  await m.goto(`/fr/app/missions/${ménage!.id}`);
  await expect(m.getByTestId("mission-absence-conflict")).toContainText("Agent test est absent(e)");
  await expect(m.getByTestId("mission-assign").getByTestId("task-cancel")).toBeVisible();
  const { data: conflictMails } = await admin.from("notification_outbox").select("template").eq("organization_id", org).eq("template", "team_assignment_conflict");
  expect((conflictMails ?? []).length).toBeGreaterThan(0);
  // Désaffecter puis tenter de réaffecter : refusé par le serveur
  await m.getByTestId("mission-assign").getByTestId("assign-select").selectOption("");
  await expect(m.getByTestId("mission-assign").getByTestId("assign-select")).toHaveValue("");
  const direct = await admin.from("tasks").update({ assignee_id: agentUser.id, status: "assigned" }).eq("id", ménage!.id).select("id");
  expect(direct.error?.message).toContain("assignee_unavailable");
  await m.reload();
  await expect(m.getByTestId("mission-assign").getByTestId("assign-select").locator("option", { hasText: "Agent test" })).toBeDisabled();
  // Le responsable, lui, est disponible : l'affectation fonctionne
  await m.getByTestId("mission-assign").getByTestId("assign-select").selectOption({ label: "Manager test" });
  await expect.poll(async () => (await admin.from("tasks").select("assignee_id").eq("id", ménage!.id).single()).data?.assignee_id).not.toBe(null);
  // Absence annulée : l'agent redevient sélectionnable
  await m.goto("/fr/app/team");
  await m.getByTestId("absence-row").filter({ hasText: "Agent test" }).first().getByTestId("absence-cancel").click();
  await expect(m.getByTestId("absence-row").filter({ hasText: "Agent test" })).toHaveCount(0);
  await m.goto(`/fr/app/missions/${ménage!.id}`);
  await expect(m.getByTestId("mission-assign").getByTestId("assign-select").locator("option", { hasText: "Agent test" })).toBeEnabled();
  await m.getByTestId("mission-assign").getByTestId("assign-select").selectOption({ label: "Agent test" });
  await expect.poll(async () => (await admin.from("tasks").select("assignee_id").eq("id", ménage!.id).single()).data?.assignee_id).toBe(agentUser.id);

  // F. Préférences : coupées puis rétablies, sans toucher celles des autres
  await m.goto("/fr/app/preferences");
  const row2 = m.locator('[data-testid="pref-row"][data-event="team_task_to_validate"]');
  await expect(row2.getByTestId("pref-where")).toContainText("Toujours visible dans HALO : Accueil");
  await row2.getByTestId("pref-email").uncheck();
  await expect.poll(async () => (await admin.from("notification_prefs").select("email").eq("event", "team_task_to_validate").eq("organization_id", org).maybeSingle()).data?.email).toBe(false);
  await m.getByTestId("prefs-reset").click();
  await expect.poll(async () => (await admin.from("notification_prefs").select("event", { count: "exact", head: true }).eq("organization_id", org)).count).toBe(0);
  await m.reload();
  await expect(m.locator('[data-testid="pref-row"][data-event="team_task_to_validate"]').getByTestId("pref-email")).toBeChecked();
  await expect(m.locator('[data-testid="pref-row"][data-event="team_agent_blocker"]').getByTestId("pref-email")).toBeDisabled(); // urgence : jamais coupée

  // G. Conversation à plusieurs : lecture par destinataire, marquée seulement pour celui qui ouvre
  await m.goto(`/fr/app/messages?task=${ménage!.id}`);
  await m.getByTestId("chat-to").first().check();
  await m.getByTestId("chat-first").fill("Point sur la mission de demain");
  await m.getByTestId("chat-start").click();
  await expect(m.getByTestId("chat-read-state")).toHaveText(" · non lu");
  const agent = await newPage(browser);
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`reco-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/messages");
  await expect(agent.getByTestId("chat-row").first()).toHaveAttribute("data-unread", "1");
  await agent.getByTestId("chat-row").first().click();
  await expect(agent.getByTestId("chat-message")).toContainText("Point sur la mission");
  await agent.getByTestId("chat-context-link").click();
  await expect(agent).toHaveURL(new RegExp(`/fr/app/missions/${ménage!.id}$`)); // la mission rattachée s'ouvre
  await expect(agent.getByTestId("mission-chat").getByTestId("chat-message")).toContainText("Point sur la mission"); // sans perdre le fil
  await m.reload();
  await expect(m.getByTestId("chat-read-state")).toHaveText(" · lu");
  for (const c of [m, agent]) await c.context().close();
});

/** Ouvre un compte de test complet (responsable + agent + séjour) et renvoie son organisation. */
async function testScenario(m: Page, name: string) {
  await m.context().clearCookies();
  await m.goto("/fr/auth/sign-in");
  await m.getByLabel("Nom du compte de test").fill(name);
  await m.getByTestId("test-scenario-submit").click();
  await expect(m.getByTestId("test-scenario-ready")).toBeVisible();
  await m.getByTestId("test-scenario-continue").click();
  await expect(m).toHaveURL(/\/fr\/app$/);
  const slug = name.replace(/\s+/g, "-").toLowerCase();
  const agentUser = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === `test-${slug}-agent@halo.invalid`)!;
  const { data: mem } = await admin.from("memberships").select("organization_id").eq("user_id", agentUser.id).single();
  return { org: mem!.organization_id as string, agentId: agentUser.id };
}

test("20 · préparation avant l'arrivée et demande VIP : lien, questionnaire, précision, recommandation, statuts exacts, révocation", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `prep ${run}`);
  // Critère VIP de l'organisation (toujours validé par une personne)
  await m.goto("/fr/app/settings");
  await m.getByTestId("vip-criterion-new").click();
  await m.getByTestId("vip-criterion-label").fill("Client fidèle");
  await m.getByTestId("vip-criterion-save").click();
  await expect(m.getByTestId("vip-criterion-row").filter({ hasText: "Client fidèle" })).toBeVisible();
  await expect(m.getByTestId("ai-status")).toContainText("fonctions manuelles uniquement");

  // 1-2. Séjour dans 12 jours (hors fenêtre habituelle) et accès avant arrivée envoyé par e-mail
  const arrive = new Date();
  arrive.setDate(arrive.getDate() + 12);
  arrive.setHours(16, 0, 0, 0);
  const leave = new Date(arrive.getTime() + 4 * 86_400_000);
  leave.setHours(11, 0, 0, 0);
  await m.goto("/fr/app/stays");
  await m.getByLabel("Nom du voyageur").fill("Camille Prépa");
  await m.getByLabel("E-mail du voyageur").fill(`prep-${run}@halo.invalid`);
  await m.getByLabel("Arrivée").fill(local(arrive));
  await m.getByLabel("Départ").fill(local(leave));
  await m.getByTestId("stay-create").click();
  await m.waitForURL(/\/fr\/app\/stays\/[0-9a-f-]{36}$/);
  const stayId = m.url().split("/").pop()!;
  await expect(m.getByTestId("link-invite")).toHaveAttribute("data-status", "none");
  await m.getByTestId("link-send").click();
  const url = await m.getByTestId("guest-link-url").inputValue();
  // Adresse fictive : jamais remise, jamais affichée « envoyé »
  await expect(m.getByTestId("link-invite")).toHaveAttribute("data-status", "failed");
  await expect(m.getByTestId("link-invite")).not.toContainText("envoyé ");
  await expect(m.getByTestId("link-status")).toContainText("Actif pour la préparation");
  // Le lien brut ne reste pas dans le journal d'envoi
  const { data: inv } = await admin.from("notification_outbox").select("payload, status").eq("reservation_id", stayId).eq("template", "prep_invite").single();
  expect(inv!.status).toBe("failed");
  expect(JSON.stringify(inv!.payload)).not.toContain(url.split("/").pop()!);

  // 3. Le voyageur ouvre son lien : préparation seulement, ni adresse ni guide
  const g = await newPage(browser);
  await g.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(g.getByTestId("guest-prep-banner")).toContainText("informations pratiques");
  await expect(g.getByTestId("guest-problems")).toHaveCount(0);
  await expect(g.getByText("Mot de passe Wi-Fi")).toHaveCount(0);
  await expect(m.getByTestId("link-questionnaire")).toBeVisible();
  await g.getByTestId("prep-interests-food").check({ force: true });
  await g.getByTestId("prep-interests-culture").check({ force: true });
  await g.getByTestId("prep-services-restaurant").check({ force: true });
  await g.getByTestId("prep-other").fill("Anniversaire de mariage");
  await g.getByTestId("prep-save").click();
  await expect(g.getByTestId("prep-done")).toContainText("Rien n'a encore été envoyé");
  await g.getByTestId("prep-send").click();
  await expect(g.getByTestId("prep-done")).toContainText("transmises à l'équipe");
  await g.reload();
  await expect(g.getByTestId("prep-updated")).toContainText("Envoyé à l'équipe");
  await expect(g.getByTestId("prep-interests-food")).toBeChecked();
  // Demande de prestation (jamais présentée comme réservée)
  await g.getByLabel("Date et heure souhaitées").fill(local(new Date(arrive.getTime() + 86_400_000 + 4 * 3_600_000)));
  await g.getByTestId("guest-request-send").click();
  await expect(g.getByTestId("guest-request-ok")).toBeVisible();
  await expect(g.getByTestId("guest-service").first()).toContainText("Demande reçue");

  // 4. Responsable : alerte utile et réponses lisibles
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-prepReview")).toContainText("1 questionnaire voyageur à examiner");
  await m.getByTestId("home-cta-prepReview").click();
  await expect(m.getByTestId("stays-filter")).toBeVisible();
  await expect(m.getByTestId("stay-row")).toHaveCount(1);
  await m.goto(`/fr/app/stays/${stayId}`);
  await expect(m.getByTestId("prep-needs-review")).toBeVisible();
  await expect(m.getByTestId("prep-answers")).toContainText("Bonnes tables");
  await expect(m.getByTestId("prep-answers")).toContainText("Anniversaire de mariage");
  await expect(m.getByTestId("prep-questionnaire")).toHaveAttribute("data-status", "submitted");

  // 5-6. Précision demandée sur la prestation, réponse du voyageur → « En cours d'étude »
  const { data: svc } = await admin.from("service_requests").select("id").eq("reservation_id", stayId).single();
  await m.goto(`/fr/app/services/${svc!.id}`);
  await m.getByTestId("decide-info_requested").click();
  await m.getByTestId("decide-message").fill("Pour combien de personnes ?");
  await m.getByTestId("decide-confirm").click();
  await expect(m.getByTestId("decide-saved")).toBeVisible();
  await g.reload();
  await expect(g.getByTestId("guest-service").first()).toHaveAttribute("data-status", "info_requested");
  await expect(g.getByTestId("guest-service").first()).toContainText("À préciser");
  await g.getByTestId("guest-reply").fill("Deux personnes");
  await g.getByTestId("guest-reply-send").click();
  await expect(g.getByTestId("guest-service").first()).toHaveAttribute("data-status", "in_review");
  await expect(g.getByTestId("guest-service").first()).toContainText("En cours d'étude");

  // 7. Recommandation publiée et action indispensable pour l'équipe
  await m.goto(`/fr/app/stays/${stayId}`);
  await m.getByTestId("prep-item-title").fill("Le Petit Zinc");
  await m.getByTestId("prep-item-body").fill("Table conseillée pour votre anniversaire, à réserver ensemble.");
  await m.getByTestId("prep-item-add").click();
  await expect(m.getByTestId("prep-item").filter({ hasText: "Le Petit Zinc" })).toHaveAttribute("data-published", "1");
  await m.getByTestId("prep-action-title").fill("Réserver la table du samedi");
  await m.getByTestId("prep-action-blocking").check();
  await m.getByTestId("prep-action-add").click();
  await expect(m.getByTestId("prep-action")).toHaveCount(1);
  await m.getByTestId("prep-status-ready").click();
  await expect(m.getByText("une action indispensable est encore ouverte")).toBeVisible();
  await expect(m.getByTestId("prep-status")).toHaveAttribute("data-status", "to_prepare");
  await m.getByTestId("prep-action-done").click();
  await expect(m.getByTestId("prep-action")).toHaveAttribute("data-status", "done");
  await m.getByTestId("prep-status-ready").click();
  await expect(m.getByTestId("prep-status")).toHaveAttribute("data-status", "ready");
  await expect(m.getByTestId("prep-history")).toContainText("Action faite", { useInnerText: false });

  // 8-9. Le voyageur voit la recommandation et le statut exact ; rien n'est « réservé »
  await g.reload();
  await expect(g.getByTestId("guest-prepared-item")).toContainText("Le Petit Zinc");
  await expect(g.getByTestId("guest-service").first()).toContainText("En cours d'étude");
  await expect(g.getByTestId("guest-space")).not.toContainText(/Confirmée|Réservé/);

  // VIP : demande, examen, acceptation, confidentialité
  await g.getByTestId("vip-note").fill("Troisième séjour avec vous");
  await g.getByTestId("vip-request").click();
  await expect(g.getByTestId("vip-pending")).toContainText("Demande envoyée à votre équipe");
  await expect(g.getByTestId("vip-confirmed")).toHaveCount(0);
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-vipRequests")).toContainText("1 demande VIP en attente");
  await m.goto(`/fr/app/stays/${stayId}`);
  await expect(m.getByTestId("vip-request")).toContainText("Troisième séjour avec vous");
  await expect(m.getByTestId("vip-loyalty")).toContainText("indice, pas une preuve");
  await m.getByTestId("vip-internal").fill("Vérifié dans l'outil de réservation");
  await m.getByTestId("vip-accept").click();
  await expect(m.getByTestId("vip-panel")).toHaveAttribute("data-vip", "active");
  await expect(m.getByTestId("vip-state")).toContainText("Client fidèle");
  await g.reload();
  await expect(g.getByTestId("vip-confirmed")).toBeVisible();
  await expect(g.getByTestId("guest-space")).not.toContainText("outil de réservation"); // note interne jamais visible
  // Agent : aucune vue du séjour, de la préparation ni du statut
  const agent = await newPage(browser);
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`prep-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto(`/fr/app/stays/${stayId}`);
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  // Une autre organisation : rien, et la même page qu'une adresse inexistante
  const other = await newPage(browser);
  await testScenario(other, `prep autre ${run}`);
  await other.goto(`/fr/app/stays/${stayId}`);
  await expect(other.getByTestId("not-found")).toContainText("n'appartient pas à l'organisation active");
  await other.goto(`/fr/app/stays/00000000-0000-0000-0000-000000000000`);
  await expect(other.getByTestId("not-found")).toContainText("n'appartient pas à l'organisation active");
  const { count: seen } = await admin.from("vip_requests").select("id", { count: "exact", head: true }).eq("organization_id", org);
  expect(seen).toBe(1);

  // Messages : même heure dans l'espace voyageur, le séjour et le journal (fuseau du logement)
  await g.getByTestId("guest-message").fill("Arrivée vers 18 h");
  await g.getByTestId("guest-message-send").click();
  await expect(g.getByTestId("guest-messages")).toContainText("Arrivée vers 18 h");
  const guestTime = (await g.getByTestId("guest-messages").locator("li").last().innerText()).match(/\d{2}:\d{2}/)![0];
  await m.goto(`/fr/app/stays/${stayId}`);
  const teamTime = (await m.getByTestId("stay-message").last().innerText()).match(/\d{2}:\d{2}/)![0];
  expect(teamTime).toBe(guestTime);

  // 10. Révocation : le lien ne donne plus rien
  await m.getByTestId("link-revoke").click();
  await expect(m.getByTestId("link-status")).toContainText("Aucun lien actif");
  await g.reload();
  await expect(g.getByTestId("guest-unavailable")).toBeVisible();
  await Promise.all([g, agent, other].map((p) => p.context().close()));
});

test("21 · recommandations : vérification explicite, import sans doublon, lieux masqués respectés, panne sans perte", async ({ browser }) => {
  startOsm(); // fournisseur simulé (arrêté par le test 19 pour simuler une panne)
  const m = await newPage(browser);
  const { org } = await testScenario(m, `lieux ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  await m.goto(`/fr/app/properties/${prop!.id}`);
  await m.getByTestId("places-locate").click();
  await expect(m.getByTestId("places-coords")).toContainText("48.86060");
  // Lieu manuel : visible, jamais « vérifié » sans confirmation
  await m.getByTestId("place-name").fill("Fromagerie du Coin");
  await m.getByTestId("place-category").selectOption("shops");
  await m.getByTestId("place-address").fill("8 rue du Marché, Paris");
  await m.getByTestId("place-hours").fill("Ma-Sa 9:00-19:00");
  await m.getByTestId("place-add").click();
  const row = m.getByTestId("place-row").filter({ hasText: "Fromagerie du Coin" });
  await expect(row).toContainText("non vérifié");
  await m.getByTestId("places-import").click();
  await expect(m.getByTestId("places-imported")).toContainText("3 lieux importés");
  await m.getByTestId("place-row").filter({ hasText: "Gare Fictive" }).getByTestId("place-toggle").click();
  await expect(m.getByTestId("place-row").filter({ hasText: "Gare Fictive" }).getByTestId("place-toggle")).toHaveText("Afficher");
  // Deuxième import : aucun doublon, le lieu masqué reste masqué
  await m.getByTestId("places-import").click();
  await expect(m.getByTestId("places-imported")).toContainText("3 lieux importés");
  const { data: rows } = await admin.from("property_places").select("name, hidden").eq("property_id", prop!.id).eq("source", "openstreetmap");
  expect(rows!.length).toBe(3);
  expect(rows!.find((r) => r.name === "Gare Fictive")!.hidden).toBe(true);
  // Le voyageur : lieu manuel « ajouté par l'équipe », horaires « à confirmer »
  const href = (await (async () => {
    await m.goto("/fr/app/stays");
    await m.getByTestId("stay-row").first().click();
    await m.getByTestId("link-create").click();
    return m.getByTestId("guest-link-url").inputValue();
  })()).replace(/^https?:\/\/[^/]+/, "");
  const g = await newPage(browser);
  await g.goto(href);
  const fromagerie = g.getByTestId("around-place").filter({ hasText: "Fromagerie du Coin" });
  await expect(fromagerie).toContainText("Ajouté par l'équipe le");
  await expect(fromagerie.getByTestId("around-hours")).toContainText("horaires à confirmer");
  await expect(g.getByTestId("around-place").filter({ hasText: "Gare Fictive" })).toHaveCount(0);
  // Vérification explicite : date et personne, puis visible comme telle
  await m.goto(`/fr/app/properties/${prop!.id}`);
  await m.getByTestId("place-row").filter({ hasText: "Fromagerie du Coin" }).getByTestId("place-verify").click();
  await expect(m.getByTestId("place-row").filter({ hasText: "Fromagerie du Coin" })).not.toContainText("non vérifié");
  await expect.poll(async () => {
    const { data: v } = await admin.from("property_places").select("verified_at, verified_by").eq("property_id", prop!.id).eq("name", "Fromagerie du Coin").single();
    return Boolean(v?.verified_at && v?.verified_by);
  }).toBe(true);
  await g.reload();
  await expect(fromagerie).toContainText("Vérifié par l'équipe le");
  await expect(fromagerie.getByTestId("around-hours")).toContainText("horaires vérifiés");
  // Overpass refuse (406, cas observé en préproduction) : repli automatique sur Photon, sans perte des lieux existants
  overpassDown = true;
  await m.getByTestId("places-import").click();
  await expect(m.getByTestId("places-imported")).toContainText("2 lieux importés");
  await expect(m.getByTestId("place-row").filter({ hasText: "Café Photon" })).toBeVisible();
  await expect(m.getByTestId("place-row").filter({ hasText: "Fromagerie du Coin" })).toBeVisible();
  overpassDown = false;
  // Panne de tous les fournisseurs : aucun lieu supprimé
  osm?.close();
  osm = null;
  await m.getByTestId("places-import").click();
  await expect(m.getByTestId("places-import-error")).toBeVisible({ timeout: 30_000 }); // délais des fournisseurs injoignables
  const { count } = await admin.from("property_places").select("id", { count: "exact", head: true }).eq("property_id", prop!.id).eq("hidden", false);
  expect(count).toBeGreaterThanOrEqual(3); // lieu manuel + lieux importés conservés
  await g.context().close();
});

test("22 · navigation responsable lisible à 1 280 px et page introuvable localisée", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 800 } });
  const m = await ctx.newPage();
  await testScenario(m, `nav ${run}`);
  const bar = m.getByRole("navigation", { name: "Navigation" }).locator("ul").first();
  // Barre principale entière, sans défilement caché
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await m.getByTestId("nav-more").click();
  await expect(m.getByTestId("nav-more-menu")).toBeVisible();
  await expect(m.getByTestId("nav-setup")).toHaveText("Configuration");
  await m.keyboard.press("Escape");
  await expect(m.getByTestId("nav-more-menu")).toHaveCount(0);
  await expect(m.getByTestId("nav-more")).toBeFocused();
  await m.getByTestId("nav-more").click();
  await m.getByTestId("nav-settings").click();
  await expect(m).toHaveURL(/\/fr\/app\/settings$/);
  // Adresse inconnue : page HALO en français, sans le message générique anglais
  const r = await m.goto("/fr/page-qui-n-existe-pas");
  expect(r?.status()).toBe(404);
  await expect(m.getByTestId("not-found")).toContainText("Page introuvable");
  await expect(m.locator("body")).not.toContainText("This page could not be found");
  await m.goto("/en/app/missions/00000000-0000-0000-0000-000000000000");
  await expect(m.getByTestId("not-found")).toContainText(/not found|does not exist/i);
  await ctx.close();
});

/** Séjour créé à l'écran, dans N jours, puis lien de préparation ouvert côté voyageur. */
async function prepStay(m: Page, browser: Browser, name: string, days: number) {
  const arrive = new Date();
  arrive.setDate(arrive.getDate() + days);
  arrive.setHours(16, 0, 0, 0);
  const leave = new Date(arrive.getTime() + 3 * 86_400_000);
  leave.setHours(11, 0, 0, 0);
  await m.goto("/fr/app/stays");
  await m.getByLabel("Nom du voyageur").fill(name);
  await m.getByLabel("E-mail du voyageur").fill(`${name.replace(/\s+/g, "-").toLowerCase()}-${run}@halo.invalid`);
  await m.getByLabel("Arrivée").fill(local(arrive));
  await m.getByLabel("Départ").fill(local(leave));
  await m.getByTestId("stay-create").click();
  await m.waitForURL(/\/fr\/app\/stays\/[0-9a-f-]{36}$/);
  const stayId = m.url().split("/").pop()!;
  await m.getByTestId("link-create").click();
  const url = (await m.getByTestId("guest-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  return { stayId, url, arrive };
}

test("23 · corrections : « Prêt » cohérent, mission issue d'une action avec consignes, message VIP, contact et carte avant arrivée", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `corr ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  await admin.from("guest_guides").update({ emergency_phone: "+33 1 23 45 67 89" }).eq("property_id", prop!.id);
  await admin.from("properties").update({ latitude: 48.8556, longitude: 2.2986 }).eq("id", prop!.id);
  await admin.from("property_places").insert({ organization_id: org, property_id: prop!.id, source: "manager", category: "food", name: "Bistrot du Champ", latitude: 48.8566, longitude: 2.2996 });
  const { stayId, url } = await prepStay(m, browser, "Noa Correctif", 12);

  // 1.1 Action indispensable : « Prêt » refusé, puis retiré si l'action est rouverte
  await m.getByTestId("prep-action-title").fill("QA — préparer table calme");
  await m.getByTestId("prep-action-blocking").check();
  await m.getByTestId("prep-action-add").click();
  await expect(m.getByTestId("prep-action")).toHaveCount(1);
  await m.getByTestId("prep-action-done").click();
  await expect(m.getByTestId("prep-action")).toHaveAttribute("data-status", "done");
  await m.getByTestId("prep-status-ready").click();
  await expect(m.getByTestId("prep-status")).toHaveAttribute("data-status", "ready");
  await m.getByRole("button", { name: "Rouvrir" }).click();
  await expect(m.getByTestId("prep-action")).toHaveAttribute("data-status", "open");
  await expect(m.getByTestId("prep-status")).toHaveAttribute("data-status", "in_progress");
  await expect(m.getByTestId("prep-not-ready-reason")).toContainText("n'est plus « Prêt »");
  await expect(m.getByTestId("prep-not-ready-reason")).toContainText("QA — préparer table calme");
  await m.getByText("Historique").click();
  await expect(m.getByTestId("prep-history")).toContainText("« Prêt » retiré");

  // Mission créée depuis l'action : non terminée → l'action ne se clôt pas sans dérogation
  await m.getByTestId("prep-action-task").click();
  await m.getByTestId("prep-task-notes").fill("Table au fond, loin de la porte. Bougie éteinte.");
  const start = new Date();
  start.setDate(start.getDate() + 11);
  start.setHours(9, 0, 0, 0);
  await m.getByTestId("prep-task-form").getByLabel("Au plus tôt").fill(local(start));
  await m.getByTestId("prep-task-create").click();
  await expect(m.getByTestId("prep-action")).toContainText("mission créée (Non assignée)");
  await m.getByTestId("prep-action-done").click();
  await expect(m.getByTestId("prep-force")).toBeVisible();
  await expect(m.getByTestId("prep-action")).toHaveAttribute("data-status", "open");
  await m.getByTestId("prep-force").getByRole("button", { name: "Fermer" }).click();

  // 1.2 L'agent voit le titre et les consignes, après affectation et rechargement
  await m.goto("/fr/app/missions");
  const row = m.getByTestId("mission-row").filter({ hasText: "QA — préparer table calme" });
  await expect(row.getByTestId("mission-title")).toContainText("QA — préparer table calme");
  await row.getByTestId("assign-select").selectOption({ label: "Agent test" });
  await expect(row.getByTestId("assign-select")).toHaveValue(/.+/);
  const agent = await newPage(browser);
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`corr-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/missions");
  const mine = agent.getByTestId("mission-row").filter({ hasText: "QA — préparer table calme" });
  await expect(mine.getByTestId("mission-notes-preview")).toContainText("Table au fond");
  await mine.getByTestId("mission-link").click();
  await expect(agent.getByRole("heading", { name: /QA — préparer table calme/ })).toBeVisible();
  await expect(agent.getByTestId("mission-notes")).toContainText("Bougie éteinte");
  await agent.reload();
  await expect(agent.getByTestId("mission-notes")).toContainText("Bougie éteinte");

  // Mission validée → action close automatiquement
  const { data: task } = await admin.from("tasks").select("id").eq("organization_id", org).eq("title", "QA — préparer table calme").single();
  await admin.from("tasks").update({ status: "validated" }).eq("id", task!.id);
  await m.goto(`/fr/app/stays/${stayId}`);
  await expect(m.getByTestId("prep-action")).toHaveAttribute("data-status", "done");

  // 1.3 Message VIP visible côté voyageur, statut d'envoi côté responsable
  await m.goto("/fr/app/settings");
  await m.getByTestId("vip-criterion-new").click();
  await m.getByTestId("vip-criterion-label").fill("Client fidèle");
  await m.getByTestId("vip-criterion-save").click();
  await expect(m.getByTestId("vip-criterion-row")).toHaveCount(1);
  const g = await newPage(browser);
  await g.goto(url);
  await g.getByTestId("vip-request").click();
  await expect(g.getByTestId("vip-pending")).toBeVisible();
  await m.goto(`/fr/app/stays/${stayId}`);
  await m.getByTestId("vip-guest-msg").fill("Une bouteille vous attendra à votre arrivée.");
  await m.getByTestId("vip-internal").fill("Note privée QA");
  await m.getByTestId("vip-accept").click();
  await expect(m.getByTestId("vip-sent-message")).toContainText("Une bouteille vous attendra");
  await expect(m.getByTestId("vip-sent-delivery")).toContainText("e-mail non remis");
  await g.reload();
  await expect(g.getByTestId("vip-team-message")).toContainText("Une bouteille vous attendra à votre arrivée.");
  await expect(g.getByTestId("guest-space")).not.toContainText("Note privée QA");

  // 1.4 / 1.5 Avant l'arrivée : carte expliquée, contact joignable, pas de renvoi vers un livret fermé
  await expect(g.getByTestId("around-origin")).toContainText("La carte et l'adresse du logement s'afficheront à partir du");
  await expect(g.getByTestId("around-origin")).not.toContainText("pas encore localisé");
  await expect(g.getByTestId("guest-messages")).toContainText("En cas d'urgence, appelez le +33 1 23 45 67 89");
  await expect(g.getByTestId("guest-messages")).not.toContainText("indiqué dans le livret");
  await Promise.all([g, agent].map((p) => p.context().close()));
});

const csv = (rows: string[][]) => Buffer.from("﻿" + rows.map((r) => r.join(";")).join("\r\n"));

test("24 · import : fichier correct, fichier imparfait, reprise sans doublon, droits, aucun envoi, missions selon l'option, annulation sûre", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `imp ${run}`);
  const outBefore = (await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org)).count ?? 0;
  const invBefore = (await admin.from("invitations").select("id", { count: "exact", head: true }).eq("organization_id", org)).count ?? 0;
  const tasksBefore = (await admin.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org)).count ?? 0;
  await m.goto("/fr/app/settings");
  await m.getByTestId("import-entry").click();
  await expect(m).toHaveURL(/\/fr\/app\/import$/);
  await m.getByTestId("import-kind-team").check();
  await m.getByTestId("import-create").click();
  await m.waitForURL(/\/fr\/app\/import\/[0-9a-f-]{36}$/);
  const jobId = m.url().split("/").pop()!;

  // Dates dans l'horizon des missions (90 jours), au format français du fichier
  const dd = (n: number) => {
    const x = new Date(Date.now() + n * 86_400_000);
    return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
  };
  await m.getByTestId("import-input-properties").setInputFiles({
    name: "logements.csv",
    mimeType: "text/csv",
    buffer: csv([["Nom", "Adresse", "Ville", "Pays", "Capacité", "Code boîte à clés"], ["Villa Import", "1 rue Fictive", "Nice", "France", "6", "1234"], ["Studio Import", "2 rue Fictive", "Lyon", "France", "2", "9999"], ["Appartement test", "", "Paris", "France", "4", ""]]),
  });
  await expect(m.getByTestId("import-file-properties")).toContainText("3 lignes lues");
  await expect(m.getByTestId("import-dropped")).toContainText("Code boîte à clés");
  await m.getByTestId("import-input-stays").setInputFiles({
    name: "sejours.csv",
    mimeType: "text/csv",
    buffer: csv([
      ["Logement", "Arrivée", "Départ", "Voyageur", "Voyageurs", "Source", "Référence", "E-mail voyageur"],
      ["Villa Import", dd(30), dd(34), "Ana", "4", "Airbnb", "HM1", `ana-${run}@halo.invalid`],
      ["Studio Import", dd(31), dd(33), "Bob", "2", "Booking", "BK2", ""],
      ["Villa Import", "32/03/2027", dd(34), "Date fausse", "2", "", "", ""],
      ["Maison fantôme", dd(40), dd(42), "Inconnu", "2", "", "", ""],
      ["Villa Import", dd(30), dd(34), "Ana", "4", "Airbnb", "HM1", ""],
    ]),
  });
  await expect(m.getByTestId("import-file-stays")).toContainText("5 lignes lues");
  // Un faux .xlsx est refusé proprement, sans rien envoyer
  await m.getByTestId("import-input-team").setInputFiles({ name: "equipe.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("pas un classeur") });
  await expect(m.getByText("Lecture impossible")).toBeVisible();
  await m.getByTestId("import-input-team").setInputFiles({ name: "equipe.csv", mimeType: "text/csv", buffer: csv([["Prénom", "Nom", "E-mail professionnel", "Téléphone professionnel", "Rôle", "Statut"], ["Lou", "Import", `lou-${run}@halo.invalid`, "06 11 22 33 44", "Agent", "Prestataire"]]) });
  await expect(m.getByTestId("import-file-team")).toContainText("1 lignes lues");
  // Rien n'est créé avant validation
  expect((await admin.from("properties").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("name", "Villa Import")).count).toBe(0);
  const { data: staged } = await admin.from("import_rows").select("raw").eq("job_id", jobId).eq("kind", "properties").limit(1).single();
  expect(JSON.stringify(staged!.raw)).not.toContain("1234"); // colonne sensible jamais transmise
  await m.getByTestId("import-analyze").click();

  // Aperçu : chaque problème signalé, lignes valides et rejetées distinguées
  const preview = m.getByTestId("import-preview");
  await expect(preview).toBeVisible();
  await expect(m.getByTestId("import-summary-properties")).toContainText("2 à créer");
  await expect(m.getByTestId("import-summary-properties")).toContainText("1 associé à une fiche existante");
  await expect(m.getByTestId("import-summary-stays")).toContainText("2 à créer");
  await expect(m.getByTestId("import-summary-stays")).toContainText("2 lignes rejetées");
  await expect(m.getByTestId("import-summary-stays")).toContainText("1 doublon ignoré");
  await expect(preview).toContainText("Date non reconnue : Arrivée (date)");
  await expect(preview).toContainText("Logement introuvable");
  await expect(preview).toContainText("Doublon de la ligne 2 du fichier"); // ligne 1 = en-têtes
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("guest_name", "Ana")).count).toBe(0);
  await expect(m.getByTestId("import-run")).toHaveText("Importer 2 logements, 2 séjours et 1 contact");

  // Droits : un agent ne voit ni l'import ni son rapport ; une autre organisation non plus
  const agent = await newPage(browser);
  await agent.context().clearCookies();
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`imp-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto(`/fr/app/import/${jobId}`);
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  const other = await newPage(browser);
  await testScenario(other, `imp autre ${run}`);
  await other.goto(`/fr/app/import/${jobId}`);
  await expect(other.getByTestId("not-found")).toBeVisible();

  // Validation : missions demandées, e-mails voyageurs non importés
  await m.getByTestId("import-opt-missions").check();
  await m.getByTestId("import-run").click();
  await expect(m.getByTestId("import-report")).toBeVisible();
  await expect(m.getByTestId("import-result-properties")).toContainText("2 créés");
  await expect(m.getByTestId("import-result-stays")).toContainText("2 créés");
  await expect(m.getByTestId("import-result-team")).toContainText("1 créé");
  await expect(m.getByTestId("import-missions")).toContainText(/Missions : \d+ créées?, non affectées?/);
  const { data: villa } = await admin.from("properties").select("id, import_job_id").eq("organization_id", org).eq("name", "Villa Import").single();
  expect(villa!.import_job_id).toBe(jobId);
  const { data: ana } = await admin.from("reservations").select("property_id, guest_email, external_uid, source").eq("organization_id", org).eq("guest_name", "Ana").single();
  expect(ana).toMatchObject({ property_id: villa!.id, guest_email: null, external_uid: "HM1", source: "airbnb" });
  expect(((await admin.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", org)).count ?? 0) > tasksBefore).toBe(true);
  // Aucun e-mail ni invitation déclenché par l'import
  expect((await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org)).count).toBe(outBefore);
  expect((await admin.from("invitations").select("id", { count: "exact", head: true }).eq("organization_id", org)).count).toBe(invBefore);

  // Reprise : relancer ne crée aucun doublon
  await m.reload();
  expect((await admin.from("properties").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("name", "Villa Import")).count).toBe(1);
  await m.goto("/fr/app/import");
  await expect(m.getByTestId("import-history-row").first()).toContainText("Terminé");

  // Annulation sûre : un séjour modifié depuis est conservé avec sa raison
  await admin.from("reservations").update({ notes: "Modifié après import" }).eq("organization_id", org).eq("guest_name", "Bob");
  await m.goto(`/fr/app/import/${jobId}`);
  await m.getByTestId("import-revert-check").click();
  await expect(m.getByTestId("import-revert-plan")).toContainText("conservé");
  await expect(m.getByTestId("import-revert")).toContainText("modifié depuis l'import");
  await m.getByTestId("import-revert-apply").click();
  await expect(m.getByTestId("import-reverted")).toBeVisible();
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("guest_name", "Ana")).count).toBe(0);
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("guest_name", "Bob")).count).toBe(1);
  expect((await admin.from("properties").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("name", "Studio Import")).count).toBe(1); // son séjour est conservé
  await Promise.all([agent, other].map((p) => p.context().close()));
});

test("24b · import Excel (.xlsx) puis reprise après interruption : aucune ligne recréée", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `xls ${run}`);
  await m.goto("/fr/app/import");
  await m.getByTestId("import-create").click();
  await m.waitForURL(/\/fr\/app\/import\/[0-9a-f-]{36}$/);
  const jobId = m.url().split("/").pop()!;
  await m.getByTestId("import-input-properties").setInputFiles("tests/fixtures/import-logements.xlsx");
  await expect(m.getByTestId("import-file-properties")).toContainText("2 lignes lues");
  await m.getByTestId("import-input-stays").setInputFiles("tests/fixtures/import-sejours.xlsx");
  await expect(m.getByTestId("import-file-stays")).toContainText("2 lignes lues");
  await m.getByTestId("import-analyze").click();
  await expect(m.getByTestId("import-summary-properties")).toContainText("2 à créer");
  await expect(m.getByTestId("import-summary-stays")).toContainText("2 à créer");

  // Interruption simulée : le premier logement a été créé, puis le traitement s'est arrêté
  const { data: chalet } = await admin.from("properties").insert({ organization_id: org, name: "Chalet Excel", city: "Annecy", country_code: "FR", timezone: "Europe/Paris", import_job_id: jobId, external_ref: "XL-1" }).select("id").single();
  await admin.from("import_rows").update({ status: "created", target_id: chalet!.id }).eq("job_id", jobId).eq("kind", "properties").eq("row_index", 1);
  await admin.from("import_jobs").update({ status: "importing" }).eq("id", jobId);
  await m.reload();
  await expect(m.getByTestId("import-resume")).toContainText("3 ligne(s) restent à traiter");
  await m.getByTestId("import-resume-btn").click();
  await expect(m.getByTestId("import-result-properties")).toContainText("2 créés");
  await expect(m.getByTestId("import-result-stays")).toContainText("2 créés");
  expect((await admin.from("properties").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("name", "Chalet Excel")).count).toBe(1);
  // Le séjour référencé « XL-1 » est rattaché au logement créé avant l'interruption
  const { data: eva } = await admin.from("reservations").select("property_id, external_uid").eq("organization_id", org).eq("guest_name", "Eva Excel").single();
  expect(eva).toMatchObject({ property_id: chalet!.id, external_uid: "BK-XL1" });
  // Relancer encore : sans effet
  await m.reload();
  await expect(m.getByTestId("import-resume")).toHaveCount(0);
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", org).in("guest_name", ["Eva Excel", "Léo Excel"])).count).toBe(2);
});

test("25 · calendrier iCal : création, relance sans doublon, modification HALO non écrasée, séjour disparu arbitré", async ({ browser }) => {
  let ics = "";
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/calendar");
    res.end(ics);
  }).listen(54391);
  const y = new Date().getFullYear() + 1;
  const ev = (uid: string, a: string, b: string, summary = "Reserved") => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${a}\r\nDTEND;VALUE=DATE:${b}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\n`;
  ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev("a1@airbnb", `${y}0510`, `${y}0514`)}${ev("a2@airbnb", `${y}0601`, `${y}0603`, "Airbnb (Not available)")}END:VCALENDAR\r\n`;
  try {
    const m = await newPage(browser);
    const { org } = await testScenario(m, `ical ${run}`);
    const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
    await m.goto(`/fr/app/properties/${prop!.id}`);
    await m.getByTestId("source-url").fill("http://127.0.0.1:54391/calendar.ics?s=secretABCD");
    await m.getByTestId("source-add").click();
    await expect(m.getByTestId("source-row")).toContainText("127.0.0.1:54391 …ABCD");
    await expect(m.getByTestId("source-row")).not.toContainText("secretABCD");
    await m.getByTestId("source-sync").click();
    await expect(m.getByTestId("source-synced")).toContainText("2 créé(s)");
    await m.getByTestId("source-sync").click();
    await expect(m.getByTestId("source-synced")).toContainText("0 créé(s), 0 mis à jour, 0 à arbitrer");
    // Le responsable modifie le séjour dans HALO ; le calendrier change aussi : HALO garde la main
    await admin.from("reservations").update({ guest_name: "Nom saisi dans HALO" }).eq("organization_id", org).eq("external_uid", "a1@airbnb");
    ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev("a1@airbnb", `${y}0511`, `${y}0514`)}END:VCALENDAR\r\n`;
    await m.getByTestId("source-sync").click();
    await expect(m.getByTestId("source-synced")).toContainText("2 à arbitrer");
    const { data: kept } = await admin.from("reservations").select("check_in_at").eq("organization_id", org).eq("external_uid", "a1@airbnb").single();
    expect(kept!.check_in_at.slice(0, 10)).toBe(`${y}-05-10`);
    await expect(m.getByTestId("source-conflict")).toHaveCount(2);
    await m.getByTestId("source-conflict").filter({ hasText: "absent du calendrier" }).getByTestId("conflict-cancel").click();
    await expect(m.getByTestId("source-conflict")).toHaveCount(1);
    expect((await admin.from("reservations").select("status").eq("organization_id", org).eq("external_uid", "a2@airbnb").single()).data!.status).toBe("cancelled");
    await m.getByTestId("conflict-apply").click();
    await expect(m.getByTestId("source-conflicts")).toHaveCount(0);
    expect((await admin.from("reservations").select("check_in_at").eq("organization_id", org).eq("external_uid", "a1@airbnb").single()).data!.check_in_at.slice(0, 10)).toBe(`${y}-05-11`);
    // Erreur de lecture visible, sans perte
    server.close();
    await m.getByTestId("source-sync").click();
    await expect(m.getByRole("alert").filter({ hasText: "Calendrier injoignable" })).toBeVisible();
    await m.reload();
    await expect(m.getByTestId("source-error")).toContainText("calendrier injoignable");
    await m.getByTestId("source-pause").click();
    await expect(m.getByTestId("source-row")).toHaveAttribute("data-status", "paused");
  } finally {
    server.close();
  }
});

const ymd = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("26 · réservation directe : lien dédié, demande, précision, offre, acceptation, dates prises puis calendrier non à jour, confirmation unique, révocation", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `book ${run}`);
  const { data: prop } = await admin.from("properties").select("id, name").eq("organization_id", org).single();
  const { stayId } = await prepStay(m, browser, "Lea Retour", 5);
  const outBefore = (await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("template", "booking_link")).count ?? 0;

  // Lien de demande distinct du lien de séjour (copie, aucun e-mail)
  await m.getByTestId("booking-link-create").click();
  const bUrl = (await m.getByTestId("once-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  expect(bUrl).toMatch(/^\/fr\/b\/[0-9a-f]{64}$/);
  await expect(m.getByTestId("booking-link-status")).toContainText("Lien actif jusqu'au");
  expect((await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("template", "booking_link")).count).toBe(outBefore);

  // Voyageur : demande (double clic = une seule demande), mention « pas une réservation »
  const g = await newPage(browser);
  await g.goto(bUrl);
  await g.waitForLoadState("networkidle"); // formulaire interactif (hydraté) avant la saisie
  await expect(g.getByTestId("booking-portal")).toBeVisible();
  await expect(g.getByTestId("bk-not-confirmed")).toContainText("pas une réservation confirmée");
  await expect(g.getByTestId("bk-calendar-note")).toContainText("Seule la confirmation de l'équipe vaut réservation");
  await g.getByTestId("bk-in").fill(ymd(40));
  await g.getByTestId("bk-out").fill(ymd(44));
  await g.getByTestId("bk-email").fill(`lea-retour-${run}@halo.invalid`);
  await g.getByLabel("Précisions (facultatif)").fill("Arrivée tardive, vers 22 h.");
  await g.getByTestId("bk-send").dblclick();
  await expect(g.getByTestId("bk-sent")).toBeVisible();
  await expect(g.getByTestId("bk-request")).toHaveCount(1);
  const { data: reqs } = await admin.from("booking_requests").select("id, status").eq("organization_id", org);
  expect(reqs).toHaveLength(1);
  const reqId = reqs![0].id as string;

  // Responsable : liste, alerte, détail (lu), précision avec note interne
  await m.goto("/fr/app");
  await expect(m.getByText("1 demande de séjour à traiter")).toBeVisible();
  await m.goto("/fr/app/bookings");
  await expect(m.getByTestId("booking-row")).toHaveAttribute("data-status", "received");
  await m.getByTestId("booking-row").click();
  await expect(m.getByTestId("booking-detail")).toContainText("Arrivée tardive");
  await expect(m.getByTestId("booking-free")).toBeVisible();
  await expect.poll(async () => (await admin.from("booking_requests").select("manager_unread").eq("id", reqId).single()).data!.manager_unread).toBe(false);
  await m.getByTestId("booking-info-open").click();
  await m.getByTestId("booking-question").fill("Combien de lits bébé vous faut-il ?");
  await m.getByTestId("booking-internal").fill("QA secret interne : client fidèle");
  await m.getByTestId("booking-info-send").click();
  await expect(m.getByTestId("booking-status")).toHaveText("Précision demandée");
  await expect(m.getByTestId("booking-history")).toContainText("QA secret interne");

  // Voyageur : voit la question, jamais la note interne ; répond
  await g.reload();
  await expect(g.getByTestId("bk-request")).toHaveAttribute("data-status", "info_requested");
  await expect(g.getByTestId("bk-team-message")).toContainText("lits bébé");
  await expect(g.locator("body")).not.toContainText("QA secret interne");
  await g.getByTestId("bk-reply").fill("Un seul, merci.");
  await g.getByTestId("bk-reply-send").click();
  await expect(g.getByTestId("bk-request")).toHaveAttribute("data-status", "in_review");

  // Offre : total = prix + frais, conditions, paiement hors HALO
  await m.reload();
  await expect(m.getByTestId("booking-history")).toContainText("Un seul, merci.");
  await m.getByTestId("booking-offer-open").click();
  await m.getByTestId("offer-price").fill("480");
  await m.getByTestId("offer-fees").fill("60");
  await expect(m.getByTestId("offer-total")).toContainText("540.00 EUR");
  await m.getByTestId("offer-conditions").fill("Acompte de 30 % par virement, solde à l'arrivée. Annulation gratuite jusqu'à 14 jours avant.");
  await m.getByTestId("booking-offer-send").click();
  await expect(m.getByTestId("booking-status")).toHaveText("Offre envoyée");
  await expect(m.getByTestId("booking-payment")).toContainText("non géré par HALO");

  await g.reload();
  await expect(g.getByTestId("bk-offer-total")).toContainText("540,00");
  await expect(g.getByTestId("bk-offer")).toContainText("Aucun paiement n'est demandé ici");
  await g.getByTestId("bk-accept").click();
  await expect(g.getByTestId("bk-request")).toHaveAttribute("data-status", "accepted");
  await expect(g.getByTestId("bk-request")).toContainText("ce n'est pas encore une réservation confirmée");

  // Dates prises entre-temps : refus serveur, rien n'est créé
  const blocked = (await admin.from("reservations").insert({ organization_id: org, property_id: prop!.id, source: "manual", status: "blocked", check_in_at: `${ymd(41)}T10:00:00Z`, check_out_at: `${ymd(42)}T10:00:00Z` }).select("id").single()).data!.id;
  await m.reload();
  await expect(m.getByTestId("booking-conflicts")).toBeVisible();
  await m.getByTestId("booking-confirm").click();
  await expect(m.getByTestId("booking-error")).toContainText("Ces dates ne sont plus disponibles");
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("origin_request_id", reqId)).count).toBe(0);
  await admin.from("reservations").delete().eq("id", blocked);

  // Calendrier externe jamais synchronisé : confirmation seulement après vérification explicite
  await admin.from("data_sources").insert({ organization_id: org, kind: "ical", property_id: prop!.id, label: "Airbnb QA", platform: "airbnb" });
  await m.reload();
  await expect(m.getByTestId("booking-stale-cals")).toContainText("Airbnb QA");
  await m.getByTestId("booking-confirm").click();
  await expect(m.getByTestId("booking-stale")).toContainText("Airbnb QA");
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("origin_request_id", reqId)).count).toBe(0);
  await m.getByTestId("booking-confirm-ack").click();
  await expect(m.getByTestId("booking-confirmed")).toBeVisible();
  await expect(m.getByTestId("booking-invite-delivery")).toHaveAttribute("data-status", "failed");

  // Un seul séjour, rattaché à l'ancien ; missions, accès voyageur et invitation ; décision tracée
  const { data: created } = await admin.from("reservations").select("id, status, previous_reservation_id, guest_email").eq("origin_request_id", reqId);
  expect(created).toHaveLength(1);
  expect(created![0]).toMatchObject({ status: "confirmed", previous_reservation_id: stayId, guest_email: `lea-retour-${run}@halo.invalid` });
  const newId = created![0].id as string;
  expect((await admin.from("guest_links").select("id", { count: "exact", head: true }).eq("reservation_id", newId)).count).toBe(1);
  expect((await admin.from("tasks").select("id", { count: "exact", head: true }).eq("reservation_id", newId).neq("status", "cancelled")).count).toBeGreaterThan(0);
  const { data: hist } = await admin.from("booking_request_events").select("kind, visibility, body").eq("request_id", reqId);
  expect(hist!.some((e) => e.kind === "confirm_refused")).toBe(true);
  expect(hist!.some((e) => e.visibility === "internal" && /Airbnb QA/.test(e.body ?? ""))).toBe(true);
  // Rejouer la confirmation : sans effet
  // Sans session : refusé
  const replay = await anon.rpc("booking_confirm", { org, request: reqId, ack_calendars: true });
  expect(replay.error).not.toBeNull();
  expect((await admin.from("reservations").select("id", { count: "exact", head: true }).eq("origin_request_id", reqId)).count).toBe(1);
  await m.getByTestId("booking-open-stay").click();
  await expect(m).toHaveURL(new RegExp(`/fr/app/stays/${newId}$`));

  await g.reload();
  await expect(g.getByTestId("bk-request")).toHaveAttribute("data-status", "confirmed");
  await expect(g.locator("body")).not.toContainText("QA secret interne");

  // Révocation du lien : plus aucun accès ; un nouveau lien remplace l'ancien
  await m.goto(`/fr/app/stays/${stayId}`);
  await m.getByTestId("booking-link-revoke").click();
  await expect(m.getByTestId("booking-link-status")).toContainText("Aucun lien de demande actif");
  await g.reload();
  await expect(g.getByTestId("booking-unavailable")).toBeVisible();
});

test("27 · satisfaction : avis voyageur et propriétaire, note faible suivie, avis importé séparé, vitrine avec consentement et retrait", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `avis ${run}`);
  const { data: prop } = await admin.from("properties").select("id, name").eq("organization_id", org).single();
  // Séjour terminé (fictif)
  const { data: past } = await admin
    .from("reservations")
    .insert({ organization_id: org, property_id: prop!.id, source: "manual", status: "confirmed", guest_name: "Sam Passé", guest_email: `sam-${run}@halo.invalid`, check_in_at: new Date(Date.now() - 64 * 86_400_000).toISOString(), check_out_at: new Date(Date.now() - 60 * 86_400_000).toISOString() })
    .select("id")
    .single();
  expect(past, "séjour passé fictif").not.toBeNull();
  await m.goto("/fr/app/satisfaction");
  await expect(m.getByTestId("sat-verified")).toContainText("aucune moyenne n'est calculée");

  await m.goto(`/fr/app/stays/${past!.id}`);
  await m.getByTestId("review-link-create").click();
  const rUrl = (await m.getByTestId("once-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  expect(rUrl).toMatch(/^\/fr\/avis\/[0-9a-f]{64}$/);

  // Voyageur : note globale obligatoire, le reste facultatif ; consentement explicite
  const g = await newPage(browser);
  await g.goto(rUrl);
  await g.getByTestId("review-send").click();
  await expect(g.getByText("La note globale est obligatoire.")).toBeVisible();
  await g.getByTestId("star-overall-2").click();
  await g.getByTestId("star-cleanliness-1").click();
  await g.getByTestId("return-false").click();
  await g.getByTestId("review-comment").fill("Ménage insuffisant à l'arrivée.");
  await g.getByTestId("review-send").click();
  await expect(g.getByTestId("review-ok")).toBeVisible();
  const { data: rev } = await admin.from("reviews").select("id, follow_status, verified, consent_publish").eq("organization_id", org).eq("kind", "guest").single();
  expect(rev).toMatchObject({ follow_status: "to_handle", verified: true, consent_publish: false });
  expect((await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("template", "team_low_review")).count).toBeGreaterThan(0);

  // Responsable : alerte, score avec nombre d'avis, suivi + incident sans désigner d'agent
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-lowReviewsGuest")).toContainText("1 avis voyageur à traiter");
  await expect(m.getByTestId("home-lowReviewsOwner")).toContainText("Aucun avis propriétaire à traiter");
  await m.goto("/fr/app/satisfaction");
  await expect(m.getByTestId("sat-verified-avg")).toHaveText("2,0");
  await expect(m.getByTestId("sat-verified")).toContainText("sur 1 avis");
  await expect(m.getByTestId("sat-questions")).toContainText("Propreté");
  await expect(m.getByTestId("sat-questions")).toContainText("Communication— · 1 sans réponse");
  await expect(m.getByTestId("review-row")).toHaveAttribute("data-follow", "to_handle");
  await m.getByTestId("review-follow-open").click();
  await expect(m.getByTestId("review-follow-status")).toHaveValue("to_handle"); // état actuel par défaut
  await m.getByTestId("review-follow-status").selectOption("handled");
  await m.getByLabel("Suivi interne").fill("Rappel de la checklist propreté à l'équipe.");
  await m.getByTestId("review-make-incident").check();
  await m.getByTestId("review-follow-save").click();
  await expect(m.getByTestId("review-row")).toHaveAttribute("data-follow", "handled");
  await expect(m.getByTestId("review-incident-link")).toBeVisible();
  const { data: inc } = await admin.from("incidents").select("source, description").eq("organization_id", org).eq("reservation_id", past!.id).single();
  expect(inc!.source).toBe("manager");
  // L'équipe ne peut pas modifier l'avis : aucun bouton d'édition de la note ou du commentaire
  await expect(m.getByTestId("review-row").getByRole("textbox")).toHaveCount(0);

  // Le voyageur modifie son avis (14 jours) et accepte la publication avec une signature
  await g.reload();
  await expect(g.getByTestId("review-existing")).toBeVisible();
  await g.getByTestId("star-overall-4").click();
  await g.getByTestId("review-consent").check();
  await g.getByTestId("review-label").fill("Sam, Lyon");
  await g.getByTestId("review-send").click();
  await expect(g.getByTestId("review-ok")).toBeVisible();
  expect((await admin.from("reviews").select("overall, consent_publish").eq("id", rev!.id).single()).data).toMatchObject({ overall: 4, consent_publish: true });

  // Avis importé : jamais mélangé aux avis vérifiés
  await m.goto("/fr/app/satisfaction");
  await m.getByTestId("imported-open").click();
  await m.getByTestId("imported-from").fill("Airbnb");
  await m.getByTestId("imported-date").fill(ymd(-20));
  await m.getByTestId("imported-save").click();
  await expect(m.getByTestId("sat-imported")).toHaveAttribute("data-count", "1");
  await expect(m.getByTestId("sat-verified")).toHaveAttribute("data-count", "1");
  await expect(m.getByTestId("sat-verified-avg")).toHaveText("4,0");

  // Propriétaire relié à un logement géré : lien d'avis
  await m.goto("/fr/app/satisfaction/owners");
  await expect(m.getByTestId("owners-limits")).toContainText("Pas d'espace propriétaire authentifié");
  await m.getByTestId("owner-add").click();
  await m.getByTestId("owner-name").fill("Mme Propriétaire QA");
  await m.getByTestId("owner-email").fill(`proprio-${run}@halo.invalid`);
  await m.getByTestId("owner-save").click();
  await expect(m.getByTestId("owner-row")).toContainText("Aucun logement relié");
  await m.getByTestId("owner-edit").click();
  await m.getByTestId("owner-property").first().check();
  await m.getByTestId("owner-save").click();
  await expect(m.getByTestId("owner-row")).toContainText(prop!.name);
  await m.getByTestId("owner-review-send").click();
  await expect(m.getByTestId("owner-review-delivery")).toHaveAttribute("data-status", "failed");
  const oUrl = (await m.getByTestId("owner-review-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const o = await newPage(browser);
  await o.goto(oUrl);
  await expect(o.getByTestId("review-portal")).toHaveAttribute("data-kind", "owner");
  await o.getByTestId("star-overall-5").click();
  await o.getByTestId("star-reactivity-5").click();
  await o.getByTestId("review-comment").fill("Gestion sérieuse et réactive.");
  await o.getByTestId("review-send").click();
  await expect(o.getByTestId("review-ok")).toBeVisible();

  // Vitrine : témoignage consenti, aperçu, publication explicite, mention « sélection »
  const slug = `qa-${run}`;
  await m.goto("/fr/app/satisfaction/showcase");
  await expect(m.getByTestId("showcase-testimonial")).toHaveCount(1);
  await m.getByTestId("showcase-slug").fill(slug);
  await m.getByTestId("showcase-testimonial").check();
  await m.getByTestId("showcase-save").click();
  await expect(m.getByTestId("showcase-preview")).toContainText("Sam, Lyon");
  const pub = await newPage(browser);
  await pub.goto(`/fr/v/${slug}`);
  await expect(pub.getByTestId("showcase-unavailable")).toBeVisible();
  await m.getByTestId("showcase-publish-btn").click();
  await expect(m.getByTestId("showcase-unpublish")).toBeVisible();
  await pub.reload();
  await expect(pub.getByTestId("showcase-score-guest")).toContainText("1 avis vérifié");
  await expect(pub.getByTestId("showcase-selection")).toContainText("Sélection");
  await expect(pub.getByTestId("showcase-testimonial-card")).toContainText("Ménage insuffisant");
  await expect(pub.locator("body")).not.toContainText(`sam-${run}`);
  await expect(pub.locator("body")).not.toContainText("Sam Passé");

  // Retrait du consentement : le témoignage disparaît aussitôt
  await g.reload();
  await g.getByTestId("review-consent").uncheck();
  await g.getByTestId("review-send").click();
  await expect(g.getByTestId("review-ok")).toBeVisible();
  await pub.reload();
  await expect(pub.getByTestId("showcase-testimonial-card")).toHaveCount(0);

  // Retrait de la vitrine
  await m.reload();
  await m.getByTestId("showcase-unpublish").click();
  await expect(m.getByTestId("showcase-publish-btn")).toBeVisible();
  await pub.reload();
  await expect(pub.getByTestId("showcase-unavailable")).toBeVisible();
});

test("28 · scénario de référence : absence, arrivée menacée, réaffectation, linge, retard, arrivée anticipée, fenêtres lisibles", async ({ browser }) => {
  const m = await newPage(browser);
  const { org, agentId } = await testScenario(m, `ref ${run}`);
  const { data: next } = await admin.from("reservations").select("id, check_in_at").eq("organization_id", org).eq("guest_name", "Voyageur test").single();
  const { data: clean } = await admin.from("tasks").select("id, window_start, window_end").eq("organization_id", org).eq("type", "turnover").eq("next_reservation_id", next!.id).single();
  // L'agent affecté au ménage devient absent (absence acceptée couvrant le créneau)
  const { error: absErr } = await admin.from("absences").insert({ organization_id: org, scope: "member", member_id: agentId, kind: "unavailable", starts_at: new Date(Date.parse(clean!.window_start) - 3_600_000).toISOString(), ends_at: new Date(Date.parse(clean!.window_end) + 3_600_000).toISOString(), status: "accepted", unplanned: true, reason: "QA fictif", client_id: crypto.randomUUID() });
  expect(absErr).toBeNull();

  // Manager : l'arrivée est menacée, avec la cause réelle (fausse couverture)
  await m.goto("/fr/app");
  const arrival = m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" });
  await expect(arrival).toHaveAttribute("data-state", "blocked");
  await expect(arrival.getByTestId("arrival-causes")).toContainText("affecté à une personne absente");

  // Mission : fenêtre, durée, créneau distincts ; conflit d'absence ; personnes disponibles et limites
  await m.goto(`/fr/app/missions/${clean!.id}`);
  await expect(m.getByTestId("mission-deadline")).toBeVisible();
  await expect(m.getByTestId("mission-from")).toBeVisible();
  await expect(m.getByTestId("mission-duration")).toContainText("1 h 30");
  await expect(m.getByTestId("mission-duration")).toContainText("estimation");
  await expect(m.getByTestId("mission-slot")).toContainText("Pas d'horaire planifié");
  await expect(m.getByTestId("mission-absence-conflict")).toBeVisible();
  await expect(m.getByTestId("mission-suggestions")).toContainText("Temps de trajet");
  await expect(m.getByTestId("mission-suggestion")).toHaveCount(1); // le responsable, seul membre sans absence

  // Agent : signale un manque de linge et un retard depuis sa mission
  const agent = await newPage(browser);
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`ref-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/missions");
  await expect(agent.getByTestId("mission-timing-compact").first()).toContainText("À faire avant le");
  await agent.goto(`/fr/app/missions/${clean!.id}`);
  for (const [cat, text] of [["linen", "Il manque deux housses de couette"], ["delay", "Retard de 30 min sur la mission précédente"]]) {
    await agent.getByTestId("report-open").click();
    await agent.getByTestId("report-category").selectOption(cat);
    await agent.getByTestId("report-description").fill(text);
    await agent.getByTestId("report-send").click();
    await expect(agent.getByTestId("reported-incident").filter({ hasText: cat === "linen" ? "Linge manquant" : "Retard" })).toBeVisible();
  }
  const { data: linen } = await admin.from("incidents").select("property_id, task_id, reservation_id, reported_by").eq("organization_id", org).eq("category", "linen").single();
  expect(linen).toMatchObject({ task_id: clean!.id, reservation_id: next!.id, reported_by: agentId });

  // Manager : incident linge dans le bon contexte, pris en charge ; cause visible sur l'arrivée
  await m.goto("/fr/app/incidents");
  const inc = m.getByTestId("incident-row").filter({ hasText: "Il manque deux housses" });
  await expect(inc).toContainText("Linge manquant ou abîmé");
  await inc.getByTestId("incident-take").click();
  await expect(inc).toHaveAttribute("data-status", "in_progress");
  await m.goto("/fr/app");
  await expect(arrival.getByTestId("arrival-causes")).toContainText("Linge manquant ou abîmé : Il manque deux housses");

  // Voyageur : demande d'arrivée anticipée, jamais acceptée automatiquement
  await m.goto(`/fr/app/stays/${next!.id}`);
  await m.getByTestId("link-create").click();
  const gUrl = (await m.getByTestId("guest-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const g = await newPage(browser);
  await g.goto(gUrl);
  await expect(g.getByTestId("guest-timing")).toContainText("pas accepté automatiquement");
  const early = new Date(next!.check_in_at);
  early.setHours(13, 0, 0, 0);
  await g.getByTestId("guest-timing-kind").selectOption("early_checkin");
  await g.getByTestId("guest-timing-when").fill(local(early));
  await g.getByTestId("guest-timing-send").click();
  await expect(g.getByTestId("guest-timing-ok")).toContainText("Rien n'est confirmé");
  const { data: svc } = await admin.from("service_requests").select("id, status").eq("organization_id", org).eq("kind", "early_checkin").single();
  expect(svc!.status).toBe("requested");
  await m.goto("/fr/app");
  await expect(arrival.getByTestId("arrival-causes")).toContainText("Arrivée anticipée");

  // Réponse du responsable : retrouvée par le voyageur avec son statut
  await m.goto(`/fr/app/services/${svc!.id}`);
  // Confirmation par la décision dédiée : préparation non garantie (ménage sans créneau) → accord explicite
  await expect(m.getByTestId("decide-confirmed")).toHaveCount(0);
  await m.getByTestId("timing-ack").check();
  await m.getByTestId("timing-message").fill("Arrivée possible à 14 h, pas avant.");
  await m.getByTestId("timing-confirm").click();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  await g.reload();
  await expect(g.locator("body")).toContainText("Arrivée possible à 14 h");
  // Aucune notification « envoyée » sans adresse réelle
  expect((await admin.from("notification_outbox").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "sent")).count).toBe(0);

  // Réaffectation en connaissance de cause : la fausse couverture disparaît
  await m.goto(`/fr/app/missions/${clean!.id}`);
  const options = await m.getByTestId("assign-select").locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  const other = options.find((v) => v !== agentId)!;
  await m.getByTestId("assign-select").selectOption(other);
  await expect.poll(async () => (await admin.from("tasks").select("assignee_id").eq("id", clean!.id).single()).data!.assignee_id).toBe(other);
  await m.goto("/fr/app");
  await expect(arrival.getByTestId("arrival-causes")).not.toContainText("affecté à une personne absente");
  // L'ancien agent ne voit plus la mission
  await agent.goto(`/fr/app/missions/${clean!.id}`);
  await expect(agent.getByTestId("not-found")).toBeVisible();
  for (const c of [m, agent, g]) await c.context().close();
});

test("29 · avis à traiter : voyageur et propriétaire séparés, compteurs, état conservé, critère faible, note du service", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `alerte ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  const { data: past } = await admin
    .from("reservations")
    .insert({ organization_id: org, property_id: prop!.id, source: "manual", status: "confirmed", guest_name: "Gaby Critère", check_in_at: new Date(Date.now() - 74 * 86_400_000).toISOString(), check_out_at: new Date(Date.now() - 70 * 86_400_000).toISOString() })
    .select("id")
    .single();
  // Propriétaire fictif relié au logement : avis 2/5 seul
  const { data: owner } = await admin.from("property_owners").insert({ organization_id: org, name: "Propriétaire Alerte" }).select("id").single();
  await admin.from("owner_properties").insert({ organization_id: org, owner_id: owner!.id, property_id: prop!.id });
  await m.goto("/fr/app/satisfaction/owners");
  await m.getByTestId("owner-review-copy").click();
  const oUrl = (await m.getByTestId("owner-review-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const o = await newPage(browser);
  await o.goto(oUrl);
  await expect(o.getByTestId("stars-service")).toHaveCount(0); // pas de note de service pour un propriétaire
  await o.getByTestId("star-overall-2").click();
  await o.getByTestId("review-send").click();
  await expect(o.getByTestId("review-ok")).toBeVisible();
  await o.reload();
  await expect(o.getByTestId("review-existing")).toContainText("gestion de votre bien");
  await expect(o.getByTestId("review-existing")).toContainText("Vous pouvez encore le modifier");

  await m.goto("/fr/app");
  await expect(m.getByTestId("home-lowReviewsOwner")).toContainText("1 avis propriétaire à traiter");
  await expect(m.getByTestId("home-lowReviewsGuest")).toContainText("Aucun avis voyageur à traiter");
  await m.getByTestId("home-cta-lowReviewsOwner").click();
  await expect(m).toHaveURL(/kind=owner&filter=to_handle/);
  await expect(m.getByTestId("review-row")).toHaveCount(1);

  // Voyageur : 4/5 global mais 2/5 en propreté → à traiter ; note du service distincte
  await m.goto(`/fr/app/stays/${past!.id}`);
  await m.getByTestId("review-link-create").click();
  const gUrl = (await m.getByTestId("once-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const g = await newPage(browser);
  await g.goto(gUrl);
  await g.getByTestId("star-overall-4").click();
  await g.getByTestId("star-service-5").click();
  await g.getByTestId("star-cleanliness-2").click();
  await g.getByTestId("review-send").click();
  await expect(g.getByTestId("review-ok")).toBeVisible();

  await m.goto("/fr/app");
  await expect(m.getByTestId("home-lowReviewsGuest")).toContainText("1 avis voyageur à traiter");
  await expect(m.getByTestId("home-lowReviewsOwner")).toContainText("1 avis propriétaire à traiter");
  await m.getByTestId("home-cta-lowReviewsGuest").click();
  const row = m.getByTestId("review-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("review-low-reason")).toContainText("Propreté");
  await expect(row.getByTestId("review-service")).toContainText("5/5");
  await expect(m.getByTestId("sat-other-to-handle")).toContainText("1 avis propriétaire à traiter");
  await expect(m.getByTestId("sat-service")).toContainText("5,0");

  // Le suivi garde l'état actuel par défaut : enregistrer une note ne le marque pas « traité »
  await row.getByTestId("review-follow-open").click();
  await expect(row.getByTestId("review-follow-status")).toHaveValue("to_handle");
  await row.getByLabel("Suivi interne").fill("Rappel propreté salle de bain");
  await row.getByTestId("review-follow-save").click();
  await expect(row).toHaveAttribute("data-follow", "to_handle");
  await row.getByTestId("review-follow-open").click();
  await row.getByTestId("review-follow-status").selectOption("handled");
  await row.getByTestId("review-follow-save").click();
  await expect(m.getByTestId("review-row")).toHaveCount(0); // filtre « à traiter »
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-lowReviewsGuest")).toContainText("Aucun avis voyageur à traiter");
  await expect(m.getByTestId("home-lowReviewsOwner")).toContainText("1 avis propriétaire à traiter");

  // Sans droit : un agent n'accède pas aux avis
  const agent = await newPage(browser);
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`alerte-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/satisfaction?kind=owner&filter=to_handle");
  await expect(agent).toHaveURL(/\/fr\/app\/missions$/);
  for (const c of [m, o, g, agent]) await c.context().close();
});

test("30 · arrivée anticipée : contraintes affichées, accord explicite, séjour et échéances cohérents, annulation, horaire impossible", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `tim ${run}`);
  const { data: stay } = await admin.from("reservations").select("id, check_in_at").eq("organization_id", org).eq("guest_name", "Voyageur test").single();
  const { data: clean } = await admin.from("tasks").select("id, window_start").eq("organization_id", org).eq("next_reservation_id", stay!.id).single();
  // Cas reproduit : ménage non attribué + action indispensable ouverte, échéance à l'heure d'arrivée
  await admin.from("tasks").update({ assignee_id: null, status: "unassigned" }).eq("id", clean!.id);
  await admin.from("stay_prep_actions").insert({ organization_id: org, reservation_id: stay!.id, title: "Ménage avant arrivée (QA)", kind: "task", blocking: true, due_at: stay!.check_in_at, task_id: clean!.id });
  await m.goto(`/fr/app/stays/${stay!.id}`);
  await m.getByTestId("link-create").click();
  const gUrl = (await m.getByTestId("guest-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const g = await newPage(browser);
  await g.goto(gUrl);
  const early = new Date(stay!.check_in_at);
  early.setHours(14, 0, 0, 0);
  await g.getByTestId("guest-timing-kind").selectOption("early_checkin");
  await g.getByTestId("guest-timing-when").fill(local(early));
  await g.getByTestId("guest-timing-send").click();
  await expect(g.getByTestId("guest-timing-ok")).toBeVisible();
  await expect(g.getByTestId("guest-timing-note")).toContainText("votre arrivée reste prévue");
  const { data: svc } = await admin.from("service_requests").select("id").eq("organization_id", org).eq("kind", "early_checkin").single();

  // Responsable : contraintes connues, points non vérifiés, confirmation impossible sans accord explicite
  await m.goto(`/fr/app/services/${svc!.id}`);
  const td = m.getByTestId("timing-decision");
  await expect(td.getByTestId("timing-current")).toContainText("16:00");
  await expect(td.getByTestId("timing-risks")).toContainText("n'est attribué à personne");
  await expect(td.getByTestId("timing-risks")).toContainText("actions indispensables");
  await expect(td.getByTestId("timing-action")).toContainText("Ménage avant arrivée (QA)");
  await expect(td.getByTestId("timing-unverified")).toContainText("linge");
  await expect(m.getByTestId("decide-confirmed")).toHaveCount(0); // la décision générique ne confirme pas un horaire
  await expect(td.getByTestId("timing-confirm")).toBeDisabled();
  await td.getByTestId("timing-ack").check();
  await td.getByTestId("timing-message").fill("Arrivée à 14 h confirmée, logement prêt si le ménage est fait à temps.");
  await td.getByTestId("timing-confirm").click();
  await expect(td.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");

  // Cohérence : séjour, ménage, action, historique, voyageur, alerte d'arrivée
  const { data: after } = await admin.from("reservations").select("check_in_at").eq("id", stay!.id).single();
  expect(Date.parse(after!.check_in_at)).toBe(early.getTime());
  expect(Date.parse((await admin.from("tasks").select("window_end").eq("id", clean!.id).single()).data!.window_end)).toBe(early.getTime());
  expect(Date.parse((await admin.from("stay_prep_actions").select("due_at").eq("reservation_id", stay!.id).single()).data!.due_at)).toBe(early.getTime());
  await m.reload();
  await expect(m.getByTestId("timing-cancel")).toBeVisible();
  await m.goto(`/fr/app/stays/${stay!.id}`);
  await m.getByText("Historique").click();
  await expect(m.getByTestId("prep-history")).toContainText("Horaire du séjour modifié");
  await g.reload();
  await expect(g.getByTestId("guest-timing-note")).toContainText("Confirmé : votre arrivée est désormais prévue");
  await expect(g.getByTestId("guest-timing-note")).toContainText("14:00");
  await m.goto("/fr/app");
  await expect(m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" }).getByTestId("arrival-causes")).toContainText("Ménage sans agent");

  // Annulation : horaire et échéances rétablis
  await m.goto(`/fr/app/services/${svc!.id}`);
  await m.getByTestId("timing-cancel").click();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  expect((await admin.from("reservations").select("check_in_at").eq("id", stay!.id).single()).data!.check_in_at).toBe(stay!.check_in_at);
  await g.reload();
  await expect(g.getByTestId("guest-timing-note")).toContainText("Votre arrivée reste prévue");

  // Horaire impossible (avant la fin du ménage possible) : refus, aucune confirmation proposée
  const tooEarly = new Date(clean!.window_start);
  tooEarly.setMinutes(tooEarly.getMinutes() + 30);
  await g.getByTestId("guest-timing-kind").selectOption("early_checkin");
  await g.getByTestId("guest-timing-when").fill(local(tooEarly));
  await g.getByTestId("guest-timing-send").click();
  await expect(g.getByTestId("guest-timing-ok")).toBeVisible();
  const { data: svc2 } = await admin.from("service_requests").select("id").eq("organization_id", org).eq("kind", "early_checkin").eq("status", "requested").single();
  await m.goto(`/fr/app/services/${svc2!.id}`);
  await expect(m.getByTestId("timing-blocking")).toContainText("Le ménage ne tient pas");
  await expect(m.getByTestId("timing-confirm")).toHaveCount(0);
  for (const c of [m, g]) await c.context().close();
});

test("31 · absences : risque (absence partielle) distingué du conflit confirmé, avec ce qui fonde la conclusion", async ({ browser }) => {
  const m = await newPage(browser);
  const { org, agentId } = await testScenario(m, `abs ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  const day = (n: number, h: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  const { data: k } = await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "maintenance", status: "assigned", assignee_id: agentId, window_start: day(10, 9), window_end: day(13, 18), duration_min: 90 }).select("id").single();
  // Absence d'une journée au milieu d'une fenêtre de plusieurs jours : risque, pas conflit
  const { error } = await admin.from("absences").insert({ organization_id: org, scope: "member", member_id: agentId, kind: "leave", starts_at: day(11, 0), ends_at: day(12, 0), status: "accepted", client_id: crypto.randomUUID() });
  expect(error).toBeNull();
  await m.goto(`/fr/app/missions/${k!.id}`);
  await expect(m.getByTestId("mission-absence-risk")).toContainText("absent(e) sur une partie de la fenêtre");
  await expect(m.getByTestId("mission-absence-basis")).toContainText("plus long temps libre continu");
  await expect(m.getByTestId("mission-absence-basis")).toContainText("pas une disponibilité garantie");
  await expect(m.getByTestId("mission-absence-conflict")).toHaveCount(0);
  await m.goto("/fr/app/team");
  await expect(m.getByTestId("availability-risk")).toContainText("absence sur une partie de la fenêtre");
  await expect(m.getByTestId("availability-conflict")).toHaveCount(0);
  // Absence qui couvre toute la fenêtre : conflit confirmé, avec les données qui le fondent
  await admin.from("absences").insert({ organization_id: org, scope: "member", member_id: agentId, kind: "unavailable", starts_at: day(10, 0), ends_at: day(14, 0), status: "accepted", client_id: crypto.randomUUID() });
  await m.goto(`/fr/app/missions/${k!.id}`);
  await expect(m.getByTestId("mission-absence-conflict")).toBeVisible();
  await expect(m.getByTestId("mission-absence-basis")).toContainText("0 min");
  await m.close();
});

test("32 · lieux avant l'ouverture : aucune donnée qui localise le logement", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `loc ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  await admin.from("properties").update({ latitude: 48.8584, longitude: 2.2945 }).eq("id", prop!.id);
  await admin.from("property_places").insert([
    { organization_id: org, property_id: prop!.id, source: "manager", category: "activities", name: "Monument au même endroit", latitude: 48.8584, longitude: 2.2945 },
    { organization_id: org, property_id: prop!.id, source: "manager", category: "food", name: "Bistrot à 1,5 km", latitude: 48.871, longitude: 2.2995, address: "1 avenue Fictive, Paris" },
  ]);
  const { url } = await prepStay(m, browser, "Lou Avance", 12);
  const g = await newPage(browser);
  await g.goto(url);
  const around = g.getByTestId("guest-around");
  await expect(around.getByTestId("around-near-hidden")).toContainText("1 lieu tout proche du logement apparaîtra");
  await expect(around.getByTestId("around-place")).toHaveCount(1);
  await expect(around).not.toContainText("Monument au même endroit");
  await expect(around.getByTestId("around-distance-band")).toContainText("1 à 2 km");
  await expect(around.getByTestId("around-distance")).toHaveCount(0);
  await expect(around.getByTestId("places-map")).toHaveCount(0);
  for (const c of [m, g]) await c.context().close();
});

test("33 · retest du 2/11 : mission de préparation liée, double clic, modification concurrente, message obsolète, horaire contradictoire résolu", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `re2 ${run}`);
  const { data: stay } = await admin.from("reservations").select("id, check_in_at, property_id").eq("organization_id", org).eq("guest_name", "Voyageur test").single();
  const { data: clean } = await admin.from("tasks").select("id, window_start").eq("organization_id", org).eq("next_reservation_id", stay!.id).eq("type", "turnover").single();
  const at = (h: number, mi = 0) => {
    const d = new Date(stay!.check_in_at);
    d.setHours(h, mi, 0, 0);
    return d;
  };
  // Configuration du retest : action indispensable liée à une mission de préparation non attribuée (13:30 → 16:00)
  const { data: prepTask } = await admin.from("tasks").insert({ organization_id: org, property_id: stay!.property_id, next_reservation_id: stay!.id, type: "other", title: "Préparer la table VIP (QA)", is_auto_generated: false, window_start: at(13, 30).toISOString(), window_end: stay!.check_in_at, duration_min: 60 }).select("id").single();
  await admin.from("stay_prep_actions").insert({ organization_id: org, reservation_id: stay!.id, title: "Table VIP (QA)", kind: "task", blocking: true, due_at: stay!.check_in_at, task_id: prepTask!.id });
  await m.goto(`/fr/app/stays/${stay!.id}`);
  await m.getByTestId("link-create").click();
  const gUrl = (await m.getByTestId("guest-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const g = await newPage(browser);
  await g.goto(gUrl);
  await g.waitForLoadState("networkidle");
  const ask = async (d: Date) => {
    await g.getByTestId("guest-timing-kind").selectOption("early_checkin");
    await g.getByTestId("guest-timing-when").fill(local(d));
    await g.getByTestId("guest-timing-send").click();
    await expect(g.getByTestId("guest-timing-ok")).toBeVisible();
    return (await admin.from("service_requests").select("id").eq("organization_id", org).eq("kind", "early_checkin").eq("status", "requested").single()).data!.id as string;
  };
  const sv1 = await ask(at(13));

  // Modification concurrente : le séjour change pendant que la page est ouverte → refus, rien n'est modifié
  await m.goto(`/fr/app/services/${sv1}`);
  await expect(m.getByTestId("timing-task").filter({ hasText: "Préparer la table VIP" })).toHaveAttribute("data-effect", "unchanged_cannot_fit");
  await admin.from("reservations").update({ check_in_at: at(16, 30).toISOString() }).eq("id", stay!.id);
  await m.getByTestId("timing-ack").check();
  await m.getByTestId("timing-confirm").click();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "stay_changed");
  // Refus ensuite : l'ancien message d'échec disparaît
  await m.getByTestId("decide-declined").click();
  await m.getByTestId("decide-confirm").click();
  await expect(m.getByTestId("decide-saved")).toBeVisible();
  await expect(m.getByTestId("timing-result")).toHaveCount(0);
  await expect(m.getByTestId("timing-error")).toHaveCount(0);
  await admin.from("reservations").update({ check_in_at: stay!.check_in_at }).eq("id", stay!.id);

  // Nouvelle demande à 13 h, confirmée avec accord ; double clic = une seule décision
  const sv2 = await ask(at(13));
  await m.goto(`/fr/app/services/${sv2}`);
  await m.getByTestId("timing-ack").check();
  await m.getByTestId("timing-confirm").dblclick();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  expect((await admin.from("service_events").select("id", { count: "exact", head: true }).eq("service_id", sv2).eq("kind", "status").eq("status", "confirmed")).count).toBe(1);
  // Séjour, ménage, mission de préparation (laissée), action, historique, voyageur
  expect(Date.parse((await admin.from("reservations").select("check_in_at").eq("id", stay!.id).single()).data!.check_in_at)).toBe(at(13).getTime());
  expect(Date.parse((await admin.from("tasks").select("window_end").eq("id", clean!.id).single()).data!.window_end)).toBe(at(13).getTime());
  const prep = (await admin.from("tasks").select("window_start, window_end").eq("id", prepTask!.id).single()).data!;
  expect([Date.parse(prep.window_start), Date.parse(prep.window_end)]).toEqual([at(13, 30).getTime(), Date.parse(stay!.check_in_at)]);
  expect(Date.parse((await admin.from("stay_prep_actions").select("due_at").eq("task_id", prepTask!.id).single()).data!.due_at)).toBe(at(13).getTime());
  await m.goto(`/fr/app/stays/${stay!.id}`);
  await expect(m.getByTestId("stay-relations")).toBeVisible();
  await m.getByText("Historique").click();
  await expect(m.getByTestId("prep-history")).toContainText("Horaire du séjour modifié");
  await g.reload();
  await expect(g.locator("[data-testid=guest-service][data-status=confirmed]").getByTestId("guest-timing-note")).toContainText("Confirmé : votre arrivée est désormais prévue");

  // Horaire contradictoire (séjour remis à 16 h après confirmation) : signalé partout, résolu par décision tracée
  await admin.from("reservations").update({ check_in_at: stay!.check_in_at }).eq("id", stay!.id);
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-timingMismatch")).toContainText("1 horaire confirmé ne correspond pas au séjour");
  await g.reload();
  await expect(g.locator("[data-testid=guest-service][data-status=confirmed]").getByTestId("guest-timing-note")).toContainText("Horaire en cours de vérification");
  await m.getByTestId("home-cta-timingMismatch").click();
  await expect(m.getByTestId("timing-legacy")).toContainText("Horaires contradictoires");
  await m.getByTestId("timing-ack").check();
  await m.getByTestId("timing-apply-legacy").click();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  expect(Date.parse((await admin.from("reservations").select("check_in_at").eq("id", stay!.id).single()).data!.check_in_at)).toBe(at(13).getTime());
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-timingMismatch")).toContainText("Aucun horaire contradictoire");
  for (const c of [m, g]) await c.context().close();
});

test("35 · brief du 3/11 : 14 h puis 13 h — une seule heure applicable, « remplacée » sans fausse alerte, annulation, régularisation avec message", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `succ ${run}`);
  const { data: stay } = await admin.from("reservations").select("id, check_in_at, property_id").eq("organization_id", org).eq("guest_name", "Voyageur test").single();
  const at = (h: number, mi = 0) => {
    const d = new Date(stay!.check_in_at);
    d.setHours(h, mi, 0, 0);
    return d;
  };
  // Action indispensable sans échéance : jamais décrite comme « plus tardive »
  await admin.from("stay_prep_actions").insert({ organization_id: org, reservation_id: stay!.id, title: "Lit bébé (QA)", kind: "task", blocking: true, due_at: null });
  await m.goto(`/fr/app/stays/${stay!.id}`);
  await m.getByTestId("link-create").click();
  const gUrl = (await m.getByTestId("guest-link-url").inputValue()).replace(/^https?:\/\/[^/]+/, "");
  const g = await newPage(browser);
  await g.goto(gUrl);
  await g.waitForLoadState("networkidle");
  const ask = async (d: Date) => {
    await g.getByTestId("guest-timing-kind").selectOption("early_checkin");
    await g.getByTestId("guest-timing-when").fill(local(d));
    await g.getByTestId("guest-timing-send").click();
    await expect(g.getByTestId("guest-timing-ok")).toBeVisible();
    return (await admin.from("service_requests").select("id").eq("organization_id", org).eq("kind", "early_checkin").eq("status", "requested").single()).data!.id as string;
  };
  const confirm = async (id: string) => {
    await m.goto(`/fr/app/services/${id}`);
    await expect(m.getByTestId("timing-not-ready")).toBeVisible();
    await m.getByTestId("timing-ack").check();
    await m.getByTestId("timing-confirm").click();
    await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  };
  const stayAt = async () => Date.parse((await admin.from("reservations").select("check_in_at").eq("id", stay!.id).single()).data!.check_in_at);

  const sv14 = await ask(at(14));
  await m.goto(`/fr/app/services/${sv14}`);
  await expect(m.getByTestId("timing-action").filter({ hasText: "Lit bébé" })).toHaveAttribute("data-effect", "no_due");
  await expect(m.getByTestId("timing-action").filter({ hasText: "Lit bébé" })).toContainText("aucune échéance renseignée");
  await confirm(sv14);
  expect(await stayAt()).toBe(at(14).getTime());
  const sv12 = await ask(at(13));
  await confirm(sv12);
  expect(await stayAt()).toBe(at(13).getTime());

  // Responsable : la 14 h est « remplacée », la 12 h applicable ; aucune alerte de contradiction
  await m.goto(`/fr/app/services/${sv14}`);
  await expect(m.getByTestId("timing-state")).toHaveAttribute("data-state", "superseded");
  await expect(m.getByTestId("timing-state")).toContainText("remplacé par une confirmation ultérieure");
  await expect(m.getByTestId("timing-legacy")).toHaveCount(0);
  await m.goto(`/fr/app/services/${sv12}`);
  await expect(m.getByTestId("timing-state")).toHaveAttribute("data-state", "applied");
  await m.goto("/fr/app/services");
  await expect(m.getByTestId("services-closed").getByTestId("service-row-status").filter({ hasText: "Remplacée" })).toHaveCount(1);
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-timingMismatch")).toContainText("Aucun horaire contradictoire");
  // Voyageur (après rechargement) : une heure applicable, l'ancienne marquée remplacée avec l'heure
  await g.reload();
  await expect(g.locator("[data-testid=guest-timing-note][data-state=superseded]")).toContainText("L'horaire de");
  await expect(g.locator("[data-testid=guest-timing-note][data-state=superseded]")).toContainText("a été remplacé par une confirmation ultérieure");
  await expect(g.locator("[data-testid=guest-timing-note][data-state=applied]")).toHaveCount(1);
  await expect(g.getByTestId("guest-service-status").filter({ hasText: "Remplacée" })).toHaveCount(1);
  await expect(g.getByTestId("guest-current-times")).toContainText("13:00");
  await expect(g.locator("[data-testid=guest-service-event][data-kind=timing]")).toContainText("Horaire remplacé par une confirmation ultérieure");

  // Annulation de la 12 h : retour à 14 h, la 14 h redevient applicable
  await m.goto(`/fr/app/services/${sv12}`);
  await m.getByTestId("timing-cancel").click();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  expect(await stayAt()).toBe(at(14).getTime());
  await g.reload();
  await expect(g.locator("[data-testid=guest-timing-note][data-state=applied]")).toHaveCount(1);
  await expect(g.locator("[data-testid=guest-timing-note][data-state=superseded]")).toHaveCount(0);

  // Vraie contradiction (séjour repoussé hors décision) puis régularisation avec message : libellés fidèles côté voyageur
  await admin.from("reservations").update({ check_in_at: at(15).toISOString() }).eq("id", stay!.id);
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-timingMismatch")).toContainText("1 horaire confirmé ne correspond pas au séjour");
  await m.goto(`/fr/app/services/${sv14}`);
  await expect(m.getByTestId("timing-legacy")).toBeVisible();
  await m.getByTestId("timing-ack").check();
  await m.getByTestId("timing-message").fill("Arrivée à 14 h maintenue (QA).");
  await m.getByTestId("timing-apply-legacy").click();
  await expect(m.getByTestId("timing-result")).toHaveAttribute("data-status", "applied");
  expect(await stayAt()).toBe(at(14).getTime());
  await g.reload();
  const card = g.getByTestId("guest-service").filter({ has: g.locator("[data-testid=guest-timing-note][data-state=applied]") });
  await expect(card.locator("[data-testid=guest-service-event][data-kind=team_message]")).toContainText("Message de l'équipe");
  await expect(card.locator("[data-testid=guest-service-event][data-kind=timing]").last()).toContainText("Horaire appliqué à votre séjour");
  await expect(card.locator("[data-testid=guest-service-event][data-kind=team_message]")).not.toContainText("Demandée");
  expect(await g.content()).not.toContain("Confirmation contradictoire appliquée");
  expect(await g.content()).not.toContain("Confirmé en connaissance de cause :");
  for (const c of [m, g]) await c.context().close();
});

test("36 · absences : mission démarrée avant une absence commencée depuis, temps libre calculé à partir de maintenant", async ({ browser }) => {
  const m = await newPage(browser);
  const { org, agentId } = await testScenario(m, `abs2 ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  const { data: k, error: e1 } = await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "maintenance", status: "in_progress", assignee_id: agentId, started_at: h(-24), window_start: h(-30), window_end: h(72), duration_min: 90 }).select("id").single();
  expect(e1).toBeNull();
  const { error } = await admin.from("absences").insert({ organization_id: org, scope: "member", member_id: agentId, kind: "leave", starts_at: h(-1), ends_at: h(20), status: "accepted", client_id: crypto.randomUUID() });
  expect(error).toBeNull();
  await m.goto("/fr/app/team");
  const row = m.getByTestId("availability-risk").filter({ has: m.locator(`a[href$="/app/missions/${k!.id}"]`) });
  await expect(row.getByTestId("availability-risk-kind")).toHaveAttribute("data-kind", "started_before");
  await expect(row.getByTestId("availability-risk-kind")).toContainText("avant l'absence commencée");
  await expect(row.getByTestId("availability-free")).toHaveAttribute("data-from-now", "1");
  await expect(row.getByTestId("availability-free")).toContainText("de maintenant au");
  await expect(row.getByTestId("availability-free")).toContainText("pas une disponibilité garantie");
  // Rien n'a été réaffecté ni déplacé
  const { data: after } = await admin.from("tasks").select("assignee_id, status, window_start").eq("id", k!.id).single();
  expect([after!.assignee_id, after!.status]).toEqual([agentId, "in_progress"]);
  await m.close();
});

test("37 · brief du 4/11 : linge préparé puis réalisé, règles de démarrage et exigences depuis la liste, correction, accueil orienté décisions", async ({ browser }) => {
  const m = await newPage(browser);
  const { org, agentId } = await testScenario(m, `lin ${run}`);
  const { data: stay } = await admin.from("reservations").select("id").eq("organization_id", org).eq("guest_name", "Voyageur test").single();
  await admin.from("organizations").update({ validation_task_types: ["turnover", "linen_delivery"] }).eq("id", org);
  // Règle de l'organisation : commentaire exigé pour la livraison de linge (réglage, appliqué par la base)
  await m.goto("/fr/app/settings");
  await m.getByTestId("rule-linen_delivery-comment").check();
  await expect(m.getByTestId("rule-linen_delivery")).toContainText("Enregistré");

  // Accueil : la décision d'abord ; linge absent → fiche préremplie → création attribuée
  await m.goto("/fr/app");
  await expect(m.getByTestId("home-now")).toBeVisible();
  await expect(m.getByTestId("home-calm")).toBeVisible();
  const row = m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" });
  await expect(row).toContainText("Linge : rien de prévu avant l'arrivée");
  await row.getByTestId("plan-linen").click();
  await row.getByTestId("linen-assignee").selectOption(agentId);
  await row.getByTestId("linen-confirm").click();
  await expect(m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" })).not.toContainText("Linge : rien de prévu");
  const { data: lin } = await admin.from("tasks").select("id, status, assignee_id").eq("next_reservation_id", stay!.id).eq("type", "linen_delivery").single();
  expect([lin!.status, lin!.assignee_id]).toEqual(["assigned", agentId]);

  // Agent, depuis la LISTE : démarrage conseillé (confirmation si en avance), fin refusée tant que le commentaire manque
  const agent = await newPage(browser);
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`lin-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto("/fr/app/missions");
  const lrow = agent.getByTestId("mission-row").filter({ has: agent.locator(`a[href$="/app/missions/${lin!.id}"]`) });
  await lrow.getByTestId("task-start").click();
  const early = lrow.getByTestId("task-early-confirm");
  if (await early.isVisible().catch(() => false)) await lrow.getByTestId("task-early-go").click();
  await expect(lrow).toContainText("En cours");
  await lrow.getByTestId("task-finish").click();
  await expect(lrow.locator("[data-testid=task-missing] [data-missing=comment]")).toBeVisible();
  expect((await admin.from("tasks").select("status").eq("id", lin!.id).single()).data!.status).toBe("in_progress");
  // Même règle depuis la fiche : on complète puis on termine
  await lrow.getByTestId("task-missing-open").click();
  await agent.getByTestId("task-comment").fill("Linge livré, 2 jeux (fictif)");
  await agent.getByTestId("task-comment-save").click();
  await expect(agent.getByTestId("task-comment-saved")).toBeVisible();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByTestId("mission-sent")).toContainText("Envoyée au responsable");

  // Accueil : linge terminé mais pas encore validé → jamais « prêt » ; mission à valider détaillée
  await m.goto("/fr/app");
  await expect(m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" }).getByTestId("arrival-causes")).toContainText("Linge");
  await expect(m.getByTestId("home-toValidate")).toHaveAttribute("data-active", "1");
  await expect(m.getByTestId("home-toValidate").getByTestId("home-details")).toContainText("Livraison linge · Appartement test · terminée le");
  // Correction puis validation
  await m.goto(`/fr/app/missions/${lin!.id}`);
  await m.getByTestId("correction-reason").fill("Ajouter les serviettes (fictif)");
  await m.getByTestId("mission-correction").click();
  await agent.reload();
  await expect(agent.getByTestId("correction-reason-shown")).toContainText("Ajouter les serviettes");
  await agent.getByTestId("mission-start").click();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByTestId("mission-sent")).toContainText("Correction envoyée au responsable");
  await m.reload();
  await m.getByTestId("mission-validate").click();
  await expect(m.locator("[data-testid=history-event][data-kind=validated]")).toBeVisible();
  await agent.reload();
  await expect(agent.getByTestId("mission-validated")).toBeVisible();
  // Notification créée pour l'agent (adresse fictive : jamais comptée « envoyée »)
  const { data: note } = await admin.from("notification_outbox").select("status, last_error").eq("organization_id", org).eq("template", "agent_task_validated").single();
  expect([note!.status, note!.last_error]).toEqual(["failed", "undeliverable_test_address"]);
  await m.goto("/fr/app");
  await expect(m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" })).not.toContainText("Linge");
  for (const c of [m, agent]) await c.context().close();
});

test("38 · brief du 4/11 (P0 dates) : la date affichée est celle enregistrée — saisie, valeur posée par un outil, changement d'heure", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `dat ${run}`);
  const cases: [string, string, string, "fill" | "tool"][] = [
    ["2027-11-05", "2027-11-05", "vendredi 5 novembre 2027", "tool"],
    ["2027-03-28", "2027-03-28", "dimanche 28 mars 2027", "fill"],
    ["2027-12-31", "2028-01-01", "31 déc. 2027 → 1 janv. 2028", "tool"],
  ];
  for (const [d1, d2, label, how] of cases) {
    await m.goto("/fr/app/team");
    await m.waitForLoadState("networkidle");
    if (how === "fill") {
      await m.getByTestId("absence-from").fill(d1);
      await m.getByTestId("absence-to").fill(d2);
    } else {
      // Valeur posée directement dans le champ (comme un outil de test automatisé ou une saisie automatique)
      await m.evaluate(([a, b]) => {
        for (const [id, v] of [["ab-from", a], ["ab-to", b]]) {
          const el = document.getElementById(id) as HTMLInputElement;
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, [d1, d2]);
    }
    const tag = `QA date ${d1} ${run}`;
    await m.getByTestId("absence-reason").fill(tag);
    await expect(m.getByTestId("absence-from")).toHaveValue(d1);
    await expect(m.getByTestId("absence-summary")).toContainText(d1 === d2 ? label : "inclus");
    await m.getByTestId("absence-save").click();
    await expect(m.getByTestId("absence-saved")).toBeVisible();
    await m.reload();
    await expect(m.locator("li", { hasText: tag }).first()).toContainText(label);
    const { data: a } = await admin.from("absences").select("starts_at, ends_at").eq("organization_id", org).eq("reason", tag).single();
    const paris = (x: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(x));
    expect(paris(a!.starts_at)).toBe(`${d1} 00:00`);
    const end = new Date(Date.UTC(Number(d2.slice(0, 4)), Number(d2.slice(5, 7)) - 1, Number(d2.slice(8, 10)) + 1)).toISOString().slice(0, 10);
    expect(paris(a!.ends_at)).toBe(`${end} 00:00`);
  }
  // Plage invalide signalée avant l'enregistrement
  await m.goto("/fr/app/team");
  await m.getByTestId("absence-allday").uncheck();
  await m.getByTestId("absence-start").fill("2027-11-05T14:00");
  await m.getByTestId("absence-end").fill("2027-11-05T10:00");
  await expect(m.getByTestId("absence-invalid")).toBeVisible();
  await expect(m.getByTestId("absence-save")).toBeDisabled();
  await m.close();
});

test("39 · correction visible jusqu'au renvoi (deux corrections, rechargement), état d'arrivée expliqué, mission entre deux séjours", async ({ browser }) => {
  const m = await newPage(browser);
  const { org, agentId } = await testScenario(m, `cor ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  await admin.from("organizations").update({ validation_task_types: ["turnover", "maintenance"] }).eq("id", org);
  const h = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  const { data: k } = await admin.from("tasks").insert({ organization_id: org, property_id: prop!.id, type: "maintenance", title: "Robinet (QA fictif)", status: "assigned", assignee_id: agentId, window_start: h(-1), window_end: h(30), duration_min: 30 }).select("id").single();
  const agent = await newPage(browser);
  await agent.goto("/fr/auth/sign-in");
  await agent.getByLabel("Nom du compte de test").fill(`cor-${run}-agent`);
  await agent.getByTestId("test-account-submit").click();
  await agent.waitForURL(/\/fr\/app/);
  await agent.goto(`/fr/app/missions/${k!.id}`);
  await agent.getByTestId("mission-start").click();
  await agent.getByTestId("mission-finish").click();
  await expect(agent.getByTestId("mission-sent")).toBeVisible();
  for (const [i, reason] of ["Joint encore humide (fictif)", "Photo du joint demandée (fictif)"].entries()) {
    await m.goto(`/fr/app/missions/${k!.id}`);
    await m.getByTestId("correction-reason").fill(reason);
    await m.getByTestId("mission-correction").click();
    await expect(m.locator("[data-testid=history-event][data-kind=correction_requested]")).toHaveCount(i + 1);
    await agent.goto(`/fr/app/missions/${k!.id}`);
    await expect(agent.getByTestId("correction-banner")).toHaveAttribute("data-status", "to_redo");
    await expect(agent.getByTestId("correction-reason-shown")).toHaveText(reason);
    await expect(agent.getByTestId("correction-at")).toBeVisible();
    await agent.getByTestId("mission-start").click();
    // Après reprise (et après rechargement) : la correction reste en évidence jusqu'au renvoi
    await expect(agent.getByTestId("correction-banner")).toHaveAttribute("data-status", "in_progress");
    await agent.reload();
    await expect(agent.getByTestId("correction-reason-shown")).toHaveText(reason);
    // Commentaire facultatif : renvoi possible sans commentaire
    await agent.getByTestId("mission-finish").click();
    await expect(agent.getByTestId("mission-sent")).toContainText("Correction envoyée au responsable");
    await expect(agent.getByTestId("correction-banner")).toHaveCount(0);
  }
  await m.goto(`/fr/app/missions/${k!.id}`);
  await m.getByTestId("mission-validate").click();
  await expect(m.locator("[data-testid=history-event][data-kind=validated]")).toBeVisible();
  await agent.reload();
  await expect(agent.getByTestId("mission-validated")).toBeVisible();
  await expect(agent.locator("[data-testid=history-event][data-kind=correction_requested]")).toHaveCount(2);
  await expect(agent.locator("[data-testid=history-event][data-kind=resubmitted]")).toHaveCount(2);

  // Accueil : l'arrivée dit où en est le ménage, et pourquoi elle n'est pas prête
  await m.goto("/fr/app");
  const row = m.getByTestId("arrival-row").filter({ hasText: "Voyageur test" });
  await expect(row.getByTestId("arrival-cleaning")).toContainText("Ménage :");
  // Fiche séjour : la mission dit entre quels séjours elle se place
  const { data: stay } = await admin.from("reservations").select("id").eq("organization_id", org).eq("guest_name", "Voyageur test").single();
  await m.goto(`/fr/app/stays/${stay!.id}`);
  await expect(m.getByTestId("stay-mission-relation").first()).toContainText(/Avant l'arrivée de ce séjour|Après le départ de ce séjour/);
  for (const c of [m, agent]) await c.context().close();
});

test("34 · lieux avant l'ouverture : données transmises au navigateur sans coordonnées, plusieurs localisations", async ({ browser }) => {
  const m = await newPage(browser);
  const { org } = await testScenario(m, `loc2 ${run}`);
  const { data: prop } = await admin.from("properties").select("id").eq("organization_id", org).single();
  const { url } = await prepStay(m, browser, "Noa Discret", 12);
  for (const [lat, lng] of [[48.8584, 2.2945], [43.6045, 1.444], [45.9237, 6.8694]]) {
    await admin.from("property_places").delete().eq("property_id", prop!.id);
    await admin.from("properties").update({ latitude: lat, longitude: lng, auto_places: true }).eq("id", prop!.id);
    await admin.from("property_places").insert([
      { organization_id: org, property_id: prop!.id, source: "openstreetmap", external_id: `node/${lat}-1`, category: "food", name: "Suggestion auto", latitude: lat + 0.004, longitude: lng },
      { organization_id: org, property_id: prop!.id, source: "manager", category: "activities", name: "Lieu public au même endroit", latitude: lat, longitude: lng },
      { organization_id: org, property_id: prop!.id, source: "manager", category: "food", name: "Choix de l'équipe", latitude: lat + 0.012, longitude: lng + 0.004, address: "1 rue Fictive" },
    ]);
    // Page complète réellement transmise (HTML + données de rendu)
    const html = await (await m.context().request.get(url)).text();
    for (const c of [String(lat), String(lng), String(lat + 0.012).slice(0, 7), String(lat + 0.004).slice(0, 7)]) expect(html.includes(c), `coordonnée ${c} transmise`).toBe(false);
    expect(html).not.toContain("Lieu public au même endroit");
    expect(html).not.toContain("Suggestion auto");
    expect(html).toContain("Choix de l");
    const g = await newPage(browser);
    await g.goto(url);
    await expect(g.getByTestId("around-auto-hidden")).toContainText("1 suggestion automatique");
    await expect(g.getByTestId("around-near-hidden")).toBeVisible();
    await expect(g.getByTestId("around-distance-band")).toContainText("1 à 2 km");
    await g.context().close();
  }
  await m.context().close();
});
