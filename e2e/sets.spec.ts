import { expect, test, type Page } from "@playwright/test";
import { go, pickType } from "./helpers";
import sharp from "sharp";

async function login(page: Page) {
  await go(page, "/login");
  await page.getByLabel("Email").fill("alex@nordlicht.example");
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("demo A-Cam set shows 7 / 8 with the missing battery and suggests spares", async ({ page }) => {
  await login(page);
  await go(page, "/sets");
  await page.getByRole("link", { name: /A-Cam Set/ }).first().click();
  await expect(page.getByText("1 expected item not in set")).toBeVisible();
  await expect(page.getByText("1 / 2")).toBeVisible();
  // Spare batteries on the project are flagged as needed.
  await expect(page.getByText("needed").first()).toBeVisible();
});

test("create a set from a template, pack by code, confirm a move, take out, add photo", async ({ page }, info) => {
  const name = `E2E Set ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await go(page, "/sets/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Template").selectOption({ label: "A-Cam Set (8 items)" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create set" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("0 / 8").first()).toBeVisible();

  // ALEXA 35 SN 35-10577 is in the B-Cam set: packing asks before moving.
  await page.getByLabel("Code to pack").fill("ARRI-0057");
  await page.getByRole("button", { name: "Pack code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "packed in B-Cam Set" })).toBeVisible();
  await page.getByRole("button", { name: /Move it here from B-Cam Set/ }).click();
  await expect(page.getByText(/moved here/)).toBeVisible();
  await expect(page.getByText("1 / 8").first()).toBeVisible();

  // Take it out again and put it back where it came from.
  await page.getByRole("button", { name: "Take out" }).first().click();
  await expect(page.getByText("0 / 8").first()).toBeVisible();
  await go(page, "/sets");
  await page.getByRole("link", { name: /B-Cam Set/ }).first().click();
  await page.getByLabel("Code to pack").fill("35-10577");
  await page.getByRole("button", { name: "Pack code" }).click();
  await expect(page.getByText(/packed\./)).toBeVisible();
  await go(page, "/sets");
  await page.getByRole("link", { name }).click();

  // Photo upload (the server normalizes and thumbnails it).
  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "set.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByLabel("Photo caption").fill("Packed for travel");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Photo added.")).toBeVisible();
  const img = page.getByRole("img", { name: "Packed for travel" });
  await expect(img).toBeVisible();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const res = await page.request.get((await img.getAttribute("src"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/webp");

  // History records everything on the set.
  await expect(page.getByText(/taken out of/).first()).toBeVisible();
  await expect(page.getByText("Photo added to Set").first()).toBeVisible();
});

test("edit expected contents and save the set as a template", async ({ page }, info) => {
  const name = `E2E Empty ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await go(page, "/sets/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create set" }).click();
  await page.getByRole("link", { name: "Define what belongs in this set" }).click();
  // Choosing a type adds it right away; − / + change the number.
  await pickType(page.getByLabel("Add to the expected contents"), "cine 7", "SmallHD Cine 7");
  await expect(page.getByLabel("SmallHD Cine 7: 1")).toBeVisible();
  await page.getByRole("button", { name: "One SmallHD Cine 7 more" }).click();
  await expect(page.getByLabel("SmallHD Cine 7: 2")).toBeVisible();
  await page.getByRole("link", { name: "Done" }).click();
  await expect(page.getByText("0 / 2").first()).toBeVisible();

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Template name").fill(`${name} template`);
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("heading", { name: `${name} template` })).toBeVisible();
  await expect(page.getByLabel("Quantity of SmallHD Cine 7")).toHaveValue("2");
});

