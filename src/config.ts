import {
  OSS_BASE_URL,
  type Backend,
  type OpenSERPConfig,
} from "@openserp/sdk";
import { API_KEY_LINE, SUPPORT_LINE } from "./messages";

let loggedOssMode = false;

export interface ServerConfig {
  client: OpenSERPConfig;
  host: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env.OPENSERP_API_KEY;
  const baseUrl = env.OPENSERP_BASE_URL;
  const backend = env.OPENSERP_BACKEND as Backend | undefined;
  const timeoutMs = parseInteger(env.OPENSERP_TIMEOUT_MS);

  if (!apiKey && !baseUrl && !loggedOssMode) {
    console.error(
      "[openserp-mcp] No OPENSERP_API_KEY set - using OSS mode at http://localhost:7000.",
    );
    console.error(`[openserp-mcp] ${API_KEY_LINE}`);
    console.error(`[openserp-mcp] ${SUPPORT_LINE}`);
    loggedOssMode = true;
  }

  return {
    client: {
      headers: { "X-OpenSERP-Client": "mcp" },
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : !apiKey ? { baseUrl: OSS_BASE_URL } : {}),
      ...(backend ? { backend } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
    host: env.HOST ?? "127.0.0.1",
    port: parseInteger(env.PORT) ?? 3333,
  };
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
