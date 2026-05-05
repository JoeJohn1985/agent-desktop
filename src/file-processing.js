const fs = require('fs');
const path = require('path');

/**
 * Process a dropped file: return path, read content, or copy depending on type and location.
 */
function processDroppedFile(filePath, { cwd, filesDropDir, textExtensions, imageExtensions }) {
  if (!fs.existsSync(filePath)) return { type: 'error', message: 'Datei nicht gefunden' };

  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const relative = path.relative(cwd, filePath);
  const isInCwd = !relative.startsWith('..') && !path.isAbsolute(relative);

  // File is inside CWD → just return the path
  if (isInCwd) {
    return { type: 'path', path: filePath };
  }

  // Image file outside CWD → copy to Dateien folder
  if (imageExtensions.has(ext)) {
    if (!fs.existsSync(filesDropDir)) fs.mkdirSync(filesDropDir, { recursive: true });
    const dest = path.join(filesDropDir, basename);
    fs.copyFileSync(filePath, dest);
    return { type: 'image', path: dest, originalPath: filePath };
  }

  // Text file outside CWD → read content
  if (textExtensions.has(ext)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 100 * 1024) {
      return { type: 'error', message: `Datei zu groß (${Math.round(stat.size / 1024)} KB). Max 100 KB.` };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lang = ext.replace('.', '');
    return { type: 'text', content, filename: basename, lang };
  }

  // Binary/unknown file outside CWD → copy to Dateien folder
  if (!fs.existsSync(filesDropDir)) fs.mkdirSync(filesDropDir, { recursive: true });
  const dest = path.join(filesDropDir, basename);
  fs.copyFileSync(filePath, dest);
  return { type: 'copied', path: dest, originalPath: filePath };
}

module.exports = { processDroppedFile };
