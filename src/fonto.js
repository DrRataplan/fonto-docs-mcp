const BASE = "https://documentation.fontoxml.com";
const INDEX_URL = `${BASE}/static/xml.xml`;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": BASE + "/",
  "Accept": "application/xml,text/xml,*/*",
};

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function extractText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return xml.match(re)?.[1]?.trim();
}

function extractAttr(xml, attr) {
  const re = new RegExp(`${attr}="([^"]+)"`);
  return xml.match(re)?.[1];
}

function stripTags(xml) {
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// XML → Markdown
// ---------------------------------------------------------------------------

export function xmlToMarkdown(xml, slug) {
  const lines = [];
  lines.push(`# Fonto Docs: ${slug}`);
  lines.push(`Source: ${BASE}/latest/${slug}`);
  lines.push("");

  const name = extractText(xml, "name");
  if (name) { lines.push(`## ${name}`); lines.push(""); }

  for (const [, inner] of [...xml.matchAll(/<description[^>]*>([\s\S]*?)<\/description>/gi)]) {
    for (const [, p] of [...inner.matchAll(/<paragraph>([\s\S]*?)<\/paragraph>/gi)]) {
      lines.push(stripTags(p)); lines.push("");
    }
  }

  const shortdesc = extractText(xml, "shortdesc");
  if (shortdesc) { lines.push(`> ${stripTags(shortdesc)}`); lines.push(""); }

  const body = extractText(xml, "body");
  if (body) {
    const sections = [...body.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/gi)];
    for (const [, section] of sections) {
      const sTitle = extractText(section, "title");
      if (sTitle) { lines.push(`### ${stripTags(sTitle)}`); lines.push(""); }
      for (const [, p] of [...section.matchAll(/<p>([\s\S]*?)<\/p>/gi)]) lines.push(stripTags(p));
      lines.push("");
    }
    if (sections.length === 0) {
      for (const [, p] of [...body.matchAll(/<p>([\s\S]*?)<\/p>/gi)]) lines.push(stripTags(p));
    }
  }

  for (const [, member] of [...xml.matchAll(/<type[^>]*>([\s\S]*?)<\/type>/gi)]) {
    const mName = extractText(member, "name");
    if (!mName || mName === name) continue;
    lines.push(`### \`${mName}\``);
    const returnBlock = extractText(member, "return");
    if (returnBlock) {
      const retType = extractText(returnBlock, "name") ?? extractAttr(returnBlock, "base");
      if (retType) lines.push(`**Returns:** \`${retType}\``);
    }
    for (const [, args] of [...member.matchAll(/<arguments>([\s\S]*?)<\/arguments>/gi)]) {
      const argTypes = [...args.matchAll(/<type[^>]*>([\s\S]*?)<\/type>/gi)];
      if (argTypes.length) {
        lines.push("**Parameters:**");
        for (const [, arg] of argTypes) {
          const argName = extractText(arg, "name");
          const base = extractAttr(arg, "base") ?? extractText(arg, "name");
          if (argName) lines.push(`- \`${argName}\`${base ? `: ${base}` : ""}`);
        }
      }
    }
    for (const [, inner] of [...member.matchAll(/<description[^>]*>([\s\S]*?)<\/description>/gi)]) {
      for (const [, p] of [...inner.matchAll(/<paragraph>([\s\S]*?)<\/paragraph>/gi)]) {
        lines.push(stripTags(p));
      }
    }
    lines.push("");
  }

  const codeBlocks = [...xml.matchAll(/<codeblock[^>]*>([\s\S]*?)<\/codeblock>/gi)];
  if (codeBlocks.length) {
    lines.push("## Examples"); lines.push("");
    for (const [, code] of codeBlocks) {
      lines.push("```"); lines.push(stripTags(code)); lines.push("```"); lines.push("");
    }
  }

  const seen = new Set();
  const links = [...xml.matchAll(/href="(\/latest\/[^"]+)"/gi)].filter(([, href]) => {
    if (seen.has(href)) return false;
    seen.add(href); return true;
  });
  if (links.length) {
    lines.push("## Related pages");
    for (const [, href] of links) lines.push(`- ${BASE}${href}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let indexCache = null;

export async function searchDocs(query) {
  if (!indexCache) indexCache = await buildIndex();
  const q = query.toLowerCase();
  return indexCache.filter(r =>
    r.title.toLowerCase().includes(q) ||
    r.slug.toLowerCase().includes(q) ||
    r.description?.toLowerCase().includes(q)
  );
}

async function buildIndex() {
  const res = await fetch(INDEX_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch index: ${res.status}`);
  const xml = await res.text();
  const results = [];
  for (const [fullMatch, href] of [...xml.matchAll(/<data[^>]*name="gatsby-clickable-panel-reference"[^>]*href="(\/latest\/[^"]+)"[^>]*\/>/gi)]) {
    const slug = href.replace(/^\/latest\//, "");
    const ctx = xml.slice(Math.max(0, xml.indexOf(fullMatch) - 500), xml.indexOf(fullMatch) + 200);
    const title = extractText(ctx, "title") ?? slug;
    const descRaw = extractText(ctx, "desc");
    const description = descRaw ? stripTags(descRaw) : undefined;
    results.push({ title, description, url: `${BASE}/latest/${slug}`, slug });
  }
  return results;
}

export async function fetchPage(slug) {
  const clean = slug.replace(/^\/?(latest\/)?/, "");
  const xmlUrl = `${BASE}/static/xml/latest/${clean}.xml`;
  const res = await fetch(xmlUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Could not fetch "${slug}" (HTTP ${res.status}). Try searching first to find the correct slug.`);
  return xmlToMarkdown(await res.text(), slug);
}
