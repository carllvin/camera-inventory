import "server-only";
import type { PickerDeps } from "../domain/image-picker";
import { getStorage } from "../storage";
import { createImageRankerFromEnv, createImageSearchFromEnv } from "./images";

let cached: Omit<PickerDeps, "storage"> | undefined;

export function getPickerDeps(): PickerDeps {
  cached ??= { search: createImageSearchFromEnv(), ranker: createImageRankerFromEnv() };
  return { ...cached, storage: getStorage() };
}
