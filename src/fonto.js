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

function titleFromSlug(slug) {
  const withoutId = slug.replace(/-[0-9a-f]{12}$/, "");
  return withoutId
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Shorthand helpers — always called with an element as context
const str  = (expr, node) => evaluateXPathToString(expr, node);
const strs = (expr, node) => evaluateXPathToStrings(expr, node);
const nodes = (expr, node) => evaluateXPathToNodes(expr, node);

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

    // Type/kind from restrict
    const base = str("restrict/type/@base", member);
    if (base) lines.push(`*${base}*`);

    // Referenced type name (e.g. extends Notifier)
    const refType = str("restrict/type/name", member);
    if (refType && refType !== mName) lines.push(`*${refType}*`);

    // Parameters
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

    // Return type
    const retBase = str("return/type/restrict/type/@base | return/type/@base", member);
    const retDesc = str("return/type/description/paragraph[1]", member);
    if (retBase || retDesc) {
      lines.push("");
      if (retBase) lines.push(`**Returns:** \`${retBase}\`${retDesc ? ` — ${retDesc.trim()}` : ""}`);
      else if (retDesc) lines.push(`**Returns:** ${retDesc.trim()}`);
    }

    // Description
    const descs = strs("description/paragraph", member);
    if (descs.length) {
      lines.push("");
      for (const p of descs) lines.push(p.trim());
    }

    lines.push("");
  }

  // Code examples
  const codeBlocks = strs("//codeblock", root);
  if (codeBlocks.length) {
    lines.push("## Examples"); lines.push("");
    for (const code of codeBlocks) {
      lines.push("```"); lines.push(code.trim()); lines.push("```"); lines.push("");
    }
  }

  // Related links
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

function renderDitaPage(root, slug) {
  const lines = [];

  const title = str("title", root);
  lines.push(`# ${title || slug}`);
  lines.push(`Source: ${BASE}/latest/${slug}`);
  lines.push("");

  const shortdesc = str("shortdesc", root);
  if (shortdesc) { lines.push(`> ${shortdesc.trim()}`); lines.push(""); }

  // body / taskbody / refbody — handle all DITA body types
  const body = nodes("*[local-name()='body' or local-name()='taskbody' or local-name()='refbody']", root)[0];
  if (body) {
    // Sections with titles
    for (const section of nodes("*[local-name()='section']", body)) {
      const sTitle = str("title", section);
      if (sTitle) { lines.push(`### ${sTitle.trim()}`); lines.push(""); }
      for (const p of strs("p", section)) { lines.push(p.trim()); lines.push(""); }
      // steps
      for (const step of nodes("steps/step | ol/li", section)) {
        const cmd = str("cmd | .", step);
        if (cmd.trim()) lines.push(`1. ${cmd.trim()}`);
      }
    }

    // Steps at body level (task pages)
    const steps = nodes("steps/step", body);
    if (steps.length) {
      lines.push("### Steps"); lines.push("");
      for (const step of steps) {
        const cmd = str("cmd", step);
        if (cmd.trim()) lines.push(`1. ${cmd.trim()}`);
        for (const p of strs("info/p", step)) lines.push(`   ${p.trim()}`);
      }
      lines.push("");
    }

    // Top-level paragraphs
    for (const p of strs("p", body)) { lines.push(p.trim()); lines.push(""); }

    // Nav panels (div > fig with title + shortdesc)
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

  // Code examples
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
// Index from sitemap
// ---------------------------------------------------------------------------

let indexCache = null;

export async function searchDocs(query) {
  if (!indexCache) indexCache = await buildIndex();
  const q = query.toLowerCase();
  return indexCache.filter(r =>
    r.title.toLowerCase().includes(q) ||
    r.slug.toLowerCase().includes(q)
  );
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
      return [{ title: titleFromSlug(slug), url: loc, slug }];
    });
}

// ---------------------------------------------------------------------------
// Fetch a page
// ---------------------------------------------------------------------------

export async function fetchPage(slug) {
  const clean = slug.replace(/^\/?(latest\/)?/, "");
  const xmlUrl = `${BASE}/static/xml/latest/${clean}.xml`;
  const res = await fetch(xmlUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Could not fetch "${slug}" (HTTP ${res.status}). Try searching first to find the correct slug.`);
  return xmlToMarkdown(await res.text(), slug);
}
