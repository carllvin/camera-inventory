import "server-only";
import type { PickerDeps } from "../domain/image-picker";
import { catalogImageCount, catalogImageFor } from "../catalog/images";
import { getStorage } from "../storage";
import { createImageRankerFromEnv, createImageSearchFromEnv } from "./images";

let cached: Omit<PickerDeps, "storage"> | undefined;

export function getPickerDeps(): PickerDeps {
  cached ??= { search: createImageSearchFromEnv(), ranker: createImageRankerFromEnv(), catalog: catalogImageCount > 0 ? catalogImageFor : undefined };
  return { ...cached, storage: getStorage() };
}
