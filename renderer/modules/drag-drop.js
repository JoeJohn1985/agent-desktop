// ── Drag & Drop Module ────────────────────────────────────────
// Extracted from app.js — whole-window file drop handling.
// Relies on globals provided elsewhere: richTextMode (app.js send-message
// state), resizeChatInput (app.js chat input).
'use strict';

/**
 * Initialize drag-and-drop for files. Dropped files are processed and inserted
 * into the chat input as @-references or inline code blocks.
 *
 * Listens on the whole document, not just the stream area: dropping onto the
 * input box, the sidebar or the tab bar is at least as natural as dropping
 * into the message list. That also closes a real hole — main.js's
 * `will-navigate` guard deliberately lets `file://` through, so a file dropped
 * anywhere unhandled made Electron navigate the window to that file and
 * replace the entire UI with it.
 */
function initDragDrop() {
  const dropOverlay = document.getElementById('dropOverlay');
  let dragCounter = 0;

  // Only react to drags carrying actual files — internal drags (e.g. todo
  // reordering) bubble up here too and must not flash the overlay.
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter++;
    if (dropOverlay) dropOverlay.style.display = 'flex';
  });

  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (dropOverlay) dropOverlay.style.display = 'none';
    }
  });

  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // required, otherwise the drop never fires
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // without this Electron navigates the window to the file
    dragCounter = 0;
    if (dropOverlay) dropOverlay.style.display = 'none';

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const chatInput = document.getElementById('chatInput');
    const parts = [];

    for (const file of files) {
      let filePath;
      try { filePath = desktop.files.getPath(file); } catch (err) { console.warn('[files] getPath fehlgeschlagen:', err.message); continue; }
      if (!filePath) continue;

      const result = await desktop.files.processDropped(filePath);
      switch (result.type) {
        case 'path':
          parts.push(`@${result.path}`);
          break;
        case 'text':
          parts.push(`Datei: \`${result.filename}\`\n\`\`\`${result.lang}\n${result.content}\n\`\`\``);
          break;
        case 'image':
          parts.push(`Bild kopiert: @${result.path}`);
          break;
        case 'copied':
          parts.push(`Datei kopiert: @${result.path}`);
          break;
        case 'error':
          parts.push(`⚠️ ${result.message}`);
          break;
      }
    }

    if (parts.length === 0) return;
    const text = parts.join('\n');

    // Rich-text mode hides the textarea behind a contenteditable — writing to
    // chatInput.value there would drop the path into an invisible field.
    const richInput = document.getElementById('chatInputRich');
    if (richTextMode && richInput) {
      const existing = richInput.innerText.trim();
      richInput.innerText = existing ? `${existing}\n${text}` : text;
      richInput.focus();
      return;
    }
    chatInput.value += (chatInput.value ? '\n' : '') + text;
    resizeChatInput(chatInput);
    chatInput.focus();
  });
}
