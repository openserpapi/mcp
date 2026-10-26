import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenSERP } from "@openserp/sdk";
import { createMcpServer } from "../src/mcp-server";

test("extract tools cut long pages to a budget and mark them truncated", async () => {
  const bodies: string[] = [];
  const sdk = new OpenSERP({
    baseUrl: "http://localhost:7000",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/extract/batch") {
        bodies.push(String(init?.body));
        const { urls } = JSON.parse(String(init?.body)) as { urls: string[] };
        const content = (u: string) =>
          u.endsWith("/post") ? "short page"
          : u.endsWith("/archive") ? "a".repeat(100_000)
          : '## Release\n"Quoted" notes, a link to [docs](https://example.com/docs).\n'.repeat(2_000);
        // OSS answers with a bare array
        return Response.json(urls.map((u) => ({ page_content: content(u), metadata: { source: u } })));
      }
      assert.equal(url.searchParams.get("maxChars"), null);
      return Response.json({
        url: "https://example.com/docs",
        markdown: "m".repeat(50_000),
        text: "t".repeat(100),
        links: Array.from({ length: 200 }, (_, i) => ({ url: `https://example.com/${i}` })),
      });
    },
  });
  const server = createMcpServer(sdk);
  const client = new Client({ name: "budget-test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const textOf = (r: unknown) => JSON.parse(((r as { content: Array<{ text: string }> }).content)[0].text);
  try {
    const batch = textOf(await client.callTool({ name: "batch_extract", arguments: {
      urls: ["https://example.com/archive", "https://example.com/post"],
    } }));
    const [long, short] = batch.results;
    assert.ok(long.page_content.length < 21_000, "40k budget split across 2 urls");
    assert.match(long.page_content, /\[truncated: 20000 of 100000 characters/);
    assert.equal(long.metadata.truncated, "true");
    assert.equal(long.metadata.total_chars, "100000");
    assert.equal(short.page_content, "short page");
    assert.equal(short.metadata.truncated, undefined);
    assert.ok(!bodies[0].includes("maxChars"), "budget is not sent upstream");

    const custom = textOf(await client.callTool({ name: "batch_extract", arguments: {
      urls: ["https://example.com/archive", "https://example.com/post"], maxChars: 1000,
    } }));
    assert.match(custom.results[0].page_content, /\[truncated: 1000 of 100000/);

    const four = await client.callTool({ name: "batch_extract", arguments: {
      urls: [1, 2, 3, 4].map((i) => `https://example.com/page${i}`),
    } });
    const size = (four as { content: Array<{ text: string }> }).content[0].text.length;
    assert.ok(size < 50_000, `4-page batch fits Claude Code's 50k limit (${size})`);

    const page = textOf(await client.callTool({ name: "extract", arguments: { url: "https://example.com/docs" } }));
    assert.equal(page.truncated, true);
    assert.match(page.markdown, /\[truncated: 20000 of 50000/);
    assert.equal(page.text, "t".repeat(100));
    assert.equal(page.links.length, 50);
  } finally {
    await client.close();
    await server.close();
  }
});
