/** Publishing to ntfy (https://ntfy.sh or a self-hosted server) with its JSON API. */
export interface NtfyMessage {
  title: string;
  message: string;
  click?: string;
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
}

export async function sendNtfy(server: string, topic: string, token: string | null, m: NtfyMessage, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${server.replace(/\/+$/, "")}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ topic, title: m.title, message: m.message, click: m.click, tags: m.tags ?? ["calendar"], priority: m.priority ?? 3 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}
