/** Runs once when a server process starts: background loops (Node.js only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startReminderLoop }, { getDb }, { startExtractionQueueLoop }] = await Promise.all([
    import("./server/reminders/run"),
    import("./server/db/client"),
    import("./server/extraction-queue"),
  ]);
  startReminderLoop(getDb);
  startExtractionQueueLoop();
}
