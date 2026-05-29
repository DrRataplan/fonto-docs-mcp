# fonto-docs-mcp

An MCP server that makes the [Fonto XML documentation](https://documentation.fontoxml.com/) accessible to AI tools like Claude Code, Cursor, and Claude Desktop.

The Fonto docs are rendered by a JavaScript SPA, which makes them impossible for AI to read directly. This server fetches the underlying XML and converts it to clean, readable Markdown on demand.

## What is MCP?

MCP (Model Context Protocol) is a standard way to give AI assistants access to external tools. Once you connect this server to your AI tool, it gains two new capabilities:

| Tool | What it does |
|---|---|
| `search_fonto_docs` | Search by keyword — returns matching pages with titles, descriptions, and slugs |
| `get_fonto_page` | Fetch the full content of a page by its slug |

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

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

## Usage examples

Once connected, ask your AI assistant:

- *"Search the Fonto docs for documentsManager"*
- *"Get the Fonto docs page for clearundostackfordocument-f0187fade723"*
- *"How does addDocumentChangeCallback work according to the Fonto docs?"*

## HTTP API

The server also exposes a plain HTTP API if you want to use it without MCP:

- `GET /search?q={query}` — search pages by keyword
- `GET /page/{slug}` — fetch a page as Markdown

## How it works

The Fonto documentation site stores its content as XML at predictable URLs under `/static/xml/`. This server fetches those XML files directly and converts them to Markdown, bypassing the JavaScript rendering. No content is mirrored or cached — every request goes to `documentation.fontoxml.com` in real time.

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
