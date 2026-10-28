import { expect, test, type Page } from "@playwright/test";

/** Navigateur vierge à chaque test : données de démo propres, jamais celles d'un autre navigateur. */

async function rowsByState(page: Page) {
  await page.getByRole("radio", { name: /^Toutes/ }).click();
  const rows = page.getByTestId("arrival-row");
  const states = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  return states;
}

const counter = async (page: Page, state: string) => Number(await page.getByTestId(`count-${state}`).locator(".tabular").innerText());

test("compteurs cohérents avec les lignes, une arrivée comptée une fois", async ({ page }) => {
  await page.goto("/fr/arrivals");
  await expect(page.getByRole("heading", { level: 1, name: "Arrivées" })).toBeVisible();
  const states = await rowsByState(page);
  for (const s of ["blocked", "watch", "preparing", "ready"]) {
    expect(await counter(page, s), `compteur ${s}`).toBe(states.filter((x) => x === s).length);
  }
  // Chaque arrivée non prête explique sa cause, son responsable et son action
  for (const row of await page.getByTestId("arrival-row").all()) {
    const state = await row.getAttribute("data-state");
    if (state === "blocked" || state === "watch") {
      await expect(row.getByTestId("blocker").first()).toBeVisible();
      await expect(row.getByText(/Qui agit :/).first()).toBeVisible();
    }
  }
});

test("agir depuis le blocage : validation d'un ménage terminé", async ({ page }) => {
  await page.goto("/fr/arrivals");
  await page.getByRole("radio", { name: /^Toutes/ }).click();
  const row = page.getByTestId("arrival-row").filter({ has: page.locator('[data-kind="awaiting_validation"]') }).first();
  await expect(row).toBeVisible();
  const property = (await row.locator(".text-\\[16px\\]").first().innerText()).trim();
  await row.locator('[data-kind="awaiting_validation"]').getByRole("button", { name: "Valider ou corriger" }).click();
  await expect(page.getByText("Preuves photo : 3/3 reçues")).toBeVisible();
  await page.getByRole("button", { name: "Valider", exact: true }).click();
  await page.keyboard.press("Escape");
  const after = page.getByTestId("arrival-row").filter({ hasText: property }).first();
  await expect(after).toBeVisible();
  await expect(after.locator('[data-kind="awaiting_validation"]')).toHaveCount(0);
});

test("agir depuis le blocage : ménage sans agent → attribué, l'arrivée n'est plus bloquée pour cette raison", async ({ page }) => {
  await page.goto("/fr/arrivals");
  // Premier jour (sur 5) où un ménage sans agent bloque une arrivée
  let row = page.getByTestId("arrival-row").filter({ has: page.locator('[data-kind="cleaning_unassigned"]') }).first();
  for (let d = 0; d < 5 && (await row.count()) === 0; d++) {
    await page.getByRole("button", { name: "Suivant", exact: true }).click();
    row = page.getByTestId("arrival-row").filter({ has: page.locator('[data-kind="cleaning_unassigned"]') }).first();
  }
  await expect(row).toBeVisible();
  const property = (await row.locator(".text-\\[16px\\]").first().innerText()).trim();
  await row.locator('[data-kind="cleaning_unassigned"]').getByRole("button", { name: "Attribuer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Assigner")).toBeVisible();
  await dialog.locator('button[aria-pressed="false"]').first().click();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: /^Toutes/ }).click();
  const after = page.getByTestId("arrival-row").filter({ hasText: property }).first();
  await expect(after).toBeVisible();
  await expect(after.locator('[data-kind="cleaning_unassigned"]')).toHaveCount(0);
  await expect(after.getByText(/Ménage · À faire · /)).toBeVisible();
});
