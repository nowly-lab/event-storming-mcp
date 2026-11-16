import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { IO } from "../cli.ts";
import { ensureServer } from "../server/daemon.ts";

/**
 * `event-storming-mcp mcp`: a stdio MCP server for agents that start commands. It starts the shared
 * server when none runs and relays every message to its /mcp, so all agents and pages see one store.
 */
export async function runStdio(opts: { dataDir: string; cli: string; io: IO }): Promise<number> {
  let info;
  try {
    info = await ensureServer({ dataDir: opts.dataDir, cli: opts.cli });
  } catch (e) {
    opts.io.err(`event-storming-mcp: ${(e as Error).message}\n`);
    return 1;
  }
  const upstream = new StreamableHTTPClientTransport(new URL(`${info.url}/mcp`));
  const local = new StdioServerTransport();
  let done!: (n: number) => void;
  const finished = new Promise<number>((r) => (done = r));
  local.onmessage = (m) => void upstream.send(m).catch((e) => opts.io.err(`event-storming-mcp: ${(e as Error).message}\n`));
  upstream.onmessage = (m) => void local.send(m);
  local.onclose = () => void upstream.close().finally(() => done(0));
  upstream.onclose = () => done(0);
  upstream.onerror = (e) => opts.io.err(`event-storming-mcp: ${e.message}\n`);
  await upstream.start();
  await local.start();
  return finished;
}
