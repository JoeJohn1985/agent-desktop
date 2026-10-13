'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

function createCredentialStore(file, encryption) {
  function encryptionAvailable() {
    return encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }
  function read() {
    if (!fs.existsSync(file)) return {};
    if (!encryptionAvailable()) throw new Error('OS-Verschlüsselung für MCP-Anmeldedaten ist nicht verfügbar.');
    return JSON.parse(encryption.decryptString(fs.readFileSync(file)));
  }
  return {
    get: id => read()[id] || {},
    set(id, value) {
      if (!encryptionAvailable()) throw new Error('MCP-Anmeldedaten werden nicht unverschlüsselt gespeichert.');
      const all = read();
      if (value === null) delete all[id];
      else all[id] = value;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + '.tmp';
      fs.writeFileSync(temp, encryption.encryptString(JSON.stringify(all)), { mode: 0o600 });
      fs.renameSync(temp, file);
    },
  };
}

class AppOAuthProvider {
  constructor(id, store, openExternal, interactive) {
    this.id = id;
    this.store = store;
    this.openExternal = openExternal;
    this.interactive = interactive;
    this.saved = store.get(id);
    this.verifier = null;
    this.oauthState = crypto.randomBytes(32).toString('hex');
    this.callback = null;
    this.code = null;
    this.failure = null;
    this.waiter = null;
  }

  async prepare() {
    if (!this.interactive) return;
    this.callback = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url, this.redirectUrl); }
      catch { res.writeHead(400).end(); return; }
      const expectedHost = new URL(this.redirectUrl).host;
      if (req.method !== 'GET' || req.headers.host !== expectedHost || url.pathname !== '/oauth/callback') {
        res.writeHead(404).end();
        return;
      }
      const state = url.searchParams.get('state') || '';
      if (url.searchParams.getAll('state').length !== 1 || Buffer.byteLength(state) !== Buffer.byteLength(this.oauthState)
        || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(this.oauthState))) {
        res.writeHead(400).end('Ungueltige OAuth-Antwort.');
        return;
      }
      if (url.searchParams.has('error')) {
        this.failure = new Error('MCP-Anmeldung wurde abgelehnt oder abgebrochen.');
      } else if (url.searchParams.getAll('code').length === 1 && url.searchParams.get('code')) {
        this.code = url.searchParams.get('code');
      } else {
        res.writeHead(400).end('Autorisierungscode fehlt.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('Antwort empfangen. Bitte zurueck zu Agent Desktop wechseln.');
      this.settle();
    });
    const port = this.saved.redirectUrl ? Number(new URL(this.saved.redirectUrl).port) : 0;
    await new Promise((resolve, reject) => {
      this.callback.once('error', reject);
      this.callback.listen(port, '127.0.0.1', resolve);
    });
    this.saved.redirectUrl = `http://127.0.0.1:${this.callback.address().port}/oauth/callback`;
  }

  get redirectUrl() { return this.saved.redirectUrl; }
  get clientMetadata() {
    return {
      client_name: 'Agent Desktop',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  state() { return this.oauthState; }
  clientInformation() { return this.saved.clientInformation; }
  saveClientInformation(value) { this.saved.clientInformation = value; this.persist(); }
  tokens() { return this.saved.tokens; }
  saveTokens(value) { this.saved.tokens = value; this.persist(); }
  saveCodeVerifier(value) { this.verifier = value; }
  codeVerifier() {
    if (!this.verifier) throw new Error('PKCE-Prüfwert fehlt. Bitte erneut verbinden.');
    return this.verifier;
  }
  async redirectToAuthorization(url) {
    if (!this.interactive) throw new Error('Anmeldung erforderlich. Bitte in der MCP-Verwaltung auf Verbinden klicken.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      throw new Error('Unsichere OAuth-Anmeldeadresse wurde abgelehnt.');
    }
    await this.openExternal(url.toString());
  }
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'client') delete this.saved.clientInformation;
    if (scope === 'all' || scope === 'tokens') delete this.saved.tokens;
    if (scope === 'all' || scope === 'verifier') this.verifier = null;
    this.persist();
  }
  persist() { this.store.set(this.id, this.saved); }
  settle() {
    if (!this.waiter) return;
    if (this.failure) this.waiter.reject(this.failure);
    else if (this.code) this.waiter.resolve(this.code);
  }
  waitForCode(signal) {
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.waiter = null;
        fn(value);
      };
      const aborted = () => finish(reject, new Error('MCP-Anmeldung abgebrochen.'));
      const timer = setTimeout(() => finish(reject, new Error('MCP-Anmeldung: Zeitlimit von 5 Minuten überschritten.')), 300000);
      this.waiter = { resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
      else this.settle();
    });
  }
  async close() {
    if (!this.callback) return;
    this.callback.closeAllConnections();
    await new Promise(resolve => this.callback.close(resolve));
    this.callback = null;
    this.verifier = null;
  }
}

module.exports = { AppOAuthProvider, createCredentialStore };
