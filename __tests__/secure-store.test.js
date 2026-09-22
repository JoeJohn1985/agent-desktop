/**
 * Unit-Tests für src/secure-store.js — Verschlüsselte Ablage von API-Keys und
 * (neu) dem optionalen SSH-Passwort für Claude Code (SSH). Die eigentliche
 * Verschlüsselung kommt von Electrons safeStorage (OS-Keychain) und wird hier
 * gemockt; Schwerpunkt ist, dass secure-store selbst nie unverschlüsselt auf
 * die Platte schreibt und bei fehlender OS-Verschlüsselung nicht still auf
 * Klartext zurückfällt.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

let mockEncryptionAvailable = true;

jest.mock('electron', () => ({
  app: { getPath: jest.fn() },
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => mockEncryptionAvailable),
    encryptString: jest.fn((s) => Buffer.from(`ENC:${s}`, 'utf-8')),
    decryptString: jest.fn((buf) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('ENC:')) throw new Error('bad ciphertext');
      return s.slice(4);
    }),
  },
}));

describe('secure-store', () => {
  let userDataDir;
  let secureStore;

  beforeEach(() => {
    jest.resetModules();
    mockEncryptionAvailable = true;
    userDataDir = path.join(os.tmpdir(), `secure-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(userDataDir, { recursive: true });
    const { app } = require('electron');
    app.getPath.mockReturnValue(userDataDir);
    secureStore = require('../src/secure-store');
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('setKey/getKey: Rundreise liefert den ursprünglichen Klartext', () => {
    secureStore.setKey('claude-code-ssh', 'geheim123');
    expect(secureStore.getKey('claude-code-ssh')).toBe('geheim123');
  });

  test('die Datei auf der Platte enthält den Klartext nirgends', () => {
    secureStore.setKey('claude-code-ssh', 'sehr-geheimes-passwort');
    const raw = fs.readFileSync(path.join(userDataDir, 'provider-keys.enc'), 'utf-8');
    expect(raw).not.toContain('sehr-geheimes-passwort');
  });

  test('hasKey: false ohne gespeicherten Key, true danach', () => {
    expect(secureStore.hasKey('claude-code-ssh')).toBe(false);
    secureStore.setKey('claude-code-ssh', 'x');
    expect(secureStore.hasKey('claude-code-ssh')).toBe(true);
  });

  test('deleteKey entfernt den Key wieder (hasKey/getKey danach leer)', () => {
    secureStore.setKey('claude-code-ssh', 'x');
    secureStore.deleteKey('claude-code-ssh');
    expect(secureStore.hasKey('claude-code-ssh')).toBe(false);
    expect(secureStore.getKey('claude-code-ssh')).toBeNull();
  });

  test('verschiedene Keys (Provider-API-Keys und SSH-Passwort) koexistieren unabhängig', () => {
    secureStore.setKey('anthropic', 'sk-ant-123');
    secureStore.setKey('claude-code-ssh', 'pi-passwort');
    expect(secureStore.getKey('anthropic')).toBe('sk-ant-123');
    expect(secureStore.getKey('claude-code-ssh')).toBe('pi-passwort');
    secureStore.deleteKey('anthropic');
    expect(secureStore.getKey('claude-code-ssh')).toBe('pi-passwort');
  });

  test('ohne OS-Verschlüsselung: setKey wirft, statt still Klartext zu speichern', () => {
    mockEncryptionAvailable = false;
    expect(() => secureStore.setKey('claude-code-ssh', 'x')).toThrow();
    expect(fs.existsSync(path.join(userDataDir, 'provider-keys.enc'))).toBe(false);
  });

  test('ohne OS-Verschlüsselung: getKey liefert null statt zu werfen', () => {
    secureStore.setKey('claude-code-ssh', 'x');
    mockEncryptionAvailable = false;
    expect(secureStore.getKey('claude-code-ssh')).toBeNull();
  });

  test('getKey ohne je gespeicherten Key liefert null', () => {
    expect(secureStore.getKey('claude-code-ssh')).toBeNull();
  });
});