test("no page scrolls sideways on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout only");
  await login(page);
  const paths = ["/", "/projects", "/equipment", "/equipment/types", "/sets", "/sets/templates", "/scan", "/search?q=alexa", "/history", "/settings", "/settings/categories"];
  // Add detail pages reached through links.
  await go(page, "/sets");
  paths.push((await page.getByRole("link", { name: /A-Cam Set/ }).first().getAttribute("href"))!);
  await go(page, "/projects");
  const project = (await page.getByRole("link", { name: /Feature Film X/ }).first().getAttribute("href"))!;
  paths.push(project, `${project}/add-equipment`, `${project}/rental-houses`);
  await go(page, "/documents");
  paths.push("/documents", "/documents/new", "/documents/new?kind=return_note", (await page.getByRole("link", { name: /LS-240512/ }).first().getAttribute("href"))!);
  await go(page, "/equipment?q=35-10421");
  paths.push((await page.getByRole("link", { name: "ARRI ALEXA 35" }).first().getAttribute("href"))!);
  for (const p of paths) {
    await go(page, p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${p}`).toBeLessThanOrEqual(0);
  }
  const casePath = paths.find((p) => p.startsWith("/sets/") && !p.includes("templates"))!;
  await go(page, `${casePath}?edit=1`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("items without serial show once with a count and pack by quantity", async ({ page }, info) => {
  const name = `E2E Bags ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await go(page, "/sets/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create set" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // The checklist: one row for all sandbags without serial, ticked with a count.
  const free = page.locator("li").filter({ hasText: "Sandbag" }).filter({ hasNotText: " · in " }).filter({ has: page.getByRole("checkbox") });
  await expect(free).toHaveCount(1); // one row, not one per unit
  const before = Number((await free.getByText(/pcs · no serial/).textContent())!.match(/\d+/)![0]);
  await free.getByRole("checkbox").check();
  await free.getByLabel(/How many/).fill("2");
  await page.getByRole("button", { name: "Add 2 to this set" }).click();
  await expect(page.getByRole("heading", { name: "In this set (2)" })).toBeVisible();
  await expect(free.getByText(`${before - 2} pcs · no serial`)).toBeVisible();

  // Take one out: the rest stays in the set.
  const packed = page.locator("li").filter({ hasText: "Sandbag" }).filter({ has: page.getByLabel(/How many/) }).filter({ has: page.getByRole("button", { name: "Take out" }) });
  await packed.getByLabel(/How many/).fill("1");
  await packed.getByRole("button", { name: "Take out" }).click();
  await expect(page.getByRole("heading", { name: "In this set (1)" })).toBeVisible();
  // A single unit left: plain button (the extras list has another one).
  await page.locator("li").filter({ hasText: "Sandbag" }).getByRole("button", { name: "Take out" }).last().click();
  await expect(page.getByRole("heading", { name: "In this set (0)" })).toBeVisible();
  await expect(free.getByText(`${before} pcs · no serial`)).toBeVisible();
});

test("remove items from a project without a return note, then add them back", async ({ page }) => {
  await login(page);
  await go(page, "/projects");
  await page.getByRole("main").getByRole("link", { name: /Feature Film X/ }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  const projectUrl = page.url().split("?")[0]!;
  await go(page, `${projectUrl}/remove`);
  await page.waitForLoadState("networkidle");

  const row = page.locator("li").filter({ hasText: "Sandbag" }).filter({ has: page.getByLabel(/How many/) }).first();
  await row.getByRole("checkbox").check();
  await row.getByLabel(/How many/).fill("1");
  await page.getByLabel("Note (optional)", { exact: true }).fill("e2e pickup");
  await page.getByRole("button", { name: "Remove selected" }).click();
  await expect(page).toHaveURL(projectUrl);

  await go(page, `${projectUrl}/history`);
  await expect(page.getByText(/Sandbag 15 lb returned \(removed from Feature Film X\)/).first()).toBeVisible();

  // Nothing was deleted: the sandbag can be added again.
  await go(page, `${projectUrl}/add-equipment?q=sandbag`);
  const free = page.locator("li").filter({ hasText: "Sandbag" });
  const n = await free.count();
  expect(n).toBeGreaterThan(0);
  await free.first().getByRole("button", { name: "Add" }).click();
  await expect(free).toHaveCount(n - 1);
});

test("project equipment: one line per type with quantity, serials when opened", async ({ page }) => {
  await login(page);
  await go(page, "/projects");
  await page.getByRole("main").getByRole("link", { name: /Feature Film X/ }).first().click();
  const line = page.locator("summary").filter({ hasText: "bebob B290cine" });
  await expect(line).toHaveCount(1);
  await expect(line.getByLabel(/Quantity/)).toHaveText("6");
  await expect(page.getByText("SN B290-31131")).toBeHidden();
  await line.click();
  await expect(page.getByText("SN B290-31131")).toBeVisible();
});

test("equipment page: by-type view groups serials under one line", async ({ page }) => {
  await login(page);
  await go(page, "/equipment");
  await page.getByRole("link", { name: "By type" }).click();
  await expect(page).toHaveURL(/view=types/);
  const line = page.locator("summary").filter({ hasText: "ARRI ALEXA 35" });
  await expect(line).toHaveCount(1);
  await line.click();
  await expect(page.getByText("SN 35-10421")).toBeVisible();
});

test("project equipment: tick entries in a type line to start removing them", async ({ page }) => {
  await login(page);
  await go(page, "/projects");
  await page.getByRole("main").getByRole("link", { name: /Feature Film X/ }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  const projectUrl = page.url().split("?")[0]!;
  // Remove…: opens the remove page with the ticked entries preselected.
  const bags = page.locator("details").filter({ has: page.locator("summary", { hasText: "Sandbag" }) });
  await bags.locator("summary").click();
  await bags.locator("li").first().getByRole("checkbox").check();
  await bags.getByRole("button", { name: "Remove from project…" }).click();
  await expect(page).toHaveURL(new RegExp(`${projectUrl}/remove\\?items=`));
  await expect(page.locator("li").filter({ hasText: "Sandbag" }).first().getByRole("checkbox")).toBeChecked();
});

test("set page: tick several things in the checklist and add them in one go", async ({ page }, info) => {
  const name = `E2E Tick ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await go(page, "/sets/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create set" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const rowFor = (text: string) => page.locator("li").filter({ hasText: text }).filter({ has: page.getByRole("checkbox") });
  await rowFor("SN WCU-4471").getByRole("checkbox").check();
  await rowFor("SN 2575-18832").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Add 2 to this set" }).click();
  await expect(page.getByText("2 pieces added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "In this set (2)" })).toBeVisible();
  // What is packed now becomes the expected contents in one click.
  await page.getByRole("button", { name: "Use what's packed now (2)" }).click();
  await expect(page.getByText("2 / 2").first()).toBeVisible();
  // Put them back where they were (not in a set).
  for (const left of [1, 0]) {
    await page.locator("li").filter({ has: page.getByRole("button", { name: "Take out" }) }).first().getByRole("button", { name: "Take out" }).click();
    await expect(page.getByRole("heading", { name: `In this set (${left})` })).toBeVisible();
  }
});

test("equipment list: set cards instead of a set column", async ({ page }) => {
  await login(page);
  await go(page, "/equipment");
  const cards = page.getByRole("region", { name: "Sets" });
  await cards.getByRole("link", { name: /A-Cam Set/ }).click();
  await expect(page).toHaveURL(/caseId=/);
  await expect(page.getByRole("main").getByText("SN 35-10421").locator("visible=true").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("SN 35-10577")).toHaveCount(0); // that one is in the B-Cam set
});
