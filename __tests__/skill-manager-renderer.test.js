/**
 * Renderer-seitige Tests für Skill-Manager-Feature:
 * - hiddenSkillsGlobal / hiddenSkillsSession Sets
 * - toggleHideGlobal() / toggleHideSession()
 * - renderSkills() filtert ausgeblendete Skills
 */

const { escapeHtml, escapeAttr } = require('../src/renderer-logic');

// ── Minimal DOM Mock ─────────────────────────────────────────

class MockElement {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.innerHTML = '';
    this.classList = {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    };
  }
}

let mockDoc;
function createMockDocument() {
  const elements = {};
  return {
    _elements: elements,
    getElementById(id) { return elements[id] || null; },
    querySelector(sel) {
      if (sel.includes('Skills neu laden')) return elements['reloadBtn'] || null;
      return null;
    },
    _setup() {
      elements['skillList'] = new MockElement('div', 'skillList');
      elements['skillsCount'] = new MockElement('span', 'skillsCount');
      elements['reloadBtn'] = new MockElement('button', 'reloadBtn');
      elements['skillManagerBody'] = new MockElement('div', 'skillManagerBody');
      elements['skillManagerOverlay'] = new MockElement('div', 'skillManagerOverlay');
    },
  };
}

// ── Mock copilot IPC bridge ──────────────────────────────────

const mockCopilot = {
  skills: {
    list: jest.fn(),
    getDisabled: jest.fn(),
    setDisabled: jest.fn(),
    getHidden: jest.fn(),
    setHidden: jest.fn(),
  },
  preferences: {
    read: jest.fn(),
    write: jest.fn(),
  },
};

// ── Extracted state + functions from renderer/app.js ─────────

let skills = [];
let activeSkills = new Set();
let disabledSkills = new Set();
let hiddenSkillsGlobal = new Set();
let hiddenSkillsSession = new Set();
let activeTabId = 'tab-1';
const tabs = new Map();
let _prefs = {};

function getNamedSessions() {
  return _prefs.namedSessions || {};
}

function setPref(key, value) {
  _prefs[key] = value;
  mockCopilot.preferences.write(_prefs).catch(() => {});
}

function getSettings() {
  return { activeSkills: [...activeSkills] };
}

