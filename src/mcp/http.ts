import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools, type ToolDeps } from "./tools.ts";
import { VERSION } from "../version.ts";

/** Streamable HTTP at /mcp: one MCP server per session, so each change records the client's name. */
export function attachMcp(deps: Omit<ToolDeps, "baseUrl">, baseUrl: () => string, openBrowser?: (url: string) => void) {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  return async (req: IncomingMessage, res: ServerResponse, body: unknown) => {
    const id = req.headers["mcp-session-id"];
    let transport = typeof id === "string" ? sessions.get(id) : undefined;
    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(body)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session. Send initialize first." }, id: null }));
        return;
      }
      const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => void sessions.set(sid, t),
      });
      t.onclose = () => {
        if (t.sessionId) sessions.delete(t.sessionId);
      };
      const server = new McpServer({ name: "event-storming-mcp", version: VERSION });
      registerTools(server, { ...deps, baseUrl, openBrowser }, () => ({ kind: "agent", name: server.server.getClientVersion()?.name || "agent" }));
      await server.connect(t);
      transport = t;
    }
    await transport.handleRequest(req, res, body);
  };
}
