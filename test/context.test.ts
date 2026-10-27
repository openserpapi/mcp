import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenSERP } from "@openserp/sdk";
import { createMcpServer } from "../src/mcp-server";

test("get_context is registered, forwards budgets and preserves citations and preview errors", async () => {
  let denied = false;
  let calls = 0;
  const evidence = { context: "[c1] Документация", partial: true, citations: [{ id: "c1", excerpt: "Документация", source_span: { start: 42, end: 66 } }], billing: { credits_used: 3, credits_remaining: 97 } };
  const sdk = new OpenSERP({ apiKey: "osk_live_preview", fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.openserp.org/v1/context");
    assert.equal(init?.method, "POST");
    const input = JSON.parse(String(init?.body));
    assert.equal(input.max_tokens, 500);
    if (denied) return Response.json({ error: "not_found", code: 404, message: "Not found." }, { status: 404 });
    return Response.json(evidence);
  } });
  const server = createMcpServer(sdk);
  const client = new Client({ name: "context-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const tools = await client.listTools();
    const tool = tools.tools.find(t => t.name === "get_context");
    assert.ok(tool);
    assert.equal(tool.annotations?.idempotentHint, false);
    const args = { query: "replication", maxTokens: 500 };
    const output = await client.callTool({ name: "get_context", arguments: args });
    assert.deepEqual(JSON.parse((output.content as Array<{ text: string }>)[0].text), evidence);
    denied = true;
    const error = await client.callTool({ name: "get_context", arguments: args });
    assert.equal(error.isError, true);
    assert.match((error.content as Array<{ text: string }>)[0].text, /404/);
    const before = calls;
    const invalid = await client.callTool({ name: "get_context", arguments: { query: "x", maxTokens: 1 } });
    assert.equal(invalid.isError, true); assert.equal(calls, before);
  } finally { await client.close(); await server.close(); }
});
