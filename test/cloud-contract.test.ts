import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenSERP } from "@openserp/sdk";
import { createMcpServer } from "../src/mcp-server";

test("Cloud tool discovery, status, paging, and errors work through MCP", async () => {
  const requests: URL[] = [];
  const sdk = new OpenSERP({
    apiKey: "osk_live_test",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer osk_live_test");
      if (url.pathname.endsWith("/engines/capabilities")) {
        return Response.json({ engines: { google: { web: true } } });
      }
      if (url.pathname.endsWith("/engines/status")) {
        return Response.json({ engines: { google: { status: "operational" } } });
      }
      if (url.pathname.endsWith("/bing/search")) {
        return Response.json({ error: "engine_unavailable", code: 503, retry_after: 60 },
          { status: 503, headers: { "X-Request-Id": "req_mcp", "Retry-After": "60" } });
      }
      return Response.json({ meta: { engine_used: "google" }, results: [],
        pagination: { page: 2, has_more: true, next_start: 20 } });
    },
  });
  const server = createMcpServer(sdk);
  const client = new Client({ name: "contract-test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const search = tools.tools.find((tool) => tool.name === "mega_search");
    assert.match(JSON.stringify(search?.inputSchema), /Balanced mega requires 0/);
    const engines = await client.callTool({ name: "list_engines", arguments: {} });
    const text = engines.content as Array<{ type: string; text: string }>;
    assert.deepEqual(JSON.parse(text[0].text).status, { engines: { google: { status: "operational" } } });

    const page = await client.callTool({ name: "any_search", arguments: {
      text: "test", engines: ["google", "bing"], start: 10, limit: 10,
    } });
    assert.ok(!page.isError);
    assert.equal(requests.at(-1)?.searchParams.get("start"), "10");
    assert.equal(requests.at(-1)?.searchParams.get("mode"), "any");

    const error = await client.callTool({ name: "search", arguments: {
      engine: "bing", text: "test", format: "markdown",
    } });
    assert.equal(error.isError, true);
    const details = (error.content as Array<{ text: string }>)[0].text;
    assert.match(details, /"error":"engine_unavailable"/);
    assert.match(details, /"request_id":"req_mcp"/);
    assert.match(details, /"retry_after":60/);
  } finally {
    await client.close();
    await server.close();
  }
});
