# fonto-docs-mcp

[![Deploy to Cloud Run](https://github.com/DrRataplan/fonto-docs-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/DrRataplan/fonto-docs-mcp/actions/workflows/deploy.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An MCP server that makes the [Fonto XML documentation](https://documentation.fontoxml.com/) accessible to AI tools like Claude Code, Cursor, and Claude Desktop. **Live at [fonto-docs.elliat.nl](https://fonto-docs.elliat.nl/).**

The Fonto docs are rendered by a JavaScript SPA, which makes them impossible for AI to read directly. This server fetches the underlying XML and converts it to clean, readable Markdown on demand.

## What is MCP?

MCP (Model Context Protocol) is a standard way to give AI assistants access to external tools. Once you connect this server to your AI tool, it gains access to these tools and resources:

| Tool | What it does |
|---|---|
| `search_fonto_docs` | Search by keyword — returns matching pages with titles, descriptions, and slugs |
| `get_fonto_page` | Fetch the full content of a page by its slug |
| `lookup_api` | Resolve an API name (e.g. `documentsManager`, `createIconWidget`) straight to its page in one call |
| `list_pages` | List all pages matching a keyword, with full section hierarchy — useful for discovery |

| Resource | What it contains |
|---|---|
| `fonto://catalog` | All ~2000 pages with real titles, product grouping, and ancestry paths |
| `fonto://page/{slug}` | Resource template — address any page directly by its slug |

You can then ask things like *"How does addDocumentChangeCallback work?"* and the AI will look it up in the live Fonto docs.

## Connect to your AI tool

The server is already running at `https://fonto-docs.elliat.nl/mcp` — you just need to point your tool at it.

### Claude Code (CLI)

```bash
claude mcp add --transport http fonto-docs https://fonto-docs.elliat.nl/mcp
```

### Cursor

Add to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "fonto-docs": {
      "type": "http",
      "url": "https://fonto-docs.elliat.nl/mcp"
    }
  }
}
```

### Claude Desktop / claude.ai

Add it as a custom connector: go to **Customize → Connectors**, click **+** → **Add custom connector**, and paste `https://fonto-docs.elliat.nl/mcp`. No OAuth settings are needed. Connectors added this way are available in both Claude Desktop and claude.ai. See [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

(`claude_desktop_config.json` only launches local stdio servers, so it can't be used for this server.)

### Mistral AI / Vibe

Add the server to your Vibe configuration via the CLI:

```bash
vibe mcp add fonto-docs --url https://fonto-docs.elliat.nl/mcp --no-login
```

Or manually edit `~/.vibe/config.toml` to include:

```toml
[[mcpServers.fonto-docs]]
url = "https://fonto-docs.elliat.nl/mcp"
```

Check the [Vibe MCP documentation](https://vibe.mistral.ai/) for the latest configuration options.

## Usage examples

Once connected, ask your AI assistant:

- *"Search the Fonto docs for documentsManager"*
- *"Get the Fonto docs page for clearundostackfordocument-f0187fade723"*
- *"How does addDocumentChangeCallback work according to the Fonto docs?"*
- *"List all pages in the configure section"*
- *"What upgrade guides are available?"*

## HTTP API

The server also exposes a plain HTTP API if you want to use it without MCP:

- `GET /search?q={query}` — search pages by keyword
- `GET /page/{slug}` — fetch a page as Markdown
- `GET /api/{name}` — fetch the page for an API symbol by exact name, as Markdown (404 with suggestions if none)
- `GET /catalog` — full page catalog grouped by section; add `?section={keyword}` to filter

## How it works

The Fonto documentation site stores its content as XML at predictable URLs under `/static/xml/`. This server fetches those XML files directly and converts them to Markdown, bypassing the JavaScript rendering. Page content is cached in-process for 10 minutes to absorb repeated lookups in the same session; after that, `get_fonto_page` fetches it live from `documentation.fontoxml.com` again. The page catalog (used by `list_pages` and `fonto://catalog`) is fetched once from the Fonto search index on first use and held in memory for the lifetime of the process.

## Self-hosting

```bash
npm install
npm start        # runs on port 8080 by default
PORT=3000 npm start
```

## Contributing

PRs welcome. The XML-to-Markdown conversion in `src/fonto.js` handles two formats:

- **DITA guide pages** — `<topic>`, `<body>`, `<section>` structure
- **API reference pages** — custom `<type>`, `<members>`, `<description>` structure

If you find pages that don't convert well, open an issue with the slug.

## License

MIT
