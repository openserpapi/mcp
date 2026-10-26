import { OpenSERP, SERPError, type BatchExtractResult } from "@openserp/sdk";
import { DASHBOARD_STATUS_URL } from "./messages";

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// Long pages (changelog archives, docs indexes) can exceed an MCP client's
// tool-output limit, so extracted content is cut to a per-page budget and
// marked as truncated. maxChars raises it. Claude Code moves results over
// 50k chars to a file, so a batch leaves ~10k for JSON and metadata.
export const EXTRACT_MAX_CHARS = 20_000;
const BATCH_MAX_CHARS = 40_000; // shared across the URLs of one batch
const BATCH_MIN_CHARS = 2_000;
const MAX_LINKS = 50;

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
      case "extract": {
        requireString(input, "url");
        const { maxChars, ...params } = input;
        const limit = charBudget(maxChars, EXTRACT_MAX_CHARS);
        return toolResult(trimExtract(await client.extract(params as any), limit));
      }
      case "batch_extract": {
        requireArray(input, "urls");
        const { maxChars, ...params } = input;
        const perPage = Math.max(BATCH_MIN_CHARS, Math.floor(BATCH_MAX_CHARS / (input.urls as unknown[]).length));
        const limit = charBudget(maxChars, perPage);
        return toolResult(trimBatch(await client.batchExtract(params as any), limit));
      }
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
      status: await client.enginesStatus(),
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

function charBudget(value: unknown, fallback: number): number {
  return typeof value === "number" && value > 0 ? Math.floor(value) : fallback;
}

function cut(text: string, limit: number): string {
  return `${text.slice(0, limit)}\n\n[truncated: ${limit} of ${text.length} characters, raise maxChars to read more]`;
}

function trimExtract(value: unknown, limit: number): unknown {
  if (typeof value === "string") {
    return value.length > limit ? cut(value, limit) : value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const page = { ...(value as Record<string, unknown>) };
  let truncated = false;
  for (const key of ["markdown", "text"]) {
    const text = page[key];
    if (typeof text === "string" && text.length > limit) {
      page[key] = cut(text, limit);
      truncated = true;
    }
  }
  if (Array.isArray(page.links) && page.links.length > MAX_LINKS) {
    page.links = page.links.slice(0, MAX_LINKS);
    truncated = true;
  }
  return truncated ? { ...page, truncated: true } : page;
}

function trimBatch(value: BatchExtractResult, limit: number): BatchExtractResult {
  const results = value.results?.map((item) => {
    const content = item.page_content;
    if (typeof content !== "string" || content.length <= limit) {
      return item;
    }
    return {
      ...item,
      page_content: cut(content, limit),
      // batch metadata is a string map (Open WebUI loader contract)
      metadata: { ...item.metadata, truncated: "true", total_chars: String(content.length) },
    };
  });
  return { ...value, results };
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
  if (err instanceof SERPError) {
    return `${err.message}\n${JSON.stringify({
      status: err.status,
      error: err.code,
      request_id: err.requestId,
      retry_after: err.retryAfter,
    })}`;
  }
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
