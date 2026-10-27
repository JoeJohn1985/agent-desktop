'use strict';

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

/** Native CLI is authoritative; never write a second disabled-skills preference. */
function createNativeSkills({ binary = 'copilot', env = process.env, run } = {}) {
  const execute = run || ((args, cwd) => new Promise((resolve, reject) => {
    execFile(binary, ['--no-auto-update', ...args], {
      cwd, env, shell: false, windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Copilot Skills: ${stderr?.trim() || error.message}`));
      else resolve(stdout);
    });
  }));
  async function list(cwd = os.homedir()) {
    const data = JSON.parse(await execute(['skill', 'list', '--json'], cwd));
    if (!Array.isArray(data) || data.some(s => !s || typeof s.name !== 'string'
      || typeof s.path !== 'string' || typeof s.source !== 'string' || typeof s.enabled !== 'boolean')) {
      throw new Error('Unbekanntes Copilot-Skill-Katalogformat.');
    }
    return data;
  }
  async function groups(others) {
    const result = others.map(g => ({ ...g, providers: g.providers.filter(p => p !== 'copilot') }))
      .filter(g => g.providers.length);
    try {
      const catalog = await list();
      const native = new Map();
      for (const skill of catalog.filter(s => !s.source.startsWith('project') && s.source !== 'builtin')) {
        const directory = path.dirname(skill.path);
        if (!native.has(directory)) native.set(directory, {
          providers: ['copilot'], directory, skills: [], error: '', native: true,
        });
        native.get(directory).skills.push({ ...skill, id: skill.path, nativeName: skill.name });
      }
      result.unshift(...native.values());
    } catch (error) {
      result.unshift({ providers: ['copilot'], directory: '', skills: [], error: error.message });
    }
    return result;
  }
  async function setEnabled(provider, identity, enabled) {
    if (provider !== 'copilot' || typeof enabled !== 'boolean' || typeof identity !== 'string') {
      throw new Error('Native Skill-Verwaltung ist nur für Copilot verfügbar.');
    }
    const catalog = await list();
    const skill = catalog.find(s => s.path === identity && !s.source.startsWith('project') && s.source !== 'builtin');
    if (!skill || !skill.name || skill.name.startsWith('-') || /[\0\r\n]/.test(skill.name)) {
      throw new Error('Skill ist nicht im aktuellen nativen benutzerweiten Copilot-Katalog.');
    }
    await execute(['skill', enabled ? 'enable' : 'disable', skill.name], os.homedir());
    const updated = await list();
    const matching = updated.filter(s => s.name === skill.name);
    if (!matching.length || matching.some(s => s.enabled !== enabled)) {
      throw new Error('Copilot hat die Skill-Änderung nicht bestätigt. Bitte neu laden.');
    }
  }
  async function filterEnabled(skills, cwd) {
    const catalog = await list(cwd || os.homedir());
    const disabled = new Set(catalog.filter(s => !s.enabled).map(s => s.name));
    return skills.filter(s => !disabled.has(s.name));
  }
  return { list, groups, setEnabled, filterEnabled };
}

module.exports = { createNativeSkills };
