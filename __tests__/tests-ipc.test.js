/**
 * Unit-Tests für src/ipc/tests-ipc.js
 */
'use strict';

// Mock electron
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
}));

// Mock child_process
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const { ipcMain } = require('electron');
const { execFile } = require('child_process');

describe('registerTestsIPC', () => {
  let handlers;

  function getHandler(channel) {
    const call = handlers.find(c => c[0] === channel);
    if (!call) throw new Error(`Handler not found: ${channel}`);
    return call[1];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    const { registerTestsIPC } = require('../src/ipc/tests-ipc');
    registerTestsIPC({
      __dirname: '/fake/project',
      TEST_RUN_TIMEOUT_MS: 30000,
      TEST_COVERAGE_TIMEOUT_MS: 60000,
    });
    handlers = ipcMain.handle.mock.calls;
  });

  // ── Registration ──────────────────────────────────────────────

  test('registriert alle 3 IPC-Handler', () => {
    const channels = handlers.map(c => c[0]);
    expect(channels).toEqual(expect.arrayContaining(['tests:run', 'tests:coverage', 'tests:e2e']));
    expect(channels).toHaveLength(3);
  });

  // ── tests:run ─────────────────────────────────────────────────

  test('tests:run parsed erfolgreiche Jest-Ausgabe', async () => {
    const jestOutput = {
      success: true,
      numPassedTests: 10,
      numFailedTests: 0,
      numTotalTests: 10,
      numTotalTestSuites: 3,
      numPassedTestSuites: 3,
      startTime: Date.now() - 1000,
      testResults: [
        {
          name: '/fake/project/__tests__/utils.test.js',
          status: 'passed',
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          assertionResults: [
            { title: 'adds numbers', fullName: 'math adds numbers', status: 'passed', duration: 5, failureMessages: [] },
          ],
        },
      ],
    };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify(jestOutput), '');
    });

    const result = await getHandler('tests:run')();

    expect(result.success).toBe(true);
    expect(result.numPassed).toBe(10);
    expect(result.numFailed).toBe(0);
    expect(result.numTotal).toBe(10);
    expect(result.numSuites).toBe(3);
    expect(result.numSuitesPassed).toBe(3);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.testResults).toHaveLength(1);
    expect(result.testResults[0].name).toBe('/__tests__/utils.test.js');
    expect(result.testResults[0].tests[0].title).toBe('adds numbers');
  });

  test('tests:run behandelt fehlgeschlagene Tests', async () => {
    const jestOutput = {
      success: false,
      numPassedTests: 8,
      numFailedTests: 2,
      numTotalTests: 10,
      numTotalTestSuites: 3,
      numPassedTestSuites: 1,
      startTime: Date.now() - 2000,
      testResults: [
        {
          name: '/fake/project/__tests__/broken.test.js',
          status: 'failed',
          startTime: Date.now() - 2000,
          endTime: Date.now(),
          assertionResults: [
            { title: 'fails', fullName: 'broken fails', status: 'failed', duration: 10, failureMessages: ['Expected true, got false'] },
          ],
        },
      ],
    };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('exit code 1'), JSON.stringify(jestOutput), '');
    });

    const result = await getHandler('tests:run')();
    expect(result.success).toBe(false);
    expect(result.numFailed).toBe(2);
    expect(result.testResults[0].tests[0].failureMessages).toContain('Expected true, got false');
  });

  test('tests:run behandelt JSON-Parse-Fehler', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('crash'), 'not valid json', 'fatal error');
    });

    const result = await getHandler('tests:run')();
    expect(result.success).toBe(false);
    expect(result.error).toBe('fatal error');
    expect(result.numPassed).toBe(0);
    expect(result.numTotal).toBe(0);
    expect(result.testResults).toEqual([]);
  });

  test('tests:run verwendet stdout als Fehler wenn kein stderr', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('crash'), 'some stdout garbage', '');
    });

    const result = await getHandler('tests:run')();
    expect(result.success).toBe(false);
    expect(result.error).toBe('some stdout garbage');
  });

  test('tests:run ruft npx jest mit richtigen Optionen auf', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, '{}', '');
    });

    await getHandler('tests:run')().catch(() => {});

    expect(execFile).toHaveBeenCalledWith(
      'npx',
      ['jest', '--json', '--no-coverage'],
      expect.objectContaining({ cwd: '/fake/project', shell: true, timeout: 30000 }),
      expect.any(Function),
    );
  });

  // ── tests:coverage ────────────────────────────────────────────

  test('tests:coverage parsed Coverage-Map korrekt', async () => {
    const jestOutput = {
      success: true,
      numPassedTests: 10,
      numTotalTests: 10,
      coverageMap: {
        '/fake/project/src/utils.js': {
          s: { 0: 1, 1: 1, 2: 0, 3: 1 }, // 3/4 = 75%
        },
        '/fake/project/src/main.js': {
          s: { 0: 1, 1: 1, 2: 1 }, // 3/3 = 100%
        },
      },
    };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify(jestOutput), '');
    });

    const result = await getHandler('tests:coverage')();

    expect(result.success).toBe(true);
    expect(result.numPassed).toBe(10);
    expect(result.numTotal).toBe(10);
    expect(result.files).toHaveLength(2);

    const utilsFile = result.files.find(f => f.file.includes('utils'));
    expect(utilsFile.stmts).toBe(75);

    const mainFile = result.files.find(f => f.file.includes('main'));
    expect(mainFile.stmts).toBe(100);
  });

  test('tests:coverage behandelt leere coverageMap', async () => {
    const jestOutput = { success: true, numPassedTests: 5, numTotalTests: 5 };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify(jestOutput), '');
    });

    const result = await getHandler('tests:coverage')();
    expect(result.success).toBe(true);
    expect(result.files).toEqual([]);
  });

  test('tests:coverage behandelt Parse-Fehler', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('fail'), 'garbage', '');
    });

    const result = await getHandler('tests:coverage')();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.files).toEqual([]);
  });

  test('tests:coverage ruft jest mit --coverage auf', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, '{}', '');
    });

    await getHandler('tests:coverage')().catch(() => {});

    expect(execFile).toHaveBeenCalledWith(
      'npx',
      ['jest', '--coverage', '--json', '--no-color'],
      expect.objectContaining({ cwd: '/fake/project', timeout: 60000 }),
      expect.any(Function),
    );
  });

  // ── tests:e2e ─────────────────────────────────────────────────

  test('tests:e2e parsed Playwright JSON-Ausgabe', async () => {
    const playwrightOutput = {
      stats: { duration: 5000 },
      suites: [
        {
          title: 'App Tests',
          specs: [
            { title: 'loads app', tests: [{ results: [{ status: 'passed', duration: 1000, errors: [] }] }] },
            { title: 'shows sidebar', tests: [{ results: [{ status: 'passed', duration: 500, errors: [] }] }] },
          ],
          suites: [],
        },
      ],
    };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify(playwrightOutput), '');
    });

    const result = await getHandler('tests:e2e')();

    expect(result.success).toBe(true);
    expect(result.numPassed).toBe(2);
    expect(result.numFailed).toBe(0);
    expect(result.numTotal).toBe(2);
    expect(result.numSuites).toBe(1);
    expect(result.numSuitesPassed).toBe(1);
    expect(result.duration).toBe(5000);
    expect(result.testResults[0].tests).toHaveLength(2);
    expect(result.testResults[0].tests[0].title).toBe('loads app');
  });

  test('tests:e2e behandelt fehlgeschlagene Tests', async () => {
    const playwrightOutput = {
      stats: { duration: 3000 },
      suites: [
        {
          title: 'E2E',
          specs: [
            { title: 'fails', tests: [{ results: [{ status: 'failed', duration: 200, errors: [{ message: 'Element not found' }] }] }] },
          ],
          suites: [],
        },
      ],
    };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('exit 1'), JSON.stringify(playwrightOutput), '');
    });

    const result = await getHandler('tests:e2e')();

    expect(result.success).toBe(false);
    expect(result.numFailed).toBe(1);
    expect(result.testResults[0].tests[0].failureMessages).toContain('Element not found');
  });

  test('tests:e2e behandelt verschachtelte Suites', async () => {
    const playwrightOutput = {
      stats: { duration: 2000 },
      suites: [
        {
          title: 'Root',
          specs: [],
          suites: [
            {
              title: 'Nested',
              specs: [
                { title: 'nested test', tests: [{ results: [{ status: 'passed', duration: 100, errors: [] }] }] },
              ],
              suites: [],
            },
          ],
        },
      ],
    };
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify(playwrightOutput), '');
    });

    const result = await getHandler('tests:e2e')();
    expect(result.numTotal).toBe(1);
    expect(result.numPassed).toBe(1);
    // Nested suite has its full path
    expect(result.testResults[0].name).toContain('Nested');
  });

  test('tests:e2e behandelt Parse-Fehler gracefully', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, 'not json output', 'some error');
    });

    const result = await getHandler('tests:e2e')();
    expect(result.success).toBe(true); // no error object → success
    expect(result.error).toContain('some error');
    expect(result.numTotal).toBe(0);
    expect(result.testResults).toEqual([]);
  });

  test('tests:e2e gibt success:false bei error-code', async () => {
    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback({ code: 1 }, 'not json', 'playwright crashed');
    });

    const result = await getHandler('tests:e2e')();
    expect(result.success).toBe(false);
    expect(result.error).toBe('playwright crashed');
  });
});
