# fonto-docs-mcp

MCP server (and plain HTTP API) that makes [Fonto XML documentation](https://documentation.fontoxml.com/) readable by AI tools. The Fonto docs site is a JS SPA — this server fetches the underlying XML files directly and converts them to Markdown on demand.

## Commands

```bash
npm start        # production server (port 8080 or $PORT)
npm run dev      # auto-restart on file changes
npm test         # unit tests via Node.js built-in test runner
```

## Source files

| File | Responsibility |
|---|---|
| `src/fonto.js` | Fetches XML from `documentation.fontoxml.com/static/xml/latest/<slug>.xml`, parses it with slimdom + fontoxpath, and renders it to Markdown. Also calls the Fonto search API. |
| `src/mcp.js` | MCP protocol handler. Defines the two tools (`search_fonto_docs`, `get_fonto_page`) and routes `tools/call` to `fonto.js`. |
| `src/server.js` | HTTP server. Routes: `POST /mcp`, `GET /search`, `GET /page/:slug`, `GET /llms.txt`, `GET /.well-known/mcp/server-card.json`, `GET /healthz`, `GET /`. |
| `src/fonto.test.js` | Unit tests for `xmlToMarkdown` using Node.js built-in test runner (no extra dependencies). |

## XML → Markdown pipeline

Fonto XML has two document shapes:

- **API pages** — root element is `<type>`. Rendered by `renderApiPage()`: extracts members, parameters, return types, descriptions, code examples, and cross-references.
- **DITA pages** — root element is `topic | task | concept | reference`. Rendered by `renderDitaPage()`: extracts title, shortdesc, body sections, steps, and code examples.

`xmlToMarkdown(xml, slug)` is the entry point — it dispatches based on root element name.

## No caching

Every request goes live to `documentation.fontoxml.com`. There is no local mirror or cache. This keeps content fresh but means tests that hit the network are slow and fragile — prefer unit tests with fixture XML.

## Deployment

Deployed to Google Cloud Run via `.github/workflows/deploy.yml` using Workload Identity Federation (no stored service account keys). The live server is at `https://fonto-docs.elliat.nl/`.
