import { expect, test } from "@playwright/test";

test("le manager voit sa journée", async ({ page }) => {
  await page.goto("/fr/today");
  await expect(page.getByRole("heading", { level: 1, name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByText("À traiter")).toBeVisible();
});

test("l'agent voit ses missions et peut changer de langue", async ({ page }) => {
  await page.goto("/fr/a/today");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bonjour");
  await page.goto("/en/a/today");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
});
