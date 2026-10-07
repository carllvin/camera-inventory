import type { Locator, Page } from "@playwright/test";

/** Navigate and wait until the page is hydrated, so early clicks and ticks are not lost. */
export async function go(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** Choose an equipment type in a TypePicker: type a query, click the suggestion. */
export async function pickType(input: Locator, query: string, option: string) {
  await input.click();
  await input.fill(query);
  await input.page().getByRole("option").filter({ hasText: option }).first().click();
}
