/**
 * Tests für Onboarding-Wizard und Auth (GitHub CLI) Logik (v0.17.0).
 *
 * Getestet werden:
 * 1. Onboarding IPC-Handler-Logik (isFirstRun, complete)
 *    - readFolderConfig / writeFolderConfig aus src/scanners.js
 * 2. Auth IPC-Handler-Logik (auth:check, auth:login)
 *    - execFile-basiert, gemockt
 * 3. Onboarding Wizard UI State Machine (extrahiert aus renderer/app.js)
 *    - Step-Navigation, Skip, Finish, Login-Step-States
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// TEIL 1: Onboarding Config-Logik (readFolderConfig / writeFolderConfig)
// ═══════════════════════════════════════════════════════════════

const { readFolderConfig, writeFolderConfig } = require('../src/scanners');

describe('Onboarding: isFirstRun Logik', () => {
  const tmpDir = path.join(os.tmpdir(), `copilot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configPath = path.join(tmpDir, 'folders.json');

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  test('config fehlt → leeres Objekt → onboardingComplete !== true → isFirstRun = true', () => {
    const config = readFolderConfig(path.join(tmpDir, 'nonexistent.json'));
    expect(config).toEqual({});
    expect(config.onboardingComplete !== true).toBe(true);
  });

  test('config existiert, aber ohne onboardingComplete → isFirstRun = true', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ cwd: 'C:\\test' }), 'utf-8');
    const config = readFolderConfig(configPath);
    expect(config.onboardingComplete !== true).toBe(true);
  });

  test('config existiert mit onboardingComplete: false → isFirstRun = true', () => {
    fs.writeFileSync(configPath, JSON.stringify({ onboardingComplete: false }), 'utf-8');
    const config = readFolderConfig(configPath);
    expect(config.onboardingComplete !== true).toBe(true);
  });

  test('config existiert mit onboardingComplete: true → isFirstRun = false', () => {
    fs.writeFileSync(configPath, JSON.stringify({ onboardingComplete: true }), 'utf-8');
    const config = readFolderConfig(configPath);
    expect(config.onboardingComplete !== true).toBe(false);
  });

  test('config existiert mit onboardingComplete: "true" (String) → isFirstRun = true (strict check)', () => {
    fs.writeFileSync(configPath, JSON.stringify({ onboardingComplete: 'true' }), 'utf-8');
    const config = readFolderConfig(configPath);
    // Die IPC-Handler-Logik: config.onboardingComplete !== true → String "true" !== true
    expect(config.onboardingComplete !== true).toBe(true);
  });

  test('kaputte JSON → readFolderConfig gibt {} zurück → isFirstRun = true', () => {
    fs.writeFileSync(configPath, '{broken json!!!', 'utf-8');
    const config = readFolderConfig(configPath);
    expect(config).toEqual({});
    expect(config.onboardingComplete !== true).toBe(true);
  });
});

describe('Onboarding: complete Logik', () => {
  const tmpDir = path.join(os.tmpdir(), `copilot-test-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configPath = path.join(tmpDir, 'folders.json');

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  test('complete setzt onboardingComplete: true und schreibt Config', () => {
    // Simuliert den IPC-Handler:
    // const config = readFolderConfig(); config.onboardingComplete = true; writeFolderConfig(config);
    const config = readFolderConfig(configPath); // {} (nicht vorhanden)
    config.onboardingComplete = true;
    writeFolderConfig(configPath, config);

    // Nachlesen
    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(true);
  });

  test('complete erhält bestehende Config-Werte', () => {
    const initial = { cwd: 'C:\\Projects', sessionsDir: 'D:\\sessions' };
    writeFolderConfig(configPath, initial);

    const config = readFolderConfig(configPath);
    config.onboardingComplete = true;
    writeFolderConfig(configPath, config);

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(true);
    expect(saved.cwd).toBe('C:\\Projects');
    expect(saved.sessionsDir).toBe('D:\\sessions');
  });

  test('complete überschreibt false mit true', () => {
    writeFolderConfig(configPath, { onboardingComplete: false });
    const config = readFolderConfig(configPath);
    config.onboardingComplete = true;
    writeFolderConfig(configPath, config);

    const saved = readFolderConfig(configPath);
    expect(saved.onboardingComplete).toBe(true);
  });

  test('complete erstellt Verzeichnis falls nicht vorhanden', () => {
    const deepPath = path.join(tmpDir, 'sub', 'deep', 'folders.json');
    writeFolderConfig(deepPath, { onboardingComplete: true });
    const saved = readFolderConfig(deepPath);
    expect(saved.onboardingComplete).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 2: Auth Check / Login (config.json-basiert, gemockt)
// ═══════════════════════════════════════════════════════════════

/**
 * Extrahierte Logik aus main.js auth:check Handler.
 * Liest lastLoggedInUser aus ~/.copilot/config.json.
 * Testbar ohne Electron ipcMain.
 */
