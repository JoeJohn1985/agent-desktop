'use strict';

/**
 * Tests für Projekt-MCP-Server aus .github/mcp.json
 *
 * Contract für den mcp:listProject IPC-Handler (main.js):
 * - Liest .github/mcp.json oder .github/copilot-mcp.json (Fallback)
 * - Parst mcpServers-Objekt: { serverName → serverConfig }
 * - Mappt zu Array von { name, type, configured: true }
 * - type-Bestimmung: cfg.type || (cfg.command ? 'stdio' : 'sse')
 * - Gibt [] zurück bei ungültigem CWD, fehlenden Dateien oder leerem Config
 *
 * Die parseMcpProjectConfig-Funktion spiegelt die Parsing-Logik aus
 * main.js (mcp:listProject IPC-Handler) für isoliertes Testen.
 * Wenn die Logik nach scanners.js extrahiert wird, sollen diese Tests
 * die importierte Funktion nutzen.
 */

const path = require('path');

// ══════════════════════════════════════════════════════════════
// Parsing-Algorithmus (Contract-Spiegel aus mcp:listProject)
// ══════════════════════════════════════════════════════════════

/**
 * Parst eine mcp.json-Datei und gibt eine flache Serverliste zurück.
 * Entspricht der Logik in main.js mcp:listProject IPC-Handler.
 *
 * @param {string} jsonString - Inhalt einer mcp.json Datei
 * @returns {Array<{name: string, type: string, configured: true}>}
 */
function parseMcpProjectConfig(jsonString) {
  const config = JSON.parse(jsonString);
  const servers = config.mcpServers || {};
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    type: cfg.type || (cfg.command ? 'stdio' : 'sse'),
    configured: true,
  }));
}

// ══════════════════════════════════════════════════════════════
// parseMcpProjectConfig — type-Bestimmung
// ══════════════════════════════════════════════════════════════

describe('parseMcpProjectConfig — type-Bestimmung', () => {
  test('verwendet explizites type-Feld "sse"', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: { type: 'sse', url: 'http://localhost:3000' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('sse');
  });

  test('verwendet explizites type-Feld "stdio"', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: { type: 'stdio', command: 'node', args: ['server.js'] } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('stdio');
  });

  test('leitet type="stdio" ab wenn command vorhanden aber kein type', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: { command: 'node', args: ['server.js'] } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('stdio');
  });

  test('leitet type="stdio" ab bei beliebigem command-Wert', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: { command: 'python' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('stdio');
  });

  test('verwendet type="sse" als Standard wenn weder type noch command gesetzt', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: {} },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('sse');
  });

  test('explizites type-Feld hat Vorrang vor command', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: { type: 'sse', command: 'node' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('sse');
  });

  test('explizites type-Feld "stdio" hat Vorrang auch wenn command vorhanden', () => {
    const json = JSON.stringify({
      mcpServers: { myserver: { type: 'stdio', command: 'node' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].type).toBe('stdio');
  });
});

// ══════════════════════════════════════════════════════════════
// parseMcpProjectConfig — Ergebnis-Struktur
// ══════════════════════════════════════════════════════════════