function renderSkills() {
  const container = mockDoc.getElementById('skillList');
  const countEl = mockDoc.getElementById('skillsCount');
  if (!container) return;
  if (countEl) countEl.textContent = skills.length > 0 ? String(skills.length) : '';
  const visibleSkills = skills.filter(s => {
    if (!s.dirName) return true;
    return !hiddenSkillsGlobal.has(s.dirName) && !hiddenSkillsSession.has(s.dirName);
  });
  container.innerHTML = visibleSkills.map(s => {
    const isActive = activeSkills.has(s.id);
    const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''} ${isCLIDisabled ? 'skill-card--cli-disabled' : ''}"
           data-tooltip="${escapeAttr(s.description)}">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleHideGlobal(dirName) {
  if (hiddenSkillsGlobal.has(dirName)) hiddenSkillsGlobal.delete(dirName);
  else hiddenSkillsGlobal.add(dirName);
  await mockCopilot.skills.setHidden([...hiddenSkillsGlobal]);
  renderSkills();
}

async function toggleHideSession(dirName) {
  if (hiddenSkillsSession.has(dirName)) hiddenSkillsSession.delete(dirName);
  else hiddenSkillsSession.add(dirName);
  const sessionId = activeTabId ? tabs.get(activeTabId)?.sessionId : null;
  if (sessionId) {
    const all = getNamedSessions();
    if (!all[sessionId]) all[sessionId] = { name: '', deniedTools: [], lastUsed: new Date().toISOString() };
    all[sessionId].hiddenSkills = [...hiddenSkillsSession];
    setPref('namedSessions', all);
  }
  renderSkills();
}

async function reloadSkills() {
  const btn = mockDoc.querySelector('[aria-label="Skills neu laden"]');
  if (btn) btn.classList.add('sidebar__reload-btn--spinning');
  try {
    skills = await mockCopilot.skills.list() || [];
    const savedActiveSkills = getSettings().activeSkills || [];
    activeSkills = new Set(savedActiveSkills);
    const savedDisabledSkills = await mockCopilot.skills.getDisabled() || [];
    disabledSkills = new Set(savedDisabledSkills);
    const savedHidden = await mockCopilot.skills.getHidden() || [];
    hiddenSkillsGlobal = new Set(savedHidden);
    const sessionId = activeTabId ? tabs.get(activeTabId)?.sessionId : null;
    const allSessions = getNamedSessions();
    hiddenSkillsSession = new Set(allSessions[sessionId]?.hiddenSkills || []);
    renderSkills();
  } catch (e) {
    // error handling
  } finally {
    if (btn) btn.classList.remove('sidebar__reload-btn--spinning');
  }
}

// ── Tests ────────────────────────────────────────────────────

beforeEach(() => {
  mockDoc = createMockDocument();
  mockDoc._setup();
  skills = [];
  activeSkills = new Set();
  disabledSkills = new Set();
  hiddenSkillsGlobal = new Set();
  hiddenSkillsSession = new Set();
  activeTabId = 'tab-1';
  tabs.clear();
  tabs.set('tab-1', { sessionId: 'session-abc' });
  _prefs = { namedSessions: {} };
  mockCopilot.skills.list.mockReset();
  mockCopilot.skills.getDisabled.mockReset();
  mockCopilot.skills.setDisabled.mockReset();
  mockCopilot.skills.getHidden.mockReset();
  mockCopilot.skills.setHidden.mockReset();
  mockCopilot.preferences.write.mockResolvedValue({});
});

// ══════════════════════════════════════════════════════════════
// hiddenSkillsGlobal Initialisierung
// ══════════════════════════════════════════════════════════════

describe('hiddenSkillsGlobal Initialisierung', () => {
  test('wird korrekt aus IPC geladen', async () => {
    mockCopilot.skills.list.mockResolvedValue([]);
    mockCopilot.skills.getDisabled.mockResolvedValue([]);
    mockCopilot.skills.getHidden.mockResolvedValue(['skill-a', 'skill-b']);

    await reloadSkills();

    expect(hiddenSkillsGlobal.has('skill-a')).toBe(true);
    expect(hiddenSkillsGlobal.has('skill-b')).toBe(true);
    expect(hiddenSkillsGlobal.size).toBe(2);
  });

  test('leer wenn IPC [] zurückgibt', async () => {
    mockCopilot.skills.list.mockResolvedValue([]);
    mockCopilot.skills.getDisabled.mockResolvedValue([]);
    mockCopilot.skills.getHidden.mockResolvedValue([]);

    await reloadSkills();

    expect(hiddenSkillsGlobal.size).toBe(0);
  });

  test('leer wenn IPC null zurückgibt', async () => {
    mockCopilot.skills.list.mockResolvedValue([]);
    mockCopilot.skills.getDisabled.mockResolvedValue([]);
    mockCopilot.skills.getHidden.mockResolvedValue(null);

    await reloadSkills();

    expect(hiddenSkillsGlobal.size).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// toggleHideGlobal
// ══════════════════════════════════════════════════════════════

describe('toggleHideGlobal', () => {
  beforeEach(() => {
    skills = [
      { id: 's1', name: 'A', icon: '🅰️', description: 'd', dirName: 'skill-a' },
      { id: 's2', name: 'B', icon: '🅱️', description: 'd', dirName: 'skill-b' },
    ];
    mockCopilot.skills.setHidden.mockResolvedValue({ success: true });
  });

  test('fügt Skill zu hiddenSkillsGlobal hinzu', async () => {
    await toggleHideGlobal('skill-a');
    expect(hiddenSkillsGlobal.has('skill-a')).toBe(true);
  });

  test('entfernt Skill aus hiddenSkillsGlobal wenn bereits vorhanden', async () => {
    hiddenSkillsGlobal.add('skill-a');
    await toggleHideGlobal('skill-a');
    expect(hiddenSkillsGlobal.has('skill-a')).toBe(false);
  });

  test('ruft IPC setHidden mit aktuellem Array auf', async () => {
    await toggleHideGlobal('skill-a');
    expect(mockCopilot.skills.setHidden).toHaveBeenCalledWith(['skill-a']);
  });

  test('hidden Skill wird aus Sidebar gefiltert', async () => {
    await toggleHideGlobal('skill-a');
    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).not.toContain('🅰️');
    expect(html).toContain('🅱️');
  });
});

// ══════════════════════════════════════════════════════════════
// toggleHideSession
// ══════════════════════════════════════════════════════════════

describe('toggleHideSession', () => {
  beforeEach(() => {
    skills = [
      { id: 's1', name: 'A', icon: '🅰️', description: 'd', dirName: 'skill-a' },
      { id: 's2', name: 'B', icon: '🅱️', description: 'd', dirName: 'skill-b' },
    ];
    mockCopilot.skills.setHidden.mockResolvedValue({ success: true });
  });

  test('fügt Skill zu hiddenSkillsSession hinzu', async () => {
    await toggleHideSession('skill-a');
    expect(hiddenSkillsSession.has('skill-a')).toBe(true);
  });

  test('entfernt Skill aus hiddenSkillsSession', async () => {
    hiddenSkillsSession.add('skill-a');
    await toggleHideSession('skill-a');
    expect(hiddenSkillsSession.has('skill-a')).toBe(false);
  });

  test('schreibt in preferences namedSessions', async () => {
    await toggleHideSession('skill-a');
    expect(_prefs.namedSessions['session-abc'].hiddenSkills).toEqual(['skill-a']);
  });

  test('erstellt Session-Entry wenn nicht vorhanden', async () => {
    _prefs.namedSessions = {};
    await toggleHideSession('skill-b');
    expect(_prefs.namedSessions['session-abc']).toBeDefined();
    expect(_prefs.namedSessions['session-abc'].hiddenSkills).toEqual(['skill-b']);
  });

  test('session-hidden Skill wird aus Sidebar gefiltert', async () => {
    await toggleHideSession('skill-a');
    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).not.toContain('🅰️');
    expect(html).toContain('🅱️');
  });
});

// ══════════════════════════════════════════════════════════════
// Sidebar filtert ausgeblendete Skills
// ══════════════════════════════════════════════════════════════

describe('renderSkills — Sidebar filtert ausgeblendete Skills', () => {
  beforeEach(() => {
    skills = [
      { id: 's1', name: 'Visible', icon: '✅', description: 'd', dirName: 'visible-skill' },
      { id: 's2', name: 'HiddenG', icon: '🌍', description: 'd', dirName: 'hidden-global' },
      { id: 's3', name: 'HiddenS', icon: '📋', description: 'd', dirName: 'hidden-session' },
      { id: 's4', name: 'NoDir', icon: '❓', description: 'd', dirName: undefined },
    ];
  });

  test('global-hidden Skill wird nicht gerendert', () => {
    hiddenSkillsGlobal.add('hidden-global');
    renderSkills();
    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('Visible');
    expect(html).not.toContain('HiddenG');
    expect(html).toContain('HiddenS');
    expect(html).toContain('NoDir');
  });

  test('session-hidden Skill wird nicht gerendert', () => {
    hiddenSkillsSession.add('hidden-session');
    renderSkills();
    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('Visible');
    expect(html).toContain('HiddenG');
    expect(html).not.toContain('HiddenS');
    expect(html).toContain('NoDir');
  });

  test('beide hidden → beide nicht gerendert', () => {
    hiddenSkillsGlobal.add('hidden-global');
    hiddenSkillsSession.add('hidden-session');
    renderSkills();
    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('Visible');
    expect(html).not.toContain('HiddenG');
    expect(html).not.toContain('HiddenS');
  });

  test('Skill ohne dirName wird immer angezeigt', () => {
    hiddenSkillsGlobal.add('undefined');
    renderSkills();
    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('NoDir');
  });
});
