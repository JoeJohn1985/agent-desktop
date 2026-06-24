'use strict';

// Tests for the multi-provider foundation: tool runtime pure helpers, the
// Anthropic tool-schema converter, and the provider registry / model→provider
// resolution. (No network or Electron — pure logic only.)

const {
  isShellCommandDenied,
  stripShellWrapper,
  globToRegExp,
  getToolDefs,
  TOOL_DEFS,
} = require('../src/providers/agent-tools');
const { toAnthropicTools } = require('../src/providers/anthropic-provider');
const { getModelProvider, createApiBackend } = require('../src/providers');
const { MODEL_PRICING, estimateCredits } = require('../src/renderer-logic');

describe('agent-tools: deny matching', () => {
  it('stripShellWrapper entfernt shell(...)', () => {
    expect(stripShellWrapper('shell(git push)')).toBe('git push');
    expect(stripShellWrapper('git push')).toBe('git push');
  });

  it('blockiert exakten und Präfix-Befehl', () => {
    const denied = ['shell(git push)'];
    expect(isShellCommandDenied('git push', denied)).toBe(true);
    expect(isShellCommandDenied('git push origin main', denied)).toBe(true);
  });

  it('erlaubt nicht gelistete Befehle', () => {
    expect(isShellCommandDenied('git status', ['shell(git push)'])).toBe(false);
    expect(isShellCommandDenied('ls', [])).toBe(false);
  });
});

describe('agent-tools: glob → RegExp', () => {
  it('** matcht über Verzeichnisgrenzen', () => {
    const re = globToRegExp('src/**/*.js');
    expect(re.test('src/a/b/c.js')).toBe(true);
    expect(re.test('src/x.js')).toBe(true);
    expect(re.test('src/x.ts')).toBe(false);
  });

  it('* matcht nicht über /', () => {
    const re = globToRegExp('*.md');
    expect(re.test('README.md')).toBe(true);
    expect(re.test('docs/README.md')).toBe(false);
  });
});

describe('agent-tools: Tool-Defs', () => {
  it('enthält die erwarteten Tools', () => {
    const names = getToolDefs().map(t => t.name);
    expect(names).toEqual(['shell', 'read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep']);
  });
});

describe('anthropic: Tool-Schema-Konvertierung', () => {
  it('mappt name/description/input_schema', () => {
    const tools = toAnthropicTools(TOOL_DEFS);
    expect(tools).toHaveLength(TOOL_DEFS.length);
    const shell = tools.find(t => t.name === 'shell');
    expect(shell.description).toContain('shell command');
    expect(shell.input_schema).toEqual(TOOL_DEFS[0].parameters);
    // Anthropic uses input_schema, not parameters
    expect(shell.parameters).toBeUndefined();
  });
});

describe('provider registry', () => {
  it('löst API-Modelle auf anthropic auf', () => {
    expect(getModelProvider('claude-opus-4-8')).toBe('anthropic');
    expect(getModelProvider('claude-sonnet-4-6')).toBe('anthropic');
  });

  it('Copilot-Modelle und Unbekanntes → copilot', () => {
    expect(getModelProvider('claude-opus-4.8')).toBe('copilot');
    expect(getModelProvider('gpt-5.3-codex')).toBe('copilot');
    expect(getModelProvider('irgendwas')).toBe('copilot');
  });

  it('createApiBackend liefert für copilot/unknown null', () => {
    expect(createApiBackend('copilot', 1, () => {}, {})).toBeNull();
    expect(createApiBackend('gemini', 1, () => {}, {})).toBeNull();
  });

  it('createApiBackend baut ein Anthropic-Backend', () => {
    const b = createApiBackend('anthropic', 1, () => {}, { model: 'claude-opus-4-8', apiKey: 'x' });
    expect(b).not.toBeNull();
    expect(b.state).toBe('dead');
    expect(b.tabId).toBe(1);
  });
});

