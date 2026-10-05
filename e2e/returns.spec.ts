import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("alex@nordlicht.example");
  await page.getByLabel("Password").fill("camera-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const pdf = (m: string) => Buffer.from(`%PDF-1.4\n% ${m}\n%%EOF`);

test("partial return to MBF: pick one of two receivers, split cables, report unknown line", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared demo project once");
  const tag = Date.now().toString(36);
  await login(page);
  await page.goto("/scan");
  await page.getByRole("link", { name: /Return note/ }).click();
  await expect(page.getByRole("heading", { name: "Upload return note" })).toBeVisible();
  await page.getByLabel("Project").selectOption({ label: "Feature Film X" });
  await page.getByLabel("Rental house").selectOption({ label: "MBF Filmtechnik" });
  await page.locator('input[type="file"]').setInputFiles({ name: `rt-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(tag) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);

  // Monitor by serial.
  await page.getByRole("button", { name: "+ Add a line by hand" }).click();
  await page.locator("#new-description").fill("SmallHD Cine 7");
  await page.locator("#new-serial").fill("C7-220871");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("Returning").first()).toBeVisible();

  // Receiver without serial: two on the project -> reviewer must choose.
  await page.locator("#new-description").fill("Teradek Bolt 6 XT 750 RX");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText(/2 Teradek Bolt 6 XT 750 RX on the project - choose/).first()).toBeVisible();
  const rx = page.locator("li", { hasText: "choose which one is returned" }).first();
  await rx.getByLabel("Item on the project").selectOption({ label: "Teradek Bolt 6 XT 750 RX (SN TD6-RX-40219) · MBF Filmtechnik" });
  await rx.getByRole("button", { name: "Save line" }).click();
  await expect(page.locator("li", { hasText: "TD6-RX-40219" }).getByText("Returning")).toBeVisible();

  // 3 of the 6 BNC cables.
  await page.locator("#new-description").fill("BNC 3G-SDI 1m");
  await page.locator("#new-quantity").fill("3");
  await page.locator("#new-item").selectOption({ label: "BNC Cable 1 m × 6 · MBF Filmtechnik" });
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText(/3 of 6 - the rest stays/).first()).toBeVisible();

  // Unknown equipment: report as issue, then ignore.
  await page.locator("#new-description").fill("Mystery monitor");
  await page.locator("#new-serial").fill(`UNKNOWN-${tag}`);
  await page.getByRole("button", { name: "Add line" }).click();
  const unknown = page.locator("li", { hasText: "unknown equipment" }).first();
  await unknown.getByText("Report as issue…").click();
  await unknown.getByLabel("Issue note").fill("MBF lists a monitor we never had");
  await unknown.getByRole("button", { name: "Report issue" }).click();
  await expect(page.getByText(/issue reported/).first()).toBeVisible();
  const unknown2 = page.locator("li", { hasText: "issue reported" }).first();
  await unknown2.getByLabel(/Ignore this line/).check();
  await unknown2.getByRole("button", { name: "Save line" }).click();

  // Overview: what stays on the project.
  await expect(page.getByText("After this return")).toBeVisible();
  await expect(page.getByText(/stay on the project/)).toBeVisible();
  await page.getByRole("button", { name: /Confirm return \(5 items\)/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /5 returned to MBF Filmtechnik, \d+ still on the project \(partial return\)/ })).toBeVisible();

  // The chosen receiver is returned, the other one stays.
  await page.goto("/search?q=TD6-RX-40219");
  await expect(page.getByText(/returned/).first()).toBeVisible();
  await page.goto("/search?q=TD6-RX-40213");
  await expect(page.getByText(/Feature Film X/).first()).toBeVisible();
  await page.goto("/issues");
  await expect(page.getByText(/MBF lists a monitor we never had/)).toBeVisible();
});