function parseAuthCheckFromConfig(configJson) {
  try {
    if (!configJson) return { success: true, authenticated: false, user: null };
    const cleaned = configJson.replace(/^\s*\/\/.*$/gm, '');
    const config = JSON.parse(cleaned);
    const user = config.lastLoggedInUser;
    if (user && user.login) {
      return { success: true, authenticated: true, user: user.login, host: user.host };
    }
    return { success: true, authenticated: false, user: null };
  } catch (e) {
    return { success: true, authenticated: false, user: null };
  }
}

/**
 * auth:login öffnet ein Terminal-Fenster (detached spawn).
 * Das Ergebnis ist immer pendingInTerminal = true (kein execFile-Parsing nötig).
 */
function makeAuthLoginResult() {
  return { success: true, pendingInTerminal: true, error: null };
}

describe('auth:check aus config.json', () => {

  test('config mit lastLoggedInUser → authenticated + user', () => {
    const result = parseAuthCheckFromConfig(JSON.stringify({
      lastLoggedInUser: { host: 'https://github.com', login: 'testuser' },
    }));
    expect(result).toEqual({ success: true, authenticated: true, user: 'testuser', host: 'https://github.com' });
  });

  test('config ohne lastLoggedInUser → authenticated: false', () => {
    const result = parseAuthCheckFromConfig(JSON.stringify({ firstLaunchAt: '2026-01-01' }));
    expect(result).toEqual({ success: true, authenticated: false, user: null });
  });

  test('leere config → authenticated: false', () => {
    const result = parseAuthCheckFromConfig(JSON.stringify({}));
    expect(result).toEqual({ success: true, authenticated: false, user: null });
  });

  test('null/undefined → authenticated: false', () => {
    expect(parseAuthCheckFromConfig(null)).toEqual({ success: true, authenticated: false, user: null });
    expect(parseAuthCheckFromConfig(undefined)).toEqual({ success: true, authenticated: false, user: null });
  });

  test('config mit JS-Kommentaren wird korrekt geparsed', () => {
    const raw = `// User settings belong in settings.json.\n// This file is managed automatically.\n${JSON.stringify({ lastLoggedInUser: { host: 'https://github.com', login: 'commentuser' } })}`;
    const result = parseAuthCheckFromConfig(raw);
    expect(result.authenticated).toBe(true);
    expect(result.user).toBe('commentuser');
  });

  test('lastLoggedInUser ohne login-Feld → authenticated: false', () => {
    const result = parseAuthCheckFromConfig(JSON.stringify({ lastLoggedInUser: { host: 'https://github.com' } }));
    expect(result).toEqual({ success: true, authenticated: false, user: null });
  });

  test('kaputtes JSON → authenticated: false (kein Crash)', () => {
    const result = parseAuthCheckFromConfig('{broken json!!!');
    expect(result).toEqual({ success: true, authenticated: false, user: null });
  });

  test('config mit trustedFolders aber ohne lastLoggedInUser → authenticated: false', () => {
    const result = parseAuthCheckFromConfig(JSON.stringify({
      trustedFolders: ['C:\\DEV'],
      firstLaunchAt: '2026-01-01T00:00:00Z',
    }));
    expect(result.authenticated).toBe(false);
  });

  test('user-Login wird korrekt weitergegeben (kein Trimmen nötig, da aus JSON)', () => {
    const result = parseAuthCheckFromConfig(JSON.stringify({
      lastLoggedInUser: { host: 'https://github.com', login: 'my-org-user' },
    }));
    expect(result.user).toBe('my-org-user');
  });
});