describe('Kontext-Management (ApiAgentClient)', () => {
  function backend(model = 'claude-opus-4-8') {
    return createApiBackend('anthropic', 1, () => {}, { model, apiKey: 'x' });
  }

  it('_contextWindow je Modell', () => {
    expect(backend('claude-opus-4-8')._contextWindow()).toBe(1_000_000);
    expect(backend('claude-haiku-4-5')._contextWindow()).toBe(200_000);
  });

  it('/context liefert Prozent im erwarteten Format', async () => {
    const b = backend('claude-opus-4-8');
    b._lastContextTokens = 100_000; // 10% von 1M
    const text = await b.silentCommand('/context');
    expect(text).toMatch(/\(10%\)/);            // vom Renderer-Parser gelesen
    expect(text).toContain('Tokens');
  });

  it('/context ohne Verbrauch → 0%', async () => {
    const text = await backend().silentCommand('/context');
    expect(text).toMatch(/\(0%\)/);
  });

  it('/usage liefert die Token-Zeile inkl. cachewrite', async () => {
    const b = backend();
    b._tokens = { input: 1200, output: 50, cache: 0, cacheWrite: 300 };
    const text = await b.silentCommand('/usage');
    expect(text).toBe('Tokens: input 1200, output 50, cached 0, cachewrite 300');
  });
});

describe('System-Context-Komposition', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { composeSystemContext } = require('../src/providers/system-context');

  let cwd;
  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sysctx-'));
    fs.mkdirSync(path.join(cwd, '.github', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.github', 'skills', 'pdf'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.github', 'copilot-instructions.md'), 'Antworte immer auf Deutsch.');
    fs.writeFileSync(path.join(cwd, '.github', 'agents', 'planner.agent.md'), 'Du bist ein Planer.');
    fs.writeFileSync(path.join(cwd, '.github', 'skills', 'pdf', 'SKILL.md'), 'PDF-Skill Inhalt.');
  });

  it('bündelt Instructions, Agents und Skills aus dem Projekt', () => {
    const out = composeSystemContext({ cwd, activeAgents: ['planner'], activeSkills: ['pdf'] });
    expect(out).toContain('Projekt-Instructions');
    expect(out).toContain('Antworte immer auf Deutsch.');
    expect(out).toContain('Agent: planner');
    expect(out).toContain('Du bist ein Planer.');
    expect(out).toContain('Skill: pdf');
    expect(out).toContain('PDF-Skill Inhalt.');
  });

  it('leerer String wenn nichts aktiv und keine Instructions', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sysctx-empty-'));
    expect(composeSystemContext({ cwd: empty })).toBe('');
  });

  it('ignoriert nicht vorhandene Skills/Agents', () => {
    const out = composeSystemContext({ cwd, activeSkills: ['gibtsnicht'] });
    expect(out).not.toContain('Skill: gibtsnicht');
  });
});

describe('Session-Persistenz (ApiAgentClient)', () => {
  it('_restoreHistory/_serializeHistory sind ein Round-Trip', () => {
    const b = createApiBackend('anthropic', 1, () => {}, { model: 'claude-opus-4-8', apiKey: 'x' });
    const hist = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hallo' }] },
    ];
    b._restoreHistory(hist);
    expect(b._serializeHistory()).toEqual(hist);
  });

  it('newSession meldet die Session-ID an den Renderer (result-Event)', async () => {
    const events = [];
    const b = createApiBackend('anthropic', 1, (channel, tabId, evt) => events.push({ channel, evt }), { model: 'claude-opus-4-8', apiKey: 'x' });
    await b.newSession('/tmp');
    const result = events.find(e => e.evt && e.evt.type === 'result');
    expect(result).toBeTruthy();
    expect(result.evt.sessionId).toMatch(/^api-/);
    expect(b.sessionId).toBe(result.evt.sessionId);
  });
});

describe('API-Modell-Pricing', () => {
  it('hat USD-Preise für Anthropic-API-Modelle', () => {
    expect(MODEL_PRICING['claude-opus-4-8']).toEqual({ input: 5, cache: 0.5, output: 25 });
    expect(MODEL_PRICING['claude-haiku-4-5']).toEqual({ input: 1, cache: 0.1, output: 5 });
  });

  it('estimateCredits rechnet mit API-Preisen (USD)', () => {
    // 1M input @ $5 + 1M output @ $25 = $30
    const v = estimateCredits({ input: 1_000_000, output: 1_000_000, cache: 0 }, 'claude-opus-4-8');
    expect(v).toBe(30);
  });
});
