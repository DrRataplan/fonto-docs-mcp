import { searchDocs, fetchPage, getCatalog, listPages } from "./fonto.js";

export const MCP_TOOLS = [
  {
    name: "search_fonto_docs",
    description: "Search the Fonto XML documentation using full-text search. Returns results ranked by relevance with titles, descriptions, and slugs. Best for looking up a concept, API name, or feature by keyword.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search term, e.g. 'documentsManager'" } },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              url: { type: "string" },
              slug: { type: "string" },
            },
            required: ["title", "slug", "url"],
          },
        },
      },
      required: ["results"],
    },
    annotations: {
      title: "Search Fonto Documentation",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "get_fonto_page",
    description: "Fetch the full content of a Fonto documentation page by its slug (the part of the URL after /latest/). Use search_fonto_docs or list_pages first to find the right slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Page slug, e.g. 'documentsmanager-f746b3a48442'" } },
      required: ["slug"],
    },
    outputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown content of the documentation page" },
      },
      required: ["content"],
    },
    annotations: {
      title: "Get Fonto Page",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "list_pages",
    description: "Filter Fonto documentation pages by title, product, or ancestry keyword. Returns all matches without ranking — useful when you know the product area or part of the page title. For full-text relevance search use search_fonto_docs; for the complete catalog use the fonto://catalog resource.",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string", description: "Word or phrase to filter page titles by, e.g. 'operations' or 'table'" } },
      required: ["keyword"],
    },
    outputSchema: {
      type: "object",
      properties: {
        pages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              title: { type: "string" },
              url: { type: "string" },
              product: { type: "string" },
              ancestry: { type: "array", items: { type: "string" } },
            },
            required: ["slug", "title", "url"],
          },
        },
      },
      required: ["pages"],
    },
    annotations: {
      title: "List Fonto Pages",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
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

// ---------------------------------------------------------------------------
// Protocol era support.
//
// This server is "dual-era": it keeps serving the legacy initialize-handshake
// clients (every current client — Claude Desktop, Cursor, Claude Code, etc.)
// while also accepting requests from clients that speak the 2026-07-28
// "modern" revision, which dropped the handshake in favor of per-request
// metadata. See https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning.
//
// Era selection is NOT simply "the MCP-Protocol-Version header is present":
// that header name is reused by legacy revision 2025-06-18, which requires
// clients to send it on every request *after* initialize (with a legacy date
// value, e.g. "2025-03-26" — whatever this server's `initialize` response
// negotiated). A legacy client's post-initialize `tools/list` therefore also
// carries this header, just without the modern `_meta` fields. Treating mere
// presence as "modern" misroutes that request into strict modern validation
// and rejects every real-world legacy client (Claude Desktop, Claude Code,
// Cursor) right after a successful handshake. Era must instead be decided
// from the header's *value*: legacy clients send a recognized legacy version
// string; only anything else is a modern (or modern-attempting) request.

const SERVER_INFO = { name: "fonto-docs", version: "0.1.0" };
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_MODERN_VERSIONS = [MODERN_PROTOCOL_VERSION];

// Every protocol revision prior to the modern 2026-07-28 rewrite used the
// initialize-handshake ("legacy") model. A header carrying one of these
// values is a legacy client speaking post-handshake, not a modern request.
const LEGACY_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

// Whether a request should be handled under modern (2026-07-28+) semantics.
// Exported so server.js can apply the same rule to JSON-RPC batching, which
// only exists for legacy clients.
export function isModernRequest(headers) {
  const versionHeader = headers["mcp-protocol-version"];
  return versionHeader !== undefined && !LEGACY_PROTOCOL_VERSIONS.has(versionHeader);
}

// Tool/resource declarations are static per deploy, so a long TTL is safe.
// Page content is cached in fonto.js for 10 minutes — mirror that here.
const TOOLS_LIST_CACHE = { ttlMs: 3_600_000, cacheScope: "public" };
const RESOURCES_LIST_CACHE = { ttlMs: 3_600_000, cacheScope: "public" };
const RESOURCE_READ_CACHE = { ttlMs: 600_000, cacheScope: "public" };

const NAME_REQUIRED_METHODS = new Set(["tools/call", "resources/read"]);

function res(body, status = 200) {
  return { status, body };
}

// Wraps a successful `result` payload with the fields modern clients expect:
// resultType, serverInfo identity, and (for cacheable methods) ttlMs/cacheScope.
function modernResult(id, result, cache) {
  return res({
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      ...result,
      ...(cache ? { ttlMs: cache.ttlMs, cacheScope: cache.cacheScope } : {}),
      _meta: { ...(result._meta ?? {}), "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    },
  });
}

// Validates the modern per-request envelope (headers + _meta) before any
// method is dispatched. Returns { error } on failure, or the parsed
// requestedVersion/clientCapabilities on success.
function validateModernRequest(body, headers) {
  const { method, params, id = null } = body ?? {};
  const versionHeader = headers["mcp-protocol-version"];
  const meta = params?._meta ?? {};
  const requestedVersion = meta["io.modelcontextprotocol/protocolVersion"];
  const clientCapabilities = meta["io.modelcontextprotocol/clientCapabilities"];

  // Per spec, a request missing a required _meta field is malformed
  // (-32602) — distinct from a header that disagrees with a *present* body
  // value (-32020, HeaderMismatch). Check for absence first so the two
  // aren't conflated: `undefined !== headerValue` would otherwise always
  // read as a mismatch.
  if (requestedVersion === undefined || clientCapabilities === undefined) {
    return {
      error: res({
        jsonrpc: "2.0", id,
        error: { code: -32602, message: "Missing required _meta field: io.modelcontextprotocol/protocolVersion and io.modelcontextprotocol/clientCapabilities are required on every request" },
      }, 400),
    };
  }
  if (versionHeader !== requestedVersion) {
    return {
      error: res({
        jsonrpc: "2.0", id,
        error: { code: -32020, message: `Header mismatch: MCP-Protocol-Version header value '${versionHeader}' does not match body _meta value '${requestedVersion}'` },
      }, 400),
    };
  }
  if (!SUPPORTED_MODERN_VERSIONS.includes(requestedVersion)) {
    return {
      error: res({
        jsonrpc: "2.0", id,
        error: { code: -32022, message: "Unsupported protocol version", data: { supported: SUPPORTED_MODERN_VERSIONS, requested: requestedVersion } },
      }, 400),
    };
  }
  const methodHeader = headers["mcp-method"];
  if (methodHeader !== method) {
    return {
      error: res({
        jsonrpc: "2.0", id,
        error: { code: -32020, message: `Header mismatch: Mcp-Method header value '${methodHeader}' does not match body method '${method}'` },
      }, 400),
    };
  }
  if (NAME_REQUIRED_METHODS.has(method)) {
    const expectedName = params?.name ?? params?.uri;
    const nameHeader = headers["mcp-name"];
    if (nameHeader === undefined || nameHeader !== expectedName) {
      return {
        error: res({
          jsonrpc: "2.0", id,
          error: { code: -32020, message: `Header mismatch: Mcp-Name header value '${nameHeader}' does not match body value '${expectedName}'` },
        }, 400),
      };
    }
  }
  return { requestedVersion, clientCapabilities };
}

function serverDiscoverResult(id) {
  return modernResult(id, {
    supportedVersions: SUPPORTED_MODERN_VERSIONS,
    capabilities: { tools: {}, resources: { subscribe: false } },
    instructions: "Search and read Fonto XML documentation, converted to Markdown from the underlying DITA source. Use search_fonto_docs or list_pages to find a page, then get_fonto_page to fetch its content.",
  }, { ttlMs: TOOLS_LIST_CACHE.ttlMs, cacheScope: "public" });
}

export async function handleMcpRequest(body, headers = {}) {
  const { method, params = {}, id } = body ?? {};
  const isModern = isModernRequest(headers);

  if (isModern) {
    const { error } = validateModernRequest(body, headers);
    if (error) return error;
  }

  // The initialize/initialized handshake only exists for legacy clients.
  if (method === "initialize") {
    if (isModern) return res({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }, 404);
    return res({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {}, resources: { subscribe: false } },
        serverInfo: SERVER_INFO,
      },
    });
  }

  if (method === "server/discover") {
    if (!isModern) return res({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    return serverDiscoverResult(id);
  }

  if (method === "tools/list") {
    const result = { tools: MCP_TOOLS };
    return isModern ? modernResult(id, result, TOOLS_LIST_CACHE) : res({ jsonrpc: "2.0", id, result });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;
    const toolError = (msg) => {
      const result = { content: [{ type: "text", text: msg }], isError: true };
      return isModern ? modernResult(id, result) : res({ jsonrpc: "2.0", id, result });
    };
    try {
      let text;
      let structuredContent;
      if (name === "search_fonto_docs") {
        if (!args.query?.trim()) return toolError("query must be a non-empty string");
        const results = await searchDocs(args.query);
        structuredContent = { results };
        text = results.length === 0
          ? `No results found for "${args.query}".`
          : results.map(r => `**${r.title}**\n${r.description ?? ""}\nURL: ${r.url}\nSlug: ${r.slug}`).join("\n\n---\n\n");
      } else if (name === "get_fonto_page") {
        if (!args.slug?.trim()) return toolError("slug must be a non-empty string");
        text = await fetchPage(args.slug);
        structuredContent = { content: text };
      } else if (name === "list_pages") {
        if (!args.keyword?.trim()) return toolError("keyword must be a non-empty string");
        const pages = await listPages(args.keyword);
        structuredContent = { pages };
        text = pages.length === 0
          ? `No pages found matching "${args.keyword}".`
          : pages.map(r => {
              const path = [...r.ancestry, r.title].join(" > ");
              return `${r.slug} — ${path}`;
            }).join("\n");
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      const result = { content: [{ type: "text", text }], structuredContent };
      return isModern ? modernResult(id, result) : res({ jsonrpc: "2.0", id, result });
    } catch (err) {
      const result = { content: [{ type: "text", text: err.message }], isError: true };
      return isModern ? modernResult(id, result) : res({ jsonrpc: "2.0", id, result });
    }
  }

  if (method === "resources/list") {
    const result = { resources: MCP_RESOURCES, resourceTemplates: MCP_RESOURCE_TEMPLATES };
    return isModern ? modernResult(id, result, RESOURCES_LIST_CACHE) : res({ jsonrpc: "2.0", id, result });
  }

  if (method === "resources/read") {
    const { uri } = params;
    try {
      let text;
      if (uri === "fonto://catalog") {
        const catalog = await getCatalog();
        text = catalog.map(p => {
          const path = [...p.ancestry, p.title].join(" > ");
          return `${p.slug} — ${path}`;
        }).join("\n");
      } else {
        const pageMatch = uri.match(/^fonto:\/\/page\/(.+)$/);
        if (!pageMatch) return res({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${uri}` } });
        text = await fetchPage(pageMatch[1]);
      }
      const result = { contents: [{ uri, mimeType: "text/plain", text }] };
      return isModern ? modernResult(id, result, RESOURCE_READ_CACHE) : res({ jsonrpc: "2.0", id, result });
    } catch (err) {
      return res({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message } });
    }
  }

  // notifications/initialized and other one-way messages
  if (!id) return null;

  return isModern
    ? res({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }, 404)
    : res({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}
