const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { AcpClient } = require('../src/acp-client');
const { AppMcpManager } = require('../src/mcp/manager');

test('real Copilot ACP initializes an app-owned Electron stdio bridge with tools capability through startup configuration without a model prompt', async () => {
  test.skip(process.env.APP_MCP_COPILOT_SMOKE !== '1', 'Explicit opt-in required for native Copilot startup.');
  test.setTimeout(60000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desktop-copilot-mcp-'));
  const name = 'probe-' + crypto.randomUUID();
  const remoteHttp = http.createServer(async (req, res) => {
    const server = new Server({ name: 'local-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => {
      return { tools: [{ name: 'bridge_probe', description: 'Local registration fixture', inputSchema: { type: 'object' } }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => server.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  const manager = new AppMcpManager({
    configPath: path.join(directory, 'servers.json'),
    credentialStore: { get: () => ({}), set: () => { throw new Error('Anonymous fixture must not save credentials.'); } },
    openExternal: () => { throw new Error('Fixture must not open a browser.'); },
  });
  let client;
  try {
    const logs = path.join(directory, 'logs');
    await new Promise(resolve => remoteHttp.listen(0, '127.0.0.1', resolve));
    await manager.save({ name, type: 'http', url: `http://127.0.0.1:${remoteHttp.address().port}/mcp` });
    const configPath = await manager.getCopilotMcpConfig();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.mcpServers[`agent-desktop-${name}`].command = require('electron');
    fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    client = new AcpClient('mcp-native-smoke', () => {}, {
      copilotBin: process.env.APP_MCP_COPILOT_BIN || 'copilot',
      cwd: directory, additionalMcpConfig: configPath, mcpServers: [], initializeTimeoutMs: 30000,
      noAutoUpdate: true, allowAll: false,
      logDir: logs,
    });
    await client.start();
    await client.newSession();
    expect(client.sessionId).toBeTruthy();
    await expect.poll(() => {
      if (!fs.existsSync(logs)) return false;
      return fs.readdirSync(logs).filter(file => /^process-.*\.log$/.test(file)).some(file =>
        fs.readFileSync(path.join(logs, file), 'utf8').split('\n').some(line =>
          line.includes('Service initialized as client') && line.includes('agent-desktop-mcp') && line.includes('tools: Some'),
        ),
      );
    }, { timeout: 30000, message: 'Native Copilot must initialize the Electron MCP peer and accept its tools capability.' }).toBe(true);
    expect(manager.list()[0].status).toBe('connected');
    console.log('Native Copilot initialized the Electron MCP bridge with tools capability; no model prompt sent.');
  } catch (e) {
    console.error('Native fixture status:', manager.list()[0]?.status);
    const logs = path.join(directory, 'logs');
    if (fs.existsSync(logs)) {
      for (const file of fs.readdirSync(logs).filter(name => /^process-.*\.log$/.test(name))) {
        const messages = fs.readFileSync(path.join(logs, file), 'utf8').split('\n')
          .filter(line => /Failed to load MCP|Rejecting|additional.mcp|mcp-runtime|MCP.*failed/i.test(line))
          .filter(line => !/APP_MCP_TOKEN|access_token|refresh_token|client_secret|Authorization|Bearer/i.test(line));
        for (const message of messages) console.error(message);
      }
    }
    throw e;
  } finally {
    if (client) await client.stop();
    await manager.close();
    remoteHttp.closeAllConnections();
    await new Promise(resolve => remoteHttp.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
