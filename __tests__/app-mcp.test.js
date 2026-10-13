'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { AppMcpManager, validateServer, MAX_BODY_BYTES } = require('../src/mcp/manager');
const { AppOAuthProvider, createCredentialStore } = require('../src/mcp/oauth');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const types = require('@modelcontextprotocol/sdk/types.js');

let directory;
let manager;
const activeServers = [];

function memoryStore() {
  const data = new Map();
  return {
    get: jest.fn(id => structuredClone(data.get(id) || {})),
    set: jest.fn((id, value) => { if (value === null) data.delete(id); else data.set(id, structuredClone(value)); }),
  };
}
function fakeRemote() {
  return {
    client: {
      connect: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
      getServerCapabilities: () => ({ tools: { listChanged: true }, resources: {}, prompts: {} }),
      getInstructions: () => 'Test instructions',
      setNotificationHandler: jest.fn(),
      request: jest.fn().mockResolvedValue({ tools: [] }),
    },
    transport: { finishAuth: jest.fn().mockResolvedValue() },
  };
}
function setup(factory = jest.fn(() => fakeRemote())) {
  if (!jest.isMockFunction(factory)) factory = jest.fn(factory);
  manager = new AppMcpManager({
    configPath: path.join(directory, 'servers.json'),
    credentialStore: memoryStore(),
    openExternal: jest.fn(),
    remoteFactory: factory,
  });
  return factory;
}
async function add(values = {}) {
  await manager.save({ name: 'test', type: 'http', url: 'https://example.org/mcp', ...values });
  return manager.list().find(s => s.name === (values.name || 'test')).id;
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-desktop-mcp-test-')); });
afterEach(async () => {
  if (manager) await manager.close();
  for (const server of activeServers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(directory, { recursive: true, force: true });
  manager = null;
});

test.each([
  { name: 'bad name', type: 'http', url: 'https://example.org' },
  { name: 'ok', type: 'stdio', url: 'https://example.org' },
  { name: 'ok', type: 'http', url: 'http://example.org' },
  { name: 'ok', type: 'http', url: 'https://user:secret@example.org' },
  { name: 'ok', type: 'http', url: 'file:///C:/test' },
  { name: 'ok', type: 'http', url: 'https://example.org/mcp?access_token=synthetic' },
])('rejects invalid or unsafe config: %j', input => {
  expect(() => validateServer(input)).toThrow();
});

test('stores config separately, rejects duplicate names and ignores injected properties', async () => {
  setup();
  await add({ tokens: 'must-not-persist' });
  expect(fs.readFileSync(manager.configPath, 'utf8')).not.toContain('must-not-persist');
  await expect(add({ name: 'TEST' })).rejects.toThrow('bereits');
  expect(manager.list()[0]).toMatchObject({ managed: true, status: 'configured' });
});

test('malformed persisted config fails explicitly without replacing it', () => {
  setup();
  fs.writeFileSync(manager.configPath, '{broken');
  expect(() => manager.list()).toThrow();
  expect(fs.readFileSync(manager.configPath, 'utf8')).toBe('{broken');
});

test('disconnect aborts a transport that never finishes connecting', async () => {
  const remote = fakeRemote();
  remote.client.connect.mockImplementation(() => new Promise(() => {}));
  setup(() => remote);
  const id = await add();
  const pending = manager.connect(id);
  const rejected = expect(pending).rejects.toThrow('abgebrochen');
  await manager.disconnect(id);
  await rejected;
  expect(remote.client.close).toHaveBeenCalled();
  expect(manager.list()[0].status).toBe('disconnected');
  expect(manager.connections.size).toBe(0);
});

test('Copilot startup config contains only local bridges, is refreshed and removed on shutdown', async () => {
  setup();
  expect(await manager.getCopilotMcpConfig()).toBeNull();
  const id = await add();
  const file = await manager.getCopilotMcpConfig();
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  const server = content.mcpServers['agent-desktop-test'];
  expect(server).toMatchObject({ type: 'local', command: process.execPath, tools: ['*'] });
  expect(server.env.APP_MCP_SERVER_ID).toBe(id);
  expect(server.env.APP_MCP_TOKEN).toBe(manager.token);
  expect(JSON.stringify(content)).not.toContain('https://example.org');
  expect(fs.readdirSync(directory)).not.toContain('mcp-config.json');
  await add({ name: 'second' });
  expect(await manager.getCopilotMcpConfig()).toBe(file);
  expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers)).toHaveLength(2);
  await manager.close();
  expect(fs.existsSync(file)).toBe(false);
});

