import { OpenSERP } from "@openserp/sdk";
import { DASHBOARD_STATUS_URL } from "./messages";

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export async function callTool(
  client: OpenSERP,
  name: string,
  args: unknown,
): Promise<ToolCallResult> {
  const input = assertObject(args);

  try {
    switch (name) {
      case "search":
        requireString(input, "engine");
        return toolResult(await client.search(input as any));
      case "mega_search":
        return toolResult(await client.megaSearch(input as any));
      case "fast_search":
        return toolResult(await client.fastSearch(input as any));
      case "any_search":
        return toolResult(await client.anySearch(input as any));
      case "image_search":
        requireString(input, "engine");
        return toolResult(await client.image(input as any));
      case "mega_image":
        return toolResult(await client.megaImage(input as any));
      case "extract":
        requireString(input, "url");
        return toolResult(await client.extract(input as any));
      case "batch_extract":
        requireArray(input, "urls");
        return toolResult(await client.batchExtract(input as any));
      case "get_usage":
        return toolResult(await getUsage(client));
      case "list_engines":
        return toolResult(await listEngines(client));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: formatError(err) }],
    };
  }
}

async function getUsage(client: OpenSERP): Promise<unknown> {
  if (client.backend !== "cloud") {
    throw new Error(
      `get_usage requires OpenSERP Cloud. Set OPENSERP_API_KEY or OPENSERP_BACKEND=cloud. Get an API key: ${DASHBOARD_STATUS_URL}`,
    );
  }

  return {
    backend: client.backend,
    baseUrl: client.baseUrl,
    account: await client.me(),
    lastResponse: summarizeLastResponse(client),
  };
}

async function listEngines(client: OpenSERP): Promise<unknown> {
  if (client.backend === "cloud") {
    return {
      backend: client.backend,
      baseUrl: client.baseUrl,
      capabilities: await client.enginesCapabilities(),
    };
  }

  return {
    backend: client.backend,
    baseUrl: client.baseUrl,
    engines: await client.engines(),
  };
}

function assertObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, key: string): void {
  if (typeof input[key] !== "string" || input[key] === "") {
    throw new Error(`Missing required string argument: ${key}`);
  }
}

function requireArray(input: Record<string, unknown>, key: string): void {
  const value = input[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing required array argument: ${key}`);
  }
}

function toolResult(value: unknown): ToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function summarizeLastResponse(client: OpenSERP): unknown {
  const last = client.lastResponse;
  if (!last) {
    return undefined;
  }

  return {
    status: last.status,
    requestId: last.requestId,
    credits: last.credits,
    engineUsed: last.engineUsed,
    networkBytes: last.networkBytes,
  };
}
