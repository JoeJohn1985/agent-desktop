/**
 * Unit Tests für Sidebar Section Visibility
 * Testet das Conditional Rendering von Skills, Agents und MCP-Server Sections
 * - Sections werden versteckt wenn leer
 * - Sections werden angezeigt wenn Items vorhanden sind
 */

const { escapeHtml, escapeAttr } = require('../src/renderer-logic');

// ── Minimal DOM Mock ─────────────────────────────────────────

class MockElement {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.innerHTML = '';
    this.style = { display: '' };
    this.className = '';
    this.textContent = '';
    this.classList = {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    };
  }
  closest(sel) {
    if (sel === '.sidebar__section' && this.id.startsWith('skillList')) {
      return mockDoc._elements['skillsSection'];
    }
    if (sel === '.sidebar__section' && this.id.startsWith('agentList')) {
      return mockDoc._elements['agentsSection'];
    }
    if (sel === '.sidebar__section' && this.id.startsWith('mcpList')) {
      return mockDoc._elements['mcpSection'];
    }
    return null;
  }
}

let mockDoc;
function createMockDocument() {
  const elements = {};
  return {
    _elements: elements,
    getElementById(id) { return elements[id] || null; },
    _setup() {
      elements['skillList'] = new MockElement('div', 'skillList');
      elements['skillsSection'] = new MockElement('div', 'skillsSection');
      elements['agentList'] = new MockElement('div', 'agentList');
      elements['agentsSection'] = new MockElement('div', 'agentsSection');
      elements['mcpList'] = new MockElement('div', 'mcpList');
      elements['mcpSection'] = new MockElement('div', 'mcpSection');
    },
  };
}

// ── Test State ───────────────────────────────────────────────

let skills = [];
let agents = [];
let mcpServers = [];
let hiddenSkillsGlobal = new Set();
let hiddenSkillsSession = new Set();
let disabledSkills = new Set();
let activeSkills = new Set();
let activeAgents = new Set();

function resetState() {
  skills = [];
  agents = [];
  mcpServers = [];
  hiddenSkillsGlobal = new Set();
  hiddenSkillsSession = new Set();
  disabledSkills = new Set();
  activeSkills = new Set();
  activeAgents = new Set();
}

// ── Render Functions (copy from app.js) ───────────────────────
// No count-badge handling here anymore — the sidebar section badges were
// removed in favor of per-section ⋮ menus (see openSectionMenu in app.js).

