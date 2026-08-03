# @openserp/mcp

[![npm version](https://img.shields.io/npm/v/@openserp/mcp.svg)](https://www.npmjs.com/package/@openserp/mcp)
[![license](https://img.shields.io/npm/l/@openserp/mcp.svg)](https://github.com/openserpapi/mcp/blob/main/LICENSE.md)

Model Context Protocol server for OpenSERP OSS and OpenSERP Cloud. It gives MCP clients search, image search, single and batch URL extraction, usage, and engine metadata tools.

When `OPENSERP_API_KEY` is not set, the server uses OSS mode at `http://localhost:7000` and writes:

```text
[openserp-mcp] No OPENSERP_API_KEY set - using OSS mode at http://localhost:7000.
[openserp-mcp] Get an API key: https://openserp.org/dashboard/keys
[openserp-mcp] Docs: https://openserp.org/docs | Issues: https://github.com/openserpapi/mcp/issues
```

Set `OPENSERP_API_KEY` to use OpenSERP Cloud. API keys are available at https://openserp.org/dashboard/keys. Set `OPENSERP_BASE_URL` to target another compatible OpenSERP API base URL.

## Install

```bash
npm install -g @openserp/mcp
```

You can also run it without installing:

```bash
npx -y @openserp/mcp --stdio
```

## Tools

- `search`
- `mega_search`
- `fast_search`
- `any_search`
- `image_search`
- `mega_image`
- `get_usage`
- `list_engines`
- `extract`
- `batch_extract`

## Quick Examples

Ask your MCP client to:

- Search Google for current docs and return the top 5 URLs.
- Compare Google and Bing results for an SEO keyword.
- Extract clean Markdown from a URL before passing it to an LLM.
- Ground an answer in several sources at once with `batch_extract` - up to 20 URLs in one round-trip, where a dead link returns an error item instead of failing the batch.
- Read a geo-fenced page as a local visitor by passing `region: "DE"`.
- Check remaining Cloud credits with `get_usage`.

## Claude Desktop

Local OSS mode:

```json
{
  "mcpServers": {
    "openserp": {
      "command": "npx",
      "args": ["-y", "@openserp/mcp"]
    }
  }
}
```

Cloud mode:

```json
{
  "mcpServers": {
    "openserp": {
      "command": "npx",
      "args": ["-y", "@openserp/mcp"],
      "env": {
        "OPENSERP_API_KEY": "osk_live_..."
      }
    }
  }
}
```

## Cursor

For stdio use, add an MCP server entry:

```json
{
  "mcpServers": {
    "openserp": {
      "command": "npx",
      "args": ["-y", "@openserp/mcp"],
      "env": {
        "OPENSERP_API_KEY": "osk_live_..."
      }
    }
  }
}
```

For remote-style HTTP use, run:

```sh
npx -y @openserp/mcp --http --host 127.0.0.1 --port 3333
```

Then point a streamable HTTP MCP client to:

```text
http://127.0.0.1:3333/mcp
```

Clients that still use the older SSE transport can connect to:

```text
http://127.0.0.1:3333/sse
```

## Environment

- `OPENSERP_API_KEY`: Cloud API key from https://openserp.org/dashboard/keys.
- `OPENSERP_BASE_URL`: API base URL override.
- `OPENSERP_BACKEND`: Optional backend hint, `oss` or `cloud`.
- `OPENSERP_TIMEOUT_MS`: SDK request timeout in milliseconds.
- `HOST`: HTTP host, default `127.0.0.1`.
- `PORT`: HTTP port, default `3333`.

## Resources

- [OpenSERP Cloud docs](https://openserp.org/docs/cloud)
- [MCP server source](https://github.com/openserpapi/mcp)
- [JavaScript SDK](https://github.com/openserpapi/sdk-js)
