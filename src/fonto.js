import { parseXmlDocument } from "slimdom";
import fontoxpath from "fontoxpath";

const {
  evaluateXPathToString,
  evaluateXPathToStrings,
  evaluateXPathToNodes,
} = fontoxpath;

const BASE = "https://documentation.fontoxml.com";
const SITEMAP_URL = `${BASE}/sitemap.xml`;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": BASE + "/",
  "Accept": "application/xml,text/xml,*/*",
};

// ---------------------------------------------------------------------------
// TTL cache
// ---------------------------------------------------------------------------

class TtlCache {
  constructor(ttlMs) {
    this._map = new Map();
    this._ttl = ttlMs;
  }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this._map.delete(key); return undefined; }
    return entry.value;
  }
  set(key, value) {
    this._map.set(key, { value, expiresAt: Date.now() + this._ttl });
  }
}

const idxCache = new TtlCache(60 * 60 * 1000);   // 1 hour
const xmlCache = new TtlCache(30 * 60 * 1000);    // 30 min

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleFromSlug(slug) {
  const withoutId = slug.replace(/-[0-9a-f]{12}$/, "");
  return withoutId
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function sectionFromSlug(slug) {
  return slug.replace(/-[0-9a-f]{12}$/, "").split("-")[0];
}

const str  = (expr, node) => evaluateXPathToString(expr, node);
const strs = (expr, node) => evaluateXPathToStrings(expr, node);
const nodes = (expr, node) => evaluateXPathToNodes(expr, node);

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export async function getIndex() {
  const cached = idxCache.get("__index__");
  if (cached) return cached;
  const index = await buildIndex();
  idxCache.set("__index__", index);
  return index;
}

async function buildIndex() {
  const res = await fetch(SITEMAP_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`);
  const doc = parseXmlDocument(await res.text());

  return evaluateXPathToStrings("//*[local-name()='loc']", doc)
    .flatMap(loc => {
      const match = loc.match(/\/latest\/(.+)$/);
      if (!match) return [];
      const slug = match[1];
      return [{ title: titleFromSlug(slug), url: loc, slug, section: sectionFromSlug(slug) }];
    });
}

// ---------------------------------------------------------------------------
// Search — scored, token-aware
// ---------------------------------------------------------------------------

function scoreResult(entry, tokens, fullQuery) {
  const titleLower = entry.title.toLowerCase();
  const slugLower = entry.slug.toLowerCase();
  let score = 0;

  if (titleLower === fullQuery) score += 100;
  if (slugLower.includes(fullQuery)) score += 50;
  if (titleLower.includes(fullQuery)) score += 30;

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (titleLower.includes(token)) score += 5;
    if (slugLower.includes(token)) score += 2;
  }

  return score;
}

export async function searchDocs(query) {
  const index = await getIndex();
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/);

  return index
    .map(r => ({ ...r, _score: scoreResult(r, tokens, q) }))
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .map(({ _score: _, ...r }) => r);
}

// ---------------------------------------------------------------------------
// List pages — optional prefix/substring filter on slug or title
// ---------------------------------------------------------------------------

export async function listPages(filter) {
  const index = await getIndex();
  const f = filter ? filter.toLowerCase().trim() : null;

  const results = f
    ? index.filter(r =>
        r.slug.toLowerCase().includes(f) ||
        r.title.toLowerCase().includes(f) ||
        r.section.toLowerCase().includes(f)
      )
    : index;

  return results.slice(0, 150);
}

// ---------------------------------------------------------------------------
// API page renderer  (root element: <type>)
// ---------------------------------------------------------------------------

function renderApiPage(root, slug) {
  const lines = [];
  lines.push(`# ${slug}`);
  lines.push(`Source: ${BASE}/latest/${slug}`);
  lines.push("");

  const name = str("name", root);
  if (name) { lines.push(`## ${name}`); lines.push(""); }

  for (const p of strs("description/paragraph", root)) {
    lines.push(p.trim()); lines.push("");
  }

  for (const member of nodes("members/type", root)) {
    const mName = str("name", member);
    if (!mName) continue;

    lines.push(`### \`${mName}\``);

    const base = str("restrict/type/@base", member);
    if (base) lines.push(`*${base}*`);

    const refType = str("restrict/type/name", member);
    if (refType && refType !== mName) lines.push(`*${refType}*`);

    const args = nodes("arguments/type", member);
    if (args.length) {
      lines.push("");
      lines.push("**Parameters:**");
      for (const arg of args) {
        const argName = str("name", arg);
        const argBase = str("restrict/type/@base | restrict/restrict/type/@base", arg);
        lines.push(`- \`${argName}\`${argBase ? `: \`${argBase}\`` : ""}`);
      }
    }

    const retBase = str("return/type/restrict/type/@base | return/type/@base", member);
    const retDesc = str("return/type/description/paragraph[1]", member);
    if (retBase || retDesc) {
      lines.push("");
      if (retBase) lines.push(`**Returns:** \`${retBase}\`${retDesc ? ` — ${retDesc.trim()}` : ""}`);
      else if (retDesc) lines.push(`**Returns:** ${retDesc.trim()}`);
    }

    const descs = strs("description/paragraph", member);
    if (descs.length) {
      lines.push("");
      for (const p of descs) lines.push(p.trim());
    }

    lines.push("");
  }

  const codeBlocks = strs("//codeblock", root);
  if (codeBlocks.length) {
    lines.push("## Examples"); lines.push("");
    for (const code of codeBlocks) {
      lines.push("```"); lines.push(code.trim()); lines.push("```"); lines.push("");
    }
  }

  const seen = new Set();
  for (const href of strs("//@href[starts-with(., '/latest/')]", root)) {
    if (!seen.has(href)) {
      if (!seen.size) lines.push("## Related pages");
      seen.add(href);
      lines.push(`- ${BASE}${href}`);
    }
  }
  if (seen.size) lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// DITA page renderer  (root element: topic | task | concept | reference)
// ---------------------------------------------------------------------------

function renderXref(node) {
  const href = str("@href", node);
  const text = str(".", node).trim();
  if (!href) return text;
  const url = href.startsWith("/") ? `${BASE}${href}` : href;
  return text ? `[${text}](${url})` : url;
}

function renderParagraph(pNode) {
  // Inline pass: replace xref nodes with Markdown links, keep other text
  const xrefs = nodes("xref", pNode);
  if (!xrefs.length) return str(".", pNode).trim();

  let result = "";
  for (const child of Array.from(pNode.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      result += child.data;
    } else if (child.localName === "xref") {
      result += renderXref(child);
    } else {
      result += str(".", child).trim();
    }
  }
  return result.trim();
}

function renderTable(tableNode) {
  const lines = [];
  const rows = nodes(".//row", tableNode);
  if (!rows.length) return lines;

  rows.forEach((row, i) => {
    const cells = nodes("entry", row);
    const cols = cells.map(c => str(".", c).trim().replace(/\|/g, "\\|") || " ");
    lines.push(`| ${cols.join(" | ")} |`);
    if (i === 0) lines.push(`| ${cols.map(() => "---").join(" | ")} |`);
  });
  return lines;
}

function renderDitaPage(root, slug) {
  const lines = [];

  const title = str("title", root);
  lines.push(`# ${title || slug}`);
  lines.push(`Source: ${BASE}/latest/${slug}`);
  lines.push("");

  const shortdesc = str("shortdesc", root);
  if (shortdesc) { lines.push(`> ${shortdesc.trim()}`); lines.push(""); }

  const body = nodes("*[local-name()='body' or local-name()='taskbody' or local-name()='refbody']", root)[0];
  if (body) {
    for (const section of nodes("*[local-name()='section']", body)) {
      const sTitle = str("title", section);
      if (sTitle) { lines.push(`### ${sTitle.trim()}`); lines.push(""); }

      for (const pNode of nodes("p", section)) {
        lines.push(renderParagraph(pNode)); lines.push("");
      }

      for (const tableNode of nodes(".//table | .//simpletable", section)) {
        lines.push(...renderTable(tableNode)); lines.push("");
      }

      for (const step of nodes("steps/step | ol/li", section)) {
        const cmd = str("cmd | .", step);
        if (cmd.trim()) lines.push(`1. ${cmd.trim()}`);
      }
    }

    const steps = nodes("steps/step", body);
    if (steps.length) {
      lines.push("### Steps"); lines.push("");
      for (const step of steps) {
        const cmd = str("cmd", step);
        if (cmd.trim()) lines.push(`1. ${cmd.trim()}`);
        for (const pNode of nodes("info/p", step)) lines.push(`   ${renderParagraph(pNode)}`);
      }
      lines.push("");
    }

    for (const pNode of nodes("p", body)) {
      lines.push(renderParagraph(pNode)); lines.push("");
    }

    for (const tableNode of nodes("table | simpletable", body)) {
      lines.push(...renderTable(tableNode)); lines.push("");
    }

    const figs = nodes(".//fig[title]", body);
    if (figs.length) {
      lines.push("### Topics"); lines.push("");
      for (const fig of figs) {
        const figTitle = str("title", fig);
        const figDesc = str("desc/p | shortdesc", fig);
        const href = str("data/@href", fig);
        if (figTitle) {
          lines.push(href ? `**[${figTitle.trim()}](${BASE}${href})**` : `**${figTitle.trim()}**`);
          if (figDesc) lines.push(figDesc.trim());
          lines.push("");
        }
      }
    }
  }

  const codeBlocks = strs("//codeblock", root);
  if (codeBlocks.length) {
    lines.push("## Examples"); lines.push("");
    for (const code of codeBlocks) {
      lines.push("```"); lines.push(code.trim()); lines.push("```"); lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function xmlToMarkdown(xml, slug) {
  const doc = parseXmlDocument(xml);
  const root = doc.documentElement;
  return root.localName === "type"
    ? renderApiPage(root, slug)
    : renderDitaPage(root, slug);
}

// ---------------------------------------------------------------------------
// Fetch raw XML (cached)
// ---------------------------------------------------------------------------

async function fetchRawXml(slug) {
  const clean = slug.replace(/^\/?(latest\/)?/, "");
  const cached = xmlCache.get(clean);
  if (cached !== undefined) return cached;
  const xmlUrl = `${BASE}/static/xml/latest/${clean}.xml`;
  const res = await fetch(xmlUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Could not fetch "${slug}" (HTTP ${res.status}). Try searching first to find the correct slug.`);
  const xml = await res.text();
  xmlCache.set(clean, xml);
  return xml;
}

// ---------------------------------------------------------------------------
// Fetch a rendered page
// ---------------------------------------------------------------------------

export async function fetchPage(slug) {
  const clean = slug.replace(/^\/?(latest\/)?/, "");
  const xml = await fetchRawXml(clean);
  return xmlToMarkdown(xml, slug);
}

// ---------------------------------------------------------------------------
// Related pages — extract xrefs from a page and match against the index
// ---------------------------------------------------------------------------

export async function getRelatedPages(slug) {
  const clean = slug.replace(/^\/?(latest\/)?/, "");
  const xml = await fetchRawXml(clean);
  const doc = parseXmlDocument(xml);

  const hrefs = evaluateXPathToStrings("//@href[starts-with(., '/latest/')]", doc);
  const slugSet = new Set(hrefs.map(h => h.replace(/^\/latest\//, "")));
  slugSet.delete(clean);

  const index = await getIndex();
  const bySlug = new Map(index.map(r => [r.slug, r]));

  return [...slugSet].map(s => bySlug.get(s)).filter(Boolean);
}
