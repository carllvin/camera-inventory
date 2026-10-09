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

/** Take everything out of the open set again, so later tests see the demo data unchanged. */
async function takeOutAll(page: Page) {
  // The "Contents (N packed)" heading is the page's own count: go by it, one piece at a time.
  const heading = page.getByRole("heading", { name: /^Contents \(\d+ packed\)$/ });
  const packed = async () => Number((await heading.textContent())!.match(/\d+/)![0]);
  for (let n = await packed(); n > 0; n = await packed()) {
    await page.getByRole("button", { name: "Take out" }).first().click();
    await expect(page.getByRole("heading", { name: `Contents (${n - 1} packed)` })).toBeVisible();
  }
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
  // Free pieces the template asks for are packed right away (the two spare batteries).
  await expect(page.getByText("2 pieces from the project packed automatically.")).toBeVisible();
  await expect(page.getByText("2 / 8").first()).toBeVisible();
  await takeOutAll(page);
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
  // Free Cine 7s on the project are packed right away (other tests may have added one);
  // the ones in other sets are never moved.
  await expect(page.getByText(/^[012] \/ 2$/).first()).toBeVisible();
  await takeOutAll(page);
  await expect(page.getByText("0 / 2").first()).toBeVisible();

  await page.getByRole("link", { name: "Edit", exact: true }).click();
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
  paths.push((await page.getByRole("link", { name: /SN 35-10421/ }).first().getAttribute("href"))!);
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
  await expect(page.getByRole("heading", { name: "Contents (2 packed)" })).toBeVisible();
  await expect(free.getByText(`${before - 2} pcs · no serial`)).toBeVisible();

  // Take one out: the rest stays in the set.
  const packed = page.locator("li").filter({ hasText: "Sandbag" }).filter({ has: page.getByLabel(/How many/) }).filter({ has: page.getByRole("button", { name: "Take out" }) });
  await packed.getByLabel(/How many/).fill("1");
  await packed.getByRole("button", { name: "Take out" }).click();
  await expect(page.getByRole("heading", { name: "Contents (1 packed)" })).toBeVisible();
  // A single unit left: plain button (the extras list has another one).
  await page.locator("li").filter({ hasText: "Sandbag" }).getByRole("button", { name: "Take out" }).last().click();
  await expect(page.getByRole("heading", { name: "Contents (0 packed)" })).toBeVisible();
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
  await page.getByRole("link", { name: "By type" }).click();
  const line = page.locator("summary").filter({ hasText: "bebob B290cine" });
  await expect(line).toHaveCount(1);
  await expect(line.getByLabel(/Quantity/)).toHaveText("6");
  await expect(page.getByText("SN B290-31131")).toBeHidden();
  await line.click();
  await expect(page.getByText("SN B290-31131")).toBeVisible();
});

