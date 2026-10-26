'use strict';

const path = require('path');
const vm = require('vm');
jest.mock('fs', () => ({
  existsSync: jest.fn(), readFileSync: jest.fn(), writeFileSync: jest.fn(),
  copyFileSync: jest.fn(), mkdirSync: jest.fn(),
}));
const fs = require('fs');
const { createPreferencesManager } = require('../src/preferences');
const source = jest.requireActual('fs').readFileSync(path.join(__dirname, '..', 'renderer', 'modules', 'provider-settings.js'), 'utf8');

beforeEach(() => jest.clearAllMocks());

function settingsPanel(modern = false) {
  const settings = {};
  const controls = new Map();
  for (const selector of ['enabled', 'percent', 'error', ...(modern ? ['threshold-label', 'model', 'price', 'warning', 'reset'] : [])]) {
    const listeners = {};
    controls.set(`[data-auto-compaction-${selector}]`, {
      value: '50', checked: true, textContent: '',
      setAttribute: jest.fn(), removeAttribute: jest.fn(),
      addEventListener: (event, callback) => { listeners[event] = callback; },
      hasAttribute: name => name === 'data-auto-compaction-reset' && selector === 'reset',
      change: () => listeners.change({ currentTarget: controls.get(`[data-auto-compaction-${selector}]`) }),
      click: () => listeners.click({ currentTarget: controls.get(`[data-auto-compaction-${selector}]`) }),
    });
  }
  const panel = { querySelector: selector => controls.get(selector) };
  const write = jest.fn(async () => true);
  const prefs = { settings };
  const context = vm.createContext({
    getSettings: () => settings, saveSetting: (key, value) => { settings[key] = value; },
    escapeAttr: value => value, desktop: { preferences: { write } },
    escapeHtml: value => value,
    showNotification: jest.fn(), _prefs: prefs,
    window: { AutoCompactionPolicy: require('../src/auto-compaction-policy') },
  });
  vm.runInContext(source, context);
  if (modern) {
    controls.get('[data-auto-compaction-model]').value = 'gpt-6.1-sol';
    controls.get('[data-auto-compaction-percent]').value = '240000';
    vm.runInContext('_autoCompactionPrices = { copilot: { gpt61sol: { input: 1, longContext: { input: 2, threshold: 272000 } } } }', context);
  }
  context.wireAutoCompaction('copilot', panel);
  return { context, settings, prefs, write,
    enabled: controls.get('[data-auto-compaction-enabled]'),
    percent: controls.get('[data-auto-compaction-percent]'),
    controls,
    error: controls.get('[data-auto-compaction-error]') };
}

test('sichtbare Tokenregel über Preisgrenze bleibt erlaubt und warnt', async () => {
  const h = settingsPanel(true);
  h.percent.value = '400000';
  await h.percent.change();
  expect(h.settings.autoCompaction.copilot.models['gpt-6.1-sol']).toEqual({ mode: 'tokens', thresholdTokens: 400000 });
  expect(h.controls.get('[data-auto-compaction-warning]').textContent).toContain('Kosten können steigen');
  expect(h.context.showNotification).toHaveBeenCalledWith(expect.stringContaining('Kosten können steigen'), 'warning');
  expect(h.settings.autoCompaction.copilot.modelDefaults).toBe(true);
});

test('Aktivierung speichert keinen Default als Override; Reset bewahrt andere Legacy-Regeln', async () => {
  const h = settingsPanel(true);
  await h.enabled.change();
  expect(h.settings.autoCompaction.copilot.models).toEqual({});
  h.settings.autoCompaction.copilot = { enabled: true, thresholdPercent: 73 };
  await h.controls.get('[data-auto-compaction-reset]').click();
  expect(h.settings.autoCompaction.copilot.thresholdPercent).toBe(73);
  expect(h.settings.autoCompaction.copilot.modelDefaults).toBeUndefined();
  expect(h.settings.autoCompaction.copilot.models['gpt-6.1-sol']).toEqual({ mode: 'auto' });
  expect(h.percent.value).toBe('240000');
});

test('offizieller einheitlicher Tarif zeigt keine Preis-unbekannt-Warnung; fehlender Eintrag schon', async () => {
  const h = settingsPanel(true);
  vm.runInContext('_autoCompactionPrices = { copilot: { gpt61sol: { input: 1 } }, sources: { copilot: { updatedAt: 123 } } }', h.context);
  await h.controls.get('[data-auto-compaction-model]').change();
  const price = h.controls.get('[data-auto-compaction-price]');
  expect(h.percent.value).toBe('50');
  expect(price.textContent).toContain('einheitlicher Tarif');
  expect(price.textContent).toContain('Preisstand:');
  expect(price.textContent).not.toContain('Preis unbekannt');
  h.controls.get('[data-auto-compaction-model]').value = 'unmatched';
  await h.controls.get('[data-auto-compaction-model]').change();
  expect(price.textContent).toContain('Preis unbekannt');
});

test('Modellwechsel zeigt gespeicherte Einzelregel, Legacy und Default ohne Schreibzugriff', async () => {
  const h = settingsPanel(true);
  h.settings.autoCompaction = { copilot: { enabled: true, thresholdPercent: 71,
    models: { 'gpt-6.1-sol': { mode: 'tokens', thresholdTokens: 280000 } } } };
  await h.controls.get('[data-auto-compaction-model]').change();
  expect(h.percent.value).toBe('280000');
  h.controls.get('[data-auto-compaction-model]').value = 'other';
  await h.controls.get('[data-auto-compaction-model]').change();
  expect(h.percent.value).toBe('71');
  expect(h.controls.get('[data-auto-compaction-threshold-label]').textContent).toBe('Komprimieren ab (% Kontextauslastung)');
  expect(h.write).not.toHaveBeenCalled();
});

