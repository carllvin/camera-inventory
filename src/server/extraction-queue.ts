/** Collects answers from the discounted AI queue every few minutes (one per server process). */
import { getExtractor } from "./ai";
import { getDb } from "./db/client";
import { pollExtractionBatches } from "./domain/documents";

let started = false;
export function startExtractionQueueLoop(everyMs = 3 * 60_000) {
  if (started) return;
  started = true;
  const tick = () => pollExtractionBatches(getDb(), getExtractor()).catch((err) => console.error("[extraction queue] round failed:", err));
  setTimeout(tick, 20_000).unref();
  setInterval(tick, everyMs).unref();
}
