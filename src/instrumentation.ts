/** Runs once when a server process starts: the daily reminder loop (Node.js only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startReminderLoop }, { getDb }] = await Promise.all([import("./server/reminders/run"), import("./server/db/client")]);
  startReminderLoop(getDb);
}
