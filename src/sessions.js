const fs = require('fs');
const path = require('path');

/**
 * Liest Checkpoints aus checkpoints/index.md im Session-Verzeichnis.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @returns {Array<{number: number, title: string, file: string}>}
 */
function readCheckpoints(sessionDir) {
  const indexPath = path.join(sessionDir, 'checkpoints', 'index.md');
  if (!fs.existsSync(indexPath)) return [];
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const checkpoints = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (match) {
        checkpoints.push({
          number: parseInt(match[1]),
          title: match[2].trim(),
          file: match[3].trim(),
        });
      }
    }
    return checkpoints;
  } catch (e) {
    console.warn('[sessions:readCheckpoints] Fehler:', e.message || e);
    return [];
  }
}

/**
 * Liest plan.md aus dem Session-Verzeichnis.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @returns {string|null}
 */
function readPlan(sessionDir) {
  const planPath = path.join(sessionDir, 'plan.md');
  if (!fs.existsSync(planPath)) return null;
  return fs.readFileSync(planPath, 'utf-8');
}

/**
 * Liest config.json aus dem Copilot-Verzeichnis.
 * @param {string} copilotDir - Absoluter Pfad zum Copilot-Verzeichnis
 * @returns {object}
 */
function readConfig(copilotDir) {
  const cfgPath = path.join(copilotDir, 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch (e) {
    console.warn('[config:read] Fehler:', e.message || e);
    return {};
  }
}

/**
 * Liest todos.json aus dem Session-Verzeichnis.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @returns {Array}
 */
function readTodos(sessionDir) {
  const todosPath = path.join(sessionDir, 'todos.json');
  if (!fs.existsSync(todosPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(todosPath, 'utf-8'));
  } catch (e) {
    console.warn('[todos:read] Fehler:', e.message || e);
    return [];
  }
}

/**
 * Schreibt todos.json ins Session-Verzeichnis.
 * @param {string} sessionDir - Absoluter Pfad zum Session-Verzeichnis
 * @param {Array} todos - Array der Todos
 */
function writeTodos(sessionDir, todos) {
  if (!fs.existsSync(sessionDir)) return;
  fs.writeFileSync(path.join(sessionDir, 'todos.json'), JSON.stringify(todos, null, 2), 'utf-8');
}

module.exports = { readCheckpoints, readPlan, readConfig, readTodos, writeTodos };
