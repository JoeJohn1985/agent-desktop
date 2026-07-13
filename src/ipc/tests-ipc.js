// ── Tests IPC Handlers ─────────────────────────────────────────
// Extracted from main.js — test runner and coverage IPC handlers
'use strict';

const { ipcMain } = require('electron');

// Node's execFile defaults stdout/stderr to a 1 MB maxBuffer — jest's --json
// output (esp. --coverage, which embeds a full per-file coverageMap) regularly
// exceeds that as the suite grows, silently truncating stdout mid-string and
// making JSON.parse fail with "Unterminated string in JSON". Raise it well
// past any output we currently produce.
const MAX_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MB

function registerTestsIPC({ __dirname, TEST_RUN_TIMEOUT_MS, TEST_COVERAGE_TIMEOUT_MS }) {

  ipcMain.handle('tests:run', async () => {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('npx', ['jest', '--json', '--no-coverage'], {
        cwd: __dirname,
        shell: true,
        timeout: TEST_RUN_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      }, (_error, stdout, stderr) => {
        try {
          const jsonOutput = JSON.parse(stdout);
          resolve({
            success: jsonOutput.success,
            numPassed: jsonOutput.numPassedTests,
            numFailed: jsonOutput.numFailedTests,
            numTotal: jsonOutput.numTotalTests,
            numSuites: jsonOutput.numTotalTestSuites,
            numSuitesPassed: jsonOutput.numPassedTestSuites,
            duration: jsonOutput.startTime ? Date.now() - jsonOutput.startTime : 0,
            testResults: jsonOutput.testResults.map(suite => ({
              name: suite.name.replace(__dirname, '').replace(/\\/g, '/'),
              status: suite.status,
              duration: suite.endTime - suite.startTime,
              tests: suite.assertionResults.map(t => ({
                title: t.title,
                fullName: t.fullName,
                status: t.status,
                duration: t.duration,
                failureMessages: t.failureMessages || [],
              })),
            })),
          });
        } catch (parseErr) {
          resolve({
            success: false,
            error: stderr || stdout || parseErr.message,
            numPassed: 0,
            numFailed: 0,
            numTotal: 0,
            testResults: [],
          });
        }
      });
    });
  });

  ipcMain.handle('tests:coverage', async () => {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('npx', ['jest', '--coverage', '--json', '--no-color'], {
        cwd: __dirname,
        shell: true,
        timeout: TEST_COVERAGE_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      }, (_error, stdout, _stderr) => {
        try {
          const jsonOutput = JSON.parse(stdout);
          const coverageMap = jsonOutput.coverageMap || {};
          const files = Object.entries(coverageMap).map(([filePath, data]) => {
            const summary = data.s ? Object.values(data.s) : [];
            const totalStatements = summary.length;
            const coveredStatements = summary.filter(v => v > 0).length;
            return {
              file: filePath.replace(__dirname, '').replace(/\\/g, '/'),
              stmts: totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : 0,
            };
          });
          resolve({
            success: jsonOutput.success,
            numPassed: jsonOutput.numPassedTests,
            numTotal: jsonOutput.numTotalTests,
            files,
          });
        } catch (e) {
          resolve({ success: false, error: e.message, files: [] });
        }
      });
    });
  });

  ipcMain.handle('tests:e2e', async () => {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('npx', ['playwright', 'test', '--reporter=json'], {
        cwd: __dirname,
        shell: true,
        timeout: TEST_COVERAGE_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      }, (error, stdout, stderr) => {
        try {
          const jsonOutput = JSON.parse(stdout);
          const suites = jsonOutput.suites || [];
          let numPassed = 0;
          let numFailed = 0;
          let numTotal = 0;
          const testResults = [];

          function collectTests(suite, suiteName) {
            const tests = [];
            for (const spec of (suite.specs || [])) {
              for (const test of (spec.tests || [])) {
                numTotal++;
                const result = test.results && test.results[0];
                const status = result?.status === 'passed' ? 'passed' : 'failed';
                if (status === 'passed') numPassed++;
                else numFailed++;
                tests.push({
                  title: spec.title,
                  fullName: `${suiteName} > ${spec.title}`,
                  status,
                  duration: result?.duration || 0,
                  failureMessages: result?.errors?.map(e => e.message || e.stack || '') || [],
                });
              }
            }
            if (tests.length > 0) {
              testResults.push({
                name: suiteName,
                status: tests.every(t => t.status === 'passed') ? 'passed' : 'failed',
                duration: tests.reduce((s, t) => s + t.duration, 0),
                tests,
              });
            }
            for (const child of (suite.suites || [])) {
              collectTests(child, `${suiteName} > ${child.title}`);
            }
          }

          for (const suite of suites) {
            collectTests(suite, suite.title || 'E2E');
          }

          resolve({
            success: numFailed === 0,
            numPassed,
            numFailed,
            numTotal,
            numSuites: testResults.length,
            numSuitesPassed: testResults.filter(s => s.status === 'passed').length,
            duration: jsonOutput.stats?.duration || 0,
            testResults,
          });
        } catch (parseErr) {
          resolve({
            success: !error || error.code === 0,
            error: stderr || stdout || parseErr.message,
            numPassed: 0,
            numFailed: 0,
            numTotal: 0,
            testResults: [],
          });
        }
      });
    });
  });
}

module.exports = { registerTestsIPC };
