// ── Test Runner Module ───────────────────────────────────────
// Extracted from app.js — Test runner popup and result rendering
'use strict';

/**
 * Wire the test-runner popup's open/close/run buttons.
 */
function initTestRunner() {
  document.getElementById('btnTests')?.addEventListener('click', openTestRunner);
  document.getElementById('btnCloseTestRunner')?.addEventListener('click', closeTestRunner);
  document.getElementById('btnRunTests')?.addEventListener('click', runTests);
  document.getElementById('btnRunE2E')?.addEventListener('click', runE2E);
  document.getElementById('btnRunCoverage')?.addEventListener('click', runCoverage);
}

function openTestRunner() {
  let backdrop = document.getElementById('testRunnerBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'testRunnerBackdrop';
    backdrop.className = 'test-runner-backdrop';
    backdrop.addEventListener('click', closeTestRunner);
    document.body.appendChild(backdrop);
  }
  backdrop.style.display = 'block';
  document.getElementById('testRunnerPopup').style.display = 'flex';
}

function closeTestRunner() {
  document.getElementById('testRunnerPopup').style.display = 'none';
  const backdrop = document.getElementById('testRunnerBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

async function runTests() {
  const body = document.getElementById('testRunnerBody');
  body.innerHTML = '<div class="test-runner__loading">Tests werden ausgeführt…</div>';

  try {
    const result = await desktop.tests.run();
    renderTestResults(result, body);
  } catch (e) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

async function runCoverage() {
  const body = document.getElementById('testRunnerBody');
  body.innerHTML = '<div class="test-runner__loading">Coverage wird berechnet…</div>';

  try {
    const result = await desktop.tests.coverage();
    renderCoverageResults(result, body);
  } catch (e) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

async function runE2E() {
  const body = document.getElementById('testRunnerBody');
  body.innerHTML = '<div class="test-runner__loading">🎭 Playwright E2E Tests werden ausgeführt…</div>';

  try {
    const result = await desktop.tests.e2e();
    renderTestResults(result, body);
  } catch (e) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

function renderTestResults(result, body) {
  if (result.error) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">❌ ${escapeHtml(result.error)}</div>`;
    return;
  }

  const icon = result.success ? '✅' : '❌';
  const durationSec = (result.duration / 1000).toFixed(1);

  let html = `<div class="test-runner__summary">
    <span class="test-runner__stat test-runner__stat--total">${icon} ${result.numTotal} Tests</span>
    <span class="test-runner__stat test-runner__stat--pass">✅ ${result.numPassed} bestanden</span>
    <span class="test-runner__stat test-runner__stat--fail">❌ ${result.numFailed} fehlgeschlagen</span>
    <span class="test-runner__stat test-runner__stat--time">⏱️ ${durationSec}s</span>
  </div>`;

  for (const suite of (result.testResults || [])) {
    const suiteIcon = suite.status === 'passed' ? '✅' : '❌';
    const suiteDuration = suite.duration ? `${suite.duration}ms` : '';

    html += `<div class="test-runner__suite">
      <div class="test-runner__suite-header" data-toggle-suite>
        <span>${suiteIcon} ${escapeHtml(suite.name)}</span>
        <span class="test-runner__test-duration">${suiteDuration}</span>
      </div>
      <ul class="test-runner__suite-tests">`;

    for (const test of (suite.tests || [])) {
      const testIcon = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
      const testClass = test.status === 'passed' ? 'test-runner__test--passed' : test.status === 'failed' ? 'test-runner__test--failed' : '';
      const testDur = test.duration != null ? `${test.duration}ms` : '';

      html += `<li class="test-runner__test ${testClass}">
        <span>${testIcon} ${escapeHtml(test.title)}</span>
        <span class="test-runner__test-duration">${testDur}</span>
      </li>`;

      if (test.failureMessages && test.failureMessages.length) {
        html += `<li class="test-runner__test" style="color:#f38ba8;padding-left:36px;font-family:monospace;font-size:10px;white-space:pre-wrap;">${escapeHtml(test.failureMessages.join('\n'))}</li>`;
      }
    }

    html += `</ul></div>`;
  }

  body.innerHTML = html;

  // Auf-/Zuklappen der Suiten: delegierter Listener statt Inline-onclick —
  // die CSP erlaubt kein 'unsafe-inline' für Skripte mehr.
  body.onclick = (e) => {
    const header = e.target.closest('[data-toggle-suite]');
    if (!header) return;
    const list = header.nextElementSibling;
    if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
  };
}

function renderCoverageResults(result, body) {
  if (result.error) {
    body.innerHTML = `<div class="test-runner-popup__empty" style="color:#f38ba8;">❌ ${escapeHtml(result.error)}</div>`;
    return;
  }

  let html = `<div class="test-runner__summary">
    <span class="test-runner__stat test-runner__stat--total">📊 Coverage</span>
    <span class="test-runner__stat test-runner__stat--pass">✅ ${result.numPassed}/${result.numTotal} Tests</span>
  </div>`;

  if (result.files && result.files.length) {
    html += '<div class="test-runner__suite"><div class="test-runner__suite-header" style="cursor:default;"><span>Datei</span><span>Statements</span></div><ul class="test-runner__suite-tests">';
    for (const file of result.files) {
      const color = file.stmts > 80 ? '#a6e3a1' : file.stmts > 50 ? '#fab387' : '#f38ba8';
      html += `<li class="test-runner__test"><span>${escapeHtml(file.file)}</span><span style="color:${color};font-weight:600;">${file.stmts}%</span></li>`;
    }
    html += '</ul></div>';
  }

  body.innerHTML = html;
}
