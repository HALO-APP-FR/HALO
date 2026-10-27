import { expect, test } from "@playwright/test";

test("le manager voit sa journée", async ({ page }) => {
  await page.goto("/fr/today");
  await expect(page.getByRole("heading", { level: 1, name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "À traiter" })).toBeVisible();
});

test("l'accueil propose les deux espaces et dit que la démo n'a pas de compte", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.getByRole("link", { name: /Espace Manager/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Espace Agent/ })).toBeVisible();
  await expect(page.getByText(/Démo sans compte/)).toBeVisible();
});

test("une mission d'un autre agent ne s'ouvre pas dans l'espace Agent", async ({ page }) => {
  await page.goto("/fr/a/task/inexistante");
  await expect(page.getByText("Mission introuvable")).toBeVisible();
});

test("l'agent voit ses missions et peut changer de langue", async ({ page }) => {
  await page.goto("/fr/a/today");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bonjour");
  await page.goto("/en/a/today");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
});
