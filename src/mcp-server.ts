import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenSERP } from "@openserp/sdk";
import { z } from "zod";
import { callTool } from "./tools";

const engines = ["google", "bing", "yandex", "baidu", "duck", "duckduckgo", "ecosia"] as const;
const formats = ["json", "markdown", "text", "ndjson"] as const;
const megaModes = ["balanced", "any", "fast"] as const;
const extractModes = ["auto", "fast", "rendered"] as const;
const httpUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "URL must use http or https");

// Replaced at build time with the package.json version (see tsup.config.ts).
// Falls back to "dev" when run from source without the define in place.
declare const __OPENSERP_MCP_VERSION__: string;
const VERSION =
  typeof __OPENSERP_MCP_VERSION__ === "string" ? __OPENSERP_MCP_VERSION__ : "dev";

// Shared description parts: what a search returns and how to recover from errors.
const SEARCH_OUTPUT =
  "Returns JSON: results (rank, title, url, snippet, domain, engine), pagination (has_more, next_start) and meta (request_id, took_ms, engines_failed).";
const SEARCH_ERRORS =
  "Errors return isError with status, error code and retry_after. On 429 or 503 wait retry_after; if an engine is blocked (CAPTCHA, 502/503), try another engine. Unsupported parameters return 400 and are not charged.";
const EXTRACT_MODE =
  "auto (default): fast HTTP fetch, browser render if the page comes back empty. fast: HTTP only. rendered: always a browser, for JavaScript-heavy pages.";
const MIN_RUNES = "Minimum text length (in runes) before auto mode escalates to a browser render. 0 uses the built-in floor.";

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
    .describe("Published-date range YYYYMMDD..YYYYMMDD. Cloud web search supports Google and Ecosia; unsupported filters return 400 without charge."),
  file: z.string().optional().describe("File extension filter, such as PDF."),
  site: z.string().optional().describe("Domain filter, such as example.com."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum result count, 1-100. Keep 10 when paging with start."),
  start: z.number().int().min(0).optional().describe("Result offset. On Cloud, Google/Bing/Yandex use multiples of 10, Baidu supports early pages, Ecosia any offset, DuckDuckGo none. Balanced mega requires 0; unsupported offsets return 400."),
  filter: z.boolean().optional().describe("Let the engine collapse near-duplicate results (default true, mostly affects Google)."),
  features: z
    .boolean()
    .optional()
    .describe("Add serp_features (AI summary, answer box, People Also Ask, related searches) when the engine shows them."),
  format: z
    .enum(formats)
    .optional()
    .default("json")
    .describe("json (default) for structured results; markdown, text or ndjson for compact plain text."),
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
  extractMode: z.enum(extractModes).optional().describe(EXTRACT_MODE),
  minRunes: z.number().int().min(0).optional().describe(MIN_RUNES),
};

const webSearchSchema = {
  ...commonSearchSchema,
  ...webExtractSchema,
};