describe('parseMcpProjectConfig — Ergebnis-Struktur', () => {
  test('jeder Eintrag hat genau die Felder: name, type, configured', () => {
    const json = JSON.stringify({
      mcpServers: { s1: { type: 'stdio' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(Object.keys(result[0]).sort()).toEqual(['configured', 'name', 'type']);
  });

  test('setzt configured: true für alle Server', () => {
    const json = JSON.stringify({
      mcpServers: {
        s1: { type: 'sse' },
        s2: { command: 'node' },
        s3: {},
      },
    });
    const result = parseMcpProjectConfig(json);
    expect(result.every(s => s.configured === true)).toBe(true);
  });

  test('verwendet den mcpServers-Key als name', () => {
    const json = JSON.stringify({
      mcpServers: { 'my-mcp-server': { type: 'stdio' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].name).toBe('my-mcp-server');
  });

  test('name enthält den exakten Key-String', () => {
    const json = JSON.stringify({
      mcpServers: { 'GitHub Copilot MCP': { type: 'sse' } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0].name).toBe('GitHub Copilot MCP');
  });
});

// ══════════════════════════════════════════════════════════════
// parseMcpProjectConfig — mehrere Server
// ══════════════════════════════════════════════════════════════

describe('parseMcpProjectConfig — mehrere Server', () => {
  test('parst mehrere Server korrekt', () => {
    const json = JSON.stringify({
      mcpServers: {
        s1: { type: 'sse' },
        s2: { command: 'node' },
        s3: {},
      },
    });
    const result = parseMcpProjectConfig(json);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: 's1', type: 'sse', configured: true });
    expect(result[1]).toEqual({ name: 's2', type: 'stdio', configured: true });
    expect(result[2]).toEqual({ name: 's3', type: 'sse', configured: true });
  });

  test('parst einzelnen Server korrekt', () => {
    const json = JSON.stringify({
      mcpServers: { 'only-server': { command: 'python', args: ['-m', 'mcp_server'] } },
    });
    const result = parseMcpProjectConfig(json);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'only-server', type: 'stdio', configured: true });
  });
});

// ══════════════════════════════════════════════════════════════
// parseMcpProjectConfig — Edge Cases
// ══════════════════════════════════════════════════════════════

describe('parseMcpProjectConfig — Edge Cases', () => {
  test('gibt [] zurück bei leerem mcpServers-Objekt', () => {
    const json = JSON.stringify({ mcpServers: {} });
    const result = parseMcpProjectConfig(json);
    expect(result).toEqual([]);
  });

  test('gibt [] zurück wenn mcpServers-Key fehlt', () => {
    const json = JSON.stringify({ otherKey: { value: 1 } });
    const result = parseMcpProjectConfig(json);
    expect(result).toEqual([]);
  });

  test('gibt [] zurück bei leerem JSON-Objekt {}', () => {
    const json = JSON.stringify({});
    const result = parseMcpProjectConfig(json);
    expect(result).toEqual([]);
  });

  test('wirft bei ungültigem JSON', () => {
    expect(() => parseMcpProjectConfig('{ broken json !!!')).toThrow();
  });

  test('reales mcp.json Format — SSE-Server', () => {
    const json = JSON.stringify({
      mcpServers: {
        'github-copilot': {
          type: 'sse',
          url: 'https://api.githubcopilot.com/mcp/',
        },
      },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0]).toEqual({
      name: 'github-copilot',
      type: 'sse',
      configured: true,
    });
  });

  test('reales mcp.json Format — stdio-Server', () => {
    const json = JSON.stringify({
      mcpServers: {
        'my-tool': {
          command: 'npx',
          args: ['-y', '@my-org/mcp-server'],
          env: { API_KEY: 'secret' },
        },
      },
    });
    const result = parseMcpProjectConfig(json);
    expect(result[0]).toEqual({
      name: 'my-tool',
      type: 'stdio',
      configured: true,
    });
  });
});

// ══════════════════════════════════════════════════════════════
// mcp:listProject — Kandidaten-Pfade
// ══════════════════════════════════════════════════════════════

describe('mcp:listProject — Kandidaten-Dateinamen', () => {
  const CWD = path.join('C:', 'myproject');

  test('erste Kandidatendatei ist .github/mcp.json', () => {
    const candidates = [
      path.join(CWD, '.github', 'mcp.json'),
      path.join(CWD, '.github', 'copilot-mcp.json'),
    ];
    expect(candidates[0]).toBe(path.join(CWD, '.github', 'mcp.json'));
  });

  test('zweite Kandidatendatei ist .github/copilot-mcp.json (Fallback)', () => {
    const candidates = [
      path.join(CWD, '.github', 'mcp.json'),
      path.join(CWD, '.github', 'copilot-mcp.json'),
    ];
    expect(candidates[1]).toBe(path.join(CWD, '.github', 'copilot-mcp.json'));
  });

  test('beide Kandidaten liegen im .github/ Unterverzeichnis des CWD', () => {
    const candidates = [
      path.join(CWD, '.github', 'mcp.json'),
      path.join(CWD, '.github', 'copilot-mcp.json'),
    ];
    const githubDir = path.join(CWD, '.github');
    for (const c of candidates) {
      expect(path.dirname(c)).toBe(githubDir);
    }
  });

  test('es gibt genau 2 Kandidaten', () => {
    const candidates = [
      path.join(CWD, '.github', 'mcp.json'),
      path.join(CWD, '.github', 'copilot-mcp.json'),
    ];
    expect(candidates).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════
// Projekt-Ressourcen — .github/ Pfad-Konstruktion
// ══════════════════════════════════════════════════════════════

describe('Projekt-Ressourcen — .github/ Pfad-Konstruktion', () => {
  const CWD = path.join('C:', 'myproject');

  test('skills:listProject scannt .github/skills/ Unterverzeichnis', () => {
    // IPC-Handler konstruiert: path.join(cwd, '.github', 'skills')
    const projectSkillsDir = path.join(CWD, '.github', 'skills');
    expect(projectSkillsDir).toBe(path.join(CWD, '.github', 'skills'));
    expect(path.basename(projectSkillsDir)).toBe('skills');
    expect(path.basename(path.dirname(projectSkillsDir))).toBe('.github');
  });

  test('agents:listProject scannt .github/agents/ Unterverzeichnis', () => {
    // IPC-Handler konstruiert: path.join(cwd, '.github', 'agents')
    const projectAgentsDir = path.join(CWD, '.github', 'agents');
    expect(projectAgentsDir).toBe(path.join(CWD, '.github', 'agents'));
    expect(path.basename(projectAgentsDir)).toBe('agents');
    expect(path.basename(path.dirname(projectAgentsDir))).toBe('.github');
  });

  test('alle Projekt-Ressource-Pfade sind direkte Kinder von .github/', () => {
    const githubDir = path.join(CWD, '.github');
    const resourcePaths = [
      path.join(CWD, '.github', 'skills'),
      path.join(CWD, '.github', 'agents'),
      path.join(CWD, '.github', 'mcp.json'),
      path.join(CWD, '.github', 'copilot-mcp.json'),
    ];
    for (const p of resourcePaths) {
      expect(path.dirname(p)).toBe(githubDir);
    }
  });

  test('Pfade unter verschiedenen CWD-Roots werden korrekt aufgebaut', () => {
    const roots = [
      path.join('C:', 'Users', 'dev', 'myproject'),
      path.join('D:', 'work', 'repo'),
      path.join('/home', 'user', 'projects', 'app'),
    ];
    for (const root of roots) {
      const skillsDir = path.join(root, '.github', 'skills');
      expect(skillsDir.startsWith(root)).toBe(true);
      expect(skillsDir).toContain('.github');
    }
  });
});

// ══════════════════════════════════════════════════════════════
// mcp:listProject — Input-Validierung (Contract)
// ══════════════════════════════════════════════════════════════

describe('mcp:listProject — Input-Validierung Contract', () => {
  // Diese Tests dokumentieren das erwartete Verhalten des IPC-Handlers
  // bei ungültigem cwd-Input (Logik aus main.js):
  //   if (!cwd || typeof cwd !== 'string') return [];

  function listProjectGuard(cwd) {
    if (!cwd || typeof cwd !== 'string') return [];
    return null; // würde fortfahren
  }

  test('gibt [] zurück wenn cwd null', () => {
    expect(listProjectGuard(null)).toEqual([]);
  });

  test('gibt [] zurück wenn cwd undefined', () => {
    expect(listProjectGuard(undefined)).toEqual([]);
  });

  test('gibt [] zurück wenn cwd leerer String', () => {
    expect(listProjectGuard('')).toEqual([]);
  });

  test('gibt [] zurück wenn cwd eine Zahl ist', () => {
    expect(listProjectGuard(42)).toEqual([]);
  });

  test('gibt null zurück (würde fortfahren) wenn cwd ein gültiger String ist', () => {
    expect(listProjectGuard('C:\\myproject')).toBeNull();
  });
});
