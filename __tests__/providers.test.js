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
    expect(createApiBackend('quatsch', 1, () => {}, {})).toBeNull();
  });

  it('createApiBackend baut ein Anthropic-Backend', () => {
    const b = createApiBackend('anthropic', 1, () => {}, { model: 'claude-opus-4-8', apiKey: 'x' });
    expect(b).not.toBeNull();
    expect(b.state).toBe('dead');
    expect(b.tabId).toBe(1);
  });
});

describe('OpenAI-kompatible Provider (OpenAI / Ollama / GLM)', () => {
  const { toOpenAITools, consumeSSEStream } = require('../src/providers/openai-compatible-provider');
  const { getToolDefs } = require('../src/providers/agent-tools');

  it('löst die Modelle auf ihre Provider auf', () => {
    expect(getModelProvider('gpt-5.1')).toBe('openai');
    expect(getModelProvider('glm-4.6')).toBe('glm');
    expect(getModelProvider('llama3.1')).toBe('ollama');
  });

  it('baut die jeweiligen Backends', () => {
    expect(createApiBackend('openai', 1, () => {}, { model: 'gpt-5.1', apiKey: 'x' }).constructor.name).toBe('OpenAIProvider');
    expect(createApiBackend('glm', 1, () => {}, { model: 'glm-4.6', apiKey: 'x' }).constructor.name).toBe('GlmProvider');
    expect(createApiBackend('ollama', 1, () => {}, { model: 'llama3.1' }).constructor.name).toBe('OllamaProvider');
  });

  it('Ollama ist keyless, OpenAI/GLM brauchen einen Key', () => {
    expect(() => createApiBackend('ollama', 1, () => {}, { model: 'llama3.1' })._ensureClient()).not.toThrow();
    expect(() => createApiBackend('openai', 1, () => {}, { model: 'gpt-5.1' })._ensureClient()).toThrow();
  });

  it('Kontextfenster je Modell', () => {
    expect(createApiBackend('openai', 1, () => {}, { model: 'gpt-4.1' })._contextWindow()).toBe(1_047_576);
    expect(createApiBackend('ollama', 1, () => {}, { model: 'llama3.1' })._contextWindow()).toBe(32_768);
  });

  it('toOpenAITools mappt name/description/parameters', () => {
    const tools = toOpenAITools(getToolDefs().filter(d => d.name === 'write_file'));
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('write_file');
    expect(tools[0].function.parameters).toBeDefined();
  });

  it('consumeSSEStream sammelt Text, Tool-Calls und Usage', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hallo "}}]}',
      'data: {"choices":[{"delta":{"content":"Welt"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"x.txt\\"}"}}]}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":2}}}',
      'data: [DONE]',
    ].join('\n') + '\n';
    async function* body() { yield new TextEncoder().encode(lines); }
    const texts = [];
    const out = await consumeSSEStream(body(), (s) => texts.push(s));
    expect(texts.join('')).toBe('Hallo Welt');
    expect(out.content).toBe('Hallo Welt');
    expect(out.toolCalls[0]).toEqual({ id: 'c1', name: 'read_file', args: '{"path":"x.txt"}' });
    expect(out.usage.prompt_tokens).toBe(10);
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

describe('buildAgentsIndex / buildSkillsIndex', () => {
  const { buildAgentsIndex, buildSkillsIndex } = require('../src/providers/system-context');

  it('buildAgentsIndex: [] / undefined ergibt leeren String', () => {
    expect(buildAgentsIndex([])).toBe('');
    expect(buildAgentsIndex(undefined)).toBe('');
  });

  it('buildAgentsIndex: listet Name, Beschreibung und Dateipfad, ohne Volltext', () => {
    const out = buildAgentsIndex([{ name: 'planner', description: 'Plant Aufgaben', file: 'C:\\agents\\planner.agent.md' }]);
    expect(out).toContain('Verfügbare Agenten');
    expect(out).toContain('planner');
    expect(out).toContain('Plant Aufgaben');
    expect(out).toContain('C:\\agents\\planner.agent.md');
  });

  it('buildAgentsIndex: fehlende description bekommt Platzhalter', () => {
    const out = buildAgentsIndex([{ name: 'x', file: 'f.agent.md' }]);
    expect(out).toContain('(keine Beschreibung)');
  });

  it('buildSkillsIndex: [] / undefined ergibt leeren String', () => {
    expect(buildSkillsIndex([])).toBe('');
    expect(buildSkillsIndex(undefined)).toBe('');
  });

  it('buildSkillsIndex: listet Name, Beschreibung und Dateipfad, ohne Volltext', () => {
    const out = buildSkillsIndex([{ name: 'pdf', description: 'PDF-Verarbeitung', file: 'C:\\skills\\pdf\\SKILL.md' }]);
    expect(out).toContain('Verfügbare Skills');
    expect(out).toContain('pdf');
    expect(out).toContain('PDF-Verarbeitung');
    expect(out).toContain('C:\\skills\\pdf\\SKILL.md');
  });

  it('buildSkillsIndex: fehlende description bekommt Platzhalter', () => {
    const out = buildSkillsIndex([{ name: 'x', file: 'f/SKILL.md' }]);
    expect(out).toContain('(keine Beschreibung)');
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

  it('bündelt Instructions sowie einen Agents- und Skills-Index (Lazy, kein Volltext)', () => {
    const agentFile = path.join(cwd, '.github', 'agents', 'planner.agent.md');
    const skillFile = path.join(cwd, '.github', 'skills', 'pdf', 'SKILL.md');
    const out = composeSystemContext({
      cwd,
      agents: [{ name: 'planner', description: 'Plant Aufgaben', file: agentFile }],
      skills: [{ name: 'pdf', description: 'PDF-Verarbeitung', file: skillFile }],
    });
    expect(out).toContain('Projekt-Instructions');
    expect(out).toContain('Antworte immer auf Deutsch.');
    expect(out).toContain('Verfügbare Agenten');
    expect(out).toContain('planner');
    expect(out).toContain('Plant Aufgaben');
    expect(out).toContain(agentFile);
    expect(out).toContain('Verfügbare Skills');
    expect(out).toContain('pdf');
    expect(out).toContain('PDF-Verarbeitung');
    expect(out).toContain(skillFile);
    // Lazy indexes only — no eager inlining of the agent's/skill's file content.
    expect(out).not.toContain('Du bist ein Planer.');
    expect(out).not.toContain('PDF-Skill Inhalt.');
  });

  it('leerer String wenn nichts aktiv und keine Instructions', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sysctx-empty-'));
    expect(composeSystemContext({ cwd: empty })).toBe('');
  });

  it('ignoriert leere Skills-Liste', () => {
    const out = composeSystemContext({ cwd, skills: [] });
    expect(out).not.toContain('Verfügbare Skills');
  });

  it('ignoriert leere Agents-Liste', () => {
    const out = composeSystemContext({ cwd, agents: [] });
    expect(out).not.toContain('Verfügbare Agenten');
  });

  it('bettet Instructions-Sets vollständig ein (eager, kein Lazy-Index, kein Toggle)', () => {
    const out = composeSystemContext({
      cwd,
      instructions: [{ name: 'Tonfall', content: 'Sei kurz und direkt.' }],
    });
    expect(out).toContain('Provider-Instructions');
    expect(out).toContain('Tonfall');
    expect(out).toContain('Sei kurz und direkt.');
  });

  it('bettet mehrere Instructions-Sets ein', () => {
    const out = composeSystemContext({
      cwd,
      instructions: [
        { name: 'A', content: 'Inhalt A.' },
        { name: 'B', content: 'Inhalt B.' },
      ],
    });
    expect(out).toContain('Inhalt A.');
    expect(out).toContain('Inhalt B.');
  });

  it('kombiniert die globale Instructions-Basisdatei additiv mit den Provider-Instructions-Sets', () => {
    const out = composeSystemContext({
      cwd,
      instructions: [{ name: 'Tonfall', content: 'Sei kurz und direkt.' }],
    });
    // Beide Layer sind vorhanden: globale Basis-Instructions.md UND die Provider-Sets.
    expect(out).toContain('Antworte immer auf Deutsch.');
    expect(out).toContain('Sei kurz und direkt.');
    // Basis-Layer steht vor den Provider-Instructions-Sets.
    expect(out.indexOf('Antworte immer auf Deutsch.')).toBeLessThan(out.indexOf('Sei kurz und direkt.'));
  });

  it('ignoriert leere/undefinierte Instructions-Liste', () => {
    const out = composeSystemContext({ cwd, instructions: [] });
    expect(out).not.toContain('Provider-Instructions');
    const out2 = composeSystemContext({ cwd });
    expect(out2).not.toContain('Provider-Instructions');
  });

  it('filtert Instructions-Einträge ohne Inhalt heraus', () => {
    const out = composeSystemContext({
      cwd,
      instructions: [{ name: 'Leer', content: '' }, { name: 'Voll', content: 'x' }],
    });
    expect(out).not.toContain('Leer');
    expect(out).toContain('Voll');
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

  it('_persistedExtras liefert standardmäßig ein leeres Objekt (Basisklasse)', () => {
    const b = createApiBackend('anthropic', 1, () => {}, { model: 'claude-opus-4-8', apiKey: 'x' });
    expect(b._persistedExtras()).toEqual({});
  });
});

describe('Gemini-Provider', () => {
  const { toGeminiTools, toGeminiSchema, buildSystemPrompt } = require('../src/providers/gemini-provider');
  const { getToolDefs } = require('../src/providers/agent-tools');

  it('löst Gemini-Modelle auf und baut ein Gemini-Backend', () => {
    expect(getModelProvider('gemini-2.5-pro')).toBe('gemini');
    expect(getModelProvider('gemini-2.5-flash')).toBe('gemini');
    const b = createApiBackend('gemini', 1, () => {}, { model: 'gemini-2.5-pro', apiKey: 'x' });
    expect(b).not.toBeNull();
    expect(b.constructor.name).toBe('GeminiProvider');
    expect(b._contextWindow()).toBe(1_048_576);
  });

  it('konvertiert JSON-Schema-Typen in Geminis Uppercase-Enum', () => {
    const s = toGeminiSchema({ type: 'object', properties: { x: { type: 'string', description: 'd' } }, required: ['x'] });
    expect(s.type).toBe('OBJECT');
    expect(s.properties.x.type).toBe('STRING');
    expect(s.required).toEqual(['x']);
  });

  it('verpackt Tools als functionDeclarations', () => {
    const tools = toGeminiTools(getToolDefs().filter(d => d.name === 'write_file'));
    expect(tools).toHaveLength(1);
    expect(tools[0].functionDeclarations[0].name).toBe('write_file');
    expect(tools[0].functionDeclarations[0].parameters.type).toBe('OBJECT');
  });

  it('hat USD-Preise für Gemini-Modelle', () => {
    expect(MODEL_PRICING['gemini-2.5-pro']).toEqual({ input: 1.25, cache: 0.31, output: 10 });
    expect(MODEL_PRICING['gemini-2.5-flash'].output).toBe(2.5);
  });

  it('_persistedExtras liefert den aktuellen Suche/Datei-Modus für die Session-Persistenz', () => {
    const b = createApiBackend('gemini', 1, () => {}, { model: 'gemini-2.5-pro', apiKey: 'x', geminiMode: 'files' });
    expect(b._persistedExtras()).toEqual({ geminiMode: 'files' });
  });

  it('resolveGeminiMode normalisiert auf gültige Modi', () => {
    const { resolveGeminiMode, GEMINI_MODES, DEFAULT_GEMINI_MODE } = require('../src/providers/gemini-provider');
    expect(GEMINI_MODES).toEqual(['search', 'files']);
    expect(DEFAULT_GEMINI_MODE).toBe('search');
    expect(resolveGeminiMode('files')).toBe('files');
    expect(resolveGeminiMode('search')).toBe('search');
    expect(resolveGeminiMode(undefined)).toBe('search'); // Default
    expect(resolveGeminiMode('quatsch')).toBe('search');  // Fallback
  });

  it('buildSystemPrompt beschreibt je Modus das passende Tool-Set', () => {
    const search = buildSystemPrompt('C:/x', 'search');
    expect(search).toMatch(/Google Search/);
    expect(search).toMatch(/File tools are disabled/);
    const files = buildSystemPrompt('C:/x', 'files');
    expect(files).toMatch(/create or edit files/);
    expect(files).toMatch(/Live web search is disabled/);
  });

  it('collectSources extrahiert und dedupliziert Web-Quellen', () => {
    const { collectSources } = require('../src/providers/gemini-provider');
    const grounding = {
      groundingChunks: [
        { web: { title: 'A', uri: 'https://a.example' } },
        { web: { title: 'A again', uri: 'https://a.example' } }, // Duplikat
        { web: { uri: 'https://b.example', domain: 'b.example' } }, // ohne title → domain
        { retrievedContext: {} }, // kein web → ignoriert
      ],
    };
    expect(collectSources(grounding)).toEqual([
      { title: 'A', uri: 'https://a.example' },
      { title: 'b.example', uri: 'https://b.example' },
    ]);
    expect(collectSources(null)).toEqual([]);
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