describe('auth:login (Terminal-basiert)', () => {

  test('Login gibt pendingInTerminal: true zurück', () => {
    const result = makeAuthLoginResult();
    expect(result.success).toBe(true);
    expect(result.pendingInTerminal).toBe(true);
    expect(result.error).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 3: Onboarding Wizard UI State Machine
// ═══════════════════════════════════════════════════════════════

const ONBOARDING_TOTAL_STEPS = 4;

/**
 * Extrahierte State Machine aus renderer/app.js für den Onboarding-Wizard.
 * Bildet die Zustandslogik ohne DOM/Electron ab.
 */
class OnboardingWizardStateMachine {
  constructor() {
    this.currentStep = 1;
    this.overlayVisible = false;
    this.btnNextDisabled = true;
    this.btnNextText = 'Weiter →';
    this.completed = false;
    this.stepIndicators = []; // {step, active, done}
  }

  start() {
    this.overlayVisible = true;
    this.showStep(1);
  }

  showStep(step) {
    this.currentStep = step;
    this.btnNextDisabled = true;
    this.btnNextText = step < ONBOARDING_TOTAL_STEPS ? 'Weiter →' : 'Fertig ✓';

    // Update step indicators
    this.stepIndicators = [];
    for (let s = 1; s <= ONBOARDING_TOTAL_STEPS; s++) {
      this.stepIndicators.push({
        step: s,
        active: s === step,
        done: s < step,
      });
    }

    // Step 1 = CWD → disabled bis Verzeichnis bestätigt
    // Step 2 = Login → disabled bis auth ok
    // Steps 3-4 = Placeholder → sofort enabled
    if (step !== 1 && step !== 2) {
      this.btnNextDisabled = false;
    }
  }

  enableNext() {
    this.btnNextDisabled = false;
  }

  nextStep() {
    if (this.currentStep >= ONBOARDING_TOTAL_STEPS) {
      this.finish();
      return;
    }
    this.showStep(this.currentStep + 1);
  }

  skip() {
    this.finish();
  }

  finish() {
    this.completed = true;
    this.overlayVisible = false;
  }
}

describe('Onboarding Wizard State Machine', () => {
  let wiz;

  beforeEach(() => {
    wiz = new OnboardingWizardStateMachine();
  });

  test('initial: Overlay nicht sichtbar, Step 1', () => {
    expect(wiz.overlayVisible).toBe(false);
    expect(wiz.currentStep).toBe(1);
    expect(wiz.completed).toBe(false);
  });

  test('start: Overlay wird sichtbar, Step 1 aktiv', () => {
    wiz.start();
    expect(wiz.overlayVisible).toBe(true);
    expect(wiz.currentStep).toBe(1);
    expect(wiz.btnNextDisabled).toBe(true); // CWD-Step: disabled bis Verzeichnis bestätigt
  });

  test('Step 1 (CWD): Next-Button disabled bis enableNext()', () => {
    wiz.start();
    expect(wiz.btnNextDisabled).toBe(true);
    wiz.enableNext();
    expect(wiz.btnNextDisabled).toBe(false);
  });

  test('Step 2 (Login): Next-Button disabled bis enableNext()', () => {
    wiz.start();
    wiz.enableNext();
    wiz.nextStep(); // → Step 2
    expect(wiz.currentStep).toBe(2);
    expect(wiz.btnNextDisabled).toBe(true);
    wiz.enableNext();
    expect(wiz.btnNextDisabled).toBe(false);
  });

  test('Steps 3-4 (Folder/Category): Next-Button sofort enabled', () => {
    wiz.start();
    wiz.enableNext();
    wiz.nextStep(); // → Step 2
    wiz.enableNext();
    wiz.nextStep(); // → Step 3
    expect(wiz.currentStep).toBe(3);
    expect(wiz.btnNextDisabled).toBe(false);

    wiz.nextStep(); // → Step 4
    expect(wiz.currentStep).toBe(4);
    expect(wiz.btnNextDisabled).toBe(false);
  });

  test('Next-Button Text: "Weiter →" für Steps 1-3, "Fertig ✓" für Step 4', () => {
    wiz.start();
    expect(wiz.btnNextText).toBe('Weiter →');

    wiz.enableNext();
    wiz.nextStep(); // Step 2
    expect(wiz.btnNextText).toBe('Weiter →');

    wiz.enableNext();
    wiz.nextStep(); // Step 3
    expect(wiz.btnNextText).toBe('Weiter →');

    wiz.nextStep(); // Step 4
    expect(wiz.btnNextText).toBe('Fertig ✓');
  });

  test('Step-Indikatoren: aktiver Step markiert, vorherige als done', () => {
    wiz.start();
    expect(wiz.stepIndicators).toEqual([
      { step: 1, active: true, done: false },
      { step: 2, active: false, done: false },
      { step: 3, active: false, done: false },
      { step: 4, active: false, done: false },
    ]);

    wiz.enableNext();
    wiz.nextStep(); // Step 2
    expect(wiz.stepIndicators).toEqual([
      { step: 1, active: false, done: true },
      { step: 2, active: true, done: false },
      { step: 3, active: false, done: false },
      { step: 4, active: false, done: false },
    ]);

    wiz.enableNext();
    wiz.nextStep(); // Step 3
    expect(wiz.stepIndicators[0].done).toBe(true);
    expect(wiz.stepIndicators[1].done).toBe(true);
    expect(wiz.stepIndicators[2].active).toBe(true);
  });

  test('Komplett-Durchlauf: Step 1 → 2 → 3 → 4 → Finish', () => {
    wiz.start();
    wiz.enableNext();
    wiz.nextStep(); // → 2
    wiz.enableNext();
    wiz.nextStep(); // → 3
    wiz.nextStep(); // → 4
    expect(wiz.currentStep).toBe(4);
    expect(wiz.btnNextText).toBe('Fertig ✓');

    wiz.nextStep(); // → finish (Step 4 ist letzter)
    expect(wiz.completed).toBe(true);
    expect(wiz.overlayVisible).toBe(false);
  });

  test('Skip: beendet Wizard sofort', () => {
    wiz.start();
    wiz.skip();
    expect(wiz.completed).toBe(true);
    expect(wiz.overlayVisible).toBe(false);
  });

  test('Skip von Mitte: beendet Wizard', () => {
    wiz.start();
    wiz.enableNext();
    wiz.nextStep(); // Step 2
    wiz.skip();
    expect(wiz.completed).toBe(true);
    expect(wiz.overlayVisible).toBe(false);
  });

  test('nextStep auf Step 4 ruft finish auf', () => {
    wiz.start();
    wiz.showStep(4); // direkt zu Step 4
    wiz.nextStep();
    expect(wiz.completed).toBe(true);
  });

  test('showStep setzt btnNextDisabled immer erst auf true', () => {
    wiz.start();
    wiz.enableNext();
    expect(wiz.btnNextDisabled).toBe(false);

    // Wenn man showStep nochmal aufruft, wird disabled zurückgesetzt
    // Step 1 (CWD) und Step 2 (Login) bleiben disabled, andere werden sofort enabled
    wiz.showStep(2);
    expect(wiz.btnNextDisabled).toBe(true); // Login → disabled bis auth ok

    wiz.showStep(3);
    expect(wiz.btnNextDisabled).toBe(false); // Placeholder → sofort enabled
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 4: Login-Step States (UI-Zustandsmaschine)
// ═══════════════════════════════════════════════════════════════

/**
 * State Machine für den Login-Step im Onboarding.
 * Bildet die verschiedenen UI-Zustände ab:
 * - checking: auth:check läuft
 * - authenticated: User eingeloggt
 * - not-authenticated: User nicht eingeloggt
 * - error: auth:check fehlgeschlagen
 * - logging-in: auth:login läuft
 * - login-success: Login erfolgreich
 * - login-error: Login fehlgeschlagen
 */
class LoginStepStateMachine {
  constructor() {
    this.state = 'idle';
    this.user = null;
    this.error = null;
    this.btnNextEnabled = false;
    this.loginBtnVisible = false;
    this.spinnerVisible = false;
    this.statusClass = '';
  }

  startCheck() {
    this.state = 'checking';
    this.spinnerVisible = true;
    this.loginBtnVisible = false;
    this.btnNextEnabled = false;
    this.statusClass = '';
  }

  checkSuccess(authenticated, user) {
    this.spinnerVisible = false;
    if (authenticated) {
      this.state = 'authenticated';
      this.user = user;
      this.btnNextEnabled = true;
      this.loginBtnVisible = false;
      this.statusClass = 'onboarding-login__status--ok';
    } else {
      this.state = 'not-authenticated';
      this.user = null;
      this.btnNextEnabled = false;
      this.loginBtnVisible = true;
      this.statusClass = 'onboarding-login__status--warn';
    }
  }

  checkError(errorMsg) {
    this.state = 'error';
    this.spinnerVisible = false;
    this.error = errorMsg;
    this.loginBtnVisible = false;
    this.btnNextEnabled = false;
    this.statusClass = 'onboarding-login__status--error';
  }

  startLogin() {
    this.state = 'logging-in';
    this.spinnerVisible = true;
    this.loginBtnVisible = false;
    this.statusClass = '';
  }

  loginSuccess() {
    this.state = 'login-success';
    this.spinnerVisible = false;
    this.btnNextEnabled = true;
    this.loginBtnVisible = false;
    this.statusClass = 'onboarding-login__status--ok';
  }

  loginError(errorMsg) {
    this.state = 'login-error';
    this.spinnerVisible = false;
    this.error = errorMsg;
    this.loginBtnVisible = true; // "Erneut versuchen" Button
    this.btnNextEnabled = false;
    this.statusClass = 'onboarding-login__status--error';
  }
}

describe('Login-Step State Machine', () => {
  let login;

  beforeEach(() => {
    login = new LoginStepStateMachine();
  });

  test('initial: idle, kein Spinner, kein Login-Button', () => {
    expect(login.state).toBe('idle');
    expect(login.spinnerVisible).toBe(false);
    expect(login.loginBtnVisible).toBe(false);
    expect(login.btnNextEnabled).toBe(false);
  });

  // ── Checking State ──

  test('startCheck: Spinner sichtbar, Next disabled', () => {
    login.startCheck();
    expect(login.state).toBe('checking');
    expect(login.spinnerVisible).toBe(true);
    expect(login.btnNextEnabled).toBe(false);
    expect(login.loginBtnVisible).toBe(false);
  });

  // ── Authenticated ──

  test('checkSuccess(true, user): authenticated, Next enabled, User gesetzt', () => {
    login.startCheck();
    login.checkSuccess(true, 'testuser');
    expect(login.state).toBe('authenticated');
    expect(login.user).toBe('testuser');
    expect(login.btnNextEnabled).toBe(true);
    expect(login.spinnerVisible).toBe(false);
    expect(login.statusClass).toBe('onboarding-login__status--ok');
  });

  test('checkSuccess(true, null): authenticated ohne User', () => {
    login.startCheck();
    login.checkSuccess(true, null);
    expect(login.state).toBe('authenticated');
    expect(login.user).toBe(null);
    expect(login.btnNextEnabled).toBe(true);
  });

  // ── Not Authenticated ──

  test('checkSuccess(false): not-authenticated, Login-Button sichtbar', () => {
    login.startCheck();
    login.checkSuccess(false, null);
    expect(login.state).toBe('not-authenticated');
    expect(login.loginBtnVisible).toBe(true);
    expect(login.btnNextEnabled).toBe(false);
    expect(login.statusClass).toBe('onboarding-login__status--warn');
  });

  // ── Check Error ──

  test('checkError: Error-State, kein Login-Button', () => {
    login.startCheck();
    login.checkError('Network error');
    expect(login.state).toBe('error');
    expect(login.error).toBe('Network error');
    expect(login.spinnerVisible).toBe(false);
    expect(login.btnNextEnabled).toBe(false);
    expect(login.statusClass).toBe('onboarding-login__status--error');
  });

  // ── Login Flow ──

  test('startLogin: Spinner, kein Login-Button', () => {
    login.startCheck();
    login.checkSuccess(false, null);
    login.startLogin();
    expect(login.state).toBe('logging-in');
    expect(login.spinnerVisible).toBe(true);
    expect(login.loginBtnVisible).toBe(false);
  });

  test('loginSuccess: Next enabled, ok-Status', () => {
    login.startCheck();
    login.checkSuccess(false, null);
    login.startLogin();
    login.loginSuccess();
    expect(login.state).toBe('login-success');
    expect(login.btnNextEnabled).toBe(true);
    expect(login.spinnerVisible).toBe(false);
    expect(login.statusClass).toBe('onboarding-login__status--ok');
  });

  test('loginError: Error-State, Retry-Button sichtbar', () => {
    login.startCheck();
    login.checkSuccess(false, null);
    login.startLogin();
    login.loginError('Auth failed');
    expect(login.state).toBe('login-error');
    expect(login.error).toBe('Auth failed');
    expect(login.loginBtnVisible).toBe(true);
    expect(login.btnNextEnabled).toBe(false);
    expect(login.statusClass).toBe('onboarding-login__status--error');
  });

  // ── Retry Flow ──

  test('Login-Retry: loginError → startLogin → loginSuccess', () => {
    login.startCheck();
    login.checkSuccess(false, null);
    login.startLogin();
    login.loginError('Timeout');

    // Retry
    login.startLogin();
    expect(login.state).toBe('logging-in');
    expect(login.spinnerVisible).toBe(true);

    login.loginSuccess();
    expect(login.state).toBe('login-success');
    expect(login.btnNextEnabled).toBe(true);
  });

  // ── Komplett-Szenario ──

  test('Komplett-Szenario: check → not-auth → login → success', () => {
    login.startCheck();
    expect(login.state).toBe('checking');

    login.checkSuccess(false, null);
    expect(login.state).toBe('not-authenticated');
    expect(login.loginBtnVisible).toBe(true);

    login.startLogin();
    expect(login.state).toBe('logging-in');

    login.loginSuccess();
    expect(login.state).toBe('login-success');
    expect(login.btnNextEnabled).toBe(true);
  });

  test('Komplett-Szenario: check → authenticated (kein Login nötig)', () => {
    login.startCheck();
    login.checkSuccess(true, 'devuser');
    expect(login.state).toBe('authenticated');
    expect(login.btnNextEnabled).toBe(true);
    expect(login.loginBtnVisible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 5: Integration — Wizard + Login kombiniert
// ═══════════════════════════════════════════════════════════════

describe('Wizard + Login Integration', () => {
  test('Login authenticated → Next enabled → can proceed to Step 2', () => {
    const wiz = new OnboardingWizardStateMachine();
    const login = new LoginStepStateMachine();

    wiz.start(); // Step 1
    login.startCheck();
    login.checkSuccess(true, 'user1');

    // Login-Erfolg aktiviert Next
    wiz.enableNext();
    expect(wiz.btnNextDisabled).toBe(false);

    wiz.nextStep();
    expect(wiz.currentStep).toBe(2);
  });

  test('Login not-authenticated → Next bleibt disabled → Skip weiterhin möglich', () => {
    const wiz = new OnboardingWizardStateMachine();
    const login = new LoginStepStateMachine();

    wiz.start();
    login.startCheck();
    login.checkSuccess(false, null);

    // Next bleibt disabled
    expect(wiz.btnNextDisabled).toBe(true);

    // Skip geht immer
    wiz.skip();
    expect(wiz.completed).toBe(true);
  });

  test('Login nach Retry → Next wird enabled', () => {
    const wiz = new OnboardingWizardStateMachine();
    const login = new LoginStepStateMachine();

    wiz.start();
    login.startCheck();
    login.checkSuccess(false, null);
    login.startLogin();
    login.loginError('Timeout');

    expect(wiz.btnNextDisabled).toBe(true);

    // Retry erfolgreich
    login.startLogin();
    login.loginSuccess();
    wiz.enableNext();

    expect(wiz.btnNextDisabled).toBe(false);
    wiz.nextStep();
    expect(wiz.currentStep).toBe(2);
  });
});
