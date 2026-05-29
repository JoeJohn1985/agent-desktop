/**
 * Renderer-seitige Tests für Skills-Deaktivieren-Feature:
 * - reloadSkills(): Lädt Skills + disabledSkills vom Main-Prozess
 * - toggleSkillDisabled(): Toggle add/remove auf disabledSkills-Set + IPC
 * - renderSkills(): Rendert CLI-Toggle-Button korrekt
 *
 * Strategie: Da renderer/app.js ein Browser-Script ohne module.exports ist,
 * extrahieren wir die zu testenden Funktionen und ihre Abhängigkeiten
 * in den Test-Scope (wie plugin-ui.test.js).
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
      // Simple: return element by aria-label match
      if (sel.includes('Skills neu laden')) return elements['reloadBtn'] || null;
      return null;
    },
    _setup() {
      elements['skillList'] = new MockElement('div', 'skillList');
      elements['reloadBtn'] = new MockElement('button', 'reloadBtn');
    },
  };
}

// ── Mock copilot IPC bridge ──────────────────────────────────

const mockCopilot = {
  skills: {
    list: jest.fn(),
    getDisabled: jest.fn(),
    setDisabled: jest.fn(),
  },
};

// ── Extracted state + functions from renderer/app.js ─────────

let skills = [];
let activeSkills = new Set();
let disabledSkills = new Set();

function getSettings() {
  return { activeSkills: [...activeSkills] };
}

function renderSkills() {
  const container = mockDoc.getElementById('skillList');
  if (!container) return;
  container.innerHTML = skills.map(s => {
    const isActive = activeSkills.has(s.id);
    const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
    const cliToggleBtn = s.dirName
      ? `<button class="skill-card__cli-toggle ${isCLIDisabled ? 'skill-card__cli-toggle--enable' : 'skill-card__cli-toggle--disable'}"
               onclick="event.stopPropagation(); toggleSkillDisabled('${escapeAttr(s.dirName)}')"
               data-tooltip="${isCLIDisabled ? 'Skill in Copilot CLI aktivieren' : 'Skill in Copilot CLI deaktivieren'}"
               aria-label="${isCLIDisabled ? 'In CLI aktivieren' : 'In CLI deaktivieren'}">
         ${isCLIDisabled ? '✓' : '⊘'}
       </button>`
      : '';
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''} ${isCLIDisabled ? 'skill-card--cli-disabled' : ''}"
           onclick="toggleSkill('${escapeAttr(s.id)}')" data-tooltip="${escapeAttr(s.description)}">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}</div>
        </div>
        ${cliToggleBtn}
        <div class="skill-card__toggle"></div>
      </div>
    `;
  }).join('');
}

async function toggleSkillDisabled(dirName) {
  if (disabledSkills.has(dirName)) disabledSkills.delete(dirName);
  else disabledSkills.add(dirName);
  await mockCopilot.skills.setDisabled([...disabledSkills]);
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
  mockCopilot.skills.list.mockReset();
  mockCopilot.skills.getDisabled.mockReset();
  mockCopilot.skills.setDisabled.mockReset();
});

// ══════════════════════════════════════════════════════════════
// reloadSkills
// ══════════════════════════════════════════════════════════════

describe('reloadSkills', () => {
  test('lädt Skills und disabledSkills vom IPC und setzt State', async () => {
    mockCopilot.skills.list.mockResolvedValue([
      { id: 'skill-1', name: 'Test Skill', icon: '🛠️', description: 'desc', dirName: 'test-skill' },
    ]);
    mockCopilot.skills.getDisabled.mockResolvedValue(['test-skill']);

    await reloadSkills();

    expect(skills).toHaveLength(1);
    expect(disabledSkills.has('test-skill')).toBe(true);
  });

  test('disabledSkills ist leer wenn IPC [] zurückgibt', async () => {
    mockCopilot.skills.list.mockResolvedValue([
      { id: 'skill-1', name: 'Test', icon: '🛠️', description: '', dirName: 'x' },
    ]);
    mockCopilot.skills.getDisabled.mockResolvedValue([]);

    await reloadSkills();

    expect(disabledSkills.size).toBe(0);
  });

  test('ruft renderSkills nach erfolgreichem Laden auf', async () => {
    mockCopilot.skills.list.mockResolvedValue([
      { id: 's1', name: 'S1', icon: '✨', description: 'test', dirName: 'dir-s1' },
    ]);
    mockCopilot.skills.getDisabled.mockResolvedValue(['dir-s1']);

    await reloadSkills();

    const container = mockDoc.getElementById('skillList');
    expect(container.innerHTML).toContain('skill-card');
    expect(container.innerHTML).toContain('skill-card--cli-disabled');
  });

  test('zeigt Spinner während Laden und entfernt ihn danach', async () => {
    mockCopilot.skills.list.mockResolvedValue([]);
    mockCopilot.skills.getDisabled.mockResolvedValue([]);

    const btn = mockDoc._elements['reloadBtn'];
    await reloadSkills();

    // After completion, spinner should be removed
    expect(btn.classList.contains('sidebar__reload-btn--spinning')).toBe(false);
  });

  test('bei IPC-Fehler wird State nicht korrumpiert', async () => {
    disabledSkills = new Set(['existing']);
    mockCopilot.skills.list.mockRejectedValue(new Error('IPC fail'));

    await reloadSkills();

    // Skills are unchanged because error was caught before assignment
    // The function assigns skills first, but list() threw, so catch fires
    // disabledSkills stays from before (not cleared)
    expect(disabledSkills.has('existing')).toBe(true);
  });

  test('skills = null von IPC → leeres Array', async () => {
    mockCopilot.skills.list.mockResolvedValue(null);
    mockCopilot.skills.getDisabled.mockResolvedValue([]);

    await reloadSkills();

    expect(skills).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// toggleSkillDisabled
// ══════════════════════════════════════════════════════════════

describe('toggleSkillDisabled', () => {
  beforeEach(() => {
    skills = [
      { id: 's1', name: 'Skill A', icon: '🅰️', description: 'A', dirName: 'skill-a' },
      { id: 's2', name: 'Skill B', icon: '🅱️', description: 'B', dirName: 'skill-b' },
    ];
    mockCopilot.skills.setDisabled.mockResolvedValue({ success: true });
  });

  test('fügt Skill zu disabledSkills hinzu wenn nicht vorhanden', async () => {
    expect(disabledSkills.has('skill-a')).toBe(false);

    await toggleSkillDisabled('skill-a');

    expect(disabledSkills.has('skill-a')).toBe(true);
  });

  test('entfernt Skill aus disabledSkills wenn bereits vorhanden', async () => {
    disabledSkills.add('skill-a');

    await toggleSkillDisabled('skill-a');

    expect(disabledSkills.has('skill-a')).toBe(false);
  });

  test('ruft IPC setDisabled mit aktuellem Array auf', async () => {
    disabledSkills.add('skill-b');

    await toggleSkillDisabled('skill-a');

    // Both skill-a and skill-b should be in the array
    const callArg = mockCopilot.skills.setDisabled.mock.calls[0][0];
    expect(callArg).toContain('skill-a');
    expect(callArg).toContain('skill-b');
    expect(callArg).toHaveLength(2);
  });

  test('nach Toggle wird renderSkills aufgerufen (HTML aktualisiert)', async () => {
    await toggleSkillDisabled('skill-a');

    const container = mockDoc.getElementById('skillList');
    expect(container.innerHTML).toContain('skill-card__cli-toggle--enable');
    expect(container.innerHTML).toContain('skill-a');
  });

  test('doppeltes Toggle → Skill wieder enabled', async () => {
    await toggleSkillDisabled('skill-a');
    expect(disabledSkills.has('skill-a')).toBe(true);

    await toggleSkillDisabled('skill-a');
    expect(disabledSkills.has('skill-a')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// renderSkills — CLI-Toggle-Button
// ══════════════════════════════════════════════════════════════

describe('renderSkills — CLI-Toggle-Button', () => {
  test('rendert cli-toggle--disable Button wenn Skill enabled ist und dirName vorhanden', () => {
    skills = [{ id: 's1', name: 'Test', icon: '🔧', description: 'desc', dirName: 'my-skill' }];
    disabledSkills = new Set(); // not disabled

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('skill-card__cli-toggle--disable');
    expect(html).not.toContain('skill-card__cli-toggle--enable');
    expect(html).toContain('⊘');
  });

  test('rendert cli-toggle--enable Button wenn Skill disabled ist', () => {
    skills = [{ id: 's1', name: 'Test', icon: '🔧', description: 'desc', dirName: 'my-skill' }];
    disabledSkills = new Set(['my-skill']);

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('skill-card__cli-toggle--enable');
    expect(html).toContain('✓');
    expect(html).toContain('skill-card--cli-disabled');
  });

  test('kein CLI-Toggle-Button wenn dirName undefined', () => {
    skills = [{ id: 's1', name: 'No Dir', icon: '❌', description: 'desc', dirName: undefined }];

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).not.toContain('skill-card__cli-toggle');
    expect(html).not.toContain('toggleSkillDisabled');
  });

  test('kein CLI-Toggle-Button wenn dirName leer/null', () => {
    skills = [
      { id: 's1', name: 'Null', icon: '❌', description: 'd', dirName: null },
      { id: 's2', name: 'Empty', icon: '❌', description: 'd', dirName: '' },
    ];

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).not.toContain('skill-card__cli-toggle');
  });

  test('tooltip zeigt korrekten Text je nach State', () => {
    skills = [
      { id: 's1', name: 'A', icon: '🅰️', description: 'd', dirName: 'a-dir' },
      { id: 's2', name: 'B', icon: '🅱️', description: 'd', dirName: 'b-dir' },
    ];
    disabledSkills = new Set(['a-dir']);

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    expect(html).toContain('Skill in Copilot CLI aktivieren');
    expect(html).toContain('Skill in Copilot CLI deaktivieren');
  });

  test('mehrere Skills — nur disabled Skills erhalten --cli-disabled Klasse', () => {
    skills = [
      { id: 's1', name: 'A', icon: '🅰️', description: 'd', dirName: 'a-dir' },
      { id: 's2', name: 'B', icon: '🅱️', description: 'd', dirName: 'b-dir' },
      { id: 's3', name: 'C', icon: '🅲', description: 'd', dirName: 'c-dir' },
    ];
    disabledSkills = new Set(['b-dir']);

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    // Count occurrences of cli-disabled class on cards
    const cliDisabledMatches = html.match(/skill-card--cli-disabled/g);
    expect(cliDisabledMatches).toHaveLength(1);
  });

  test('escapeAttr wird auf dirName angewendet (XSS-Schutz)', () => {
    skills = [{ id: 's1', name: 'XSS', icon: '⚠️', description: 'd', dirName: 'dir"onclick="alert(1)' }];

    renderSkills();

    const html = mockDoc.getElementById('skillList').innerHTML;
    // The dangerous characters should be escaped
    expect(html).not.toContain('dir"onclick="alert(1)');
    expect(html).toContain('&quot;');
  });
});
