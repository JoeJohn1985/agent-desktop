'use strict';

const { compareVersions, checkForAdapterUpdate, REGISTRY_URL } = require('../src/claude-adapter-update');

describe('claude-adapter-update: compareVersions', () => {
  it('erkennt gleiche Versionen', () => {
    expect(compareVersions('0.73.0', '0.73.0')).toBe(0);
  });

  it('erkennt eine neuere Patch-Version', () => {
    expect(compareVersions('0.73.1', '0.73.0')).toBe(1);
    expect(compareVersions('0.73.0', '0.73.1')).toBe(-1);
  });

  it('vergleicht numerisch, nicht lexikografisch (0.9 < 0.10)', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
  });

  it('ignoriert -prerelease/+build-Suffixe', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3+build5', '1.2.3')).toBe(0);
  });

  it('behandelt fehlende Segmente als 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.3', '1.2.9')).toBe(1);
  });
});

describe('claude-adapter-update: checkForAdapterUpdate', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('meldet ein verfügbares Update, wenn die Registry eine neuere Version liefert', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: '0.80.0' }) });
    const res = await checkForAdapterUpdate('0.73.0');
    expect(global.fetch).toHaveBeenCalledWith(REGISTRY_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(res).toEqual({ ok: true, currentVersion: '0.73.0', latestVersion: '0.80.0', updateAvailable: true });
  });

  it('meldet kein Update, wenn die gepinnte Version bereits die neueste ist', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ version: '0.73.0' }) });
    const res = await checkForAdapterUpdate('0.73.0');
    expect(res).toEqual({ ok: true, currentVersion: '0.73.0', latestVersion: '0.73.0', updateAvailable: false });
  });

  it('liefert ok:false bei HTTP-Fehler', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const res = await checkForAdapterUpdate('0.73.0');
    expect(res.ok).toBe(false);
    expect(res.updateAvailable).toBe(false);
    expect(res.error).toMatch(/500/);
  });

  it('liefert ok:false bei Netzwerkfehler', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const res = await checkForAdapterUpdate('0.73.0');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('offline');
  });

  it('liefert ok:false, wenn die Antwort keine Version enthält', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const res = await checkForAdapterUpdate('0.73.0');
    expect(res.ok).toBe(false);
    expect(res.latestVersion).toBeNull();
  });
});
