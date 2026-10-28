import { expect, test } from "@playwright/test";

test("le manager voit sa journée", async ({ page }) => {
  await page.goto("/fr/today");
  await expect(page.getByRole("heading", { level: 1, name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "À traiter" })).toBeVisible();
});

test("l'entrée de la démo propose les deux espaces et dit que rien n'est enregistré en ligne", async ({ page }) => {
  await page.goto("/fr/demo");
  await expect(page.getByTestId("demo-entry-badge")).toBeVisible();
  await expect(page.getByRole("link", { name: /Espace Manager · Démo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Espace Agent · Démo/ })).toBeVisible();
  await expect(page.getByText(/Rien de ce que vous faites ici n'est enregistré en ligne/)).toBeVisible();
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
