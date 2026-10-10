import { expect, test, type Page } from "@playwright/test";
import { go } from "./helpers";

async function login(page: Page, email: string) {
  await go(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("switch the interface to German and back", async ({ page }) => {
  await login(page, "jonas@nordlicht.example");
  await go(page, "/settings");
  await page.getByLabel("Interface language").selectOption("de");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Sprache gespeichert.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

  await go(page, "/projects");
  await expect(page.getByRole("heading", { name: "Projekte" })).toBeVisible();

  await go(page, "/settings");
  await page.getByLabel("Oberflächensprache").selectOption("en");
  await page.getByRole("button", { name: "Speichern", exact: true }).first().click();
  await expect(page.getByText("Language saved.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Interface language").selectOption("");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Language saved.")).toBeVisible();
});

test("admins delete an empty project and restore it", async ({ page }, info) => {
  const name = `E2E Delete ${info.project.name}-${Date.now().toString(36)}`;
  await login(page, "mira@nordlicht.example");
  await go(page, "/projects/new");
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await go(page, `${new URL(page.url()).pathname}/edit`);
  await page.getByText("Delete this project…").click();
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("link", { name })).toHaveCount(0);

  await page.getByText(/Deleted projects \(\d+\)/).click();
  await page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});
