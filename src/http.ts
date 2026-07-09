import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OpenSERP } from "@openserp/sdk";
import type { OpenSERPConfig } from "@openserp/sdk";
import { SUPPORT_LINE } from "./messages";
import { createMcpServer } from "./mcp-server";

export function runHttpTransport(
  clientConfig: OpenSERPConfig,
  options: { host: string; port: number },
): void {
  const sseTransports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (request.method === "OPTIONS") {
        sendEmpty(response, 204);
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/mcp") {
        await handleStreamableHttp(clientConfig, request, response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/sse") {
        const transport = new SSEServerTransport("/messages", response);
        sseTransports.set(transport.sessionId, transport);
        transport.onclose = () => {
          sseTransports.delete(transport.sessionId);
        };

        await createMcpServer(new OpenSERP(clientConfig)).connect(transport);
        return;
      }

      if (request.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? sseTransports.get(sessionId) : undefined;
        if (!transport) {
          sendJson(response, 404, { error: "unknown_session" });
          return;
        }
        await transport.handlePostMessage(request, response);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (err) {
      sendJson(response, 500, { error: errorMessage(err) });
    }
  });

  httpServer.listen(options.port, options.host, () => {
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    console.error(
      `[openserp-mcp] HTTP transport listening at http://${options.host}:${port}/mcp | ${SUPPORT_LINE}`,
    );
  });
}

async function handleStreamableHttp(
  clientConfig: OpenSERPConfig,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const server = createMcpServer(new OpenSERP(clientConfig));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  } as any);

  try {
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response);
  } finally {
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  });
  response.end();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
