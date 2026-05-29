import { createServer } from "node:http";
import { searchDocs, fetchPage, getCatalog, listPages } from "./fonto.js";
import { handleMcpRequest, MCP_TOOLS, MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from "./mcp.js";

const PORT = process.env.PORT ?? 8080;

function logEvent(event) {
  // Structured JSON logs are picked up by Cloud Logging automatically
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function text(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function html(res, data) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // ── MCP ────────────────────────────────────────────────────────────────
  if (url.pathname === "/mcp") {
    if (req.method !== "POST") return json(res, { error: "POST required" }, 405);
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, { error: "Invalid JSON" }, 400);
    }
    const logMcp = (req) => {
      if (req.method === "tools/call") {
        logEvent({ type: "mcp_tool_call", tool: req.params?.name, args: req.params?.arguments });
      }
    };
    if (Array.isArray(body)) {
      body.forEach(logMcp);
      const responses = (await Promise.all(body.map(handleMcpRequest))).filter(Boolean);
      return json(res, responses);
    }
    logMcp(body);
    const response = await handleMcpRequest(body);
    if (!response) { res.writeHead(202); return res.end(); }
    return json(res, response);
  }

  // ── HTTP API ───────────────────────────────────────────────────────────
  if (url.pathname === "/search") {
    const q = url.searchParams.get("q");
    if (!q) return json(res, { error: "Missing ?q= parameter" }, 400);
    try {
      logEvent({ type: "http_search", query: q });
      return json(res, { results: await searchDocs(q) });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  if (url.pathname.startsWith("/page/")) {
    const slug = url.pathname.slice("/page/".length);
    if (!slug) return json(res, { error: "Missing slug" }, 400);
    try {
      logEvent({ type: "http_page", slug });
      return text(res, await fetchPage(slug));
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // ── Catalog ────────────────────────────────────────────────────────────
  if (url.pathname === "/catalog") {
    const section = url.searchParams.get("section");
    try {
      logEvent({ type: "http_catalog", section });
      const pages = section ? await listPages(section) : await getCatalog();
      const byProduct = {};
      for (const p of pages) {
        const key = p.product;
        if (!byProduct[key]) byProduct[key] = [];
        byProduct[key].push(p);
      }
      const lines = [];
      for (const [product, entries] of Object.entries(byProduct)) {
        lines.push(`## ${product}`);
        for (const p of entries) {
          const breadcrumb = [...p.ancestry, p.title].join(" > ");
          lines.push(`- [${breadcrumb}](/page/${p.slug})`);
        }
        lines.push("");
      }
      return text(res, lines.join("\n"));
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // ── Smithery / MCP server card ────────────────────────────────────────
  if (url.pathname === "/.well-known/mcp/server-card.json") {
    return json(res, {
      serverInfo: { name: "fonto-docs", version: "0.1.0" },
      authentication: { required: false },
      tools: MCP_TOOLS,
      resources: MCP_RESOURCES,
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
      prompts: [],
    });
  }

  // ── Favicon ────────────────────────────────────────────────────────────
  if (url.pathname === "/favicon.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    return res.end(FAVICON_SVG);
  }

  // ── llms.txt ───────────────────────────────────────────────────────────
  if (url.pathname === "/llms.txt") {
    return text(res, llmsTxt());
  }

  // ── Health check (Cloud Run needs this) ───────────────────────────────
  if (url.pathname === "/healthz") {
    return text(res, "ok");
  }

  // ── Landing page ───────────────────────────────────────────────────────
  if (url.pathname === "/" || url.pathname === "") {
    return html(res, landingPage());
  }

  return json(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`fonto-docs-mcp listening on port ${PORT}`);
  getCatalog().catch(() => {});
});

// Two angle-brackets flanking a centre dot on a deep-teal background.
// Colour chosen to be clearly distinct from Fonto's blue palette.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#134e4a"/>
  <path d="M5 9 L11 16 L5 23" stroke="#5eead4" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M27 9 L21 16 L27 23" stroke="#5eead4" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="2.5" fill="#5eead4"/>
</svg>`;

function llmsTxt() {
  return `# Fonto Docs MCP

> An MCP server and HTTP API that makes the Fonto XML documentation accessible to AI tools. The Fonto docs site is a JavaScript SPA — this server fetches the underlying XML and converts it to clean Markdown on demand.

## MCP tools

Connect to this server at https://fonto-docs.elliat.nl/mcp (HTTP transport, no authentication required).

- **search_fonto_docs(query)** — Search the Fonto XML documentation by keyword. Returns matching pages with titles, descriptions, and slugs.
- **get_fonto_page(slug)** — Fetch the full content of a Fonto documentation page by its slug. Use search_fonto_docs first to find the right slug.
- **list_pages(keyword)** — List all pages matching a keyword, filtered across title, product section, and full ancestry hierarchy. Returns slug and breadcrumb path for each match.

## MCP resources

- **fonto://catalog** — All ~2000 Fonto documentation pages with real titles, product grouping, and full ancestry paths (e.g. "Configure > Tables > CALS tables"). Fetched once on first use and cached.
- **fonto://page/{slug}** (resource template) — Address any documentation page directly as a resource by its slug.

## HTTP API

- GET /search?q={query} — Search documentation pages. Returns JSON array of {title, slug, url, description}.
- GET /page/{slug} — Fetch a page as Markdown. Example: /page/documentsmanager-f746b3a48442
- GET /catalog — Full page catalog as Markdown, grouped by section. Add ?section={keyword} to filter.

## MCP setup

\`\`\`bash
claude mcp add --transport http fonto-docs https://fonto-docs.elliat.nl/mcp
\`\`\`

Or add to mcp.json:
\`\`\`json
{ "mcpServers": { "fonto-docs": { "type": "http", "url": "https://fonto-docs.elliat.nl/mcp" } } }
\`\`\`

## Source

https://github.com/DrRataplan/fonto-docs-mcp
`;
}

function landingPage() {
  const sections = [
    { name: "Get started", slug: "get-started", pages: 9 },
    { name: "Configure", slug: "configure", pages: 182 },
    { name: "Customize", slug: "customize", pages: 24 },
    { name: "Learn", slug: "learn", pages: 3 },
    { name: "Integrate", slug: "integrate", pages: 34 },
    { name: "API reference", slug: "api", pages: 22 },
    { name: "Add-ons", slug: "add-ons", pages: 30 },
    { name: "Upgrade", slug: "upgrade", pages: 262 },
    { name: "FAQ", slug: "faq", pages: 39 },
    { name: "Generated API docs", slug: "generated-content", pages: 1377 },
  ];
  const sectionGrid = sections.map(s =>
    `<a class="section-card" href="/catalog?section=${s.slug}"><span class="section-name">${s.name}</span><span class="section-count">${s.pages} pages</span></a>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fonto Docs MCP</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 48px 24px 80px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 2rem; margin-bottom: 0.25em; }
  h2 { font-size: 1.2rem; margin-top: 2em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.4em; }
  p { margin: 0.6em 0 1em; color: #444; }
  code { background: #f4f4f4; border-radius: 5px; padding: 2px 6px; font-size: 0.88em; }
  pre { background: #f4f4f4; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 0.88em; }
  a { color: #0055cc; }
  .badge { display: inline-block; background: #e8f0fe; color: #1a56db; border-radius: 4px; padding: 2px 8px; font-size: 0.75em; font-weight: 700; margin-right: 6px; vertical-align: middle; }
  .tools { display: grid; gap: 12px; margin: 1em 0; }
  .tool { background: #fafafa; border: 1px solid #e5e5e5; border-radius: 8px; padding: 14px 16px; }
  .tool code { font-size: 0.95em; font-weight: 600; }
  .tool p { margin: 4px 0 0; font-size: 0.9em; color: #555; }
  .sections { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin: 1em 0; }
  .section-card { display: flex; flex-direction: column; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 14px; text-decoration: none; color: inherit; transition: border-color 0.15s; }
  .section-card:hover { border-color: #0055cc; }
  .section-name { font-weight: 600; font-size: 0.9em; }
  .section-count { font-size: 0.8em; color: #888; margin-top: 2px; }
  .endpoint { display: flex; align-items: baseline; gap: 10px; margin: 10px 0; }
  .endpoint code { font-size: 0.9em; }
  .endpoint span { font-size: 0.8em; color: #666; }
</style>
</head>
<body>

<h1>Fonto Docs MCP</h1>
<p>An MCP server and HTTP API that makes <a href="https://documentation.fontoxml.com/">Fonto XML documentation</a> readable by AI tools. The docs are a JavaScript SPA — this server fetches the underlying XML and converts it to clean Markdown on demand.</p>

<h2>Connect your AI tool</h2>
<p><strong>Claude Code:</strong></p>
<pre>claude mcp add --transport http fonto-docs https://fonto-docs.elliat.nl/mcp</pre>
<p><strong>Cursor / Claude Desktop</strong> — add to <code>mcp.json</code>:</p>
<pre>{
  "mcpServers": {
    "fonto-docs": { "type": "http", "url": "https://fonto-docs.elliat.nl/mcp" }
  }
}</pre>

<h2>MCP tools &amp; resources</h2>
<div class="tools">
  <div class="tool"><code>search_fonto_docs(query)</code><p>Search by keyword — returns matching pages with titles, descriptions, and slugs.</p></div>
  <div class="tool"><code>get_fonto_page(slug)</code><p>Fetch the full Markdown content of a page by its slug.</p></div>
  <div class="tool"><code>list_pages(keyword)</code><p>List pages matching a keyword, with full section breadcrumbs — great for discovery.</p></div>
  <div class="tool"><code>fonto://catalog</code> &amp; <code>fonto://page/{slug}</code><p>MCP resources: browse the full catalog or address any page directly.</p></div>
</div>

<h2>Documentation sections</h2>
<p>Browse the full catalog filtered by section:</p>
<div class="sections">
${sectionGrid}
</div>

<h2>HTTP API</h2>
<div class="endpoint"><span class="badge">GET</span><code>/search?q={query}</code><span>Search pages — returns JSON</span></div>
<div class="endpoint"><span class="badge">GET</span><code>/page/{slug}</code><span>Fetch a page as Markdown — <a href="/page/documentsmanager-f746b3a48442">example</a></span></div>
<div class="endpoint"><span class="badge">GET</span><code>/catalog</code><span>Full page hierarchy as Markdown — <a href="/catalog">browse</a> or <a href="/catalog?section=configure">filter by section</a></span></div>
<div class="endpoint"><span class="badge">GET</span><code>/search?q={query}</code><span><a href="/search?q=documentsManager">example</a></span></div>

<h2>Source</h2>
<p><a href="https://github.com/DrRataplan/fonto-docs-mcp">github.com/DrRataplan/fonto-docs-mcp</a> — MIT license</p>

</body>
</html>`;
}
