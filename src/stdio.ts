import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SUPPORT_LINE } from "./messages";

export async function runStdioTransport(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error(`[openserp-mcp] stdio transport ready | ${SUPPORT_LINE}`);
}
