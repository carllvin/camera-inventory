import { expect, test, type Page } from "@playwright/test";
import { go, pickType } from "./helpers";

async function login(page: Page) {
  await go(page, "/login");
  await page.getByLabel("Email").fill("alex@nordlicht.example");
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);

test("upload a delivery note, enter lines by hand, resolve a conflict, confirm", async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await go(page, "/scan");
  await page.getByRole("link", { name: /Delivery note/ }).click();
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Rental house").selectOption({ label: "MBF Filmtechnik" });
  await page.locator('input[type="file"]').setInputFiles({ name: `ls-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(tag) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("load");
  // No AI key in the test environment: lines are entered by hand.
  await expect(page.getByText("Enter lines").first()).toBeVisible();
  await page.getByLabel("Document number").fill(`MBF-E2E-${tag}`);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  await page.getByRole("button", { name: "+ Add a line by hand" }).click();
  await page.locator("#new-description").fill("SmallHD Cine 7 spare");
  await page.locator("#new-serial").fill(`C7-${tag}`);
  await pickType(page.locator("#new-type"), "cine 7", "SmallHD Cine 7");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("New item").first()).toBeVisible();

  // The add form stays open for the next line. A serial already on this project is flagged, not merged.
  await page.locator("#new-description").fill("ALEXA 35");
  await page.locator("#new-serial").fill("35-10421");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText(/already on this project/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Confirm delivery/ })).toBeDisabled();

  // Ignore the conflicting line, then confirm.
  const conflict = page.locator("li", { hasText: "already on this project" }).first();
  await conflict.getByLabel(/Ignore this line/).check();
  await conflict.getByRole("button", { name: "Save line" }).click();
  await expect(page.getByRole("button", { name: /Confirm delivery \(1 item\)/ })).toBeEnabled();
  await page.getByRole("button", { name: /Confirm delivery/ }).click();
  await expect(page.getByText("Confirmed").first()).toBeVisible();

  // The new monitor is on the project, linked to this delivery note.
  await page.getByRole("link", { name: "SmallHD Cine 7" }).first().click();
  await expect(page.getByText(`SN C7-${tag}`).first()).toBeVisible();
  await expect(page.getByText(`↓ MBF-E2E-${tag}`)).toBeVisible();
  await expect(page.getByText(/received on Feature Film X/).first()).toBeVisible();
});

test("the seeded extracted ARRI note shows conflicts and suggestions for review", async ({ page }) => {
  await login(page);
  await go(page, "/documents");
  await page.getByRole("link", { name: /LS-240512/ }).click();
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Confirm delivery/ })).toBeVisible();
  // The layout groups the zoom and its motors into a set, offered after confirming.
  await expect(page.getByText("▣ Zoom-Set Optimo").first()).toBeVisible();
  await expect(page.getByText(/groups items into 1 set/)).toBeVisible();
});

test("a product that is not known yet is created from its line in one step", async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now().toString(36)}`;
  // A made-up product, unlike anything from earlier runs (the matcher accepts similar names).
  const word = () => Array.from({ length: 9 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");
  const maker = `Qx${word()}`;
  const product = `${word()} ${word()}`;
  await login(page);
  await go(page, "/scan");
  await page.getByRole("link", { name: /Delivery note/ }).click();
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Rental house").selectOption({ label: "MBF Filmtechnik" });
  await page.locator('input[type="file"]').setInputFiles({ name: `ls-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(`new-${tag}`) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("load");

  await page.getByRole("button", { name: "+ Add a line by hand" }).click();
  await page.locator("#new-description").fill(`${maker} ${product}`);
  await page.locator("#new-serial").fill(`WC-${tag}`);
  await page.getByRole("button", { name: "Add line" }).click();

  // Pre-filled from the printed line; adjust and create with one click.
  const line = page.locator("li").filter({ hasText: `${maker} ${product}` }).first();
  await expect(line.getByText(/New product/)).toBeVisible();
  await expect(line.getByLabel("Manufacturer")).toHaveValue(maker);
  await expect(line.getByLabel("Model")).toHaveValue(product);
  await line.getByRole("button", { name: "Create & use" }).click();
  await expect(page.locator("li").filter({ hasText: `${maker} ${product}` }).first().getByText("New item")).toBeVisible();
});
