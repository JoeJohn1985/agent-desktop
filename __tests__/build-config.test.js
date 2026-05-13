/**
 * Build-Configuration & Portable-Bundle-Konsistenz-Tests.
 *
 * Statische Checks rund um die Portable-ZIP-Distribution:
 * - electron-builder-Konfig in package.json ist vollstaendig
 * - npm-Scripts pack:portable / dist:portable existieren und passen
 * - build/portable/-Artefakte existieren und referenzieren das current\/_staged\-Layout
 * - PORTABLE_README dokumentiert das Auto-Update-Verhalten
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

const PORTABLE_DIR = path.join(ROOT, 'build', 'portable');
const START_BAT_PATH = path.join(PORTABLE_DIR, 'start.bat');
const BUILD_PS1_PATH = path.join(PORTABLE_DIR, 'build-portable.ps1');
const README_TXT_PATH = path.join(PORTABLE_DIR, 'PORTABLE_README.txt');

const startBat   = fs.existsSync(START_BAT_PATH)   ? fs.readFileSync(START_BAT_PATH,   'utf-8') : '';
const buildPs1   = fs.existsSync(BUILD_PS1_PATH)   ? fs.readFileSync(BUILD_PS1_PATH,   'utf-8') : '';
const readmeTxt  = fs.existsSync(README_TXT_PATH)  ? fs.readFileSync(README_TXT_PATH,  'utf-8') : '';

// ── electron-builder Konfig ─────────────────────────────────

describe('electron-builder Konfiguration in package.json', () => {
  test('build-Block existiert', () => {
    expect(pkg.build).toBeDefined();
  });

  test('appId ist GEBIT-konform', () => {
    expect(pkg.build.appId).toBe('de.gebit.copilot-desktop');
  });

  test('productName ist gesetzt', () => {
    expect(pkg.build.productName).toBeTruthy();
  });

  test('asar ist aktiviert', () => {
    expect(pkg.build.asar).toBe(true);
  });

  test('files-Liste enthaelt main.js, preload.js, renderer, src', () => {
    const files = pkg.build.files || [];
    expect(files).toEqual(expect.arrayContaining([
      'main.js', 'preload.js', 'package.json', 'renderer/**', 'src/**',
    ]));
  });

  test('Windows-Target ist "dir" auf x64 (portable)', () => {
    const targets = pkg.build.win && pkg.build.win.target;
    expect(Array.isArray(targets)).toBe(true);
    const dir = targets.find(t => t.target === 'dir');
    expect(dir).toBeDefined();
    expect(dir.arch).toEqual(expect.arrayContaining(['x64']));
  });
});

// ── npm-Scripts ─────────────────────────────────────────────

describe('npm-Scripts fuer Portable-Build', () => {
  test('pack:portable nutzt electron-builder mit --win dir', () => {
    expect(pkg.scripts['pack:portable']).toMatch(/electron-builder.*--win\s+dir/);
  });

  test('dist:portable ruft build-portable.ps1 auf', () => {
    expect(pkg.scripts['dist:portable']).toMatch(/build\/portable\/build-portable\.ps1/);
  });

  test('electron-builder ist als devDependency deklariert', () => {
    expect(pkg.devDependencies['electron-builder']).toBeTruthy();
  });
});

// ── build/portable Artefakte existieren ─────────────────────

describe('build/portable Verzeichnis', () => {
  test.each([
    ['start.bat',           START_BAT_PATH],
    ['build-portable.ps1',  BUILD_PS1_PATH],
    ['PORTABLE_README.txt', README_TXT_PATH],
  ])('Datei existiert: build/portable/%s', (_name, p) => {
    expect(fs.existsSync(p)).toBe(true);
  });
});

// ── start.bat: Bundle-Layout & Update-Switch ────────────────

describe('build/portable/start.bat', () => {
  test('verwendet current\\ als app-Verzeichnis', () => {
    expect(startBat).toMatch(/CURRENT_DIR=.*current/);
    expect(startBat).toMatch(/APP_ROOT=%CURRENT_DIR%/);
  });

  test('kennt _staged\\ als Update-Staging-Verzeichnis', () => {
    expect(startBat).toMatch(/STAGED_DIR=.*_staged/);
  });

  test('prueft _staged\\pending-update.json', () => {
    expect(startBat).toMatch(/PENDING_FILE=.*pending-update\.json/);
  });

  test('hat eine apply_pending_update-Subroutine', () => {
    expect(startBat).toMatch(/^:apply_pending_update/m);
    expect(startBat).toMatch(/call :apply_pending_update/);
  });

  test('macht atomic switch via Rename current -> _old', () => {
    expect(startBat).toMatch(/ren\s+"%CURRENT_DIR%"\s+"_old"/);
  });

  test('promotet staged Version in current\\', () => {
    expect(startBat).toMatch(/move\s+\/y\s+"%STAGED_VER_DIR%"\s+"%CURRENT_DIR%"/);
  });

  test('loggt nach %LOCALAPPDATA%\\copilot-desktop\\logs', () => {
    expect(startBat).toMatch(/LOCALAPPDATA%\\copilot-desktop\\logs/);
  });

  test('startet gh auth login bei fehlender Session', () => {
    expect(startBat).toMatch(/gh\.exe"\s+auth\s+login\s+--web/);
  });

  test('installiert gh-copilot Extension bei Bedarf', () => {
    expect(startBat).toMatch(/extension\s+install\s+github\/gh-copilot/);
  });

  test('startet die Electron-App am Ende', () => {
    expect(startBat).toMatch(/start\s+""\s+"%APP_ROOT%app\\copilot-desktop\.exe"/);
  });

  // Sanity: keine Labels innerhalb von (...)-Bloecken (haeufiger Batch-Bug)
  test('keine Labels innerhalb von Klammer-Bloecken', () => {
    // Sehr einfacher Heuristik-Check: ":<name>" auf eigener Zeile mit fuehrenden Spaces ist verdaechtig
    const indentedLabels = startBat
      .split(/\r?\n/)
      .filter(l => /^\s+:[a-zA-Z_]/.test(l));
    expect(indentedLabels).toEqual([]);
  });
});

// ── build-portable.ps1 ──────────────────────────────────────

describe('build/portable/build-portable.ps1', () => {
  test('staged app\\ unter current\\', () => {
    expect(buildPs1).toMatch(/current\\app/);
  });

  test('staged tools\\gh unter current\\', () => {
    expect(buildPs1).toMatch(/current\\tools\\gh/);
  });

  test('schreibt VERSION.txt nach current\\', () => {
    expect(buildPs1).toMatch(/current\\VERSION\.txt/);
  });

  test('produziert ZIP mit Versions-Suffix', () => {
    expect(buildPs1).toMatch(/copilot-desktop-v\$version-portable/);
  });

  test('loggt jeden Schritt (Invoke-Step)', () => {
    expect(buildPs1).toMatch(/function Invoke-Step/);
  });

  test('laedt portable gh.exe von cli/cli', () => {
    expect(buildPs1).toMatch(/cli\/cli\/releases\/download/);
  });
});

// ── PORTABLE_README ─────────────────────────────────────────

describe('PORTABLE_README.txt (End-User-Doku im ZIP)', () => {
  test('beschreibt Erststart', () => {
    expect(readmeTxt).toMatch(/ERSTSTART/);
    expect(readmeTxt).toMatch(/start\.bat/);
  });

  test('dokumentiert Auto-Update-Mechanismus', () => {
    expect(readmeTxt).toMatch(/Update bereit/);
    expect(readmeTxt).toMatch(/_staged/);
    expect(readmeTxt).toMatch(/current/);
    expect(readmeTxt).toMatch(/atomar/);
  });

  test('zeigt Speicherorte fuer Logs und Userdaten', () => {
    expect(readmeTxt).toMatch(/LOCALAPPDATA%\\copilot-desktop\\logs/);
    expect(readmeTxt).toMatch(/\.copilot/);
  });

  test('erwaehnt SmartScreen-Verhalten', () => {
    expect(readmeTxt).toMatch(/SmartScreen/);
  });
});

// ── Release-Workflow (.github/workflows/release.yml) ────────

describe('Release-Workflow', () => {
  const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'release.yml');
  const workflow = fs.existsSync(WORKFLOW_PATH) ? fs.readFileSync(WORKFLOW_PATH, 'utf-8') : '';

  test('release.yml existiert', () => {
    expect(fs.existsSync(WORKFLOW_PATH)).toBe(true);
  });

  test('triggert auf Tag-Push v*.*.*', () => {
    expect(workflow).toMatch(/tags:\s*\n\s*-\s*['"]?v\*\.\*\.\*/);
  });

  test('erlaubt manuellen Dispatch fuer Dry-Runs', () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
  });

  test('laeuft auf windows-latest', () => {
    expect(workflow).toMatch(/runs-on:\s*windows-latest/);
  });

  test('hat explizit contents: write permission fuer Release-Upload', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });

  test('verifiziert package.json version gegen Tag', () => {
    expect(workflow).toMatch(/package\.json version/);
  });

  test('ruft npm test auf', () => {
    expect(workflow).toMatch(/npm test/);
  });

  test('ruft npm run dist:portable auf', () => {
    expect(workflow).toMatch(/npm run dist:portable/);
  });

  test('sucht ZIP in dist-portable\\ (matched build-portable.ps1 output)', () => {
    expect(workflow).toMatch(/dist-portable/);
    expect(workflow).toMatch(/\*portable\*\.zip/);
  });

  test('laedt ZIP immer als workflow-artifact hoch (Sichtbarkeit auch ohne Release)', () => {
    expect(workflow).toMatch(/actions\/upload-artifact@v\d/);
  });

  test('nutzt softprops/action-gh-release fuer Release-Erstellung', () => {
    expect(workflow).toMatch(/softprops\/action-gh-release@v\d/);
  });

  test('haengt Prerelease-Flag automatisch an Tags mit Bindestrich (zB v1.0.0-rc1)', () => {
    expect(workflow).toMatch(/prerelease:\s*\$\{\{\s*contains\(/);
  });

  test('CSC_IDENTITY_AUTO_DISCOVERY=false fuer code-signing-freien Build', () => {
    expect(workflow).toMatch(/CSC_IDENTITY_AUTO_DISCOVERY:\s*['"]?false/);
  });

  test('fail_on_unmatched_files: true verhindert leeren Release', () => {
    expect(workflow).toMatch(/fail_on_unmatched_files:\s*true/);
  });
});
