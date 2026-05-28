import { searchDocs, fetchPage } from "./fonto.js";

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
];

export async function handleMcpRequest(body) {
  const { method, params, id } = body;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
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
