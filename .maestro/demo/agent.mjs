#!/usr/bin/env node
// Plays the agent in the demo: a tiny local endpoint the flow calls (POST /apply?project=<slug>&id=<sticky>&text=<new text>,
// or POST /add?project=<slug>&after=<sticky>&type=<type>&text=<text>) that makes one change through the server's MCP
// endpoint, as Claude would.
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
  if (req.method !== 'POST' || !['/apply', '/add'].includes(u.pathname) || req.headers.origin) { res.writeHead(404).end(); return; }
  try {
    const project = u.searchParams.get('project');
    const m = await call('get_model', { project });
    const q = (k) => u.searchParams.get(k);
    const op = u.pathname === '/add'
      ? { op: 'addNode', after: q('after'), node: { type: q('type'), text: q('text') } }
      : { op: 'updateNode', id: q('id'), patch: { text: q('text') } };
    const r = await call('apply_changes', { project, base_version: m.version, ops: [op] });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
}).listen(8798, '127.0.0.1', () => console.log('agent ready on 127.0.0.1:8798'));