const megaEngineSchema = {
  engines: z
    .array(z.enum(engines))
    .optional()
    .describe("Engines to query, in priority order for any mode. Omit to use all available engines."),
  mode: z
    .enum(megaModes)
    .optional()
    .default("balanced")
    .describe("balanced (default): all engines in parallel, results merged. any: engines in your order until one succeeds; on Cloud slow attempts can overlap. fast: the healthiest, fastest engine. Only any and fast support start above 0."),
  dedupe: z.boolean().optional().describe("Drop duplicate URLs across engines (default true)."),
  merge: z
    .boolean()
    .optional()
    .describe("true (default): one list from every engine that succeeded. false: keep only the first engine that returned results."),
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

const engineArg = z
  .enum(engines)
  .describe("Engine to query: google, bing, yandex, baidu, duckduckgo (or duck), ecosia.");

// Fields shared by extract and batch_extract.
const extractOptions = {
  mode: z.enum(extractModes).optional().default("auto").describe(EXTRACT_MODE),
  lang: z.string().optional().describe("Preferred page language, sent as Accept-Language, such as en or de."),
  minRunes: z.number().int().min(0).optional().describe(MIN_RUNES),
  clean: z
    .boolean()
    .optional()
    .describe("Article-only extraction (default true). Set false for landing pages, docs indexes and dashboards, where content sits in navigation or feature blocks."),
  useLlmsTxt: z
    .boolean()
    .optional()
    .describe("For a site root URL, return the site's /llms-full.txt or /llms.txt instead when it has one."),
};

export function createMcpServer(client: OpenSERP): McpServer {
  const server = new McpServer({
    name: "@openserp/mcp",
    version: VERSION,
  });

  server.registerTool(
    "get_context",
    {
      title: "Get web context",
      description: "Search a question and optional variants, read sources, and return relevant verbatim passages with citations. No LLM synthesis. maxTokens bounds only the context string in cl100k_base, not the JSON envelope. Inspect partial, truncated and failures. Source spans refer to UTF-8 byte offsets in extracted Markdown. Cloud: admin-account-only preview; uses the account's normal API key and credit balance. Charges successful search/extract steps plus assembly; completely empty context is refunded. Do not retry paid calls automatically.",
      inputSchema: {
        query: z.string().min(1).max(2000),
        queries: z.array(z.string().min(1).max(2000)).max(4).optional(),
        engines: z.array(z.enum(engines)).min(1).max(3).optional(),
        lang: z.string().max(32).optional(),
        region: z.string().max(128).optional(),
        extractMode: z.enum(extractModes).optional(),
        maxSources: z.number().int().min(1).max(10).optional(),
        maxFetches: z.number().int().min(1).max(20).optional(),
        maxTokens: z.number().int().min(256).max(32000).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => callTool(client, "get_context", args),
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description: `Search one engine you choose and return its ranked web results. Use it when the engine matters (Yandex for Russian, Baidu for Chinese, Google for the widest index) or to page with start. If any engine will do, use any_search; to compare engines, use mega_search. ${SEARCH_OUTPUT} Cloud: 1 credit per 10 returned results. ${SEARCH_ERRORS}`,
      inputSchema: {
        engine: engineArg,
        ...webSearchSchema,
      },
    },
    (args) => callTool(client, "search", args),
  );

  server.registerTool(
    "mega_search",
    {
      title: "Mega Search",
      description: `Query several engines in parallel and merge their web results into one list (mode balanced, the default). Each result keeps its source engine and rank, and clusters list each URL with its rank on every engine that found it. Use it to compare engines, check where a page ranks across engines, or widen coverage for research; it is slower and costs more than one engine. Balanced mode serves only the first page (start 0); mode any or fast behaves like any_search or fast_search. ${SEARCH_OUTPUT} Cloud: balanced is billed per engine that returns results. ${SEARCH_ERRORS}`,
      inputSchema: megaSearchSchema,
    },
    (args) => callTool(client, "mega_search", args),
  );

  server.registerTool(
    "fast_search",
    {
      title: "Fast Search",
      description: `Return one web result set as fast as possible, from the engine with the best recent health and latency. Use it for quick lookups where the engine doesn't matter; use search to pick the engine, or any_search to set a fallback order. ${SEARCH_OUTPUT} Cloud: 1 credit. ${SEARCH_ERRORS}`,
      inputSchema: fastOrAnySchema,
    },
    (args) => callTool(client, "fast_search", args),
  );

  server.registerTool(
    "any_search",
    {
      title: "Any Search",
      description: `Try engines one at a time in the order you give and return the first result set that succeeds, e.g. engines [google, bing, duckduckgo]. Use it as a resilient default when you prefer one engine but need a fallback; use fast_search when the order doesn't matter. On Cloud a slow attempt can overlap with the next one. ${SEARCH_OUTPUT} Cloud: 1 credit. ${SEARCH_ERRORS}`,
      inputSchema: fastOrAnySchema,
    },
    (args) => callTool(client, "any_search", args),
  );

  server.registerTool(
    "image_search",
    {
      title: "Image Search",
      description: `Search images on one engine you choose. Returns JSON results (rank, title, image url/thumbnail/width/height, source page_url and domain, engine) and pagination. Use mega_image to combine several engines. Cloud: cost scales with the number of returned images. ${SEARCH_ERRORS}`,
      inputSchema: {
        engine: engineArg,
        ...commonSearchSchema,
      },
    },
    (args) => callTool(client, "image_search", args),
  );

  server.registerTool(
    "mega_image",
    {
      title: "Mega Image Search",
      description: `Search images on several engines and merge them into one list (mode balanced, the default); each image keeps its source engine and rank, and duplicates are dropped. Use it when one engine gives too few or too similar images; use image_search for a single engine. Balanced mode serves only the first page; mode any or fast returns the first engine that succeeds. Output fields match image_search. Cloud: any/fast cost 1 credit, balanced depends on engines and image volume. ${SEARCH_ERRORS}`,
      inputSchema: megaImageSchema,
    },
    (args) => callTool(client, "mega_image", args),
  );

  server.registerTool(
    "get_usage",
    {
      title: "Get Usage",
      description:
        "Show the OpenSERP Cloud account behind OPENSERP_API_KEY: account (plan, credits_remaining) and lastResponse (request_id, credits used, engine) for the previous tool call in this session. Read-only and free. Use it to check the balance before a large batch or to see what a call cost. Self-hosted mode has no credits, so it returns an error there.",
      inputSchema: {},
    },
    () => callTool(client, "get_usage", {}),
  );

  server.registerTool(
    "list_engines",
    {
      title: "List Engines",
      description:
        "List the engines this OpenSERP backend can use and whether they work right now. Self-hosted: each engine with initialized and circuit_state (open means it is failing, skip it). Cloud: per-engine web/image support and status (operational, loaded, down) with latency. Read-only and free. Call it when searches keep failing, then pick a healthy engine for search or the engines list.",
      inputSchema: {},
    },
    () => callTool(client, "list_engines", {}),
  );

  server.registerTool(
    "extract",
    {
      title: "Extract URL",
      description:
        "Fetch one URL and return its main content as Markdown, e.g. to read a page found by search. Returns JSON: url, title, description, markdown, text, headings, links (first 50), lang and meta.mode_used. Content over maxChars (default 20000) is cut and the result gets truncated: true. For two or more pages use batch_extract. Pages behind logins or bot walls can fail or come back thin; try mode rendered or another source. Cloud: 1 credit for a fast fetch, 3 when the page needs a browser, +1 with region; failed and empty pages are free. Errors return isError with status and error code.",
      inputSchema: {
        url: httpUrl.describe("Absolute URL to fetch and extract."),
        ...extractOptions,
        region: z
          .string()
          .regex(/^[a-z]{2}$/i)
          .optional()
          .describe(
            "Two-letter country code to extract from, e.g. US or DE, for geo-fenced or localized pages. On Cloud this adds 1 credit per extracted URL.",
          ),
        format: z
          .enum(formats)
          .optional()
          .default("json")
          .describe("json (default) for the structured fields; markdown or text for the page content as plain text."),
        maxChars: z
          .number()
          .int()
          .min(500)
          .optional()
          .describe("Max characters of page content (default 20000). Longer pages are cut and marked truncated."),
      },
    },
    (args) => callTool(client, "extract", args),
  );

  server.registerTool(
    "batch_extract",
    {
      title: "Extract several URLs",
      description:
        "Extract LLM-ready content from up to 20 URLs in one request. Prefer this over repeated extract calls when grounding an answer in several pages: it is one round-trip, and a URL that fails returns an item with an error instead of failing the batch. Returns results (url, page_content as Markdown, error when that URL failed; metadata with title, mode_used and, when cut, truncated and total_chars) and meta (requested, succeeded, failed). Cloud: billed per URL like extract; failed and empty URLs are free.",
      inputSchema: {
        urls: z
          .array(httpUrl)
          .min(1)
          .max(20)
          .describe("Absolute URLs to fetch and extract. Duplicates are dropped."),
        ...extractOptions,
        region: z
          .string()
          .regex(/^[a-z]{2}$/i)
          .optional()
          .describe(
            "Two-letter country code applied to every URL, e.g. US or DE. On Cloud this adds 1 credit per extracted URL.",
          ),
        maxChars: z
          .number()
          .int()
          .min(500)
          .optional()
          .describe(
            "Max characters of content per URL. Default splits 40000 across the batch (at least 2000 each). Longer pages are cut and marked metadata.truncated.",
          ),
      },
    },
    (args) => callTool(client, "batch_extract", args),
  );

  return server;
}
