import type { Locator } from "@playwright/test";

/** Choose an equipment type in a TypePicker: type a query, click the suggestion. */
export async function pickType(input: Locator, query: string, option: string) {
  await input.click();
  await input.fill(query);
  await input.page().getByRole("option").filter({ hasText: option }).first().click();
}
