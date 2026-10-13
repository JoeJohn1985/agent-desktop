'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { McpError } = require('@modelcontextprotocol/sdk/types.js');
const { REQUESTS } = require('./protocol');

async function runBridge() {
  const gateway = process.env.APP_MCP_GATEWAY;
  const token = process.env.APP_MCP_TOKEN;
  const id = process.env.APP_MCP_SERVER_ID;
  if (!gateway || !token || !/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Lokale MCP-Verbindung ist nicht konfiguriert.');
  const url = new URL(gateway);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('MCP-Brücke darf nur die lokale App erreichen.');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function call(route, options = {}) {
    const response = await fetch(`${gateway}/${route}/${id}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(35000) });
    const data = await response.json();
    if (!response.ok) throw new McpError(data.error?.code || -32000, data.error?.message || 'Lokale MCP-Verbindung fehlgeschlagen.');
    return data;
  }
  const info = await call('info');
  const server = new Server({ name: 'agent-desktop-mcp', version: require('../../package.json').version }, info);
  for (const [method, [schema, , capability]] of Object.entries(REQUESTS)) {
    if (info.capabilities[capability]) {
      server.setRequestHandler(schema, async (request, extra) => {
        const data = await call('rpc', { method: 'POST', body: JSON.stringify({ ...request, method }), signal: extra.signal });
        return data.result;
      });
    }
  }
  const events = new AbortController();
  server.onclose = () => events.abort();
  await server.connect(new StdioServerTransport());
  async function receiveEvents() {
    const response = await fetch(`${gateway}/events/${id}`, { headers, signal: events.signal });
    if (!response.ok) throw new Error('MCP-Benachrichtigungen konnten nicht verbunden werden.');
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (event.startsWith('data: ')) await server.notification(JSON.parse(event.slice(6)));
      }
    }
    if (!events.signal.aborted) throw new Error('MCP-Verbindung zur App wurde getrennt.');
  }
  receiveEvents().catch(async e => {
    if (!events.signal.aborted) {
      console.error('[app-mcp]', e.message);
      await server.close();
    }
  });
  process.stdin.on('end', () => { events.abort(); server.close().catch(e => console.error('[app-mcp]', e.message)); });
}

if (require.main === module) runBridge().catch(e => { console.error('[app-mcp]', e.message); process.exitCode = 1; });

module.exports = { runBridge };
