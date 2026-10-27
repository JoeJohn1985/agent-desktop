/* global document, window, getComputedStyle */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const artifactDir = process.env.CHAT_SPACING_ARTIFACT_DIR;

// Execute the actual preload Markdown configuration without starting Electron.
// Sanitization runs in the isolated browser below (DOMPurify needs a DOM).
const bridge = {};
vm.runInNewContext(read('preload.js').split('/**\n * IPC bridge:')[0], {
  require: name => name === 'electron'
    ? { contextBridge: { exposeInMainWorld: (key, value) => { bridge[key] = value; } } }
    : name === 'dompurify' ? { sanitize: html => html } : require(name),
  console,
});
const markdown = [
  '## Ruhiger Chatfluss',
  'Ein Absatz mit **Betonung**, `inlineCode` und einem expliziten\nZeilenumbruch.',
  'Ein zweiter Absatz bleibt klar getrennt.',
  '- Ein langer Listenpunkt mit hängendem Umbruch und genügend Text, damit er auch bei breiten Nachrichten mehrere Zeilen benötigt. '.repeat(2).trim() +
    '\n  - Verschachtelter Punkt\n  - Weiterer Punkt\n- Kompakter zweiter Punkt',
  '1. Loser Listenpunkt\n\n   Absatz innerhalb des Listenpunkts.\n\n2. Weiterer Listenpunkt',
  '> Ein Zitat.\n>\n> Zweiter Zitatabsatz.',
  '```js\nconst message = "Whitespace bleibt erhalten";\n  console.log(message);\n```',
  '| Spalte | Wert |\n| --- | --- |\n| Tabelle | Inhalt |',
  `https://example.com/${'long-link-'.repeat(35)}`,
  '### Abschließende Überschrift',
].join('\n\n');

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
for (const theme of ['light', 'dark']) {
  for (const width of [390, 1200]) {
    test(`${theme}, ${width}px: live and restored Markdown spacing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent('<main class="stream-output stream-output--active"></main>');
      await page.addStyleTag({ content: read('renderer/styles.css') });
      await page.addScriptTag({ path: path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.js') });
      await page.exposeFunction('renderFixtureMarkdown', text => bridge.markdown.render(text));
      const rendered = await page.evaluate(async text => window.DOMPurify.sanitize(
        await window.renderFixtureMarkdown(text),
      ), markdown);
      await page.evaluate(({ theme, rendered }) => {
        document.documentElement.dataset.theme = theme;
        const stream = document.querySelector('main');
        stream.style.fontSize = '16px';
        window.markdown = { render: () => rendered, renderFast: () => rendered };
        window.tabs = new Map([['fixture', { streamEl: stream, statusEl: stream.appendChild(document.createElement('span')) }]]);
        window.desktop = { chat: { onEvent: fn => { window.fixtureEvent = fn; }, onDone: () => {} } };
        window.formatMessageTime = () => '13:39';
        window.scrollToBottom = () => {};
        window.RESIZE_FIT_DELAY_MS = 1;
      }, { theme, rendered });
      await page.addScriptTag({ content: read('renderer/modules/agent-ipc.js') });
      await page.addScriptTag({ content: read('renderer/modules/sessions-sidebar.js') });
      await page.evaluate(text => {
        window.initAgentIPC();
        window.fixtureEvent('fixture', { type: 'assistant.message_delta', data: { deltaContent: text } });
      }, markdown);
      await expect(page.locator('.stream-response p').first()).toBeVisible();
      await page.evaluate(text => {
        window.fixtureEvent('fixture', { type: 'assistant.message', data: { content: text } });
        const stream = document.querySelector('main');
        window.renderSimpleHistory([{ role: 'user', content: 'Nutzertext\nmit Umbruch\n\nund Absatz' },
          { role: 'assistant', content: text }], el => stream.appendChild(el), {});
        window.renderApiHistory([{ role: 'assistant', content: text }], el => stream.appendChild(el), {});
      }, markdown);
      const metrics = await page.locator('.stream-response').evaluateAll(nodes => nodes.map(el => {
        const style = node => getComputedStyle(node);
        const paragraphs = el.querySelectorAll(':scope > p');
        const p = paragraphs[0];
        const next = paragraphs[1];
        const list = el.querySelector('ul');
        const code = el.querySelector('pre code');
        return {
          line: style(el).lineHeight, whitespace: style(el).whiteSpace,
          gap: next.getBoundingClientRect().top - p.getBoundingClientRect().bottom,
          indent: style(list).paddingLeft, itemGap: style(list.firstElementChild).marginBottom,
          nestedGap: style(list.querySelector('ul')).marginTop,
          first: style(el.firstElementChild).marginTop,
          last: style(el.lastElementChild).marginBottom,
          pre: style(code.parentElement).whiteSpace, wordBreak: style(code).wordBreak,
          codeLine: style(code).lineHeight,
          overflow: el.scrollWidth - el.clientWidth,
          looseParagraphGap: style(el.querySelector('ol li p + p')).marginTop,
        };
      }));
      expect(metrics).toHaveLength(3);
      expect(metrics[1]).toEqual(metrics[0]);
      expect(metrics[2]).toEqual(metrics[0]);
      expect(metrics[0]).toMatchObject({
        line: '22.4px', whitespace: 'normal', indent: '24px', first: '0px',
        last: '0px', pre: 'pre', wordBreak: 'normal', nestedGap: '4px',
        looseParagraphGap: '6.4px', codeLine: '21px',
      });
      expect(metrics[0].gap).toBeCloseTo(14.4, 0);
      expect(parseFloat(metrics[0].itemGap)).toBeLessThan(3);
      expect(metrics[0].overflow).toBeLessThanOrEqual(1);
      await expect(page.locator('.stream-input')).toHaveCSS('white-space', 'pre-wrap');
      await expect(page.locator('.stream-input')).toHaveCSS('line-height', '22.4px');
      await expect(page.locator('body')).toHaveCSS('color', theme === 'dark' ? 'rgb(205, 214, 244)' : 'rgb(26, 26, 26)');
      if (artifactDir) {
        await page.screenshot({ path: path.join(artifactDir, `chat-spacing-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.locator('main').evaluate(el => { el.style.fontSize = '20px'; });
      await expect(page.locator('.stream-response').first()).toHaveCSS('line-height', '28px');
      await expect(page.locator('.stream-input')).toHaveCSS('line-height', '28px');
      await expect(page.locator('.stream-input')).toHaveCSS('font-size', '20px');
    });
  }
}