test("equipment page: one line per type in the type view, pictures grouped by set as an option", async ({ page }) => {
  await login(page);
  await go(page, "/equipment?view=types");
  const line = page.locator("summary").filter({ hasText: "ARRI ALEXA 35" });
  await expect(line).toHaveCount(1);
  await line.click();
  await expect(page.getByText("SN 35-10421")).toBeVisible();

  await page.getByRole("link", { name: "Image view" }).click();
  await expect(page).toHaveURL(/view=grid/);
  // Grouped by set like the list: the A-Cam camera has its card under A-Cam, the B-Cam one under B-Cam.
  const card = page.getByRole("region", { name: "A-Cam Set" }).getByRole("link", { name: /ARRI ALEXA 35/ });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("× 1");
  await expect(page.getByRole("region", { name: "B-Cam Set" }).getByRole("link", { name: /ARRI ALEXA 35/ })).toHaveCount(1);
  await card.click();
  await expect(page.getByText("SN 35-10421").first()).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Contents (2 packed)" })).toBeVisible();
  // What is packed now becomes the expected contents in one click.
  await page.getByRole("button", { name: "Use what's packed now (2)" }).click();
  await expect(page.getByText("2 / 2").first()).toBeVisible();
  // Put them back where they were (not in a set).
  for (const left of [1, 0]) {
    await page.locator("li").filter({ has: page.getByRole("button", { name: "Take out" }) }).first().getByRole("button", { name: "Take out" }).click();
    await expect(page.getByRole("heading", { name: `Contents (${left} packed)` })).toBeVisible();
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

test("equipment can be sorted, e.g. by quantity", async ({ page }) => {
  await login(page);
  // One list by type (the default view groups by set).
  await go(page, "/equipment?view=types");
  await page.getByLabel("Sort").selectOption("qty");
  await expect(page).toHaveURL(/sort=qty/);
  // The 10 sandbags come first.
  await expect(page.locator("summary").first()).toContainText("Sandbag");
  await page.getByLabel("Sort").selectOption("name");
  await expect(page.locator("summary").first()).toContainText("ARRI");
});

test("select mode: tick equipment and change it in one go", async ({ page }) => {
  await login(page);
  await go(page, "/equipment?view=types");
  await page.getByRole("link", { name: "Select" }).click();
  await expect(page).toHaveURL(/select=1/);
  const bar = page.locator("form").filter({ has: page.getByLabel("Action") });

  // A whole type at once: both top handles in use, then back.
  await page.getByLabel("Select all ARRI Top Handle").check();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await bar.getByLabel("Action").selectOption("status:in_use");
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("2 pieces updated (status).")).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "ARRI Top Handle" })).toContainText("2 in use");
  await page.getByLabel("Select all ARRI Top Handle").check();
  await bar.getByLabel("Action").selectOption("status:on_project");
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("summary").filter({ hasText: "ARRI Top Handle" })).not.toContainText("in use");

  // Into a set and out again.
  await page.getByLabel("Select all bebob VS2-Cine Charger").check();
  const setValue = await bar.getByLabel("Action").locator("option", { hasText: "A-Cam Set" }).getAttribute("value");
  await bar.getByLabel("Action").selectOption(setValue!);
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("1 piece added to the set.")).toBeVisible();
  await page.getByLabel("Select all bebob VS2-Cine Charger").check();
  await bar.getByLabel("Action").selectOption("unpack");
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("1 piece taken out of their set.")).toBeVisible();
});

test("lists: just start typing, the list updates live", async ({ page }) => {
  await login(page);
  await go(page, "/equipment");
  await expect(page.locator("summary").filter({ hasText: "Matthews Sandbag" })).toBeVisible();
  // No click into the field: the keys go to the search on their own.
  await page.keyboard.type("bebob");
  await expect(page).toHaveURL(/q=bebob/);
  await expect(page.locator("summary").filter({ hasText: "Matthews Sandbag" })).toHaveCount(0);
  await expect(page.locator("summary").filter({ hasText: "bebob B290cine" }).first()).toBeVisible();
  // Escape clears it again.
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator("summary").filter({ hasText: "Matthews Sandbag" })).toBeVisible();
});

test("equipment grouped by set; ticking a type ticks it only in that set", async ({ page }) => {
  await login(page);
  await go(page, "/equipment");
  // By set is the default view.
  await expect(page.getByRole("link", { name: "By set" })).toHaveAttribute("aria-current", "true");
  const aCam = page.getByRole("region", { name: "A-Cam Set" });
  const loose = page.getByRole("region", { name: "Not in a set" });
  await expect(aCam.locator("summary").filter({ hasText: "ARRI ALEXA 35" })).toBeVisible();
  await expect(loose.locator("summary").filter({ hasText: "Matthews Sandbag" })).toBeVisible();
  await expect(aCam.locator("summary").filter({ hasText: "Matthews Sandbag" })).toHaveCount(0);
  // ALEXA 35 is in A-Cam and B-Cam: the type tick in A-Cam only takes that one.
  await page.getByRole("link", { name: "Select" }).click();
  await aCam.getByLabel("Select all ARRI ALEXA 35").check();
  await expect(page.getByText("1 selected")).toBeVisible();
});

test("a click on a small picture shows it large", async ({ page }) => {
  await login(page);
  await go(page, "/equipment?q=WCU-4471");
  await page.getByRole("link", { name: /SN WCU-4471/ }).first().click();
  await page.waitForURL(/\/equipment\/[0-9a-f-]{36}/);
  await page.waitForLoadState("networkidle");
  const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#cc5500" } }).jpeg().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "wcu.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Photo added.")).toBeVisible();

  await go(page, "/equipment");
  const line = page.locator("details").filter({ has: page.locator("summary", { hasText: "ARRI WCU-4" }) }).first();
  await line.getByRole("button", { name: "Show picture of ARRI WCU-4" }).click();
  const dialog = page.getByRole("dialog", { name: "ARRI WCU-4" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Only the picture opened, not the line.
  await expect(line).not.toHaveAttribute("open", "");
});
