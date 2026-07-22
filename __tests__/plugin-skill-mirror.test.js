'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncMarketplaceSkills } = require('../src/plugin-skill-mirror');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-pluginmirror-'));
}

function writeSkill(dir, name, content = 'Inhalt') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n${content}`);
}

describe('plugin-skill-mirror: syncMarketplaceSkills', () => {
  let root, installedPluginsDir, userSkillsDir, manifestPath;

  beforeEach(() => {
    root = mkTmp();
    installedPluginsDir = path.join(root, 'installed-plugins');
    userSkillsDir = path.join(root, 'copilot-skills');
    manifestPath = path.join(root, 'mirror-manifest.json');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('spiegelt einen Marketplace-Plugin-Skill in den User-Skills-Ordner', () => {
    writeSkill(path.join(installedPluginsDir, 'my-mp', 'my-plugin', 'skills', 'retail-platform'), 'retail-platform');

    const mirrored = syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });

    expect(mirrored).toEqual(['retail-platform']);
    expect(fs.existsSync(path.join(userSkillsDir, 'retail-platform', 'SKILL.md'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))).toEqual(['retail-platform']);
  });

  it('aktualisiert einen bereits gespiegelten Skill, wenn sich der Plugin-Inhalt ändert', () => {
    const src = path.join(installedPluginsDir, 'my-mp', 'my-plugin', 'skills', 'retail-platform');
    writeSkill(src, 'retail-platform', 'Version 1');
    syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });

    writeSkill(src, 'retail-platform', 'Version 2');
    syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });

    const content = fs.readFileSync(path.join(userSkillsDir, 'retail-platform', 'SKILL.md'), 'utf-8');
    expect(content).toContain('Version 2');
  });

  it('entfernt einen gespiegelten Skill wieder, wenn das Plugin deinstalliert wurde', () => {
    const src = path.join(installedPluginsDir, 'my-mp', 'my-plugin', 'skills', 'retail-platform');
    writeSkill(src, 'retail-platform');
    syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });
    expect(fs.existsSync(path.join(userSkillsDir, 'retail-platform'))).toBe(true);

    // Plugin uninstalled → source dir gone.
    fs.rmSync(path.join(installedPluginsDir, 'my-mp'), { recursive: true, force: true });
    const mirrored = syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });

    expect(mirrored).toEqual([]);
    expect(fs.existsSync(path.join(userSkillsDir, 'retail-platform'))).toBe(false);
  });

  it('überschreibt einen gleichnamigen, selbst angelegten User-Skill NICHT', () => {
    // User already has their own "retail-platform" skill, never mirrored by us.
    writeSkill(path.join(userSkillsDir, 'retail-platform'), 'retail-platform', 'Eigener Inhalt des Users');
    writeSkill(path.join(installedPluginsDir, 'my-mp', 'my-plugin', 'skills', 'retail-platform'), 'retail-platform', 'Plugin-Inhalt');

    const mirrored = syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });

    expect(mirrored).toEqual([]);
    const content = fs.readFileSync(path.join(userSkillsDir, 'retail-platform', 'SKILL.md'), 'utf-8');
    expect(content).toContain('Eigener Inhalt des Users');
  });

  it('verarbeitet mehrere Marketplaces und Plugins', () => {
    writeSkill(path.join(installedPluginsDir, 'mp-a', 'plugin-1', 'skills', 'skill-a'), 'skill-a');
    writeSkill(path.join(installedPluginsDir, 'mp-b', 'plugin-2', 'skills', 'skill-b'), 'skill-b');

    const mirrored = syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });

    expect(mirrored.sort()).toEqual(['skill-a', 'skill-b']);
    expect(fs.existsSync(path.join(userSkillsDir, 'skill-a', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(userSkillsDir, 'skill-b', 'SKILL.md'))).toBe(true);
  });

  it('ist ein No-Op ohne installierte Plugins', () => {
    const mirrored = syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath });
    expect(mirrored).toEqual([]);
    expect(fs.existsSync(userSkillsDir)).toBe(false);
  });

  it('wirft nicht bei kaputtem Manifest', () => {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, '{not valid json');
    writeSkill(path.join(installedPluginsDir, 'my-mp', 'my-plugin', 'skills', 'retail-platform'), 'retail-platform');

    expect(() => syncMarketplaceSkills({ installedPluginsDir, userSkillsDir, manifestPath })).not.toThrow();
    expect(fs.existsSync(path.join(userSkillsDir, 'retail-platform'))).toBe(true);
  });
});
