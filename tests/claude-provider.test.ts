/**
 * The Claude provider against a local fake of the Messages API: checks the request
 * we send (model, fallback beta, document block, structured-output schema) and how
 * streamed responses, refusals and API errors are handled. No real API calls.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaudeDocumentExtractor } from "../src/server/ai/claude";
import { ExtractionError, type Extraction } from "../src/server/ai/types";
import { createExtractorFromEnv } from "../src/server/ai";

let server: http.Server;
let baseURL: string;
let lastRequest: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | null = null;
let reply: { stopReason: string; text: string } | { status: number; body: unknown } = { stopReason: "end_turn", text: "{}" };

const extraction: Extraction = {
  document_type: "delivery_note",
  rental_house_name: "ARRI Rental",
  rental_house_match: "ARRI Rental",
  document_number: "LS-1",
  document_date: "2026-10-01",
  project_reference: "FFX",
  lines: [{ raw_text: "1 ALEXA 35 SN 1", description: "ALEXA 35", manufacturer: "ARRI", model: "ALEXA 35", quantity: 1, serial_numbers: ["1"], asset_numbers: [], catalog_match: "ARRI ALEXA 35", is_equipment: true, confidence: 0.98 }],
  warnings: [],
};

function sse(res: http.ServerResponse, stopReason: string, text: string) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  send("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage } });
  if (text) {
    send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
    send("content_block_stop", { type: "content_block_stop", index: 0 });
  }
  send("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastRequest = { headers: req.headers, body: JSON.parse(raw || "{}") };
      if ("status" in reply) {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      } else sse(res, reply.stopReason, reply.text);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const extractor = () => new ClaudeDocumentExtractor("claude-opus-5-5", "high", new Anthropic({ apiKey: "test-key", baseURL, maxRetries: 0 }));
const pdfFile = { name: "ls.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4 test") };
const ctx = { expectedKind: "delivery_note" as const, rentalHouses: ["ARRI Rental; ARRI Rental Deutschland GmbH"], catalog: ["ARRI ALEXA 35; A35"] };

describe("Claude document extractor", () => {
  it("sends the PDF with structured output, fallback and adaptive thinking; parses the result", async () => {
    reply = { stopReason: "end_turn", text: JSON.stringify(extraction) };
    const r = await extractor().extract([pdfFile], ctx);
    expect(r.extraction).toEqual(extraction);
    expect(r.provider).toBe("anthropic");
    const body = lastRequest!.body as Record<string, any>;
    expect(lastRequest!.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", thinking: { type: "adaptive" }, stream: true });
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.properties.lines.type).toBe("array");
    const content = body.messages[0].content;
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(content.at(-1).text).toContain("ARRI ALEXA 35; A35");
  });

  it("turns refusals, truncation and API errors into user-facing extraction errors", async () => {
    reply = { stopReason: "refusal", text: "" };
    await expect(extractor().extract([pdfFile], ctx)).rejects.toThrow(/declined/);
    reply = { stopReason: "max_tokens", text: '{"document_type":"deliv' };
    await expect(extractor().extract([pdfFile], ctx)).rejects.toThrow(/too long/);
    reply = { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
    const err = await extractor().extract([pdfFile], ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).message).toContain("ANTHROPIC_API_KEY");
    reply = { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } };
    const rate = (await extractor().extract([pdfFile], ctx).catch((e: unknown) => e)) as ExtractionError;
    expect(rate.retryable).toBe(true);
  });

  it("refuses unsupported files before calling the API", async () => {
    lastRequest = null;
    await expect(extractor().extract([{ name: "a.txt", mimeType: "text/plain", bytes: Buffer.from("x") }], ctx)).rejects.toThrow(/No readable file/);
    expect(lastRequest).toBeNull();
  });

  it("picks the provider from the environment", () => {
    expect(createExtractorFromEnv({}).available).toBe(false);
    const e = createExtractorFromEnv({ ANTHROPIC_API_KEY: "x", AI_EFFORT: "max" });
    expect([e.provider, e.model, e.available]).toEqual(["anthropic", "claude-opus-5-5", true]);
    expect(createExtractorFromEnv({ ANTHROPIC_API_KEY: "x", AI_PROVIDER: "none" }).available).toBe(false);
  });
});
