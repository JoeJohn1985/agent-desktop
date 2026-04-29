const path = require('path');

// ── ANSI Stripping ──────────────────────────────────────────
function stripAnsi(raw) {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Z]/g, '')
    .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\r/g, '');
}

// ── Path Safety ─────────────────────────────────────────────
function safeSessionPath(sessionsDir, sessionId) {
  const resolved = path.resolve(sessionsDir, sessionId);
  if (!resolved.startsWith(sessionsDir + path.sep) && resolved !== sessionsDir) {
    throw new Error('Invalid session ID');
  }
  return resolved;
}

// ── Context Output Parsing ──────────────────────────────────
function parseContextOutput(text) {
  const result = { raw: text };
  
  try {
    const headerMatch = text.match(/([A-Za-z\s.]+\d[\w.]*)\s*[·]\s*([\d.]+k)\/([\d.]+k)\s*tokens?\s*\((\d+)%\)/i);
    if (headerMatch) {
      result.model = headerMatch[1].trim();
      result.usedTokens = headerMatch[2];
      result.totalTokens = headerMatch[3];
      result.percent = parseInt(headerMatch[4]);
    }
    
    const categories = [];
    const catRegex = /(System\/Tools|Messages|Free Space|Buffer):\s*([\d.]+k)\s*\((\d+)%\)/gi;
    let match;
    while ((match = catRegex.exec(text)) !== null) {
      categories.push({ name: match[1], tokens: match[2], percent: parseInt(match[3]) });
    }
    if (categories.length) result.categories = categories;
  } catch (e) {
    console.log('[parseContextOutput] Parse error, returning raw:', e.message);
  }
  
  return result;
}

// ── Skill Icons ─────────────────────────────────────────────
const SKILL_ICON_MAP = {
  'task-router': '🧠',
  'code-review': '🔍',
  'quality-audit': '🧪',
  'security-audit': '🛡️',
  'customize-cloud-agent': '☁️',
};

function builtinSkillIcon(name) {
  return SKILL_ICON_MAP[(name || '').toLowerCase()] || '🧩';
}

function userSkillIcon(name) {
  const mapped = SKILL_ICON_MAP[(name || '').toLowerCase()];
  if (mapped) return mapped;
  const m = (name || '').match(/([\p{Emoji}])/u);
  return m ? m[1] : '🧩';
}

module.exports = {
  stripAnsi,
  safeSessionPath,
  parseContextOutput,
  builtinSkillIcon,
  userSkillIcon,
  SKILL_ICON_MAP,
};
