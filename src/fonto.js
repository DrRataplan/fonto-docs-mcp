import { parseXmlDocument } from "slimdom";
import fontoxpath from "fontoxpath";

const {
  evaluateXPathToString,
  evaluateXPathToStrings,
  evaluateXPathToNodes,
} = fontoxpath;

const BASE = "https://documentation.fontoxml.com";
const HEADERS = {
  "User-Agent": "fonto-docs-mcp/0.1.0 (+https://fonto-docs.elliat.nl/)",
  "Referer": BASE + "/",
  "Accept": "application/xml,text/xml,*/*",
};

// Shorthand helpers — always called with an element as context
const str  = (expr, node) => evaluateXPathToString(expr, node);
const strs = (expr, node) => evaluateXPathToStrings(expr, node);
const nodes = (expr, node) => evaluateXPathToNodes(expr, node);

function renderInline(node) {
  let result = "";
  for (const child of nodes("node()", node)) {
    if (child.nodeType === 3) {
      result += child.nodeValue || "";
    } else if (child.localName === "codeph" || child.localName === "filepath" || child.localName === "varname" || child.localName === "code-phrase") {
      result += `\`${str(".", child)}\``;
    } else if (child.localName === "link") {
      const href = str("@reference", child);
      const text = str(".", child).trim();
      result += href ? `[${text}](${BASE}${href})` : text;
    } else {
      result += str(".", child);
    }
  }
  return result.trim();
}

function renderStentry(entry) {
  const paras = nodes("p", entry);
  if (paras.length) return paras.map(p => renderInline(p)).join(" ").trim();
  return renderInline(entry);
}

function renderSimpletable(table, lines) {
  const headerEntries = nodes("sthead/stentry", table);
  const dataRows = nodes("strow", table);
  if (!headerEntries.length && !dataRows.length) return;
  if (headerEntries.length) {
    lines.push("| " + headerEntries.map(e => renderStentry(e)).join(" | ") + " |");
    lines.push("| " + headerEntries.map(() => "---").join(" | ") + " |");
  }
  for (const row of dataRows) {
    const entries = nodes("stentry", row);
    lines.push("| " + entries.map(e => renderStentry(e)).join(" | ") + " |");
  }
  lines.push("");
}

function renderDescriptionInto(descNode, lines) {
  for (const child of nodes("paragraph | list", descNode)) {
    if (child.localName === "paragraph") {
      lines.push(renderInline(child));
      lines.push("");
    } else {
      for (const item of nodes("list-item", child)) {
        const paras = nodes("paragraph", item);
        const text = paras.length ? paras.map(p => renderInline(p)).join(" ") : renderInline(item);
        if (text) lines.push(`- ${text}`);
      }
      lines.push("");
    }
  }
}

// ---------------------------------------------------------------------------
// API page renderer  (root element: <type>)
// ---------------------------------------------------------------------------

function renderTypeNode(typeNode) {
  // String enum: <type base="string"><value>"a"</value><value>"b"</value></type>
  const values = strs("value", typeNode);
  if (values.length) return values.join(" | ");
  return str("name", typeNode) || str("@base", typeNode) || "";
}

