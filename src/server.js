import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { searchDocs, fetchPage, getCatalog, listPages } from "./fonto.js";
import { handleMcpRequest, isModernRequest, MCP_TOOLS, MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from "./mcp.js";

const PORT = process.env.PORT ?? 8080;
const STATIC = join(dirname(fileURLToPath(import.meta.url)), "static");

const FAVICON_SVG     = readFileSync(join(STATIC, "favicon.svg"), "utf8");
const OG_IMAGE_SVG    = readFileSync(join(STATIC, "og-image.svg"), "utf8");
const LLMS_TXT        = readFileSync(join(STATIC, "llms.txt"), "utf8");
const INDEX_HTML      = readFileSync(join(STATIC, "index.html"), "utf8");
const PRIVACY_HTML    = readFileSync(join(STATIC, "privacy.html"), "utf8");

let OG_IMAGE_PNG = null;
try { OG_IMAGE_PNG = readFileSync(join(STATIC, "og-image.png")); } catch {}

const SECTIONS = [
  { name: "Get started",       slug: "get-started",       pages: 9    },
  { name: "Configure",         slug: "configure",          pages: 182  },
  { name: "Customize",         slug: "customize",          pages: 24   },
  { name: "Learn",             slug: "learn",              pages: 3    },
  { name: "Integrate",         slug: "integrate",          pages: 34   },
  { name: "API reference",     slug: "api",                pages: 22   },
  { name: "Add-ons",           slug: "add-ons",            pages: 30   },
  { name: "Upgrade",           slug: "upgrade",            pages: 262  },
  { name: "FAQ",               slug: "faq",                pages: 39   },
  { name: "Generated API docs",slug: "generated-content",  pages: 1377 },
];

const SECTION_GRID = SECTIONS.map(s =>
  `<a class="section-card" href="/catalog?section=${s.slug}"><span class="section-name">${s.name}</span><span class="section-count">${s.pages} pages</span></a>`
).join("\n");

const LANDING_HTML = INDEX_HTML.replace("{{SECTION_GRID}}", SECTION_GRID);

// ---------------------------------------------------------------------------

function logEvent(event) {
  // Structured JSON logs are picked up by Cloud Logging automatically
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...event }));
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data, null, 2));
}

function text(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(data);
}

function html(res, data) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(data);
}

