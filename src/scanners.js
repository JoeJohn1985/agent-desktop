/**
 * Scanner- und Config-Funktionen (aus main.js extrahiert)
 * Dependency-Injection für yamlParse ermöglicht einfaches Testen.
 */

const fs = require('fs');
const path = require('path');

// ── scanSessions ─────────────────────────────────────────────

function scanSessions(sessionsDir, yamlParse) {
  if (!fs.existsSync(sessionsDir)) return [];

  const sessions = [];
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(sessionsDir, entry.name, 'workspace.yaml');
    if (!fs.existsSync(wsPath)) continue;

    try {
      const raw = fs.readFileSync(wsPath, 'utf-8');
      const ws = yamlParse(raw);
      const sessionDir = path.join(sessionsDir, entry.name);

      // Checkpoint-Anzahl ermitteln
      const cpDir = path.join(sessionDir, 'checkpoints');
      let checkpointCount = 0;
      if (fs.existsSync(cpDir)) {
        checkpointCount = fs.readdirSync(cpDir)
          .filter(f => f.match(/^\d{3}-.*\.md$/)).length;
      }

      const hasPlan = fs.existsSync(path.join(sessionDir, 'plan.md'));
      const isActive = fs.readdirSync(sessionDir)
        .some(f => f.startsWith('inuse.'));

      sessions.push({
        id: ws.id || entry.name,
        name: ws.name || null,
        summary: ws.summary || null,
        cwd: ws.cwd || '',
        createdAt: ws.created_at || '',
        updatedAt: ws.updated_at || '',
        summaryCount: ws.summary_count || 0,
        checkpointCount,
        hasPlan,
        isActive,
      });
    } catch (e) {
      console.warn('[sessions:scan] Fehler:', e.message || e);
    }
  }

  sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return sessions;
}

// ── scanSkillDirectory ───────────────────────────────────────

function scanSkillDirectory(dir, source, iconFn, yamlParse) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    try {
      const raw = fs.readFileSync(skillMd, 'utf-8').replace(/^\uFEFF/, '');
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter) {
        const meta = yamlParse(frontmatter[1]);
        results.push({
          id: meta.name || entry.name,
          name: meta.name || entry.name,
          description: meta.description || '',
          source,
          icon: meta.icon || iconFn(meta.name || entry.name),
        });
      }
    } catch (e) {
      console.warn(`[skills:scan:${source}] Fehler:`, e.message || e);
    }
  }
  return results;
}

// ── Folder Config ────────────────────────────────────────────

function readFolderConfig(configPath) {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[folders:readConfig] Fehler:', e.message || e);
  }
  return {};
}

function writeFolderConfig(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

module.exports = {
  scanSessions,
  scanSkillDirectory,
  readFolderConfig,
  writeFolderConfig,
};
