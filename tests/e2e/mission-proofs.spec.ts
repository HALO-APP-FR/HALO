import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

/**
 * Scénarios isolés : chaque test démarre dans un navigateur vierge (données de démo
 * propres à ce test). Les données de démo d'un autre navigateur ne sont jamais touchées.
 */

// Petite image PNG valide (64×64, couleur unie) pour simuler une photo prise sur le téléphone
function png(): Buffer {
  const w = 64;
  const h = 64;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([40, 120, 200], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Ouvre une mission depuis la liste des tâches (tableau sur ordinateur, liste sur téléphone). */
async function openTask(page: Page, property: string) {
  await page.locator("main tr, main li button").filter({ hasText: property }).filter({ visible: true }).first().click();
}

async function actAs(page: Page, name: string) {
  await page.goto("/fr/a/profile");
  await page.locator("#as").selectOption({ label: name });
}

test("une mission à 3 photos exigées ne peut être ni terminée ni validée sans les vraies photos", async ({ page }) => {
  await actAs(page, "Inès Moreau");
  await page.goto("/fr/a/today");
  await page.getByRole("link", { name: /Loft Marais/ }).first().click();
  await page.getByRole("button", { name: "Démarrer la mission" }).click();

  // 1. Bloqué, et l'écran dit précisément ce qui manque
  const finish = page.getByRole("button", { name: /^Terminer/ });
  await expect(finish).toBeDisabled();
  await expect(page.getByText("3 photos obligatoires manquantes")).toBeVisible();
  const missing = page.getByTestId("missing-photos");
  await expect(missing).toContainText("·");
  const names = (await missing.innerText()).split(", ");
  expect(names).toHaveLength(3);

  // 2. Cocher les points ne remplace pas une photo
  for (const box of await page.getByRole("checkbox").all()) await box.check().catch(() => undefined);
  await expect(finish).toBeDisabled();

  // 3. Une vraie photo pour chacun des points exigés, nommés par l'écran
  for (const [i, name] of names.entries()) {
    const label = name.split(" · ")[1];
    const item = page.getByRole("checkbox", { name: label }).locator("xpath=ancestor::*[.//input[@type='file']][1]");
    await item.locator('input[type="file"]').first().setInputFiles({ name: `preuve-${i}.png`, mimeType: "image/png", buffer: png() });
    await expect(page.getByTestId("missing-photos").filter({ hasText: label })).toHaveCount(0);
  }
  await expect(page.getByTestId("missing-photos")).toHaveCount(0);
  await expect(finish).toBeEnabled();
  await finish.click();
  const anyway = page.getByRole("button", { name: "Terminer quand même" });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await expect(page).toHaveURL(/\/a\/today/);

  // 4. Le manager voit les 3 preuves avant de valider
  await page.goto("/fr/tasks?status=done&period=all");
  await openTask(page, "Loft Marais");
  await expect(page.getByText("Preuves photo : 3/3 reçues")).toBeVisible();
  await expect(page.getByRole("button", { name: "Valider" })).toBeEnabled();
});

test("circuit de correction : manager → agent → nouvelle soumission → historique conservé", async ({ page }) => {
  // Mission de Lucía, terminée avec ses preuves, à valider
  await page.goto("/fr/tasks?status=done&period=all");
  await openTask(page, "Casa Alfama");
  await expect(page.getByText("Preuves photo : 3/3 reçues")).toBeVisible();

  // 1. Correction avec motif (obligatoire)
  await page.getByRole("button", { name: "Demander une correction" }).click();
  const send = page.getByRole("button", { name: "Envoyer la demande de correction" });
  await expect(send).toBeDisabled();
  await page.locator("#redo").fill("Traces sur le miroir de la salle de bain.");
  await send.click();
  await expect(page.getByText(/Correction demandée\. Le premier compte rendu est conservé/)).toBeVisible();

  // 2. L'agent concerné reçoit la notification dans HALO (seul canal annoncé)
  await actAs(page, "Lucía Gómez");
  await page.goto("/fr/a/today");
  await expect(page.getByText("Traces sur le miroir de la salle de bain.").first()).toBeVisible();
  await page.getByRole("button", { name: /Notifications \(1 non lues\)/ }).click();
  await expect(page.getByText("Dans l'application uniquement : aucun e-mail, push ou SMS n'est envoyé pour l'instant.")).toBeVisible();
  await page.getByRole("button", { name: /Correction demandée : Traces sur le miroir/ }).click();

  // 3. Il rouvre la mission, voit le motif, reprend et resoumet
  await expect(page).toHaveURL(/\/a\/task\//);
  await expect(page.getByText("Traces sur le miroir de la salle de bain.")).toBeVisible();
  await page.getByRole("button", { name: "Reprendre" }).click();
  await page.getByRole("button", { name: /^Terminer/ }).click();
  await expect(page).toHaveURL(/\/a\/today/);

  // 4. Le manager voit le nouveau rapport ; le premier est conservé ; l'historique est complet
  await page.goto("/fr/tasks?status=done&period=all");
  await openTask(page, "Casa Alfama");
  await expect(page.getByText(/Compte rendu n° 1 .*conservé/)).toBeVisible();
  const history = page.locator("ol").filter({ hasText: "Correction demandée" });
  await expect(history).toContainText("Démarrée");
  await expect(history).toContainText("Terminée, envoyée en validation");
  await expect(history).toContainText("« Traces sur le miroir de la salle de bain. »");
  await page.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Mission validée.")).toBeVisible();
});

test("une demande de prestation s'ouvre en lecture ; les décisions restent distinctes", async ({ page }) => {
  await page.goto("/fr/services");
  await page.getByText("Réservation restaurant").click();
  // Lecture seule : aucun champ modifiable, aucun « Enregistrer »
  await expect(page.locator("#s-details")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accepter la demande" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Demander des précisions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refuser" })).toBeVisible();
  // Modification explicite
  await page.getByRole("button", { name: "Modifier les détails" }).click();
  await expect(page.locator("#s-details")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accepter la demande" })).toBeVisible();
});
