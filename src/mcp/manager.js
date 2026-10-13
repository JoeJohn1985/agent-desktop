'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const { McpError } = require('@modelcontextprotocol/sdk/types.js');
const { AppOAuthProvider } = require('./oauth');
const { REQUESTS, NOTIFICATIONS, bridgeCapabilities } = require('./protocol');

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function validateServer(value) {
  if (!value || typeof value !== 'object' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.name)) {
    throw new Error('Servername: 1 bis 64 Buchstaben, Ziffern, Bindestriche oder Unterstriche.');
  }
  if (!['http', 'sse'].includes(value.type)) throw new Error('MCP-Transport muss HTTP oder SSE sein.');
  const url = new URL(value.url);
  if (url.username || url.password || url.hash) throw new Error('MCP-Adresse darf keine Zugangsdaten oder URL-Fragmente enthalten.');
  for (const key of url.searchParams.keys()) {
    if (/^(accesstoken|token|apikey|password|secret|clientsecret|authorization|auth|key)$/.test(key.toLowerCase().replace(/[-_]/g, ''))) {
      throw new Error('Anmeldedaten in MCP-URL-Parametern werden nicht unterstützt. Bitte OAuth verwenden.');
    }
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Remote-MCP benötigt HTTPS; HTTP ist nur für lokale Server erlaubt.');
  }
  return { id: value.id, name: value.name, type: value.type, url: url.toString(), enabled: value.enabled !== false };
}

function createRemote(config, provider, signal) {
  const client = new Client({ name: 'agent-desktop', version: require('../../package.json').version }, { capabilities: {} });
  const Transport = config.type === 'sse' ? SSEClientTransport : StreamableHTTPClientTransport;
  const fetchRemote = (input, init = {}) => fetch(input, {
    ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
  });
  return { client, transport: new Transport(new URL(config.url), { authProvider: provider, fetch: fetchRemote }) };
}

async function waitForRemote(operation, signal) {
  let timer;
  let aborted;
  const interrupt = new Promise((_resolve, reject) => {
    aborted = () => reject(new Error('MCP-Verbindung abgebrochen.'));
    signal.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => reject(new Error('MCP-Verbindung: Zeitlimit von 30 Sekunden überschritten.')), 30000);
  });
  try {
    signal.throwIfAborted();
    return await Promise.race([operation(), interrupt]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', aborted);
  }
}

class AppMcpManager {
  constructor({ configPath, credentialStore, openExternal, onChange = () => {}, remoteFactory = createRemote }) {
    this.configPath = configPath;
    this.credentialStore = credentialStore;
    this.openExternal = openExternal;
    this.onChange = onChange;
    this.remoteFactory = remoteFactory;
    this.states = new Map();
    this.events = new Map();
    this.connections = new Map();
    this.revision = 0;
    this.gateway = null;
    this.gatewayPending = null;
    this.token = crypto.randomBytes(32).toString('hex');
    this.closing = false;
    this.runtimeConfigPath = path.join(path.dirname(configPath), `mcp-runtime-${crypto.randomUUID()}.json`);
    this.runtimeConfigContent = null;
  }