test('startup connects enabled servers in parallel and never opens an authorization browser', async () => {
  const factory = setup();
  const first = await add();
  const second = await add({ name: 'second' });
  await add({ name: 'disabled', enabled: false });
  expect(await manager.connectEnabled()).toEqual([
    { id: first, success: true }, { id: second, success: true },
  ]);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(factory.mock.calls.every(call => call[1] === undefined)).toBe(true);
  expect(manager.openExternal).not.toHaveBeenCalled();
  await manager.connectEnabled();
  expect(factory).toHaveBeenCalledTimes(2);
});

test('startup reports authentication requirements while continuing with other servers', async () => {
  setup(config => {
    const remote = fakeRemote();
    if (config.name === 'test') remote.client.connect.mockRejectedValue(new UnauthorizedError());
    return remote;
  });
  const first = await add();
  const second = await add({ name: 'second' });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await manager.connectEnabled()).toEqual([
      { id: first, success: false, error: expect.stringContaining('Anmeldung erforderlich') },
      { id: second, success: true },
    ]);
    expect(log).toHaveBeenCalledWith('[mcp:startup:test]', expect.stringContaining('Anmeldung erforderlich'));
    expect(manager.list().find(server => server.id === first).status).toBe('auth-required');
    expect(manager.openExternal).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test('shares one connection across concurrent tabs and rejects unsupported methods', async () => {
  const factory = setup();
  const id = await add();
  const [first, second] = await Promise.all([manager.connect(id), manager.connect(id)]);
  expect(first).toBe(second);
  expect(factory).toHaveBeenCalledTimes(1);
  await manager.request(id, { method: 'tools/list', params: { cursor: 'page-2' } });
  expect(first.request).toHaveBeenCalledWith(expect.objectContaining({ params: { cursor: 'page-2' } }), expect.anything(), expect.anything());
  await expect(manager.request(id, { method: 'sampling/createMessage' })).rejects.toThrow('Nicht unterstützte');
});

test('disabling or changing endpoint closes the client and clears old endpoint credentials', async () => {
  const factory = setup();
  const id = await add();
  await manager.connect(id);
  await manager.save({ ...manager.config(id), url: 'https://other.example.org/mcp', enabled: false });
  expect(factory.mock.results[0].value.client.close).toHaveBeenCalled();
  expect(manager.credentialStore.set).toHaveBeenCalledWith(id, null);
  await expect(manager.connect(id)).rejects.toThrow('deaktiviert');
  expect(await manager.getAcpServers()).toEqual([]);
});

test('background connection never launches OAuth; failure is visible', async () => {
  const remote = fakeRemote();
  remote.client.connect.mockRejectedValue(new UnauthorizedError());
  setup(() => remote);
  const id = await add();
  await expect(manager.connect(id)).rejects.toThrow('Anmeldung erforderlich');
  expect(manager.openExternal).not.toHaveBeenCalled();
  expect(manager.list()[0]).toMatchObject({ status: 'auth-required' });
});

test('interactive OAuth validates state and reconnects after code exchange', async () => {
  let provider;
  let count = 0;
  const factory = setup((_config, auth) => {
    provider = auth;
    const remote = fakeRemote();
    if (count++ === 0) {
      remote.client.connect.mockImplementation(async () => {
        await auth.redirectToAuthorization(new URL('https://example.org/authorize'));
        throw new UnauthorizedError();
      });
      remote.transport.finishAuth.mockImplementation(async () => auth.saveTokens({ access_token: 'synthetic-test-token', token_type: 'Bearer' }));
    }
    return remote;
  });
  const id = await add();
  const connection = manager.connect(id, true);
  while (!manager.openExternal.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 5));
  const invalid = await fetch(`${provider.redirectUrl}?code=fake&state=${'ä'.repeat(64)}`);
  expect(invalid.status).toBe(400);
  const response = await fetch(`${provider.redirectUrl}?code=test-code&state=${provider.state()}`);
  expect(response.status).toBe(200);
  await connection;
  expect(factory.mock.results[0].value.transport.finishAuth).toHaveBeenCalledWith('test-code');
  expect(factory).toHaveBeenCalledTimes(2);
  expect(manager.credentialStore.get(id).tokens.access_token).toBe('synthetic-test-token');
  expect(provider.callback).toBeNull();
});

test('OAuth pending login can be cancelled without leaving a listener', async () => {
  const provider = new AppOAuthProvider('test-id', memoryStore(), jest.fn(), true);
  await provider.prepare();
  const controller = new AbortController();
  const code = provider.waitForCode(controller.signal);
  controller.abort();
  await expect(code).rejects.toThrow('abgebrochen');
  await provider.close();
  expect(provider.callback).toBeNull();
});

