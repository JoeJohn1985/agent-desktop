/**
 * Tests für Rich-Text-Editor:
 * - Content-Sync zwischen Plain-Text und Rich-Text Modus (Toggle)
 * - convertHtmlToMarkdown (inkl. Strikethrough)
 * - Toolbar-Integrität (kein Strikethrough-Button im HTML)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_JS_PATH = path.join(ROOT, 'renderer', 'app.js');
const HTML_PATH = path.join(ROOT, 'renderer', 'index.html');

const appJs = fs.readFileSync(APP_JS_PATH, 'utf-8');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

// ── convertHtmlToMarkdown extrahieren & testen ──────────────────────

// Wir extrahieren die Funktion aus app.js und evaluieren sie in einer
// kontrollierten Umgebung mit gemocktem `document.createElement`.
function loadConvertHtmlToMarkdown() {
  // Extract the function body from app.js
  const fnMatch = appJs.match(
    /function convertHtmlToMarkdown\(html\)\s*\{([\s\S]*?)^\}/m
  );
  if (!fnMatch) throw new Error('convertHtmlToMarkdown not found in app.js');

  // Mock document.createElement('textarea') for HTML entity decoding
  const mockDocument = {
    createElement: () => {
      let _innerHTML = '';
      return {
        get innerHTML() { return _innerHTML; },
        set innerHTML(v) { 
          // Simple entity decode for test purposes
          _innerHTML = v
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        },
        get value() { return _innerHTML; },
      };
    },
  };

  // Build the function with mocked document
  const fn = new Function('document', 'html', `
    ${fnMatch[1]}
  `);

  return (htmlInput) => fn(mockDocument, htmlInput);
}

const convertHtmlToMarkdown = loadConvertHtmlToMarkdown();

describe('convertHtmlToMarkdown', () => {
  // ── Bold ──
  test('konvertiert <b> zu **text**', () => {
    expect(convertHtmlToMarkdown('<b>fett</b>')).toContain('**fett**');
  });

  test('konvertiert <strong> zu **text**', () => {
    expect(convertHtmlToMarkdown('<strong>fett</strong>')).toContain('**fett**');
  });

  // ── Italic ──
  test('konvertiert <i> zu *text*', () => {
    expect(convertHtmlToMarkdown('<i>kursiv</i>')).toContain('*kursiv*');
  });

  test('konvertiert <em> zu *text*', () => {
    expect(convertHtmlToMarkdown('<em>kursiv</em>')).toContain('*kursiv*');
  });

  // ── Strikethrough ──
  test('konvertiert <s> zu ~~text~~', () => {
    expect(convertHtmlToMarkdown('<s>gestrichen</s>')).toContain('~~gestrichen~~');
  });

  test('konvertiert <del> zu ~~text~~', () => {
    expect(convertHtmlToMarkdown('<del>gelöscht</del>')).toContain('~~gelöscht~~');
  });

  test('konvertiert <strike> zu ~~text~~', () => {
    expect(convertHtmlToMarkdown('<strike>alt</strike>')).toContain('~~alt~~');
  });

  // ── Listen ──
  test('konvertiert <ul><li> zu Markdown Aufzählung', () => {
    const result = convertHtmlToMarkdown('<ul><li>Eins</li><li>Zwei</li></ul>');
    expect(result).toContain('- Eins');
    expect(result).toContain('- Zwei');
  });

  test('konvertiert <ol><li> zu nummerierter Liste', () => {
    const result = convertHtmlToMarkdown('<ol><li>Eins</li><li>Zwei</li></ol>');
    expect(result).toContain('1. Eins');
    expect(result).toContain('2. Zwei');
  });

  // ── Zeilenumbrüche ──
  test('konvertiert <br> zu Newline', () => {
    const result = convertHtmlToMarkdown('Zeile1<br>Zeile2');
    expect(result).toContain('Zeile1\nZeile2');
  });

  test('konvertiert </p> zu Newline', () => {
    const result = convertHtmlToMarkdown('<p>Absatz1</p><p>Absatz2</p>');
    expect(result).toContain('Absatz1\n');
    expect(result).toContain('Absatz2\n');
  });

  // ── Leerer Input ──
  test('gibt leeren String für leeren HTML-Input', () => {
    const result = convertHtmlToMarkdown('');
    expect(result).toBe('');
  });

  test('gibt leeren String für nur-Whitespace-HTML', () => {
    const result = convertHtmlToMarkdown('   ');
    expect(result.trim()).toBe('');
  });

  // ── HTML-Tags werden entfernt ──
  test('entfernt unbekannte HTML-Tags', () => {
    const result = convertHtmlToMarkdown('<span class="foo">text</span>');
    expect(result).toContain('text');
    expect(result).not.toContain('<span');
    expect(result).not.toContain('</span>');
  });

  // ── Kombinierter Test ──
  test('konvertiert gemischtes HTML korrekt', () => {
    const input = '<p><b>Titel</b></p><ul><li>Punkt 1</li><li>Punkt 2</li></ul>';
    const result = convertHtmlToMarkdown(input);
    expect(result).toContain('**Titel**');
    expect(result).toContain('- Punkt 1');
    expect(result).toContain('- Punkt 2');
  });
});

// ── Content-Sync Toggle (Quellcode-Analyse) ─────────────────────────

describe('Content-Sync Toggle (Implementierungs-Verifikation)', () => {
  // Wir testen über Quellcode-Analyse, dass die Toggle-Logik korrekt ist.
  // Ein vollständiger DOM-Test wäre E2E; hier prüfen wir die Struktur.

  test('Plain→Rich: chatInput.value wird als innerText in chatInputRich übernommen', () => {
    // Die Zeile: chatInputRich.innerText = chatInput.value;
    expect(appJs).toMatch(/chatInputRich\.innerText\s*=\s*chatInput\.value/);
  });

  test('Rich→Plain: chatInputRich.innerHTML wird via convertHtmlToMarkdown konvertiert', () => {
    // Die Zeile: const markdown = convertHtmlToMarkdown(chatInputRich.innerHTML).trim();
    expect(appJs).toMatch(/convertHtmlToMarkdown\(chatInputRich\.innerHTML\)/);
  });

  test('Rich→Plain: markdown wird in chatInput.value geschrieben', () => {
    // Die Zeile: chatInput.value = markdown;
    expect(appJs).toMatch(/chatInput\.value\s*=\s*markdown/);
  });

  test('Sync bei leerem Inhalt: kein if-Guard vor der Zuweisung (Plain→Rich)', () => {
    // Es darf KEIN if (chatInput.value) Guard vor der innerText-Zuweisung im Toggle-Block stehen
    // Extrahiere nur den Toggle-Block (btnToggle click handler)
    const toggleBlock = appJs.match(
      /btnToggle\.addEventListener\('click',\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/
    );
    expect(toggleBlock).not.toBeNull();
    const block = toggleBlock[1];
    // Innerhalb des Toggle-Blocks: chatInputRich.innerText = chatInput.value ohne if-Guard
    const syncLine = block.match(
      /if\s*\(richTextMode\)\s*\{([\s\S]*?)chatInputRich\.innerText\s*=\s*chatInput\.value/
    );
    expect(syncLine).not.toBeNull();
    // Prüfe: Zwischen "if (richTextMode) {" und der Zuweisung kein "if (chatInput.value"
    const between = syncLine[1];
    expect(between).not.toMatch(/if\s*\(chatInput\.value\b/);
  });

  test('Sync bei leerem Inhalt: kein if-Guard vor der Zuweisung (Rich→Plain)', () => {
    // Es darf KEIN if (chatInputRich.innerHTML) vor convertHtmlToMarkdown stehen
    const toggleBlock = appJs.match(
      /\}\s*else\s*\{([\s\S]*?)convertHtmlToMarkdown\(chatInputRich\.innerHTML\)/
    );
    expect(toggleBlock).not.toBeNull();
    const blockBefore = toggleBlock[1];
    expect(blockBefore).not.toMatch(/if\s*\(chatInputRich\.innerHTML/);
  });
});

// ── Toolbar Integrität ──────────────────────────────────────────────

describe('Rich-Text Toolbar Integrität', () => {
  test('Toolbar existiert im HTML (id="richTextToolbar")', () => {
    expect(html).toMatch(/id=["']richTextToolbar["']/);
  });

  test('Toolbar hat Bold-Button (data-cmd="bold")', () => {
    expect(html).toMatch(/data-cmd=["']bold["']/);
  });

  test('Toolbar hat Italic-Button (data-cmd="italic")', () => {
    expect(html).toMatch(/data-cmd=["']italic["']/);
  });

  test('Toolbar hat insertUnorderedList-Button', () => {
    expect(html).toMatch(/data-cmd=["']insertUnorderedList["']/);
  });

  test('Toolbar hat insertOrderedList-Button', () => {
    expect(html).toMatch(/data-cmd=["']insertOrderedList["']/);
  });

  test('Toolbar hat KEINEN Strikethrough-Button (data-cmd="strikethrough")', () => {
    expect(html).not.toMatch(/data-cmd=["']strikethrough["']/);
  });

  test('convertHtmlToMarkdown unterstützt Strikethrough trotzdem (Funktion vorhanden)', () => {
    // Die Funktion bleibt erhalten für importierten/eingefügten Content
    expect(appJs).toMatch(/<\(s\|strike\|del\)/);
  });
});
