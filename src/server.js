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
// HTML helpers for SEO-friendly page rendering
// ---------------------------------------------------------------------------

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMd(raw) {
  const tokens = [];
  let t = raw;
  // Extract spans before escaping so we can escape their content independently
  t = t.replace(/`([^`]+)`/g, (_, c) => { tokens.push(`<code>${escHtml(c)}</code>`); return `\x00${tokens.length - 1}\x00`; });
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => { tokens.push(`<a href="${escHtml(href)}">${escHtml(txt)}</a>`); return `\x00${tokens.length - 1}\x00`; });
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, inner) => { tokens.push(`<strong>${escHtml(inner)}</strong>`); return `\x00${tokens.length - 1}\x00`; });
  t = escHtml(t);
  return t.replace(/\x00(\d+)\x00/g, (_, i) => tokens[+i]);
}

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0, inCode = false, inList = false, inTable = false;
  const closeList  = () => { if (inList)  { out.push('</ul>');              inList  = false; } };
  const closeTable = () => { if (inTable) { out.push('</tbody></table>');   inTable = false; } };
  while (i < lines.length) {
    const line = lines[i++];
    if (line.startsWith('```')) {
      closeList(); closeTable();
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else        { out.push('<pre><code>');    inCode = true;  }
      continue;
    }
    if (inCode) { out.push(escHtml(line)); continue; }
    const hm = line.match(/^(#{1,3}) (.+)$/);
    if (hm) {
      closeList(); closeTable();
      out.push(`<h${hm[1].length}>${inlineMd(hm[2])}</h${hm[1].length}>`);
      continue;
    }
    if (line.startsWith('|')) {
      closeList();
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        if (/^\|[-| :]+\|$/.test(lines[i] || '')) {
          out.push('<table><thead><tr>' + cells.map(c => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>');
          inTable = true; i++;
          continue;
        }
        out.push('<table><tbody>'); inTable = true;
      }
      if (!cells.every(c => /^[-: ]+$/.test(c)))
        out.push('<tr>' + cells.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
      continue;
    }
    closeTable();
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList(); closeTable();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

const PAGE_STYLE = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 32px 24px 80px; color: #1a1a1a; line-height: 1.65; }
  nav { font-size: 0.85em; color: #666; margin-bottom: 2em; }
  nav a { color: #0055cc; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  h1 { font-size: 1.9rem; margin: 0 0 0.5em; }
  h2 { font-size: 1.3rem; margin-top: 2em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3em; }
  h3 { font-size: 1.05rem; margin-top: 1.5em; }
  p { margin: 0.5em 0 0.9em; }
  code { background: #f4f4f4; border-radius: 4px; padding: 1px 5px; font-size: 0.88em; }
  pre { background: #f4f4f4; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 0.85em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
  th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  ul { margin: 0.5em 0 1em 1.5em; }
  li { margin: 0.25em 0; }
  a { color: #0055cc; }
  footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #e5e5e5; font-size: 0.85em; color: #666; }
  footer a { color: inherit; }
`;

function buildPageHtml(markdown, slug) {
  const titleMatch = markdown.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : slug;
  let description = '';
  for (const line of markdown.split('\n').slice(1)) {
    const clean = line.replace(/\*\*([^*]*)\*\*/g, '$1').replace(/`[^`]+`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    if (clean.length > 30 && !clean.startsWith('#')) { description = clean.slice(0, 160); break; }
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} — Fonto Documentation</title>
<meta name="description" content="${escHtml(description)}">
<link rel="canonical" href="https://fonto-docs.elliat.nl/page/${escHtml(slug)}">
<style>${PAGE_STYLE}</style>
</head>
<body>
<nav><a href="/">Fonto Documentation</a> › <a href="/catalog">All pages</a></nav>
${mdToHtml(markdown)}
<footer>
  <a href="/">Fonto Documentation MCP</a> ·
  Source: <a href="https://documentation.fontoxml.com/latest/${escHtml(slug)}">official Fonto docs</a>
</footer>
</body>
</html>`;
}

function buildCatalogHtml(pages, section) {
  const byProduct = {};
  for (const p of pages) (byProduct[p.product] ??= []).push(p);
  const body = Object.entries(byProduct).map(([product, entries]) =>
    `<h2>${escHtml(product)}</h2>\n<ul>\n` +
    entries.map(p => `<li><a href="/page/${escHtml(p.slug)}">${escHtml([...p.ancestry, p.title].join(' › '))}</a></li>`).join('\n') +
    `\n</ul>`
  ).join('\n');
  const heading = section ? escHtml(section) : 'All Fonto documentation';
  const canonical = `https://fonto-docs.elliat.nl/catalog${section ? `?section=${encodeURIComponent(section)}` : ''}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} — Fonto Documentation</title>
<meta name="description" content="Browse all Fonto documentation pages.">
<link rel="canonical" href="${canonical}">
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 32px 24px 80px; color: #1a1a1a; line-height: 1.65; }
  h1 { font-size: 1.9rem; margin: 0 0 0.5em; }
  h2 { font-size: 1.1rem; margin-top: 1.5em; }
  ul { margin: 0.3em 0 1em 1.5em; }
  li { margin: 0.15em 0; }
  a { color: #0055cc; }
  nav { font-size: 0.85em; margin-bottom: 2em; }
  nav a { color: #0055cc; text-decoration: none; }
</style>
</head>
<body>
<nav><a href="/">Fonto Documentation</a></nav>
<h1>${heading}</h1>
${body}
</body>
</html>`;
}

function wantsHtml(req) {
  return (req.headers['accept'] || '').includes('text/html');
}

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
      const markdown = await fetchPage(slug);
      if (wantsHtml(req)) return html(res, buildPageHtml(markdown, slug));
      return text(res, markdown);
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  if (url.pathname === "/catalog") {
    const section = url.searchParams.get("section");
    try {
      logEvent({ type: "http_catalog", section });
      const pages = section ? await listPages(section) : await getCatalog();
      if (wantsHtml(req)) return html(res, buildCatalogHtml(pages, section));
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
    try {
      const pages = await getCatalog();
      const locs = pages.map(p =>
        `  <url><loc>https://fonto-docs.elliat.nl/page/${p.slug}</loc><changefreq>weekly</changefreq></url>`
      ).join('\n');
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://fonto-docs.elliat.nl/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://fonto-docs.elliat.nl/catalog</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
${locs}
</urlset>`);
    } catch {
      res.writeHead(500); return res.end();
    }
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
  if (url.pathname === "/healthz") return text(res, "ok");

  // ── Landing page ───────────────────────────────────────────────────────
  if (url.pathname === "/" || url.pathname === "") return html(res, LANDING_HTML);

  return json(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`fonto-docs-mcp listening on port ${PORT}`);
  getCatalog().catch(() => {});
});
