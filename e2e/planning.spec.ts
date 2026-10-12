import { expect, test, type Page } from "@playwright/test";
import { go } from "./helpers";

async function login(page: Page, email = "alex@nordlicht.example") {
  await go(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test("return date: from the project's end, own date, move, back to inherited", async ({ page }) => {
  await login(page);
  await go(page, "/scan");
  await page.getByLabel("Code").fill("ARRI-0057");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}$/);

  const card = page.getByLabel("Return date");
  await expect(card.getByRole("heading", { name: "Return by" })).toBeVisible();
  // A run that stopped half-way may have left an own date.
  const reset = card.getByRole("button", { name: "Follow set / delivery / project" });
  if (await reset.isVisible()) {
    await reset.click();
    await expect(reset).toBeHidden();
  }
  // Demo pieces came with a delivery note: the date follows it (or the project's end).
  const inherited = card.getByText(/^(Project end|From delivery .*)$/);
  await expect(inherited).toBeVisible();
  const inheritedText = await inherited.innerText();

  const own = isoIn(3);
  await card.getByLabel("Own date").fill(own);
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Return date saved.")).toBeVisible();
  await expect(card.getByText("Own date", { exact: true }).first()).toBeVisible();

  await card.getByRole("button", { name: "One day later" }).click();
  await expect(page.getByText("Return date moved.")).toBeVisible();
  await expect(card.getByLabel("Own date")).toHaveValue(isoIn(4));

  // The calendar lists it (agenda on phones, month on desktop).
  await go(page, "/calendar");
  await expect(page.getByText(/^Return: /).filter({ visible: true }).first()).toBeVisible();

  await page.goBack();
  await page.getByLabel("Return date").getByRole("button", { name: "Follow set / delivery / project" }).click();
  await expect(page.getByLabel("Return date").getByText(inheritedText, { exact: true })).toBeVisible();
});

test("plan extra equipment, see it in the calendar, cancel and restore", async ({ page }, info) => {
  const label = `Remote head ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await go(page, "/projects");
  await page.getByRole("link", { name: /Feature Film X/ }).first().click();
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 15_000 });

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add to plan" }) });
  await form.getByLabel("Description").fill(label);
  await form.getByLabel("Quantity").fill("2");
  await form.getByLabel("Needed from").fill(isoIn(5));
  await form.getByLabel("Until (return)").fill(isoIn(7));
  await form.getByRole("button", { name: "Add to plan" }).click();
  await expect(page.getByText("Planned.")).toBeVisible();
  await expect(page.getByText(`2 × ${label}`)).toBeVisible();

  await go(page, "/calendar");
  await expect(page.getByText(new RegExp(`Extra: 2 × ${label}`)).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`Order: 2 × ${label}`)).filter({ visible: true }).first()).toBeVisible();

  await page.goBack();
  const row = page.getByRole("listitem").filter({ hasText: `2 × ${label}` });
  await row.getByText("Change").click();
  await row.getByRole("button", { name: "Cancel this plan" }).click();
  // The plan moves to "Cancelled" (its form goes with it), and comes back on restore.
  await page.getByText(/Cancelled \(\d+\)/).click();
  await page.getByRole("listitem").filter({ hasText: label }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: `2 × ${label}` }).getByText("Change")).toBeVisible();
});

test("reminder settings and a personal calendar link that serves ICS", async ({ page }) => {
  await login(page, "jonas@nordlicht.example");
  await go(page, "/settings");
  const reminders = page.locator("#reminders");
  await reminders.getByLabel("ntfy topic").fill("camera-e2e-topic");
  await reminders.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("Reminders saved.")).toBeVisible();
  await expect(page.locator("#reminders").getByLabel("ntfy topic")).toHaveValue("camera-e2e-topic");

  await page.getByRole("button", { name: "Create calendar link" }).click();
  const link = page.getByLabel("Calendar link");
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("BEGIN:VCALENDAR");

  // Clean up: no reminders and no link for this demo user.
  await page.locator("#reminders").getByLabel("ntfy topic").fill("");
  await page.locator("#reminders").getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("Reminders saved.")).toBeVisible();
  await page.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByRole("button", { name: "Create calendar link" })).toBeVisible();
  expect((await page.request.get(url)).status()).toBe(404);
});