test('encrypted credential store refuses plaintext and preserves issuer', () => {
  const key = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: text => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString: data => {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  const file = path.join(directory, 'credentials.enc');
  const store = createCredentialStore(file, encryption);
  store.set('server', { tokens: { access_token: 'synthetic-secret', issuer: 'https://issuer.example.org' } });
  expect(fs.readFileSync(file).includes(Buffer.from('synthetic-secret'))).toBe(false);
  expect(store.get('server').tokens.issuer).toBe('https://issuer.example.org');
  encryption.isEncryptionAvailable = () => false;
  expect(() => store.get('server')).toThrow('Verschlüsselung');
  expect(() => store.set('other', {})).toThrow('unverschlüsselt');
  encryption.isEncryptionAvailable = () => true;
  encryption.getSelectedStorageBackend = () => 'basic_text';
  expect(() => store.set('other', {})).toThrow('unverschlüsselt');
});

test('loopback gateway rejects missing bearer, browser origins and oversized requests', async () => {
  setup();
  const id = await add();
  const [config] = await manager.getAcpServers();
  const env = Object.fromEntries(config.env.map(e => [e.name, e.value]));
  const endpoint = `${env.APP_MCP_GATEWAY}/rpc/${id}`;
  expect((await fetch(endpoint, { method: 'POST', body: '{}' })).status).toBe(403);
  const headers = { Authorization: `Bearer ${env.APP_MCP_TOKEN}` };
  expect((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://example.org' }, body: '{}' })).status).toBe(403);
  expect((await fetch(endpoint, { method: 'POST', headers, body: 'x'.repeat(MAX_BODY_BYTES + 1) })).status).toBe(413);
  expect(config.command).toBe(process.execPath);
  expect(JSON.stringify(config)).not.toContain('access_token');
});

test.each([process.execPath, require('electron')])('real stdio bridge via %s forwards rich MCP results', async command => {
  const remoteHttp = http.createServer(async (req, res) => {
    const server = new Server({ name: 'fixture', version: '1.0.0' }, {
      capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
      instructions: 'Fixture instructions',
    });
    server.setRequestHandler(types.ListToolsRequestSchema, () => ({ tools: [{
      name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    }] }));
    server.setRequestHandler(types.CallToolRequestSchema, request => ({
      content: [{ type: 'text', text: request.params.arguments.text }],
      structuredContent: { echoed: request.params.arguments.text },
    }));
    server.setRequestHandler(types.ListResourcesRequestSchema, () => ({ resources: [{ name: 'test', uri: 'fixture://test' }] }));
    server.setRequestHandler(types.ReadResourceRequestSchema, () => ({ contents: [{ uri: 'fixture://test', text: 'resource-content' }] }));
    server.setRequestHandler(types.ListPromptsRequestSchema, () => ({ prompts: [{ name: 'hello' }] }));
    server.setRequestHandler(types.GetPromptRequestSchema, () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'prompt-content' } }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => server.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  const url = await listen(remoteHttp);
  manager = new AppMcpManager({
    configPath: path.join(directory, 'servers.json'), credentialStore: memoryStore(), openExternal: jest.fn(),
  });
  const id = await add({ url: url + '/mcp' });
  await manager.connect(id);
  const [config] = await manager.getAcpServers();
  const transport = new StdioClientTransport({
    command, args: config.args, env: Object.fromEntries(config.env.map(e => [e.name, e.value])), stderr: 'pipe',
  });
  const client = new Client({ name: 'copilot-fixture', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    expect(client.getInstructions()).toBe('Fixture instructions');
    expect((await client.listTools()).tools[0]).toMatchObject({ name: 'echo', annotations: { readOnlyHint: true } });
    expect(await client.callTool({ name: 'echo', arguments: { text: 'Grüße' } })).toMatchObject({
      content: [{ type: 'text', text: 'Grüße' }], structuredContent: { echoed: 'Grüße' },
    });
    expect((await client.listResources()).resources[0].uri).toBe('fixture://test');
    expect((await client.readResource({ uri: 'fixture://test' })).contents[0].text).toBe('resource-content');
    expect((await client.listPrompts()).prompts[0].name).toBe('hello');
    expect((await client.getPrompt({ name: 'hello' })).messages[0].content.text).toBe('prompt-content');
  } finally { await client.close(); }
}, 20000);

test('SSE remote notifications and stdio cancellation pass through the app gateway', async () => {
  const remote = new Server({ name: 'sse-fixture', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } });
  remote.setRequestHandler(types.ListToolsRequestSchema, () => ({ tools: [] }));
  let startedResolve;
  let cancelledResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const cancelled = new Promise(resolve => { cancelledResolve = resolve; });
  remote.setRequestHandler(types.CallToolRequestSchema, async (_request, extra) => {
    await new Promise(resolve => {
      extra.signal.addEventListener('abort', () => { cancelledResolve(); resolve(); }, { once: true });
      startedResolve();
    });
    return { content: [] };
  });
  let remoteTransport;
  const remoteHttp = http.createServer(async (req, res) => {
    if (req.url === '/sse') {
      remoteTransport = new SSEServerTransport('/messages', res);
      await remote.connect(remoteTransport);
    } else if (req.url.startsWith('/messages')) await remoteTransport.handlePostMessage(req, res);
    else res.writeHead(404).end();
  });
  const url = await listen(remoteHttp);
  manager = new AppMcpManager({
    configPath: path.join(directory, 'servers.json'), credentialStore: memoryStore(), openExternal: jest.fn(),
  });
  const id = await add({ type: 'sse', url: url + '/sse' });
  await manager.connect(id);
  const [config] = await manager.getAcpServers();
  const client = new Client({ name: 'copilot-fixture', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(new StdioClientTransport({
      command: config.command, args: config.args, env: Object.fromEntries(config.env.map(e => [e.name, e.value])), stderr: 'pipe',
    }));
    let notifiedResolve;
    const notified = new Promise(resolve => { notifiedResolve = resolve; });
    client.setNotificationHandler(types.ToolListChangedNotificationSchema, notifiedResolve);
    await client.listTools();
    await remote.notification({ method: 'notifications/tools/list_changed' });
    await notified;
    const controller = new AbortController();
    const request = client.callTool({ name: 'wait' }, undefined, { signal: controller.signal });
    const rejected = expect(request).rejects.toThrow();
    await started;
    controller.abort();
    await rejected;
    await cancelled;
    expect(await client.listTools()).toEqual({ tools: [] });
    expect(manager.list()[0].status).toBe('connected');
  } finally {
    await client.close();
    await remote.close();
  }
}, 20000);

test('real OAuth discovery, PKCE, refresh and reconnect use app credentials rather than Copilot', async () => {
  let base;
  let expectedChallenge;
  let validToken = 'fixture-access-1';
  let refreshCount = 0;
  const store = memoryStore();
  const remoteHttp = http.createServer(async (req, res) => {
    const json = value => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) {
      json({ resource: base + '/mcp', authorization_servers: [base], scopes_supported: ['read'] });
    } else if (req.url.startsWith('/.well-known/oauth-authorization-server')) {
      json({
        issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
        registration_endpoint: base + '/register', response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
      });
    } else if (req.url === '/register' || req.url === '/token') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (req.url === '/register') {
        json({ ...JSON.parse(body), client_id: 'fixture-client' });
      } else {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'authorization_code') {
          const challenge = crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url');
          if (challenge !== expectedChallenge) { res.writeHead(400).end(); return; }
        } else if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'fixture-refresh') {
          refreshCount++;
          validToken = 'fixture-access-2';
        } else { res.writeHead(400).end(); return; }
        json({ access_token: validToken, refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600 });
      }
    } else if (req.url === '/mcp') {
      if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
      if (req.headers.authorization !== `Bearer ${validToken}`) {
        res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="read"` }).end();
        return;
      }
      const server = new Server({ name: 'oauth-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(types.ListToolsRequestSchema, () => ({ tools: [] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => server.close());
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } else res.writeHead(404).end();
  });
  base = await listen(remoteHttp);
  const openExternal = jest.fn(async value => {
    const auth = new URL(value);
    expectedChallenge = auth.searchParams.get('code_challenge');
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', auth.searchParams.get('state'));
    callback.searchParams.set('code', 'fixture-code');
    expect((await fetch(callback)).status).toBe(200);
  });
  const options = { configPath: path.join(directory, 'servers.json'), credentialStore: store, openExternal };
  manager = new AppMcpManager(options);
  const id = await add({ url: base + '/mcp' });
  await manager.connect(id, true);
  expect(openExternal).toHaveBeenCalledTimes(1);
  const refreshBeforeExpiry = refreshCount;
  validToken = 'expired-sentinel';
  expect(await manager.request(id, { method: 'tools/list' })).toEqual({ tools: [] });
  expect(refreshCount).toBe(refreshBeforeExpiry + 1);
  expect(openExternal).toHaveBeenCalledTimes(1);
  await manager.close();
  manager = new AppMcpManager(options);
  expect(await manager.connectEnabled()).toEqual([{ id, success: true }]);
  expect(openExternal).toHaveBeenCalledTimes(1);
  expect(manager.list()[0].status).toBe('connected');
}, 20000);
