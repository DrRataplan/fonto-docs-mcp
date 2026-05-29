import { searchDocs, fetchPage, getCatalog, listPages } from "./fonto.js";

export const MCP_TOOLS = [
  {
    name: "search_fonto_docs",
    description: "Search the Fonto XML documentation by keyword. Returns matching pages with titles, descriptions, and slugs.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search term, e.g. 'documentsManager'" } },
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
    name: "list_pages",
    description: "List Fonto documentation pages whose titles match a keyword. Useful for discovery when you don't know the exact slug. Returns slug, title, and URL for each match. For a full catalog use the fonto://catalog resource.",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string", description: "Word or phrase to filter page titles by, e.g. 'operations' or 'table'" } },
      required: ["keyword"],
    },
  },
];

export const MCP_RESOURCES = [
  {
    uri: "fonto://catalog",
    name: "Fonto Docs Catalog",
    description: "Complete list of all Fonto documentation pages with slugs and titles. Use this for broad discovery; use search_fonto_docs or list_pages for targeted lookups.",
    mimeType: "text/plain",
  },
];

export const MCP_RESOURCE_TEMPLATES = [
  {
    uriTemplate: "fonto://page/{slug}",
    name: "Fonto Documentation Page",
    description: "Fetch any Fonto documentation page by slug. Use search_fonto_docs or list_pages to find the slug, then address the page directly as a resource.",
    mimeType: "text/plain",
  },
];

export async function handleMcpRequest(body) {
  const { method, params, id } = body;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: { subscribe: false } },
        serverInfo: { name: "fonto-docs", version: "0.1.0" },
      },
    };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      let text;
      if (name === "search_fonto_docs") {
        const results = await searchDocs(args.query);
        text = results.length === 0
          ? `No results found for "${args.query}".`
          : results.map(r => `**${r.title}**\n${r.description ?? ""}\nURL: ${r.url}\nSlug: ${r.slug}`).join("\n\n---\n\n");
      } else if (name === "get_fonto_page") {
        text = await fetchPage(args.slug);
      } else if (name === "list_pages") {
        const results = await listPages(args.keyword);
        text = results.length === 0
          ? `No pages found matching "${args.keyword}".`
          : results.map(r => {
              const path = [...r.ancestry, r.title].join(" > ");
              return `${r.slug} — ${path}`;
            }).join("\n");
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: err.message }], isError: true } };
    }
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: MCP_RESOURCES, resourceTemplates: MCP_RESOURCE_TEMPLATES } };
  }

  if (method === "resources/read") {
    const { uri } = params;
    try {
      if (uri === "fonto://catalog") {
        const catalog = await getCatalog();
        const text = catalog.map(p => {
          const path = [...p.ancestry, p.title].join(" > ");
          return `${p.slug} — ${path}`;
        }).join("\n");
        return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "text/plain", text }] } };
      }
      const pageMatch = uri.match(/^fonto:\/\/page\/(.+)$/);
      if (pageMatch) {
        const text = await fetchPage(pageMatch[1]);
        return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "text/plain", text }] } };
      }
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${uri}` } };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32603, message: err.message } };
    }
  }

  // notifications/initialized and other one-way messages
  if (!id) return null;

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}
