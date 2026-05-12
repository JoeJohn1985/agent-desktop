/**
 * Tests für Onboarding Step 3: Agents & Skills Kategorien (v0.17.2).
 *
 * Getestet werden:
 * 1. setup:getCategories — gibt 6 Kategorien mit id, icon, title, desc zurück
 * 2. setup:createStarterFiles IPC-Handler-Logik
 *    - Erstellt Agent-Dateien korrekt auf dem Dateisystem
 *    - Überschreibt KEINE bestehenden Dateien → skipped[]
 *    - Ungültige Kategorie-ID → in errors[]
 *    - Alle 6 Kategorien haben gültige Templates (Dateiname + Content)
 *    - created[] enthält korrekte Dateinamen
 * 3. Category-Step UI State Machine
 *    - Initial: keine Auswahl → Next enabled (skip erlaubt), kein Action-Button
 *    - 1+ Karte togglen → Action-Button erscheint, Next disabled
 *    - Karte deselektieren → Zustand korrekt
 *    - handleCreateStarterFiles: Spinner → success → Next enabled
 *    - handleCreateStarterFiles: Fehler → Button reaktiviert
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// Extrahierte Daten aus main.js (STARTER_TEMPLATES & getCategories)
// ═══════════════════════════════════════════════════════════════

const STARTER_TEMPLATES = {
  'code-review': {
    agent: {
      filename: 'code-reviewer.agent.md',
      content: `---\nname: code-reviewer\ndescription: Führt Code Reviews durch und findet Bugs, Sicherheitslücken und Verbesserungspotenzial.\n---\n\nDu bist ein erfahrener Code-Reviewer. Analysiere den gegebenen Code auf:\n- Bugs und Logikfehler\n- Sicherheitslücken\n- Performance-Probleme\n- Code-Qualität und Lesbarkeit\n\nGib konkrete, umsetzbare Verbesserungsvorschläge.`
    },
    skill: null
  },
  'testing': {
    agent: {
      filename: 'tester.agent.md',
      content: `---\nname: tester\ndescription: Schreibt Unit-Tests, Integrationstests und hilft bei Test-Strategien.\n---\n\nDu bist ein Test-Experte. Schreibe vollständige, aussagekräftige Tests.\nNutze das Test-Framework das im Projekt verwendet wird.\nTeste Edge Cases, Error Paths und Happy Paths.`
    },
    skill: null
  },
  'planning': {
    agent: {
      filename: 'planner.agent.md',
      content: `---\nname: planner\ndescription: Erstellt strukturierte Pläne, Aufgabenlisten und Roadmaps.\n---\n\nDu bist ein strukturierter Planer. Zerlege Anforderungen in klare, umsetzbare Aufgaben.\nErstelle Pläne mit klaren Schritten, Abhängigkeiten und Prioritäten.`
    },
    skill: null
  },
  'documentation': {
    agent: {
      filename: 'documenter.agent.md',
      content: `---\nname: documenter\ndescription: Erstellt und verbessert Dokumentation, READMEs und API-Docs.\n---\n\nDu bist ein Dokumentations-Experte. Schreibe klare, vollständige Dokumentation.\nPasse den Stil an die Zielgruppe an (Entwickler, Endnutzer, API-Nutzer).`
    },
    skill: null
  },
  'security': {
    agent: {
      filename: 'security-auditor.agent.md',
      content: `---\nname: security-auditor\ndescription: Findet Sicherheitslücken, OWASP-Risiken und unsichere Patterns.\n---\n\nDu bist ein Security-Experte. Analysiere Code auf:\n- OWASP Top 10 Risiken\n- Injection-Angriffe (SQL, XSS, Command)\n- Authentifizierungs- und Autorisierungsprobleme\n- Unsichere Abhängigkeiten und Konfigurationen`
    },
    skill: null
  },
  'performance': {
    agent: {
      filename: 'performance-analyzer.agent.md',
      content: `---\nname: performance-analyzer\ndescription: Analysiert Performance-Probleme und schlägt Optimierungen vor.\n---\n\nDu bist ein Performance-Experte. Identifiziere:\n- N+1 Queries und ineffiziente DB-Zugriffe\n- Unnötige Re-Renders und Memory Leaks\n- Algorithmen mit schlechter Komplexität\n- Caching-Möglichkeiten`
    },
    skill: null
  }
};

const CATEGORIES = [
  { id: 'code-review', icon: '🔍', title: 'Code Review', desc: 'Analysiert Code und findet Probleme' },
  { id: 'testing', icon: '🧪', title: 'Testen', desc: 'Schreibt Unit- und Integrationstests' },
  { id: 'planning', icon: '📋', title: 'Planung', desc: 'Erstellt Pläne und Aufgabenlisten' },
  { id: 'documentation', icon: '📝', title: 'Dokumentation', desc: 'Schreibt Doku und README-Dateien' },
  { id: 'security', icon: '🔒', title: 'Security', desc: 'Findet Sicherheitslücken' },
  { id: 'performance', icon: '⚡', title: 'Performance', desc: 'Analysiert und optimiert Code' },
];

// ═══════════════════════════════════════════════════════════════
// Extrahierte Logik aus main.js setup:getCategories Handler
// ═══════════════════════════════════════════════════════════════

function getCategories() {
  return CATEGORIES;
}

// ═══════════════════════════════════════════════════════════════
// Extrahierte Logik aus main.js setup:createStarterFiles Handler
// ═══════════════════════════════════════════════════════════════

/**
 * Erstellt Starter-Agent-Dateien für die gewählten Kategorien.
 * @param {string[]} categories - Array von Kategorie-IDs
 * @param {string} agentsDir - Zielverzeichnis für Agent-Dateien
 * @returns {{ success: boolean, created: string[], skipped: string[], errors: string[] }}
 */
