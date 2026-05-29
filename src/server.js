import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { searchDocs, fetchPage, getCatalog, listPages } from "./fonto.js";
import { handleMcpRequest, MCP_TOOLS, MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from "./mcp.js";

const PORT = process.env.PORT ?? 8080;
const STATIC = join(dirname(fileURLToPath(import.meta.url)), "static");

const FAVICON_SVG     = readFileSync(join(STATIC, "favicon.svg"), "utf8");
const OG_IMAGE_SVG    = readFileSync(join(STATIC, "og-image.svg"), "utf8");
const LLMS_TXT        = readFileSync(join(STATIC, "llms.txt"), "utf8");
const INDEX_HTML      = readFileSync(join(STATIC, "index.html"), "utf8");

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
      if (req.method === "tools/call")
        logEvent({ type: "mcp_tool_call", tool: req.params?.name, args: req.params?.arguments });
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

  // ── Smithery / MCP server card ────────────────────────────────────────
  if (url.pathname === "/.well-known/mcp/server-card.json") {
    return json(res, {
      serverInfo: {
        name: "fonto-docs",
        version: "0.1.0",
        description: "Makes Fonto documentation accessible to AI tools. Fetches the underlying DITA XML and converts it to Markdown on demand — bypassing the JavaScript SPA.",
        homepage: "https://fonto-docs.elliat.nl",
        repository: "https://github.com/DrRataplan/fonto-docs-mcp",
      },
      authentication: { required: false },
      tools: MCP_TOOLS,
      resources: MCP_RESOURCES,
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
      prompts: [],
    });
  }

  // ── Health check ───────────────────────────────────────────────────────
  if (url.pathname === "/healthz") return text(res, "ok");

  // ── Landing page ───────────────────────────────────────────────────────
  if (url.pathname === "/" || url.pathname === "") return html(res, LANDING_HTML);

  return json(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`fonto-docs-mcp listening on port ${PORT}`);
  getCatalog().catch(() => {});
});
