import { createServer } from "node:http";
import { searchDocs, fetchPage } from "./fonto.js";
import { handleMcpRequest, MCP_TOOLS } from "./mcp.js";

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
});

function landingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fonto Docs MCP</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; }
  h1 { font-size: 1.8rem; }
  code, pre { background: #f4f4f4; border-radius: 6px; padding: 2px 6px; font-size: 0.9em; }
  pre { padding: 16px; overflow-x: auto; }
  a { color: #0066cc; }
  .endpoint { margin: 24px 0; }
  .label { display: inline-block; background: #e8f0fe; color: #1a56db; border-radius: 4px; padding: 2px 8px; font-size: 0.8em; font-weight: bold; margin-right: 8px; }
</style>
</head>
<body>
<h1>Fonto Docs MCP</h1>
<p>An MCP server and HTTP API that makes <a href="https://documentation.fontoxml.com/">Fonto XML documentation</a> accessible to AI tools like Cursor, Claude, and Claude Code.</p>

<h2>MCP setup</h2>
<p>Add to your <code>mcp.json</code> (Cursor) or Claude Desktop config:</p>
<pre>{
  "mcpServers": {
    "fonto-docs": {
      "type": "http",
      "url": "https://fonto-docs.elliat.nl/mcp"
    }
  }
}</pre>

<p>Or with Claude Code:</p>
<pre>claude mcp add --transport http fonto-docs https://fonto-docs.elliat.nl/mcp</pre>

<h2>HTTP API</h2>

<div class="endpoint">
  <span class="label">GET</span><code>/search?q={query}</code>
  <p>Search documentation pages by keyword.</p>
  <p>Example: <a href="/search?q=documentsManager">/search?q=documentsManager</a></p>
</div>

<div class="endpoint">
  <span class="label">GET</span><code>/page/{slug}</code>
  <p>Fetch a page as Markdown by slug.</p>
  <p>Example: <a href="/page/documentsmanager-f746b3a48442">/page/documentsmanager-f746b3a48442</a></p>
</div>

<h2>Source</h2>
<p><a href="https://github.com/DrRataplan/fonto-docs-mcp">github.com/DrRataplan/fonto-docs-mcp</a></p>
</body>
</html>`;
}
