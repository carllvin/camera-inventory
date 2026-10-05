import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email = "alex@nordlicht.example") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("redirects to login when signed out", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
});

test("create project, add a new item, change status, see it in the timeline", async ({ page }, info) => {
  const tag = `${info.project.name}-${Date.now().toString(36)}`;
  await login(page);

  await page.goto("/projects/new");
  await page.getByLabel("Project name").fill(`E2E Shoot ${tag}`);
  await page.getByLabel("Status", { exact: true }).selectOption("shooting");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: `E2E Shoot ${tag}` })).toBeVisible();

  await page.getByRole("link", { name: "Add equipment" }).first().click();
  await page.getByRole("link", { name: "Create new item" }).click();
  await page.getByLabel("Equipment type").selectOption({ label: "SmallHD Cine 7" });
  await page.getByLabel("Serial number").fill(`E2E-${tag}`);
  await page.getByLabel("Rental house").selectOption({ label: "MBF Filmtechnik" });
  await page.getByRole("button", { name: "Create item", exact: true }).click();

  await expect(page.getByRole("heading", { name: "SmallHD Cine 7" })).toBeVisible();
  await expect(page.getByText(`SN E2E-${tag}`).first()).toBeVisible();
  await page.getByLabel("Status", { exact: true }).selectOption("in_use");
  await page.getByLabel("Status note").fill("On the dolly");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Status updated.")).toBeVisible();
  await expect(page.getByText(/on project → in use/)).toBeVisible();
  await expect(page.getByText("“On the dolly”")).toBeVisible();
});

test("duplicate serial is refused with a link to the existing item", async ({ page }) => {
  await login(page);
  await page.goto("/equipment/new");
  await page.getByLabel("Equipment type").selectOption({ label: "ARRI ALEXA 35" });
  await page.getByLabel("Serial number").fill("35-10421");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "never merged automatically" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open existing item" })).toBeVisible();
  // The typed value survives the failed submit.
  await expect(page.getByLabel("Serial number")).toHaveValue("35-10421");
});

test("search finds a serial typed without dashes", async ({ page }) => {
  await login(page);
  await page.goto("/search?q=b29031131");
  await expect(page.getByRole("link", { name: /bebob B290cine · SN B290-31131/ })).toBeVisible();
});

test("scan lookup opens the item for a barcode", async ({ page }) => {
  await login(page);
  await page.goto("/scan");
  await page.getByLabel("Code").fill("ARRI-0057");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}$/);
  await expect(page.getByText("SN 35-10577").first()).toBeVisible();
});

test("viewers can look but not change", async ({ page }) => {
  await login(page, "sam@nordlicht.example");
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
  await page.getByRole("link", { name: /Feature Film X/ }).click();
  await expect(page.getByRole("link", { name: "Add equipment" })).toHaveCount(0);
  await page.goto("/projects/new");
  await expect(page.getByText("No permission")).toBeVisible();
});

test("new user signs up, creates a workspace and sees an empty, isolated dashboard", async ({ page }, info) => {
  const email = `new-${info.project.name}-${Date.now().toString(36)}@test.example`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("New Loader");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Department or company name").fill("Second Unit Camera");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("No active projects")).toBeVisible();
  // Demo workspace data must not leak into the new workspace.
  await page.goto("/search?q=alexa");
  await expect(page.getByText("Nothing found")).toBeVisible();
});
