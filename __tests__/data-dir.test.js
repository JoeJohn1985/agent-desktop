'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyData } = require('../src/data-dir');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-mig-'));
}

describe('data-dir: migrateLegacyData', () => {
  let root;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('kopiert Home-Datenverzeichnis (folders.json) und userData (prefs+keys)', () => {
    const legacyData = path.join(root, '.copilot-desktop');
    const dataDir = path.join(root, '.agent-desktop');
    const legacyUser = path.join(root, 'appdata', 'copilot-desktop');
    const userDir = path.join(root, 'appdata', 'agent-desktop');
    fs.mkdirSync(path.join(legacyData, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(legacyData, 'folders.json'), '{"cwd":"x"}');
    fs.writeFileSync(path.join(legacyData, 'logs', 'a.log'), 'hi');
    fs.mkdirSync(legacyUser, { recursive: true });
    fs.writeFileSync(path.join(legacyUser, 'preferences.json'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(legacyUser, 'provider-keys.enc'), 'CIPHER');

    const moved = migrateLegacyData({ dataDir, legacyDataDir: legacyData, userDataDir: userDir, legacyUserDataDir: legacyUser });

    expect(moved).toBe(true);
    expect(fs.readFileSync(path.join(dataDir, 'folders.json'), 'utf-8')).toBe('{"cwd":"x"}');
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'a.log'), 'utf-8')).toBe('hi');
    expect(fs.readFileSync(path.join(userDir, 'preferences.json'), 'utf-8')).toBe('{"theme":"dark"}');
    expect(fs.readFileSync(path.join(userDir, 'provider-keys.enc'), 'utf-8')).toBe('CIPHER');
  });

  it('überschreibt vorhandene Dateien im Ziel NICHT', () => {
    const legacyData = path.join(root, '.copilot-desktop');
    const dataDir = path.join(root, '.agent-desktop');
    fs.mkdirSync(legacyData, { recursive: true });
    fs.writeFileSync(path.join(legacyData, 'folders.json'), 'OLD');
    // dataDir already populated → migration must skip entirely.
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'folders.json'), 'NEW');

    const moved = migrateLegacyData({ dataDir, legacyDataDir: legacyData });
    expect(moved).toBe(false);
    expect(fs.readFileSync(path.join(dataDir, 'folders.json'), 'utf-8')).toBe('NEW');
  });

  it('ist idempotent / no-op ohne Legacy-Daten', () => {
    const legacyData = path.join(root, '.copilot-desktop');
    const dataDir = path.join(root, '.agent-desktop');
    expect(migrateLegacyData({ dataDir, legacyDataDir: legacyData })).toBe(false);
  });

  it('migriert userData nur, wenn Ziel noch keine preferences.json hat', () => {
    const legacyUser = path.join(root, 'appdata', 'copilot-desktop');
    const userDir = path.join(root, 'appdata', 'agent-desktop');
    fs.mkdirSync(legacyUser, { recursive: true });
    fs.writeFileSync(path.join(legacyUser, 'preferences.json'), 'OLD');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'preferences.json'), 'NEW');

    const moved = migrateLegacyData({ userDataDir: userDir, legacyUserDataDir: legacyUser, dataDir: root, legacyDataDir: root });
    expect(moved).toBe(false);
    expect(fs.readFileSync(path.join(userDir, 'preferences.json'), 'utf-8')).toBe('NEW');
  });
});
