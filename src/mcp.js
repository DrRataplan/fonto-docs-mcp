import { searchDocs, fetchPage, listPages, getRelatedPages, getIndex } from "./fonto.js";

export const MCP_TOOLS = [
  {
    name: "search_fonto_docs",
    description: "Search the Fonto XML documentation by keyword. Returns matching pages ranked by relevance, with titles and slugs. Use this to discover the correct slug before calling get_fonto_page.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search term, e.g. 'documentsManager' or 'configure cursor'" } },
      required: ["query"],
    },
  },
  {
    name: "get_fonto_page",
    description: "Fetch the full content of a Fonto documentation page by its slug (the part of the URL after /latest/). Use search_fonto_docs first to find the right slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Page slug, e.g. 'documentsmanager-f746b3a48442'" } },
      required: ["slug"],
    },
  },
  {
    name: "list_fonto_pages",
    description: "List available Fonto documentation pages, optionally filtered by a keyword. Returns up to 150 pages with their section, title, and slug. Useful for browsing what's available before searching.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Optional keyword to filter pages by slug, title, or section (e.g. 'cursor', 'api', 'configure'). Omit to list all pages.",
        },
      },
    },
  },
  {
    name: "get_related_pages",
    description: "Given a page slug, return a list of other Fonto documentation pages that are referenced by that page. Useful for following a trail through related documentation.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Page slug to find related pages for, e.g. 'documentsmanager-f746b3a48442'" } },
      required: ["slug"],
    },
  },
];

const MCP_RESOURCES = [
  {
    uri: "fonto://catalog",
    name: "Fonto Documentation Catalog",
    description: "Complete list of all available Fonto XML documentation pages with slugs and sections.",
    mimeType: "application/json",
  },
];

export async function handleMcpRequest(body) {
  const { method, params, id } = body;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "fonto-docs", version: "0.2.0" },
      },
    };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: MCP_RESOURCES } };
  }

  if (method === "resources/read") {
    const { uri } = params;
    if (uri === "fonto://catalog") {
      try {
        const index = await getIndex();
        const text = JSON.stringify(index, null, 2);
        return {
          jsonrpc: "2.0", id,
          result: { contents: [{ uri, mimeType: "application/json", text }] },
        };
      } catch (err) {
        return { jsonrpc: "2.0", id, error: { code: -32603, message: err.message } };
      }
    }
    return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${uri}` } };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      let text;

      if (name === "search_fonto_docs") {
        const results = await searchDocs(args.query);
        text = results.length === 0
          ? `No results found for "${args.query}".`
          : results.map(r => `**${r.title}**\nSection: ${r.section}\nSlug: \`${r.slug}\`\nURL: ${r.url}`).join("\n\n---\n\n");

      } else if (name === "get_fonto_page") {
        text = await fetchPage(args.slug);

      } else if (name === "list_fonto_pages") {
        const results = await listPages(args.filter);
        if (results.length === 0) {
          text = args.filter
            ? `No pages found matching "${args.filter}".`
            : "No pages found.";
        } else {
          const header = args.filter
            ? `Found ${results.length} page(s) matching "${args.filter}":\n\n`
            : `${results.length} pages available:\n\n`;
          text = header + results
            .map(r => `**${r.title}** (${r.section})\nSlug: \`${r.slug}\``)
            .join("\n\n");
        }

      } else if (name === "get_related_pages") {
        const results = await getRelatedPages(args.slug);
        text = results.length === 0
          ? `No related pages found for "${args.slug}".`
          : `Related pages for \`${args.slug}\`:\n\n` +
            results.map(r => `**${r.title}** (${r.section})\nSlug: \`${r.slug}\`\nURL: ${r.url}`).join("\n\n---\n\n");

      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: err.message }], isError: true } };
    }
  }

  // notifications/initialized and other one-way messages
  if (!id) return null;

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}