function renderSkills() {
  const container = mockDoc.getElementById('skillList');
  const section = container.closest('.sidebar__section');
  const visibleSkills = skills.filter(s => {
    if (!s.dirName) return true;
    return !hiddenSkillsGlobal.has(s.dirName) && !hiddenSkillsSession.has(s.dirName) && !disabledSkills.has(s.dirName);
  });

  if (visibleSkills.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = visibleSkills.map(s => {
    const isActive = activeSkills.has(s.id);
    const isCLIDisabled = s.dirName && disabledSkills.has(s.dirName);
    const isProject = s.source === 'project';
    return `
      <div class="skill-card ${isActive ? 'skill-card--active' : ''} ${isCLIDisabled ? 'skill-card--cli-disabled' : ''} ${isProject ? 'skill-card--project' : ''}"
           onclick="toggleSkill('${escapeAttr(s.id)}')" data-tooltip="${escapeAttr(s.description)}">
        <span class="skill-card__icon">${s.icon}</span>
        <div class="skill-card__info">
          <div class="skill-card__name">${escapeHtml(s.name)}</div>
        </div>
        <div class="skill-card__toggle"></div>
      </div>
    `;
  }).join('');
}

function renderAgents() {
  const container = mockDoc.getElementById('agentList');
  const section = container.closest('.sidebar__section');

  if (agents.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = agents.map(a => {
    const isActive = activeAgents.has(a.id);
    const isProject = a.source === 'project';
    return `
      <div class="agent-card ${isActive ? 'agent-card--active' : ''} ${isProject ? 'agent-card--project' : ''}"
           onclick="toggleAgent('${escapeAttr(a.id)}')" data-tooltip="${escapeAttr(a.description)}">
        <span class="agent-card__icon">${a.icon}</span>
        <div class="agent-card__info">
          <div class="agent-card__name">${escapeHtml(a.name)}</div>
        </div>
        <div class="agent-card__toggle"></div>
      </div>
    `;
  }).join('');
}

function renderMcpServers() {
  const container = mockDoc.getElementById('mcpList');
  if (!container) return;
  const section = container.closest('.sidebar__section');

  if (mcpServers.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = 'block';
  container.innerHTML = mcpServers.map(s => {
    const isConnected = s.status === 'connected';
    const statusIcon = isConnected ? '🟢' : '🔴';
    const statusLabel = isConnected ? 'verbunden' : 'getrennt';
    const cardClass = isConnected ? 'mcp-card--connected' : 'mcp-card--disconnected';
    return `
      <div class="mcp-card ${cardClass}" data-tooltip="${escapeAttr(s.name)}">
        <span class="mcp-card__status">${statusIcon}</span>
        <div class="mcp-card__info">
          <div class="mcp-card__name">${escapeHtml(s.name)}</div>
        </div>
        <span class="mcp-card__label">${statusLabel}</span>
      </div>
    `;
  }).join('');
}

// ── Tests ────────────────────────────────────────────────────

describe('Sidebar Sections Visibility', () => {
  beforeEach(() => {
    mockDoc = createMockDocument();
    mockDoc._setup();
    resetState();
  });

  describe('renderSkills — Section Visibility', () => {
    test('versteckt skills-section wenn keine Skills vorhanden sind', () => {
      skills = [];
      const section = mockDoc.getElementById('skillsSection');
      renderSkills();
      expect(section.style.display).toBe('none');
    });

    test('zeigt skills-section wenn Skills vorhanden sind', () => {
      skills = [
        { id: 'skill1', name: 'Test Skill', dirName: 'test-skill', description: 'A test skill', icon: '🧪', source: 'user' },
      ];
      const section = mockDoc.getElementById('skillsSection');
      section.style.display = 'none'; // Reset
      renderSkills();
      expect(section.style.display).toBe('block');
    });

    test('versteckt skills-section wenn alle Skills ausgeblendet sind', () => {
      skills = [
        { id: 'skill1', name: 'Test Skill', dirName: 'test-skill', description: 'A test skill', icon: '🧪', source: 'user' },
      ];
      hiddenSkillsGlobal.add('test-skill');
      const section = mockDoc.getElementById('skillsSection');
      section.style.display = 'block'; // Reset
      renderSkills();
      expect(section.style.display).toBe('none');
    });

    test('zeigt skills-section wenn nur manche Skills ausgeblendet sind', () => {
      skills = [
        { id: 'skill1', name: 'Test Skill 1', dirName: 'test-skill-1', description: 'A test skill', icon: '🧪', source: 'user' },
        { id: 'skill2', name: 'Test Skill 2', dirName: 'test-skill-2', description: 'Another skill', icon: '🧪', source: 'user' },
      ];
      hiddenSkillsGlobal.add('test-skill-1');
      const section = mockDoc.getElementById('skillsSection');
      section.style.display = 'none'; // Reset
      renderSkills();
      expect(section.style.display).toBe('block');
    });
  });

  describe('renderAgents — Section Visibility', () => {
    test('versteckt agents-section wenn keine Agents vorhanden sind', () => {
      agents = [];
      const section = mockDoc.getElementById('agentsSection');
      renderAgents();
      expect(section.style.display).toBe('none');
    });

    test('zeigt agents-section wenn Agents vorhanden sind', () => {
      agents = [
        { id: 'agent1', name: 'Test Agent', description: 'A test agent', icon: '🤖', source: 'user', fileSlug: 'test-agent' },
      ];
      const section = mockDoc.getElementById('agentsSection');
      section.style.display = 'none'; // Reset
      renderAgents();
      expect(section.style.display).toBe('block');
    });
  });

  describe('renderMcpServers — Section Visibility', () => {
    test('versteckt mcp-section wenn keine Server vorhanden sind', () => {
      mcpServers = [];
      const section = mockDoc.getElementById('mcpSection');
      renderMcpServers();
      expect(section.style.display).toBe('none');
    });

    test('zeigt mcp-section wenn Server vorhanden sind', () => {
      mcpServers = [
        { id: 'mcp1', name: 'Test MCP', status: 'connected' },
      ];
      const section = mockDoc.getElementById('mcpSection');
      section.style.display = 'none'; // Reset
      renderMcpServers();
      expect(section.style.display).toBe('block');
    });
  });

  describe('State Transitions', () => {
    test('zeigt skills-section wenn Skills nach leer hinzugefügt werden', () => {
      skills = [];
      const section = mockDoc.getElementById('skillsSection');
      renderSkills();
      expect(section.style.display).toBe('none');

      // Add skill
      skills = [
        { id: 'skill1', name: 'New Skill', dirName: 'new-skill', description: 'A new skill', icon: '🧪', source: 'user' },
      ];
      renderSkills();
      expect(section.style.display).toBe('block');
    });

    test('versteckt agents-section wenn Agents gelöscht werden', () => {
      agents = [
        { id: 'agent1', name: 'Test Agent', description: 'A test agent', icon: '🤖', source: 'user', fileSlug: 'test-agent' },
      ];
      const section = mockDoc.getElementById('agentsSection');
      renderAgents();
      expect(section.style.display).toBe('block');

      // Remove agent
      agents = [];
      renderAgents();
      expect(section.style.display).toBe('none');
    });

    test('versteckt mcp-section wenn alle Server entfernt werden', () => {
      mcpServers = [
        { id: 'mcp1', name: 'Test MCP', status: 'connected' },
      ];
      const section = mockDoc.getElementById('mcpSection');
      renderMcpServers();
      expect(section.style.display).toBe('block');

      // Remove server
      mcpServers = [];
      renderMcpServers();
      expect(section.style.display).toBe('none');
    });
  });
});
