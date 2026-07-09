#!/usr/bin/env node
import { OpenSERP } from "@openserp/sdk";
import { loadConfig } from "./config";
import { runHttpTransport } from "./http";
import { DASHBOARD_STATUS_URL, DOCS_URL, ISSUES_URL } from "./messages";
import { createMcpServer } from "./mcp-server";
import { runStdioTransport } from "./stdio";

const args = process.argv.slice(2);

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

const config = loadConfig();
const client = new OpenSERP(config.client);

if (hasFlag("--http")) {
  runHttpTransport(config.client, {
    host: valueFor("--host") ?? config.host,
    port: parsePort(valueFor("--port")) ?? config.port,
  });
} else {
  const server = createMcpServer(client);
  await runStdioTransport(server);
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function valueFor(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function printHelp(): void {
  process.stdout.write(`OpenSERP MCP server

Usage:
  openserp-mcp --stdio
  openserp-mcp --http [--host 127.0.0.1] [--port 3333]

Environment:
  OPENSERP_API_KEY      Use OpenSERP Cloud when set. Keys: ${DASHBOARD_STATUS_URL}
  OPENSERP_BASE_URL     Override API base URL, for example http://localhost:7000.
  OPENSERP_BACKEND      Optional backend hint: oss or cloud.
  OPENSERP_TIMEOUT_MS   Request timeout in milliseconds.
  HOST                  HTTP host, default 127.0.0.1.
  PORT                  HTTP port, default 3333.

Resources:
  Docs                  ${DOCS_URL}
  GitHub / Issues       ${ISSUES_URL}
`);
}
