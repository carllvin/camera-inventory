import { expect, test, type Page } from "@playwright/test";
import { pickType } from "./helpers";
import sharp from "sharp";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("alex@nordlicht.example");
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("demo A-Cam case shows 7 / 8 with the missing battery and suggests spares", async ({ page }) => {
  await login(page);
  await page.goto("/cases");
  await page.getByRole("link", { name: /A-Cam Case/ }).first().click();
  await expect(page.getByText("1 expected item not in case")).toBeVisible();
  await expect(page.getByText("1 / 2")).toBeVisible();
  // Spare batteries on the project are flagged as needed.
  await expect(page.getByText("needed").first()).toBeVisible();
});

test("create a case from a template, pack by code, confirm a move, take out, add photo", async ({ page }, info) => {
  const name = `E2E Case ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await page.goto("/cases/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Template").selectOption({ label: "A-Cam Case (8 items)" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("0 / 8").first()).toBeVisible();

  // ALEXA 35 SN 35-10577 is in the B-Cam case: packing asks before moving.
  await page.getByLabel("Code to pack").fill("ARRI-0057");
  await page.getByRole("button", { name: "Pack code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "packed in B-Cam Case" })).toBeVisible();
  await page.getByRole("button", { name: /Move it here from B-Cam Case/ }).click();
  await expect(page.getByText(/moved here/)).toBeVisible();
  await expect(page.getByText("1 / 8").first()).toBeVisible();

  // Take it out again and put it back where it came from.
  await page.getByRole("button", { name: "Take out" }).first().click();
  await expect(page.getByText("0 / 8").first()).toBeVisible();
  await page.goto("/cases");
  await page.getByRole("link", { name: /B-Cam Case/ }).first().click();
  await page.getByLabel("Code to pack").fill("35-10577");
  await page.getByRole("button", { name: "Pack code" }).click();
  await expect(page.getByText(/packed\./)).toBeVisible();
  await page.goto("/cases");
  await page.getByRole("link", { name }).click();

  // Photo upload (the server normalizes and thumbnails it).
  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "case.jpg", mimeType: "image/jpeg", buffer: jpeg });
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

  // History records everything on the case.
  await expect(page.getByText(/taken out of/).first()).toBeVisible();
  await expect(page.getByText("Photo added to Case").first()).toBeVisible();
});

test("edit expected contents and save the case as a template", async ({ page }, info) => {
  const name = `E2E Empty ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await page.goto("/cases/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create case" }).click();
  await page.getByRole("link", { name: "Define what belongs in this case" }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await pickType(page.getByLabel("Equipment type or category"), "cine 7", "SmallHD Cine 7");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Quantity of SmallHD Cine 7")).toHaveValue("2");
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
  const paths = ["/", "/projects", "/equipment", "/equipment/types", "/cases", "/cases/templates", "/scan", "/search?q=alexa", "/history", "/settings", "/settings/categories"];
  // Add detail pages reached through links.
  await page.goto("/cases");
  paths.push((await page.getByRole("link", { name: /A-Cam Case/ }).first().getAttribute("href"))!);
  await page.goto("/projects");
  const project = (await page.getByRole("link", { name: /Feature Film X/ }).first().getAttribute("href"))!;
  paths.push(project, `${project}/add-equipment`, `${project}/rental-houses`);
  await page.goto("/documents");
  paths.push("/documents", "/documents/new", "/documents/new?kind=return_note", (await page.getByRole("link", { name: /LS-240512/ }).first().getAttribute("href"))!);
  await page.goto("/equipment?q=35-10421");
  paths.push((await page.getByRole("link", { name: "ARRI ALEXA 35" }).first().getAttribute("href"))!);
  for (const p of paths) {
    await page.goto(p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${p}`).toBeLessThanOrEqual(0);
  }
  const casePath = paths.find((p) => p.startsWith("/cases/") && !p.includes("templates"))!;
  await page.goto(`${casePath}?edit=1`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("items without serial show once with a count and pack by quantity", async ({ page }, info) => {
  const name = `E2E Bags ${info.project.name}-${Date.now().toString(36)}`;
  await login(page);
  await page.goto("/cases/new");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Feature Film X" });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const free = page.locator("li").filter({ hasText: "Sandbag" }).filter({ hasNotText: " · in " });
  await expect(free).toHaveCount(1); // one row, not one per unit
  const before = Number((await free.getByText(/pcs · no serial/).textContent())!.match(/\d+/)![0]);
  await free.getByLabel(/How many/).fill("2");
  await free.getByRole("button", { name: "Pack" }).click();
  await expect(page.getByRole("heading", { name: "In this case (2)" })).toBeVisible();
  await expect(free.getByText(`${before - 2} pcs · no serial`)).toBeVisible();

  // Take one out: the rest stays in the case.
  const packed = page.locator("li").filter({ hasText: "Sandbag" }).filter({ has: page.getByLabel(/How many/) }).filter({ has: page.getByRole("button", { name: "Take out" }) });
  await packed.getByLabel(/How many/).fill("1");
  await packed.getByRole("button", { name: "Take out" }).click();
  await expect(page.getByRole("heading", { name: "In this case (1)" })).toBeVisible();
  // A single unit left: plain button (the extras list has another one).
  await page.locator("li").filter({ hasText: "Sandbag" }).getByRole("button", { name: "Take out" }).last().click();
  await expect(page.getByRole("heading", { name: "In this case (0)" })).toBeVisible();
  await expect(free.getByText(`${before} pcs · no serial`)).toBeVisible();
});

test("remove items from a project without a return note, then add them back", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("main").getByRole("link", { name: /Feature Film X/ }).first().click();
  await expect(page.getByRole("heading", { name: /Feature Film X/ })).toBeVisible();
  const projectUrl = page.url().split("?")[0]!;
  await page.goto(`${projectUrl}/remove`);

  const row = page.locator("li").filter({ hasText: "Sandbag" }).filter({ has: page.getByLabel(/How many/) }).first();
  await row.getByRole("checkbox").check();
  await row.getByLabel(/How many/).fill("1");
  await page.getByLabel("Note (optional)", { exact: true }).fill("e2e pickup");
  await page.getByRole("button", { name: "Remove selected" }).click();
  await expect(page).toHaveURL(projectUrl);

  await page.goto(`${projectUrl}/history`);
  await expect(page.getByText(/Sandbag 15 lb returned \(removed from Feature Film X\)/).first()).toBeVisible();

  // Nothing was deleted: the sandbag can be added again.
  await page.goto(`${projectUrl}/add-equipment?q=sandbag`);
  const free = page.locator("li").filter({ hasText: "Sandbag" });
  const n = await free.count();
  expect(n).toBeGreaterThan(0);
  await free.first().getByRole("button", { name: "Add" }).click();
  await expect(free).toHaveCount(n - 1);
});

test("project equipment: one line per type with quantity, serials when opened", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("main").getByRole("link", { name: /Feature Film X/ }).first().click();
  const line = page.locator("summary").filter({ hasText: "bebob B290cine" });
  await expect(line).toHaveCount(1);
  await expect(line.getByLabel(/Quantity/)).toHaveText("6");
  await expect(page.getByText("SN B290-31131")).toBeHidden();
  await line.click();
  await expect(page.getByText("SN B290-31131")).toBeVisible();
});
