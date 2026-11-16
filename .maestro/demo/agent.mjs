#!/usr/bin/env node
// Plays the agent in the demo: a tiny local endpoint the flow calls (POST /apply?project=<slug>&id=<sticky>&text=<new text>)
// that makes one change through the server's MCP endpoint, as Claude would.
//   node .maestro/demo/agent.mjs <server-url>     (listens on 127.0.0.1:8798)
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const server = process.argv[2];
const mcp = new Client({ name: 'claude-code', version: 'demo' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${server}/mcp`)));
const call = async (name, args) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'POST' || u.pathname !== '/apply' || req.headers.origin) { res.writeHead(404).end(); return; }
  try {
    const project = u.searchParams.get('project');
    const m = await call('get_model', { project });
    const r = await call('apply_changes', { project, base_version: m.version, ops: [{ op: 'updateNode', id: u.searchParams.get('id'), patch: { text: u.searchParams.get('text') } }] });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
}).listen(8798, '127.0.0.1', () => console.log('agent ready on 127.0.0.1:8798'));