  configs() {
    if (!fs.existsSync(this.configPath)) return [];
    const values = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    if (!Array.isArray(values)) throw new Error('Ungültige MCP-Konfigurationsdatei.');
    const configs = values.map(validateServer);
    const ids = new Set();
    const names = new Set();
    for (const item of configs) {
      if (!/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id) || names.has(item.name.toLowerCase())) {
        throw new Error('Ungültige oder doppelte MCP-Server-ID / Servername.');
      }
      ids.add(item.id);
      names.add(item.name.toLowerCase());
    }
    return configs;
  }
  config(id) {
    const value = this.configs().find(s => s.id === id);
    if (!value) throw new Error('MCP-Server nicht gefunden.');
    return value;
  }
  list() {
    return this.configs().map(s => ({
      ...s, source: 'app', managed: true,
      bridgeName: `agent-desktop-${s.name}`,
      status: s.enabled ? (this.states.get(s.id)?.status || 'configured') : 'disabled',
      error: this.states.get(s.id)?.error || null,
    }));
  }
  changed() { this.onChange(this.list()); }
  status(id, status, error = null) {
    this.states.set(id, { ...this.states.get(id), status, error });
    this.changed();
  }
  async save(input) {
    const configs = this.configs();
    const old = input.id ? this.config(input.id) : null;
    const value = validateServer({ ...input, id: old?.id || crypto.randomUUID() });
    if (configs.some(s => s.id !== value.id && s.name.toLowerCase() === value.name.toLowerCase())) {
      throw new Error('Dieser MCP-Servername wird bereits verwendet.');
    }
    if (old) await this.disconnect(old.id);
    if (old && (old.url !== value.url || old.type !== value.type)) this.credentialStore.set(old.id, null);
    const next = old ? configs.map(s => s.id === old.id ? value : s) : [...configs, value];
    this.writeConfigs(next);
    this.revision++;
    this.changed();
    return this.list();
  }
  writeConfigs(values) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath + '.tmp', JSON.stringify(values, null, 2), { mode: 0o600 });
    fs.renameSync(this.configPath + '.tmp', this.configPath);
  }
  async remove(id) {
    this.config(id);
    await this.disconnect(id);
    this.credentialStore.set(id, null);
    this.writeConfigs(this.configs().filter(s => s.id !== id));
    this.states.delete(id);
    this.revision++;
    this.changed();
  }
  async disconnect(id, logout = false) {
    this.config(id);
    const pending = this.connections.get(id);
    pending?.controller.abort();
    if (pending) {
      try { await pending.promise; }
      catch (e) { if (e.message !== 'MCP-Verbindung abgebrochen.') console.error('[mcp:disconnect]', e.message); }
    }
    const state = this.states.get(id);
    if (state?.client) await state.client.close();
    for (const res of this.events.get(id) || []) res.end();
    this.events.delete(id);
    if (logout) this.credentialStore.set(id, null);
    this.status(id, 'disconnected');
    this.revision++;
  }
  connect(id, interactive = false) {
    if (this.closing) return Promise.reject(new Error('MCP-Dienst wird beendet.'));
    const config = this.config(id);
    if (!config.enabled) return Promise.reject(new Error('MCP-Server ist deaktiviert.'));
    const ready = this.states.get(id);
    if (ready?.client && ready.status === 'connected') return Promise.resolve(ready.client);
    const existing = this.connections.get(id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.open(config, interactive, controller.signal).finally(() => this.connections.delete(id));
    this.connections.set(id, { promise, controller });
    return promise;
  }
  async connectEnabled() {
    return Promise.all(this.configs().filter(server => server.enabled).map(async server => {
      try {
        await this.connect(server.id);
        return { id: server.id, success: true };
      } catch (e) {
        console.error(`[mcp:startup:${server.name}]`, e.message);
        return { id: server.id, success: false, error: e.message };
      }
    }));
  }
  async open(config, interactive, signal) {
    let provider;
    let remote;
    try {
      provider = new AppOAuthProvider(config.id, this.credentialStore, this.openExternal, interactive);
      const old = this.states.get(config.id)?.client;
      if (old) await old.close();
      this.status(config.id, 'connecting');
      await provider.prepare();
      // A background connection without stored credentials must never start an OAuth registration.
      const authProvider = interactive || provider.tokens() ? provider : undefined;
      remote = this.remoteFactory(config, authProvider, signal);
      try {
        await waitForRemote(() => remote.client.connect(remote.transport, { signal, timeout: 30000 }), signal);
      } catch (e) {
        if (!(e instanceof UnauthorizedError) || !interactive) throw e;
        this.status(config.id, 'authenticating');
        const code = await provider.waitForCode(signal);
        await waitForRemote(() => remote.transport.finishAuth(code), signal);
        await remote.client.close();
        remote = this.remoteFactory(config, provider, signal);
        await waitForRemote(() => remote.client.connect(remote.transport, { signal, timeout: 30000 }), signal);
      }
      if (signal.aborted || this.closing) throw new Error('MCP-Verbindung abgebrochen.');
      for (const schema of NOTIFICATIONS) {
        remote.client.setNotificationHandler(schema, notification => this.notify(config.id, notification));
      }
      remote.client.onclose = () => {
        if (this.states.get(config.id)?.client === remote.client) {
          this.states.delete(config.id);
          this.status(config.id, 'disconnected');
        }
      };
      remote.client.onerror = e => this.status(config.id, 'error', this.errorMessage(e, provider));
      provider.interactive = false;
      this.states.set(config.id, { client: remote.client, provider, status: 'connected', error: null });
      this.revision++;
      this.changed();
      return remote.client;
    } catch (e) {
      if (remote) await remote.client.close();
      const message = signal.aborted ? 'MCP-Verbindung abgebrochen.' : e instanceof UnauthorizedError
        ? 'Anmeldung erforderlich. Bitte auf Verbinden klicken.' : this.errorMessage(e, provider);
      this.status(config.id, signal.aborted ? 'disconnected' : e instanceof UnauthorizedError ? 'auth-required' : 'error', message);
      throw new Error(message, { cause: e });
    } finally {
      await provider?.close();
    }
  }
  errorMessage(error, provider) {
    let message = String(error.message || 'MCP-Verbindung fehlgeschlagen.');
    const secrets = [provider?.verifier, provider?.saved?.tokens?.access_token, provider?.saved?.tokens?.refresh_token,
      provider?.saved?.clientInformation?.client_secret];
    for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
    return message.slice(0, 1000);
  }
  notify(id, notification) {
    for (const res of this.events.get(id) || []) res.write(`data: ${JSON.stringify(notification)}\n\n`);
  }
  async request(id, request, signal) {
    const entry = REQUESTS[request?.method];
    if (!entry) throw new Error('Nicht unterstützte MCP-Methode.');
    const parsed = entry[0].parse(request);
    const client = await this.connect(id);
    if (!client.getServerCapabilities()?.[entry[2]]) throw new Error('Der MCP-Server unterstützt diese Funktion nicht.');
    try {
      return await client.request(parsed, entry[1], { signal, timeout: 120000 });
    } catch (e) {
      const message = this.errorMessage(e, this.states.get(id)?.provider);
      if (!signal?.aborted && !(e instanceof McpError)) {
        this.status(id, e instanceof UnauthorizedError || message.includes('Anmeldung erforderlich') ? 'auth-required' : 'error', message);
      }
      throw e;
    }
  }
  async startGateway() {
    if (this.gateway) return;
    if (this.gatewayPending) return this.gatewayPending;
    this.gatewayPending = (async () => {
      const server = http.createServer((req, res) => {
        this.handleGateway(req, res).catch(e => {
          if (!res.headersSent && !res.destroyed) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ error: { code: -32000, message: e.message } }));
          } else res.destroy();
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      this.gateway = server;
    })().finally(() => { this.gatewayPending = null; });
    return this.gatewayPending;
  }
  async handleGateway(req, res) {
    const host = `127.0.0.1:${this.gateway.address().port}`;
    const auth = req.headers.authorization || '';
    const expected = `Bearer ${this.token}`;
    if (req.headers.host !== host || req.headers.origin || Buffer.byteLength(auth) !== Buffer.byteLength(expected)
      || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    const match = url.pathname.match(/^\/(info|rpc|events)\/([a-f0-9-]{36})$/);
    if (!match) { res.writeHead(404).end(); return; }
    const [, action, id] = match;
    const config = this.config(id);
    if (!config.enabled) throw new Error('MCP-Server ist deaktiviert.');
    if (action === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write(': ready\n\n');
      const listeners = this.events.get(id) || new Set();
      listeners.add(res);
      this.events.set(id, listeners);
      const timer = setInterval(() => res.write(': keepalive\n\n'), 15000);
      res.on('close', () => { clearInterval(timer); listeners.delete(res); });
      return;
    }
    if (action === 'info' && req.method === 'GET') {
      const client = await this.connect(id);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ capabilities: bridgeCapabilities(client.getServerCapabilities()), instructions: client.getInstructions() }));
      return;
    }
    if (action !== 'rpc' || req.method !== 'POST') { res.writeHead(405).end(); return; }
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    try {
      const result = await this.request(id, JSON.parse(Buffer.concat(chunks).toString('utf8')), controller.signal);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ result }));
    } catch (e) {
      const provider = this.states.get(id)?.provider;
      res.writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: { code: typeof e.code === 'number' ? e.code : -32000, message: this.errorMessage(e, provider) } }));
    }
  }
  async getAcpServers() {
    const configs = this.configs().filter(s => s.enabled);
    if (!configs.length) return [];
    await this.startGateway();
    return configs.map(s => ({
      name: `agent-desktop-${s.name}`,
      command: process.execPath,
      args: [path.join(__dirname, 'bridge.js')],
      env: [
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
        { name: 'APP_MCP_GATEWAY', value: `http://127.0.0.1:${this.gateway.address().port}` },
        { name: 'APP_MCP_TOKEN', value: this.token },
        { name: 'APP_MCP_SERVER_ID', value: s.id },
      ],
    }));
  }
  async getCopilotMcpConfig() {
    const bridges = await this.getAcpServers();
    if (!bridges.length) return null;
    const content = JSON.stringify({
      mcpServers: Object.fromEntries(bridges.map(({ name, command, args, env }) => [name, {
        type: 'local', command, args, env: Object.fromEntries(env.map(item => [item.name, item.value])), tools: ['*'],
      }])),
    }, null, 2);
    if (content !== this.runtimeConfigContent) {
      fs.mkdirSync(path.dirname(this.runtimeConfigPath), { recursive: true });
      fs.writeFileSync(this.runtimeConfigPath + '.tmp', content, { mode: 0o600 });
      fs.renameSync(this.runtimeConfigPath + '.tmp', this.runtimeConfigPath);
      this.runtimeConfigContent = content;
    }
    return this.runtimeConfigPath;
  }
  async close() {
    this.closing = true;
    for (const pending of this.connections.values()) pending.controller.abort();
    const connections = await Promise.allSettled([...this.connections.values()].map(p => p.promise));
    for (const result of connections) {
      if (result.status === 'rejected' && result.reason.message !== 'MCP-Verbindung abgebrochen.') {
        console.error('[mcp:shutdown]', result.reason.message);
      }
    }
    const results = await Promise.allSettled([...this.states.values()].filter(s => s.client).map(s => s.client.close()));
    for (const result of results) if (result.status === 'rejected') console.error('[mcp:shutdown]', result.reason.message);
    if (this.gatewayPending) await this.gatewayPending;
    if (this.gateway) {
      for (const listeners of this.events.values()) for (const res of listeners) res.end();
      this.gateway.closeAllConnections();
      await new Promise(resolve => this.gateway.close(resolve));
      this.gateway = null;
    }
    if (fs.existsSync(this.runtimeConfigPath)) fs.unlinkSync(this.runtimeConfigPath);
  }
}

module.exports = { AppMcpManager, validateServer, MAX_BODY_BYTES };
