/**
 * Tests für Tutorial-Flags IPC-Handler und zugehörige Logik (Session).
 *
 * Getestet werden:
 * 1. tutorial:getFlags — liest tutorialSkillsShown / tutorialRenameShown
 * 2. tutorial:setFlag — schreibt einzelnes Tutorial-Flag
 * 3. dev:setOnboardingComplete(false) — löscht Tutorial-Flags
 * 4. dev:setOnboardingComplete(true) — lässt Tutorial-Flags unberührt
 * 5. Todo-Icon Rendering (🗑️)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { readFolderConfig, writeFolderConfig } = require('../src/scanners');
const { escapeHtml, escapeAttr } = require('../src/renderer-logic');

// ═══════════════════════════════════════════════════════════════
// TEIL 1: tutorial:getFlags Logik
// ═══════════════════════════════════════════════════════════════

describe('tutorial:getFlags Logik', () => {
  const tmpDir = path.join(os.tmpdir(), `copilot-tutorial-get-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configPath = path.join(tmpDir, 'folders.json');

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  // Simuliert den IPC-Handler tutorial:getFlags aus main.js:
  // try { const config = readFolderConfig();
  //   return { tutorialSkillsShown: config.tutorialSkillsShown === true,
  //            tutorialRenameShown: config.tutorialRenameShown === true };
  // } catch (_) { return { tutorialSkillsShown: false, tutorialRenameShown: false }; }

  function simulateGetFlags(cfgPath) {
    try {
      const config = readFolderConfig(cfgPath);
      return {
        tutorialSkillsShown: config.tutorialSkillsShown === true,
        tutorialRenameShown: config.tutorialRenameShown === true,
      };
    } catch (_) {
      return { tutorialSkillsShown: false, tutorialRenameShown: false };
    }
  }

  test('gibt default false/false zurück wenn keine Config existiert', () => {
    const result = simulateGetFlags(path.join(tmpDir, 'nonexistent.json'));
    expect(result).toEqual({ tutorialSkillsShown: false, tutorialRenameShown: false });
  });

  test('gibt default false/false zurück wenn Config keine Tutorial-Flags enthält', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ onboardingComplete: true }), 'utf-8');
    const result = simulateGetFlags(configPath);
    expect(result).toEqual({ tutorialSkillsShown: false, tutorialRenameShown: false });
  });

  test('gibt true für tutorialSkillsShown zurück wenn gesetzt', () => {
    writeFolderConfig(configPath, { tutorialSkillsShown: true, tutorialRenameShown: false });
    const result = simulateGetFlags(configPath);
    expect(result.tutorialSkillsShown).toBe(true);
    expect(result.tutorialRenameShown).toBe(false);
  });

  test('gibt true für tutorialRenameShown zurück wenn gesetzt', () => {
    writeFolderConfig(configPath, { tutorialSkillsShown: false, tutorialRenameShown: true });
    const result = simulateGetFlags(configPath);
    expect(result.tutorialSkillsShown).toBe(false);
    expect(result.tutorialRenameShown).toBe(true);
  });

  test('gibt true/true zurück wenn beide gesetzt', () => {
    writeFolderConfig(configPath, { tutorialSkillsShown: true, tutorialRenameShown: true });
    const result = simulateGetFlags(configPath);
    expect(result).toEqual({ tutorialSkillsShown: true, tutorialRenameShown: true });
  });

  test('String "true" wird als false behandelt (strict === true Check)', () => {
    writeFolderConfig(configPath, { tutorialSkillsShown: 'true', tutorialRenameShown: 'true' });
    const result = simulateGetFlags(configPath);
    expect(result).toEqual({ tutorialSkillsShown: false, tutorialRenameShown: false });
  });

  test('kaputte JSON gibt default false/false zurück', () => {
    fs.writeFileSync(configPath, '{broken!!!', 'utf-8');
    const result = simulateGetFlags(configPath);
    expect(result).toEqual({ tutorialSkillsShown: false, tutorialRenameShown: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 2: tutorial:setFlag Logik
// ═══════════════════════════════════════════════════════════════

describe('tutorial:setFlag Logik', () => {
  const tmpDir = path.join(os.tmpdir(), `copilot-tutorial-set-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configPath = path.join(tmpDir, 'folders.json');

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  // Simuliert den IPC-Handler tutorial:setFlag aus main.js (mit Key-Validierung):
  const TUTORIAL_FLAG_KEYS = ['tutorialSkillsShown', 'tutorialRenameShown'];
  function simulateSetFlag(cfgPath, key, value) {
    try {
      if (!TUTORIAL_FLAG_KEYS.includes(key)) {
        return { success: false, error: `Invalid tutorial flag key: ${key}` };
      }
      const config = readFolderConfig(cfgPath);
      config[key] = value === true;
      writeFolderConfig(cfgPath, config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  test('schreibt tutorialSkillsShown: true in Config', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    writeFolderConfig(configPath, { onboardingComplete: true });

    const result = simulateSetFlag(configPath, 'tutorialSkillsShown', true);
    expect(result).toEqual({ success: true });

    const saved = readFolderConfig(configPath);
    expect(saved.tutorialSkillsShown).toBe(true);
    expect(saved.onboardingComplete).toBe(true); // bestehende Werte erhalten
  });

  test('schreibt tutorialRenameShown: true in Config', () => {
    writeFolderConfig(configPath, {});
    simulateSetFlag(configPath, 'tutorialRenameShown', true);

    const saved = readFolderConfig(configPath);
    expect(saved.tutorialRenameShown).toBe(true);
  });

  test('value === true strict: String "true" wird als false geschrieben', () => {
    writeFolderConfig(configPath, {});
    simulateSetFlag(configPath, 'tutorialSkillsShown', 'true');

    const saved = readFolderConfig(configPath);
    expect(saved.tutorialSkillsShown).toBe(false);
  });

  test('value false setzt Flag auf false', () => {
    writeFolderConfig(configPath, { tutorialSkillsShown: true });
    simulateSetFlag(configPath, 'tutorialSkillsShown', false);

    const saved = readFolderConfig(configPath);
    expect(saved.tutorialSkillsShown).toBe(false);
  });

  test('erhält bestehende Config-Werte', () => {
    writeFolderConfig(configPath, { cwd: 'C:\\test', onboardingComplete: true });
    simulateSetFlag(configPath, 'tutorialSkillsShown', true);

    const saved = readFolderConfig(configPath);
    expect(saved.cwd).toBe('C:\\test');
    expect(saved.onboardingComplete).toBe(true);
    expect(saved.tutorialSkillsShown).toBe(true);
  });

  test('lehnt ungültige Keys ab (Key-Validierung)', () => {
    writeFolderConfig(configPath, { cwd: 'C:\\test', onboardingComplete: true });
    const result = simulateSetFlag(configPath, 'cwd', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid tutorial flag key');

    // Config darf nicht verändert sein
    const saved = readFolderConfig(configPath);
    expect(saved.cwd).toBe('C:\\test');
  });

  test('lehnt onboardingComplete als Key ab', () => {
    writeFolderConfig(configPath, { onboardingComplete: true });
    const result = simulateSetFlag(configPath, 'onboardingComplete', false);
    expect(result.success).toBe(false);

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 3: dev:setOnboardingComplete erweitert — Tutorial-Flags löschen
// ═══════════════════════════════════════════════════════════════

describe('dev:setOnboardingComplete — Tutorial-Flag Cleanup', () => {
  const tmpDir = path.join(os.tmpdir(), `copilot-tutorial-reset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configPath = path.join(tmpDir, 'folders.json');

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  // Simuliert den erweiterten dev:setOnboardingComplete Handler:
  // config.onboardingComplete = value === true;
  // if (value === false) { delete config.tutorialSkillsShown; delete config.tutorialRenameShown; }
  function simulateSetOnboardingComplete(cfgPath, value) {
    try {
      const config = readFolderConfig(cfgPath);
      config.onboardingComplete = value === true;
      if (value === false) {
        delete config.tutorialSkillsShown;
        delete config.tutorialRenameShown;
      }
      writeFolderConfig(cfgPath, config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  test('value=false löscht tutorialSkillsShown und tutorialRenameShown', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    writeFolderConfig(configPath, {
      onboardingComplete: true,
      tutorialSkillsShown: true,
      tutorialRenameShown: true,
      cwd: 'C:\\test',
    });

    const result = simulateSetOnboardingComplete(configPath, false);
    expect(result).toEqual({ success: true });

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(false);
    expect(saved).not.toHaveProperty('tutorialSkillsShown');
    expect(saved).not.toHaveProperty('tutorialRenameShown');
    expect(saved.cwd).toBe('C:\\test'); // andere Werte erhalten
  });

  test('value=false funktioniert auch wenn keine Tutorial-Flags existieren', () => {
    writeFolderConfig(configPath, { onboardingComplete: true });
    simulateSetOnboardingComplete(configPath, false);

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(false);
    expect(saved).not.toHaveProperty('tutorialSkillsShown');
    expect(saved).not.toHaveProperty('tutorialRenameShown');
  });

  test('value=true lässt Tutorial-Flags unberührt', () => {
    writeFolderConfig(configPath, {
      onboardingComplete: false,
      tutorialSkillsShown: true,
      tutorialRenameShown: true,
    });

    simulateSetOnboardingComplete(configPath, true);

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(true);
    expect(saved.tutorialSkillsShown).toBe(true);
    expect(saved.tutorialRenameShown).toBe(true);
  });

  test('value=true lässt fehlende Tutorial-Flags unberührt (kein Hinzufügen)', () => {
    writeFolderConfig(configPath, { onboardingComplete: false });
    simulateSetOnboardingComplete(configPath, true);

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(true);
    expect(saved).not.toHaveProperty('tutorialSkillsShown');
    expect(saved).not.toHaveProperty('tutorialRenameShown');
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 4: Todo-Icon Rendering (🗑️)
// ═══════════════════════════════════════════════════════════════

describe('Todo-Item Rendering', () => {
  // Simuliert die Render-Logik aus todos.js (Template-Teil)
  function renderTodoItem(todo) {
    const checked = todo.status === 'done' ? 'checked' : '';
    const doneClass = todo.status === 'done' ? 'todo-item--done' : '';
    return `
      <div class="todo-item ${doneClass}" data-id="${todo.id}" draggable="true">
        <span class="todo-item__grip">⠿</span>
        <label class="todo-item__check">
          <input type="checkbox" ${checked} onchange="toggleTodo('${escapeAttr(todo.id)}')" />
        </label>
        <span class="todo-item__text" data-tooltip="${escapeHtml(todo.text)}">${escapeHtml(todo.text)}</span>
        <button class="todo-item__delete" onclick="deleteTodo('${escapeAttr(todo.id)}')" data-tooltip="Löschen">🗑️</button>
      </div>
    `;
  }

  test('Lösch-Button enthält 🗑️ Icon (nicht ✕)', () => {
    const html = renderTodoItem({ id: 'test-1', text: 'Test Todo', status: 'open' });
    expect(html).toContain('🗑️');
    expect(html).not.toContain('>✕<');
  });

  test('Lösch-Button hat data-tooltip="Löschen"', () => {
    const html = renderTodoItem({ id: 'test-1', text: 'Test Todo', status: 'open' });
    expect(html).toContain('data-tooltip="Löschen"');
  });

  test('offenes Todo hat kein checked und kein done-class', () => {
    const html = renderTodoItem({ id: 'test-1', text: 'Offen', status: 'open' });
    expect(html).not.toContain('todo-item--done');
    expect(html).toContain('type="checkbox"');
    // checkbox sollte nicht checked sein
    expect(html).not.toMatch(/checkbox"\s+checked/);
  });

  test('erledigtes Todo hat checked und done-class', () => {
    const html = renderTodoItem({ id: 'test-2', text: 'Erledigt', status: 'done' });
    expect(html).toContain('todo-item--done');
    expect(html).toContain('checked');
  });

  test('HTML-Escaping in Todo-Text', () => {
    const html = renderTodoItem({ id: 'test-3', text: '<script>alert("xss")</script>', status: 'open' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