test('alle Provider-Panels zeigen bestätigte Defaults und gültigen Bereich', () => {
  const h = settingsPanel();
  for (const provider of ['copilot', 'claude-code', 'claude-code-ssh', 'anthropic', 'gemini', 'openai', 'glm', 'ollama']) {
    const html = h.context.buildAutoCompactionHtml(provider);
    expect(html).toContain('value="50"');
    expect(html).toContain('min="1" max="95" step="1"');
    expect(html).toContain('data-auto-compaction-enabled checked');
  }
});

test('Formular kapselt Felder statt die horizontale Simple-Group-Regel auszulösen', () => {
  const h = settingsPanel();
  for (const provider of ['copilot', 'claude-code', 'anthropic', 'gemini', 'openai', 'glm', 'ollama']) {
    const html = h.context.buildAutoCompactionHtml(provider);
    expect(html).toContain('settings__group settings__auto-compaction');
    for (const field of ['enabled', 'threshold', ...(provider === 'copilot' ? ['model'] : [])]) {
      expect(html).toContain(`for="settAutoCompaction-${provider}-${field}"`);
      expect(html).toContain(`id="settAutoCompaction-${provider}-${field}"`);
    }
    expect(html).toMatch(/settings__auto-compaction-field">\s*<label[^>]+>[^<]+<\/label>\s*<input/);
    expect(html).toContain('<strong>Kostengrenzen:</strong>');
  }
  const html = h.context.buildAutoCompactionHtml('copilot');
  expect(html).toContain('Die angezeigte Regel gilt für das ausgewählte Modell');
  expect(html).toContain('<strong>Kontextfenster:</strong>');
  expect(html).not.toMatch(/data-auto-compaction-mode[\s>]/);
  expect(html).not.toContain('data-auto-compaction-unit');
  expect(html).toContain('class="action-btn" data-auto-compaction-reset');
  const css = jest.requireActual('fs').readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  expect(css).toMatch(/\.settings__auto-compaction \.settings__input\s*\{[^}]*width: 16ch;[^}]*max-width: 100%;[^}]*box-sizing: border-box;/);
  expect(css).toMatch(/\.settings__auto-compaction \.settings__select\s*\{[^}]*width: 100%;[^}]*min-width: 0;/);
});

test.each(['', '0', '96', '50.5', 'kein Wert'])('weist Eingabe "%s" sichtbar ab ohne Persistenz', async value => {
  const h = settingsPanel();
  h.percent.value = value;
  await h.percent.change();
  expect(h.write).not.toHaveBeenCalled();
  expect(h.settings.autoCompaction).toBeUndefined();
  expect(h.error.textContent).toContain('1 bis 95');
  expect(h.percent.setAttribute).toHaveBeenCalledWith('aria-invalid', 'true');
});

test('persistiert Aktivierung und Prozent je Provider und bewahrt andere Einstellungen', async () => {
  const h = settingsPanel();
  h.settings.autoCompaction = { openai: { enabled: true, thresholdPercent: 75 } };
  h.settings.unrelated = 'bewahren';
  h.enabled.checked = false;
  h.percent.value = '30';
  await h.enabled.change();
  expect(h.write).toHaveBeenCalledWith(h.prefs);
  expect(h.settings.autoCompaction.copilot).toEqual({ enabled: false, thresholdPercent: 30 });
  expect(h.settings.autoCompaction.openai).toEqual({ enabled: true, thresholdPercent: 75 });
  expect(h.settings.unrelated).toBe('bewahren');
});

test('Speicherfehler ist sichtbar und setzt Policy zurück statt Erfolg zu behaupten', async () => {
  const h = settingsPanel();
  const previous = { copilot: { enabled: true, thresholdPercent: 70 } };
  h.settings.autoCompaction = previous;
  h.write.mockResolvedValue(false);
  await h.percent.change();
  expect(h.settings.autoCompaction).toBe(previous);
  expect(h.error.textContent).toContain('nicht gespeichert');
  expect(h.context.showNotification).toHaveBeenCalledWith(expect.stringContaining('nicht gespeichert'), 'error');
});

test('Preferences validieren vor jeder Dateiveränderung und bleiben nach Neustart erhalten', () => {
  const files = new Map();
  fs.existsSync.mockImplementation(file => files.has(file));
  fs.writeFileSync.mockImplementation((file, content) => files.set(file, content));
  fs.readFileSync.mockImplementation(file => files.get(file));
  fs.copyFileSync.mockImplementation((file, copy) => files.set(copy, files.get(file)));
  const prefsPath = path.join(__dirname, 'virtual-preferences.json');
  const manager = createPreferencesManager(prefsPath);
  const settings = { autoCompaction: { copilot: { enabled: false, thresholdPercent: 55 } }, existing: true };
  expect(manager.write({ settings })).toBe(true);
  const before = files.get(prefsPath);
  fs.writeFileSync.mockClear();
  expect(() => manager.write({ settings: { autoCompaction: { copilot: { enabled: true, thresholdPercent: 100 } } } })).toThrow(/1 bis 95/);
  expect(fs.writeFileSync).not.toHaveBeenCalled();
  expect(files.get(prefsPath)).toBe(before);
  expect(createPreferencesManager(prefsPath).read().settings).toEqual(settings);
});
