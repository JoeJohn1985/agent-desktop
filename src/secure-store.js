'use strict';

// Encrypted storage for provider API keys, backed by Electron safeStorage
// (OS keychain: Windows Credential Manager / macOS Keychain / libsecret).
// Keys are stored as encrypted ciphertext in a JSON file under userData and
// are only ever decrypted in the main process — the raw key is never exposed
// to the renderer.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

// Providers that may store an API key. GLM needs a key too; Ollama is keyless
// but listed so providers:status reports it consistently. (Copilot uses the CLI.)
const KNOWN_PROVIDERS = ['anthropic', 'gemini', 'openai', 'glm', 'ollama'];

let _filePath = null;

function filePath() {
  if (!_filePath) {
    _filePath = path.join(app.getPath('userData'), 'provider-keys.enc');
  }
  return _filePath;
}

/**
 * Whether OS-level encryption is available. If false, we refuse to store keys
 * in plaintext rather than silently degrading security.
 * @returns {boolean}
 */
function isAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

/**
 * Reads the on-disk store: { [provider]: base64Ciphertext }.
 * @returns {Object<string, string>}
 */
function readStore() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf-8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

function writeStore(store) {
  fs.writeFileSync(filePath(), JSON.stringify(store), { mode: 0o600 });
}

/**
 * Encrypts and stores an API key for a provider.
 * @param {string} provider
 * @param {string} key - Plaintext API key.
 * @throws if encryption is unavailable.
 */
function setKey(provider, key) {
  if (!isAvailable()) {
    throw new Error('OS-Verschlüsselung nicht verfügbar — Key kann nicht sicher gespeichert werden.');
  }
  const store = readStore();
  const cipher = safeStorage.encryptString(String(key));
  store[provider] = cipher.toString('base64');
  writeStore(store);
}

/**
 * Decrypts and returns the plaintext API key for a provider (main process only).
 * @param {string} provider
 * @returns {string|null}
 */
function getKey(provider) {
  const store = readStore();
  const b64 = store[provider];
  if (!b64) return null;
  if (!isAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch (e) {
    console.warn(`[secure-store] decrypt failed for ${provider}:`, e?.message);
    return null;
  }
}

/**
 * @param {string} provider
 * @returns {boolean} Whether a key is stored for the provider.
 */
function hasKey(provider) {
  const store = readStore();
  return Boolean(store[provider]);
}

/**
 * Removes the stored key for a provider.
 * @param {string} provider
 */
function deleteKey(provider) {
  const store = readStore();
  if (provider in store) {
    delete store[provider];
    writeStore(store);
  }
}

module.exports = {
  KNOWN_PROVIDERS,
  isAvailable,
  setKey,
  getKey,
  hasKey,
  deleteKey,
};
