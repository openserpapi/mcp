import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenSERP } from "@openserp/sdk";
import { z } from "zod";
import { callTool } from "./tools";

const engines = ["google", "bing", "yandex", "baidu", "duck", "duckduckgo", "ecosia"] as const;
const formats = ["json", "markdown", "text", "ndjson"] as const;
const megaModes = ["balanced", "any", "fast"] as const;
const extractModes = ["auto", "fast", "rendered"] as const;

// Replaced at build time with the package.json version (see tsup.config.ts).
// Falls back to "dev" when run from source without the define in place.
declare const __OPENSERP_MCP_VERSION__: string;
const VERSION =
  typeof __OPENSERP_MCP_VERSION__ === "string" ? __OPENSERP_MCP_VERSION__ : "dev";

// Fields shared by every search-style tool, web and image alike.
const commonSearchSchema = {
  text: z
    .string()
    .optional()
    .describe("Search query text. At least one of text, site, or file should be provided."),
  lang: z.string().optional().describe("Language code, such as EN or de."),
  region: z
    .string()
    .optional()
    .describe("Market or location hint, such as US, DE, en-GB, Berlin, or a Yandex lr id."),
  date: z
    .string()
    .regex(/^[0-9]{8}\.\.[0-9]{8}$/)
    .optional()
    .describe("Date interval in YYYYMMDD..YYYYMMDD format."),
  file: z.string().optional().describe("File extension filter, such as PDF."),
  site: z.string().optional().describe("Domain filter, such as example.com."),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum result count."),
  start: z.number().int().min(0).optional().describe("Pagination offset."),
  filter: z.boolean().optional().describe("Enable duplicate filtering."),
  features: z.boolean().optional().describe("Include supported rich SERP features."),
  format: z.enum(formats).optional().default("json").describe("Response format."),
};

// Page-content extraction only applies to web results, so these are kept off
// the image tools (the image endpoints ignore them).
const webExtractSchema = {
  extract: z
    .union([z.boolean(), z.number().int().min(0).max(5)])
    .optional()
    .describe(
      "Enrich the top web results with cleaned page content. Boolean or integer depth: false/0 off, true/1 top result, N top N (1-5).",
    ),
  extractMode: z.enum(extractModes).optional().describe("Extraction strategy for target pages."),
  minRunes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Minimum content length (in runes) before auto mode escalates to rendered extraction."),
};

const webSearchSchema = {
  ...commonSearchSchema,
  ...webExtractSchema,
};

const megaEngineSchema = {
  engines: z
    .array(z.enum(engines))
    .optional()
    .describe("Engines to query. Omit to use all available engines."),
  mode: z.enum(megaModes).optional().default("balanced").describe("Mega execution mode."),
  dedupe: z.boolean().optional().describe("Deduplicate by normalized URL."),
  merge: z.boolean().optional().describe("Merge successful engine results."),
};

const megaSearchSchema = {
  ...webSearchSchema,
  ...megaEngineSchema,
};

const megaImageSchema = {
  ...commonSearchSchema,
  ...megaEngineSchema,
};

// fast_search / any_search are mega_search with a fixed mode, so they take the
// same inputs minus the mode selector.
const { mode: _mode, ...fastOrAnySchema } = megaSearchSchema;

export function createMcpServer(client: OpenSERP): McpServer {
  const server = new McpServer({
    name: "@openserp/mcp",
    version: VERSION,
  });

  server.registerTool(
    "search",
    {
      title: "Search",
      description: "Search web results with a specific OpenSERP engine.",
      inputSchema: {
        engine: z.enum(engines).describe("Search engine endpoint alias."),
        ...webSearchSchema,
      },
    },
    (args) => callTool(client, "search", args),
  );

  server.registerTool(
    "mega_search",
    {
      title: "Mega Search",
      description: "Search across multiple engines with balanced, any, or fast execution.",
      inputSchema: megaSearchSchema,
    },
    (args) => callTool(client, "mega_search", args),
  );

  server.registerTool(
    "fast_search",
    {
      title: "Fast Search",
      description: "Search using the fastest currently healthy engine.",
      inputSchema: fastOrAnySchema,
    },
    (args) => callTool(client, "fast_search", args),
  );

  server.registerTool(
    "any_search",
    {
      title: "Any Search",
      description: "Try engines in order and return the first successful web result set.",
      inputSchema: fastOrAnySchema,
    },
    (args) => callTool(client, "any_search", args),
  );

  server.registerTool(
    "image_search",
    {
      title: "Image Search",
      description: "Search image results with a specific OpenSERP engine.",
      inputSchema: {
        engine: z.enum(engines).describe("Search engine endpoint alias."),
        ...commonSearchSchema,
      },
    },
    (args) => callTool(client, "image_search", args),
  );

  server.registerTool(
    "mega_image",
    {
      title: "Mega Image Search",
      description: "Search images across multiple engines.",
      inputSchema: megaImageSchema,
    },
    (args) => callTool(client, "mega_image", args),
  );

  server.registerTool(
    "get_usage",
    {
      title: "Get Usage",
      description: "Return OpenSERP Cloud account and credit information.",
      inputSchema: {},
    },
    () => callTool(client, "get_usage", {}),
  );

  server.registerTool(
    "list_engines",
    {
      title: "List Engines",
      description: "List available engines on OSS or Cloud engine capabilities on Cloud.",
      inputSchema: {},
    },
    () => callTool(client, "list_engines", {}),
  );

  server.registerTool(
    "extract",
    {
      title: "Extract URL",
      description: "Extract LLM-ready content from a URL.",
      inputSchema: {
        url: z.string().url().describe("Absolute URL to fetch and extract."),
        mode: z.enum(extractModes).optional().default("auto").describe("Extraction strategy."),
        lang: z.string().optional().describe("Language hint."),
        minRunes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Minimum content length (in runes) before auto mode escalates to rendered extraction."),
        clean: z.boolean().optional().describe("Use article-only extraction when true."),
        useLlmsTxt: z
          .boolean()
          .optional()
          .describe("Prefer /llms-full.txt or /llms.txt for site roots."),
        format: z.enum(formats).optional().default("json").describe("Response format."),
      },
    },
    (args) => callTool(client, "extract", args),
  );

  return server;
}