// Renders a single type descriptor node (either a <type> or a <restrict type="..."> element).
function renderTypeChild(node) {
  if (node.localName === "type") return renderTypeNode(node);
  const rt = str("@type", node);
  if (rt === "union") {
    return nodes("type | restrict", node).map(c => renderTypeChild(c)).filter(Boolean).join(" | ");
  }
  if (rt === "generic") {
    const parts = nodes("type | restrict", node).map(c => renderTypeChild(c)).filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}<${parts.slice(1).join(", ")}>` : parts.join("");
  }
  if (rt === "function") {
    const retChildren = nodes("type | restrict", node);
    const retTypeStr = retChildren.length ? renderTypeChild(retChildren[0]) : "void";
    return `() => ${retTypeStr}`;
  }
  return "";
}

function renderTypeFromRestrict(restrictNode) {
  const inner = nodes("restrict | type", restrictNode)[0];
  if (!inner) return "";
  return renderTypeChild(inner);
}

function renderApiPage(root, slug) {
  const lines = [];
  lines.push(`# ${slug}`);
  lines.push(`Source: ${BASE}/latest/${slug}`);
  lines.push("");

  const name = str("name", root);
  if (name) { lines.push(`## ${name}`); lines.push(""); }

  const source = str("source", root);
  if (source) { lines.push(`*Source file: \`${source.trim()}\`*`); lines.push(""); }

  const rootDesc = nodes("description", root)[0];
  if (rootDesc) renderDescriptionInto(rootDesc, lines);

  // Overloaded function/hook: description + parameters from first overload, return type variants listed
  const overloads = nodes("overloads/type", root);
  if (overloads.length) {
    for (const overload of overloads) {
      const desc = nodes("description", overload)[0];
      if (desc) { renderDescriptionInto(desc, lines); break; }
    }

    const firstArgs = nodes("arguments/type", overloads[0]);
    if (firstArgs.length) {
      lines.push("## Parameters");
      lines.push("");
      for (const arg of firstArgs) {
        const argName = str("name", arg);
        if (!argName) continue;
        const isOptional = str("restrict/@optional", arg) === "true";
        lines.push(`### \`${argName}\``);
        if (isOptional) lines.push("*Optional*");
        lines.push("");
        const restrictNode = nodes("restrict", arg)[0];
        if (restrictNode) {
          const typeStr = renderTypeFromRestrict(restrictNode);
          if (typeStr) { lines.push(`**Type:** \`${typeStr}\``); lines.push(""); }
        }
        const argDesc = nodes("description", arg)[0];
        if (argDesc) renderDescriptionInto(argDesc, lines);
      }
    }

    const retEntries = [];
    for (const overload of overloads) {
      const retRestrictNode = nodes("return/type/restrict", overload)[0];
      const retDescNode = nodes("return/type/description", overload)[0];
      const typeStr = retRestrictNode ? renderTypeFromRestrict(retRestrictNode) : "";
      const descStr = retDescNode ? str("paragraph[1]", retDescNode).trim() : "";
      if (typeStr) retEntries.push({ typeStr, descStr });
    }
    if (retEntries.length === 1) {
      lines.push(`**Returns:** \`${retEntries[0].typeStr}\`${retEntries[0].descStr ? ` — ${retEntries[0].descStr}` : ""}`);
      lines.push("");
    } else if (retEntries.length > 1) {
      lines.push("## Overloads");
      lines.push("");
      for (const { typeStr, descStr } of retEntries) {
        lines.push(`- Returns \`${typeStr}\`${descStr ? ` — ${descStr}` : ""}`);
      }
      lines.push("");
    }
  }

  // Component props (root-level <arguments>)
  const rootArgs = nodes("arguments/type", root);
  if (rootArgs.length) {
    lines.push("## Component props");
    lines.push("");
    for (const arg of rootArgs) {
      const argName = str("name", arg);
      if (!argName) continue;
      const isOptional = str("restrict/@optional", arg) === "true";
      lines.push(`### \`${argName}\``);
      lines.push(isOptional ? "*Optional*" : "*Required*");
      lines.push("");
      const restrictNode = nodes("restrict", arg)[0];
      if (restrictNode) {
        const typeStr = renderTypeFromRestrict(restrictNode);
        if (typeStr) { lines.push(`**Type:** \`${typeStr}\``); lines.push(""); }
      }
      const argDesc = nodes("description", arg)[0];
      if (argDesc) renderDescriptionInto(argDesc, lines);
    }
  }

  for (const member of nodes("members/type", root)) {
    const mName = str("name", member);
    if (!mName) continue;

    lines.push(`### \`${mName}\``);

    // Type/kind from restrict
    const base = str("restrict/type/@base", member);
    const subMembers = nodes("members/type", member);
    if (base === "type-literal" && subMembers.length) {
      // Render inline object type signature instead of bare "type-literal"
      const props = subMembers.map(sm => {
        const smName = str("name", sm);
        const smRestrict = nodes("restrict", sm)[0];
        const smType = smRestrict ? renderTypeFromRestrict(smRestrict) : "unknown";
        return `${smName}: ${smType}`;
      });
      lines.push(`**Type:** \`{ ${props.join("; ")} }\``);
      lines.push("");
    } else if (base) {
      lines.push(`*${base}*`);
    }

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
        const argRestrictNode = nodes("restrict", arg)[0];
        const typeStr = argRestrictNode ? renderTypeFromRestrict(argRestrictNode) : "";
        lines.push(`- \`${argName}\`${typeStr ? `: \`${typeStr}\`` : ""}`);
      }
    }

    // Return type
    const retRestrictNode = nodes("return/type/restrict", member)[0];
    const retTypeStr = retRestrictNode ? renderTypeFromRestrict(retRestrictNode) : "";
    const retDesc = str("return/type/description/paragraph[1]", member);
    if (retTypeStr || retDesc) {
      lines.push("");
      if (retTypeStr) lines.push(`**Returns:** \`${retTypeStr}\`${retDesc ? ` — ${retDesc.trim()}` : ""}`);
      else if (retDesc) lines.push(`**Returns:** ${retDesc.trim()}`);
    }

    // Description
    const memberDesc = nodes("description", member)[0];
    if (memberDesc) { lines.push(""); renderDescriptionInto(memberDesc, lines); }

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
  for (const href of strs("//@reference[starts-with(., '/latest/')]", root)) {
    const base = href.split("#")[0];
    // Fragment anchors on this page are opaque UUIDs pointing to members already rendered above
    if (base.endsWith(slug) || seen.has(base)) continue;
    if (!seen.size) lines.push("## Related pages");
    seen.add(base);
    lines.push(`- ${base.replace(/^\/latest\//, "")}`);
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
      for (const table of nodes("simpletable", section)) renderSimpletable(table, lines);
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

    // Top-level simpletables
    for (const table of nodes("simpletable", body)) renderSimpletable(table, lines);

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
// Page catalog (from search index)
// ---------------------------------------------------------------------------

let catalogCache = null;

async function buildCatalog() {
  const res = await fetch(`${BASE}/api/search/latest?q=&all=true`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
  const data = await res.json();
  return (data.results || [])
    .filter(r => r.pagePath)
    .map(r => ({
      slug: r.pagePath,
      title: r.navtitle || r.title,
      url: `${BASE}/latest/${r.pagePath}`,
      product: r.product,
      ancestry: r.ancestry || [],
    }));
}

export async function getCatalog() {
  if (!catalogCache) catalogCache = await buildCatalog();
  return catalogCache;
}

export async function listPages(keyword) {
  const catalog = await getCatalog();
  const q = keyword.toLowerCase();
  return catalog.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.slug.toLowerCase().includes(q) ||
    p.product?.toLowerCase().includes(q) ||
    p.ancestry.some(a => a.toLowerCase().includes(q))
  );
}

// ---------------------------------------------------------------------------
// Search via Fonto search API
// ---------------------------------------------------------------------------

const SEARCH_API = `${BASE}/api/search/latest`;

export async function searchDocs(query) {
  const url = `${SEARCH_API}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, 20).map(r => ({
    title: r.title,
    slug: r.pagePath,
    url: `${BASE}/latest/${r.pagePath}`,
    description: r.snippet || "",
  }));
}

// ---------------------------------------------------------------------------
// Fetch a page  (10-minute in-process cache to absorb same-session refetches)
// ---------------------------------------------------------------------------

const PAGE_CACHE_TTL = 10 * 60 * 1000;
const pageCache = new Map(); // slug -> { markdown, expiresAt }

export async function fetchPage(slug) {
  const clean = slug.replace(/^\/?(latest\/)?/, "");
  const cached = pageCache.get(clean);
  if (cached && cached.expiresAt > Date.now()) return cached.markdown;

  const xmlUrl = `${BASE}/static/xml/latest/${clean}.xml`;
  const res = await fetch(xmlUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Could not fetch "${slug}" (HTTP ${res.status}). Try searching first to find the correct slug.`);
  const markdown = xmlToMarkdown(await res.text(), slug);

  if (pageCache.size >= 200) {
    const now = Date.now();
    for (const [k, v] of pageCache) if (v.expiresAt <= now) pageCache.delete(k);
  }
  pageCache.set(clean, { markdown, expiresAt: Date.now() + PAGE_CACHE_TTL });
  return markdown;
}
