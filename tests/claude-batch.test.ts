/**
 * The discounted AI queue (Message Batches API) against a local fake: the batch
 * request we send (no fallbacks, which batches reject) and how results are read.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaudeDocumentExtractor } from "../src/server/ai/claude";
import type { Extraction } from "../src/server/ai/types";

let server: http.Server;
let baseURL: string;
let created: Record<string, any> | null = null;
let status: "in_progress" | "ended" = "in_progress";
let result: Record<string, unknown> = {};

const extraction: Extraction = {
  document_type: "delivery_note",
  rental_house_name: "ARRI Rental",
  rental_house_match: null,
  document_number: "LS-9",
  document_date: "2026-10-01",
  project_reference: null,
  project_number: null,
  customer_name: null,
  project_match: null,
  rental_start_date: null,
  rental_end_date: "2026-11-20",
  lines: [],
  warnings: [],
};

const batch = (id: string) => ({
  id,
  type: "message_batch",
  processing_status: status,
  request_counts: { processing: status === "ended" ? 0 : 1, succeeded: status === "ended" ? 1 : 0, errored: 0, canceled: 0, expired: 0 },
  created_at: "2026-10-16T08:00:00Z",
  expires_at: "2026-10-17T08:00:00Z",
  ended_at: status === "ended" ? "2026-10-16T08:30:00Z" : null,
  cancel_initiated_at: null,
  archived_at: null,
  results_url: status === "ended" ? `${baseURL}/v1/messages/batches/${id}/results` : null,
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "POST" && url.startsWith("/v1/messages/batches")) {
        created = JSON.parse(raw);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(batch("msgbatch_1")));
      }
      if (url.endsWith("/results")) {
        res.writeHead(200, { "content-type": "application/binary" });
        return res.end(`${JSON.stringify({ custom_id: "doc-1", result })}\n`);
      }
      if (url.includes("msgbatch_missing")) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "not found" } }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(batch("msgbatch_1")));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const extractor = () => new ClaudeDocumentExtractor("claude-sonnet-5-5", "medium", new Anthropic({ apiKey: "test-key", baseURL, maxRetries: 0 }));
const pdfFile = { name: "ls.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4 test") };
const ctx = { expectedKind: "delivery_note" as const, rentalHouses: [], catalog: [], projects: [] };
const message = (text: string, stop = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe("Claude extractor: discounted queue", () => {
  it("submits one request with the document and structured output, without fallbacks", async () => {
    status = "in_progress";
    const id = await extractor().submitBatch([pdfFile], ctx, "doc-1");
    expect(id).toBe("msgbatch_1");
    expect(created!.requests).toHaveLength(1);
    const req = created!.requests[0];
    expect(req.custom_id).toBe("doc-1");
    expect(req.params).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "adaptive" } });
    expect(req.params.fallbacks).toBeUndefined();
    expect(req.params.output_config.format.type).toBe("json_schema");
    expect(req.params.messages[0].content[1]).toMatchObject({ type: "document" });
  });

  it("reports pending, then the parsed reading, refusals and expiry", async () => {
    status = "in_progress";
    expect(await extractor().batchResult("msgbatch_1")).toEqual({ status: "pending" });

    status = "ended";
    result = { type: "succeeded", message: message(JSON.stringify(extraction)) };
    const done = await extractor().batchResult("msgbatch_1");
    expect(done.status).toBe("done");
    expect(done.status === "done" && done.result.extraction.rental_end_date).toBe("2026-11-20");
    expect(done.status === "done" && done.result.meta.batch).toBe(true);

    result = { type: "succeeded", message: message("", "refusal") };
    const refused = await extractor().batchResult("msgbatch_1");
    expect(refused.status === "failed" && refused.error.message).toMatch(/declined/);

    result = { type: "expired" };
    const expired = await extractor().batchResult("msgbatch_1");
    expect(expired.status === "failed" && expired.error.message).toMatch(/24 hours/);

    const gone = await extractor().batchResult("msgbatch_missing");
    expect(gone.status === "failed" && gone.error.message).toMatch(/no longer knows/);
  });
});