function svg(res, data) {
  res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
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

// ---------------------------------------------------------------------------
// Per-IP rate limiting. In-memory and per-instance, so under Cloud Run
// autoscaling the effective ceiling is up to (limit * instance count) — that's
// fine here, the goal is to blunt a single runaway client, not to enforce an
// exact global quota.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitBuckets = new Map(); // ip -> { count, resetAt }

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress;
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  if (rateLimitBuckets.size >= 1000) {
    for (const [k, v] of rateLimitBuckets) if (v.resetAt <= now) rateLimitBuckets.delete(k);
  }
  return bucket.count > RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // Never rate-limit /health — Cloud Run's startup probe hits it every 2s.
  if (url.pathname !== "/health" && isRateLimited(clientIp(req))) {
    res.setHeader("Retry-After", "60");
    return json(res, { error: "Too many requests" }, 429);
  }

  // ── MCP ────────────────────────────────────────────────────────────────
  if (url.pathname === "/mcp") {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, { error: "POST required" }, 405);
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    // The MCP-Protocol-Version header is the literal signal the server itself
    // uses to pick an era (see isModern in mcp.js) — log that value rather
    // than a synthetic boolean, so a future second modern version shows up
    // distinctly instead of collapsing into "modern".
    const protocolVersion = req.headers["mcp-protocol-version"] ?? "legacy";
    // Legacy clients report identity once, in `initialize` params; modern
    // clients report it on every request's `_meta`.
    const clientIdentity = (msg) =>
      msg.method === "initialize" ? msg.params?.clientInfo : msg.params?._meta?.["io.modelcontextprotocol/clientInfo"];
    const logMcp = (msg) => {
      const client = clientIdentity(msg);
      if (msg.method === "initialize")
        logEvent({ type: "mcp_initialize", protocolVersion, client });
      if (msg.method === "tools/call")
        logEvent({ type: "mcp_tool_call", protocolVersion, client, tool: msg.params?.name, args: msg.params?.arguments });
      if (msg.method === "resources/read")
        logEvent({ type: "mcp_resource_read", protocolVersion, client, uri: msg.params?.uri });
    };
    const logMcpError = (msg, res) => {
      if (msg.method === "tools/call" && res?.result?.isError)
        logEvent({ type: "mcp_tool_error", protocolVersion, client: clientIdentity(msg), tool: msg.params?.name, args: msg.params?.arguments, error: res.result.content?.[0]?.text });
    };
    try {
      if (Array.isArray(body)) {
        // JSON-RPC batching only exists for legacy (pre-2026-07-28) clients —
        // the modern revision requires one request per HTTP POST.
        if (isModernRequest(req.headers)) {
          return json(res, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch requests are not supported under MCP-Protocol-Version 2026-07-28" } }, 400);
        }
        body.forEach(logMcp);
        const results = (await Promise.all(body.map((b) => handleMcpRequest(b, req.headers)))).filter(Boolean);
        const responses = results.map((r) => r.body);
        body.forEach((msg, i) => logMcpError(msg, responses[i]));
        return json(res, responses);
      }
      logMcp(body);
      const result = await handleMcpRequest(body, req.headers);
      logMcpError(body, result?.body);
      if (!result) { res.writeHead(202); return res.end(); }
      return json(res, result.body, result.status);
    } catch (err) {
      // A bug in a single request's handling must not take the whole
      // instance down with it (it previously did — an unhandled rejection
      // here crashed the process, which Cloud Run then reports to every
      // other in-flight request on that instance as a 503).
      return json(res, { jsonrpc: "2.0", id: null, error: { code: -32603, message: err.message } }, 500);
    }
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
      const status = /\(HTTP 404\)/.test(err.message) ? 404 : 500;
      return json(res, { error: err.message }, status);
    }
  }

  if (url.pathname === "/catalog") {
    const section = url.searchParams.get("section");
    try {
      logEvent({ type: "http_catalog", section });
      const pages = section ? await listPages(section) : await getCatalog();
      const byProduct = {};
      for (const p of pages) {
        if (!byProduct[p.product]) byProduct[p.product] = [];
        byProduct[p.product].push(p);
      }
      const lines = [];
      for (const [product, entries] of Object.entries(byProduct)) {
        lines.push(`## ${product}`);
        for (const p of entries) {
          lines.push(`- [${[...p.ancestry, p.title].join(" > ")}](/page/${p.slug})`);
        }
        lines.push("");
      }
      return text(res, lines.join("\n"));
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // ── Static assets ──────────────────────────────────────────────────────
  if (url.pathname === "/favicon.svg")  return svg(res, FAVICON_SVG);
  if (url.pathname === "/og-image.svg") return svg(res, OG_IMAGE_SVG);
  if (url.pathname === "/og-image.png") {
    if (OG_IMAGE_PNG) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      return res.end(OG_IMAGE_PNG);
    }
    res.writeHead(302, { "Location": "/og-image.svg" });
    return res.end();
  }
  if (url.pathname === "/llms.txt")     return text(res, LLMS_TXT);
  if (url.pathname === "/47ecb075b242427fa657a5e4aee339fd.txt") return text(res, "47ecb075b242427fa657a5e4aee339fd");
  if (url.pathname === "/robots.txt")   return text(res, "User-agent: *\nAllow: /\nSitemap: https://fonto-docs.elliat.nl/sitemap.xml\n");
  if (url.pathname === "/sitemap.xml") {
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://fonto-docs.elliat.nl/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>https://fonto-docs.elliat.nl/privacy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n</urlset>\n`);
  }

  // ── Smithery / MCP server card ────────────────────────────────────────
  if (url.pathname === "/.well-known/mcp/server-card.json") {
    return json(res, {
      serverInfo: {
        name: "fonto-docs",
        version: "0.1.0",
        description: "Makes Fonto documentation accessible to AI tools. Fetches the underlying DITA XML and converts it to Markdown on demand — bypassing the JavaScript SPA.",
        homepage: "https://fonto-docs.elliat.nl",
        repository: "https://github.com/DrRataplan/fonto-docs-mcp",
        relatedProjects: [
          { name: "xq-lsp", url: "https://github.com/DrRataplan/xq-lsp", description: "Client-side LSP implementation for XQuery — autocomplete and language intelligence for the XQuery side of Fonto development (Fonto uses both TypeScript and XQuery)." },
        ],
      },
      authentication: { required: false },
      tools: MCP_TOOLS,
      resources: MCP_RESOURCES,
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
      prompts: [],
    });
  }

  // ── Health check ───────────────────────────────────────────────────────
  if (url.pathname === "/health") return text(res, "ok");

  // ── Landing page ───────────────────────────────────────────────────────
  if (url.pathname === "/" || url.pathname === "") return html(res, LANDING_HTML);
  if (url.pathname === "/privacy") return html(res, PRIVACY_HTML);

  return json(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`fonto-docs-mcp listening on port ${PORT}`);
  getCatalog().catch(() => {});
});