function createStarterFiles(categories, agentsDir) {
  const created = [];
  const skipped = [];
  const errors = [];

  for (const catId of categories) {
    const template = STARTER_TEMPLATES[catId];
    if (!template) {
      errors.push(`Unbekannte Kategorie: ${catId}`);
      continue;
    }

    if (template.agent) {
      const filePath = path.join(agentsDir, template.agent.filename);
      if (fs.existsSync(filePath)) {
        skipped.push(template.agent.filename);
      } else {
        try {
          if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
          fs.writeFileSync(filePath, template.agent.content, 'utf-8');
          created.push(template.agent.filename);
        } catch (e) {
          errors.push(`${template.agent.filename}: ${e.message}`);
        }
      }
    }
  }

  return { success: errors.length === 0, created, skipped, errors };
}

// ═══════════════════════════════════════════════════════════════
// TEIL 1: setup:getCategories Logik
// ═══════════════════════════════════════════════════════════════

describe('setup:getCategories Logik', () => {
  test('gibt genau 6 Kategorien zurück', () => {
    const cats = getCategories();
    expect(cats).toHaveLength(6);
  });

  test('jede Kategorie hat id, icon, title, desc', () => {
    const cats = getCategories();
    for (const cat of cats) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('icon');
      expect(cat).toHaveProperty('title');
      expect(cat).toHaveProperty('desc');
    }
  });

  test('alle IDs sind unique', () => {
    const cats = getCategories();
    const ids = cats.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('IDs sind: code-review, testing, planning, documentation, security, performance', () => {
    const cats = getCategories();
    const ids = cats.map(c => c.id).sort();
    expect(ids).toEqual(['code-review', 'documentation', 'performance', 'planning', 'security', 'testing']);
  });

  test('alle IDs haben ein passendes Template in STARTER_TEMPLATES', () => {
    const cats = getCategories();
    for (const cat of cats) {
      expect(STARTER_TEMPLATES).toHaveProperty(cat.id);
    }
  });

  test('kein Feld ist leer oder undefined', () => {
    const cats = getCategories();
    for (const cat of cats) {
      expect(cat.id).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.title).toBeTruthy();
      expect(cat.desc).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 2: STARTER_TEMPLATES Konsistenz
// ═══════════════════════════════════════════════════════════════

describe('STARTER_TEMPLATES Konsistenz', () => {
  test('hat genau 6 Einträge', () => {
    expect(Object.keys(STARTER_TEMPLATES)).toHaveLength(6);
  });

  test('jedes Template hat einen agent mit filename und content', () => {
    for (const [catId, tmpl] of Object.entries(STARTER_TEMPLATES)) {
      expect(tmpl.agent).toBeDefined();
      expect(tmpl.agent.filename).toBeTruthy();
      expect(tmpl.agent.content).toBeTruthy();
      // Dateiname endet auf .agent.md
      expect(tmpl.agent.filename).toMatch(/\.agent\.md$/);
    }
  });

  test('agent.content beginnt mit YAML Frontmatter (---)', () => {
    for (const [catId, tmpl] of Object.entries(STARTER_TEMPLATES)) {
      expect(tmpl.agent.content.startsWith('---\n')).toBe(true);
    }
  });

  test('agent.content enthält name und description im Frontmatter', () => {
    for (const [catId, tmpl] of Object.entries(STARTER_TEMPLATES)) {
      expect(tmpl.agent.content).toMatch(/name:\s*.+/);
      expect(tmpl.agent.content).toMatch(/description:\s*.+/);
    }
  });

  test('alle Dateinamen sind unique', () => {
    const filenames = Object.values(STARTER_TEMPLATES).map(t => t.agent.filename);
    expect(new Set(filenames).size).toBe(filenames.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 3: setup:createStarterFiles Logik
// ═══════════════════════════════════════════════════════════════

describe('setup:createStarterFiles Logik', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `copilot-test-cats-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  test('erstellt Agent-Dateien korrekt auf dem Dateisystem', () => {
    const result = createStarterFiles(['code-review', 'testing'], tmpDir);
    expect(result.success).toBe(true);
    expect(result.created).toHaveLength(2);
    expect(result.created).toContain('code-reviewer.agent.md');
    expect(result.created).toContain('tester.agent.md');

    // Dateien existieren wirklich
    expect(fs.existsSync(path.join(tmpDir, 'code-reviewer.agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'tester.agent.md'))).toBe(true);
  });

  test('erstellte Dateien haben korrekten Inhalt', () => {
    createStarterFiles(['code-review'], tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'code-reviewer.agent.md'), 'utf-8');
    expect(content).toBe(STARTER_TEMPLATES['code-review'].agent.content);
    expect(content.startsWith('---\n')).toBe(true);
  });

  test('überschreibt KEINE bestehenden Dateien → skipped[]', () => {
    // Erstelle Datei vorab mit eigenem Inhalt
    const existingContent = '# Mein eigener Code-Reviewer';
    fs.writeFileSync(path.join(tmpDir, 'code-reviewer.agent.md'), existingContent, 'utf-8');

    const result = createStarterFiles(['code-review', 'testing'], tmpDir);
    expect(result.success).toBe(true);
    expect(result.skipped).toContain('code-reviewer.agent.md');
    expect(result.created).toContain('tester.agent.md');
    expect(result.created).not.toContain('code-reviewer.agent.md');

    // Inhalt unverändert
    const content = fs.readFileSync(path.join(tmpDir, 'code-reviewer.agent.md'), 'utf-8');
    expect(content).toBe(existingContent);
  });

  test('ungültige Kategorie-ID → in errors[]', () => {
    const result = createStarterFiles(['nonexistent-category'], tmpDir);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Unbekannte Kategorie.*nonexistent-category/);
    expect(result.created).toEqual([]);
  });

  test('Mischung: gültige + ungültige Kategorie', () => {
    const result = createStarterFiles(['testing', 'invalid-cat'], tmpDir);
    expect(result.success).toBe(false);
    expect(result.created).toContain('tester.agent.md');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/invalid-cat/);
  });

  test('alle 6 Kategorien erstellen → 6 Dateien', () => {
    const allCats = Object.keys(STARTER_TEMPLATES);
    const result = createStarterFiles(allCats, tmpDir);
    expect(result.success).toBe(true);
    expect(result.created).toHaveLength(6);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);

    // Alle Dateien existieren
    for (const tmpl of Object.values(STARTER_TEMPLATES)) {
      expect(fs.existsSync(path.join(tmpDir, tmpl.agent.filename))).toBe(true);
    }
  });

  test('created[] enthält korrekte Dateinamen für jede Kategorie', () => {
    const result = createStarterFiles(['planning', 'security', 'performance'], tmpDir);
    expect(result.created).toContain('planner.agent.md');
    expect(result.created).toContain('security-auditor.agent.md');
    expect(result.created).toContain('performance-analyzer.agent.md');
  });

  test('leeres Kategorien-Array → nichts erstellt, success: true', () => {
    const result = createStarterFiles([], tmpDir);
    expect(result.success).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('wenn alles existiert → alles in skipped[], nichts in created[]', () => {
    // Erst alle erstellen
    createStarterFiles(Object.keys(STARTER_TEMPLATES), tmpDir);
    // Nochmal aufrufen
    const result = createStarterFiles(Object.keys(STARTER_TEMPLATES), tmpDir);
    expect(result.success).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(6);
  });

  test('erstellt agentsDir automatisch wenn nicht vorhanden', () => {
    const nestedDir = path.join(tmpDir, 'deep', 'nested', 'agents');
    expect(fs.existsSync(nestedDir)).toBe(false);

    const result = createStarterFiles(['testing'], nestedDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(path.join(nestedDir, 'tester.agent.md'))).toBe(true);
  });

  test('doppelte Kategorie in Array → Datei wird erstellt, dann geskippt', () => {
    const result = createStarterFiles(['testing', 'testing'], tmpDir);
    expect(result.success).toBe(true);
    expect(result.created).toContain('tester.agent.md');
    expect(result.skipped).toContain('tester.agent.md');
    // Nur einmal erstellt + einmal geskippt
    expect(result.created.filter(f => f === 'tester.agent.md')).toHaveLength(1);
    expect(result.skipped.filter(f => f === 'tester.agent.md')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 4: Category-Step UI State Machine
// ═══════════════════════════════════════════════════════════════

/**
 * State Machine für den Category-Step im Onboarding.
 * Extrahierte Logik aus renderCategoryCards() / updateCategoryActionButton()
 * / handleCreateStarterFiles() in renderer/app.js.
 */
class CategoryStepStateMachine {
  constructor() {
    this.state = 'idle';
    this.selected = new Set();
    this.btnNextEnabled = false;
    this.actionBtnVisible = false;
    this.actionBtnDisabled = false;
    this.actionBtnText = '✨ Auswahl einrichten';
    this.spinnerVisible = false;
    this.cardsDisabled = false;
    this.statusMessage = null;
    this.errorMessage = null;
    this.categories = [];
  }

  /** Kategorien geladen: Karten anzeigen, Next freigeben (skip erlaubt) */
  categoriesLoaded(categories) {
    this.state = 'loaded';
    this.categories = categories;
    this.selected = new Set();
    this.btnNextEnabled = true; // skip ohne Auswahl erlaubt
    this.actionBtnVisible = false;
    this.cardsDisabled = false;
    this.errorMessage = null;
  }

  /** Laden fehlgeschlagen */
  loadError(errorMsg) {
    this.state = 'load-error';
    this.errorMessage = errorMsg;
    this.btnNextEnabled = true; // skip erlaubt auch bei Fehler
    this.actionBtnVisible = false;
    this.cardsDisabled = false;
  }

  /** Karte togglen */
  toggleCard(catId) {
    if (this.cardsDisabled) return;

    if (this.selected.has(catId)) {
      this.selected.delete(catId);
    } else {
      this.selected.add(catId);
    }

    if (this.selected.size > 0) {
      this.btnNextEnabled = false;
      this.actionBtnVisible = true;
    } else {
      this.btnNextEnabled = true;
      this.actionBtnVisible = false;
    }
  }

  /** "Auswahl einrichten" geklickt: Spinner anzeigen */
  startCreate() {
    this.state = 'creating';
    this.actionBtnDisabled = true;
    this.actionBtnText = 'Richte ein…';
    this.spinnerVisible = true;
  }

  /** Create erfolgreich */
  createSuccess(result) {
    this.state = 'done';
    this.actionBtnVisible = false;
    this.spinnerVisible = false;
    this.cardsDisabled = true;
    this.btnNextEnabled = true;

    let msg = `✅ ${result.created.length} Agent(s) angelegt.`;
    if (result.skipped.length > 0) msg += ` ${result.skipped.length} übersprungen (existiert bereits).`;
    if (result.errors.length > 0) msg += ` ⚠️ ${result.errors.length} Fehler.`;
    this.statusMessage = msg;
  }

  /** Create fehlgeschlagen */
  createError(errorMsg) {
    this.state = 'error';
    this.actionBtnDisabled = false;
    this.actionBtnText = '✨ Auswahl einrichten';
    this.spinnerVisible = false;
    this.errorMessage = errorMsg;
  }
}

describe('Category-Step UI State Machine', () => {
  let sm;

  beforeEach(() => {
    sm = new CategoryStepStateMachine();
  });

  // ── Initial & Laden ──

  test('initial: idle State', () => {
    expect(sm.state).toBe('idle');
    expect(sm.btnNextEnabled).toBe(false);
    expect(sm.actionBtnVisible).toBe(false);
    expect(sm.selected.size).toBe(0);
  });

  test('categoriesLoaded: Next enabled (skip erlaubt), kein Action-Button', () => {
    sm.categoriesLoaded(CATEGORIES);

    expect(sm.state).toBe('loaded');
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);
    expect(sm.categories).toHaveLength(6);
    expect(sm.cardsDisabled).toBe(false);
  });

  test('loadError: Fehler angezeigt, Next enabled (skip)', () => {
    sm.loadError('IPC-Fehler');

    expect(sm.state).toBe('load-error');
    expect(sm.errorMessage).toBe('IPC-Fehler');
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);
  });

  // ── Karten-Toggle ──

  test('1 Karte selektieren → Action-Button erscheint, Next disabled', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');

    expect(sm.selected.has('testing')).toBe(true);
    expect(sm.selected.size).toBe(1);
    expect(sm.actionBtnVisible).toBe(true);
    expect(sm.btnNextEnabled).toBe(false);
  });

  test('mehrere Karten selektieren → alle in selected, Action-Button bleibt', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.toggleCard('security');
    sm.toggleCard('planning');

    expect(sm.selected.size).toBe(3);
    expect(sm.actionBtnVisible).toBe(true);
    expect(sm.btnNextEnabled).toBe(false);
  });

  test('Karte deselektieren → aus selected entfernt', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.toggleCard('security');

    expect(sm.selected.size).toBe(2);

    sm.toggleCard('testing'); // deselect
    expect(sm.selected.has('testing')).toBe(false);
    expect(sm.selected.size).toBe(1);
    expect(sm.actionBtnVisible).toBe(true);
  });

  test('letzte Karte deselektieren → Action-Button weg, Next enabled', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.toggleCard('testing'); // deselect

    expect(sm.selected.size).toBe(0);
    expect(sm.actionBtnVisible).toBe(false);
    expect(sm.btnNextEnabled).toBe(true);
  });

  test('toggle auf disabled Cards wird ignoriert', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.startCreate();
    sm.createSuccess({ created: ['tester.agent.md'], skipped: [], errors: [] });

    expect(sm.cardsDisabled).toBe(true);

    sm.toggleCard('security'); // sollte ignoriert werden
    expect(sm.selected.has('security')).toBe(false);
  });

  // ── Spinner während createStarterFiles ──

  test('startCreate: Spinner sichtbar, Action-Button disabled', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.startCreate();

    expect(sm.state).toBe('creating');
    expect(sm.spinnerVisible).toBe(true);
    expect(sm.actionBtnDisabled).toBe(true);
    expect(sm.actionBtnText).toBe('Richte ein…');
  });

  // ── Nach createStarterFiles: Erfolg ──

  test('createSuccess: Next enabled, Action-Button weg, Karten disabled', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.toggleCard('code-review');
    sm.startCreate();

    sm.createSuccess({ created: ['tester.agent.md', 'code-reviewer.agent.md'], skipped: [], errors: [] });

    expect(sm.state).toBe('done');
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);
    expect(sm.spinnerVisible).toBe(false);
    expect(sm.cardsDisabled).toBe(true);
    expect(sm.statusMessage).toMatch(/2 Agent\(s\) angelegt/);
  });

  test('createSuccess mit skipped: Status-Nachricht enthält "übersprungen"', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.startCreate();

    sm.createSuccess({ created: [], skipped: ['tester.agent.md'], errors: [] });

    expect(sm.statusMessage).toMatch(/übersprungen/);
    expect(sm.statusMessage).toMatch(/1 übersprungen/);
  });

  test('createSuccess mit errors: Status-Nachricht enthält "Fehler"', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.startCreate();

    sm.createSuccess({ created: [], skipped: [], errors: ['tester.agent.md: Permission denied'] });

    expect(sm.statusMessage).toMatch(/1 Fehler/);
  });

  // ── Nach createStarterFiles: Fehler ──

  test('createError: Button reaktiviert, Fehler angezeigt', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.startCreate();

    sm.createError('Network error');

    expect(sm.state).toBe('error');
    expect(sm.actionBtnDisabled).toBe(false);
    expect(sm.actionBtnText).toBe('✨ Auswahl einrichten');
    expect(sm.spinnerVisible).toBe(false);
    expect(sm.errorMessage).toBe('Network error');
  });

  // ── Komplette Flows ──

  test('Komplett-Durchlauf: laden → auswählen → create → fertig', () => {
    // 1. Kategorien laden
    sm.categoriesLoaded(CATEGORIES);
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);

    // 2. Karten auswählen
    sm.toggleCard('testing');
    sm.toggleCard('security');
    expect(sm.btnNextEnabled).toBe(false);
    expect(sm.actionBtnVisible).toBe(true);

    // 3. Create starten
    sm.startCreate();
    expect(sm.spinnerVisible).toBe(true);
    expect(sm.actionBtnDisabled).toBe(true);

    // 4. Create erfolgreich
    sm.createSuccess({ created: ['tester.agent.md', 'security-auditor.agent.md'], skipped: [], errors: [] });
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);
    expect(sm.cardsDisabled).toBe(true);
    expect(sm.spinnerVisible).toBe(false);
  });

  test('Komplett-Durchlauf: laden → auswählen → Fehler → Retry → Erfolg', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('planning');

    // 1. Erster Versuch → Fehler
    sm.startCreate();
    sm.createError('Disk full');
    expect(sm.actionBtnDisabled).toBe(false);
    expect(sm.errorMessage).toBe('Disk full');

    // 2. Retry → Erfolg
    sm.startCreate();
    expect(sm.spinnerVisible).toBe(true);
    sm.createSuccess({ created: ['planner.agent.md'], skipped: [], errors: [] });
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.cardsDisabled).toBe(true);
  });

  test('Skip-Pfad: laden → keine Auswahl → Next direkt', () => {
    sm.categoriesLoaded(CATEGORIES);
    // Nutzer klickt direkt "Weiter" ohne Auswahl
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);
    expect(sm.selected.size).toBe(0);
  });

  test('Auswahl → Deselect alle → wieder Skip-fähig', () => {
    sm.categoriesLoaded(CATEGORIES);
    sm.toggleCard('testing');
    sm.toggleCard('security');
    expect(sm.btnNextEnabled).toBe(false);

    // Alles deselektieren
    sm.toggleCard('testing');
    sm.toggleCard('security');
    expect(sm.btnNextEnabled).toBe(true);
    expect(sm.actionBtnVisible).toBe(false);
  });

  test('alle 6 Karten auswählen → alle in selected', () => {
    sm.categoriesLoaded(CATEGORIES);
    for (const cat of CATEGORIES) {
      sm.toggleCard(cat.id);
    }
    expect(sm.selected.size).toBe(6);
    expect(sm.actionBtnVisible).toBe(true);
    expect(sm.btnNextEnabled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 5: Integration getCategories + createStarterFiles
// ═══════════════════════════════════════════════════════════════

describe('setup: Integration getCategories + createStarterFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `copilot-test-catint-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  test('alle Kategorie-IDs von getCategories sind in createStarterFiles nutzbar', () => {
    const cats = getCategories();
    const allIds = cats.map(c => c.id);
    const result = createStarterFiles(allIds, tmpDir);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(6);
  });

  test('erstellte Dateien haben Markdown-Frontmatter mit name + description', () => {
    const cats = getCategories();
    createStarterFiles(cats.map(c => c.id), tmpDir);

    for (const tmpl of Object.values(STARTER_TEMPLATES)) {
      const filePath = path.join(tmpDir, tmpl.agent.filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/name:\s*.+/);
      expect(content).toMatch(/description:\s*.+/);
    }
  });
});
