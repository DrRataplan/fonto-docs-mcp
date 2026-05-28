# fonto-docs-mcp

An MCP server that makes the [Fonto XML documentation](https://documentation.fontoxml.com/) accessible to AI tools like Cursor, Claude, and Claude Code.

The Fonto docs are rendered by a JavaScript SPA, which makes them hard for AI to read directly. This server fetches the underlying XML and converts it to clean, readable Markdown on demand.

## Tools

| Tool | Description |
|---|---|
| `search_fonto_docs` | Search by keyword — returns matching pages with titles, descriptions, and slugs |
| `get_fonto_page` | Fetch the full content of a page by its slug |

## Setup

### Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "fonto-docs": {
      "command": "npx",
      "args": ["-y", "fonto-docs-mcp"]
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
      "command": "npx",
      "args": ["-y", "fonto-docs-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add fonto-docs -- npx -y fonto-docs-mcp
```

## Usage examples

Once connected, you can ask your AI assistant things like:

- *"Search the Fonto docs for documentsManager"*
- *"Get the Fonto docs page for clearundostackfordocument-f0187fade723"*
- *"How does addDocumentChangeCallback work according to the Fonto docs?"*

## How it works

The Fonto documentation site stores its content as XML at predictable URLs under `/static/xml/`. This server fetches those XML files directly and converts them to Markdown, bypassing the JavaScript rendering. No content is mirrored or cached — every request goes to `documentation.fontoxml.com` in real time.

## Contributing

PRs welcome. The XML-to-Markdown conversion in `src/fonto.ts` handles two formats:

- **DITA guide pages** — `<topic>`, `<body>`, `<section>` structure
- **API reference pages** — custom `<type>`, `<members>`, `<description>` structure

If you find pages that don't convert well, open an issue with the slug.

## License

MIT
