// ── Todos Module ────────────────────────────────────────────
// Extracted from app.js — Todo list management
'use strict';

/** @type {Array<{id: string, text: string, status: 'open'|'done'}>} */
let currentTodos = [];
/** Project directory the currently shown todos belong to (or null). */
let todosCwd = null;

/**
 * Lädt die Todos eines Projekts (cwd) vom Backend und rendert sie.
 * Die Todo-Sektion bleibt immer sichtbar, auch ohne aktives
 * Arbeitsverzeichnis oder ganz ohne Todos (dann leerer Zustand).
 *
 * Todos sind projekt- statt session-gebunden: sie liegen unter
 * <cwd>/todo/todos.md und überleben damit das Löschen einer Session.
 *
 * @param {string|null} cwd - Das aktive Arbeitsverzeichnis oder null
 * @returns {Promise<void>}
 */
async function loadTodos(cwd) {
  todosCwd = cwd || null;
  if (!cwd) {
    currentTodos = [];
    renderTodos();
    return;
  }
  try {
    currentTodos = await desktop.todos.list(cwd) || [];
  } catch (e) {
    console.warn('[todos] Laden fehlgeschlagen:', e.message);
    currentTodos = [];
  }
  renderTodos();
}

/**
 * Rendert die Todo-Liste ins DOM.
 * Sortiert offene Todos vor erledigte und aktualisiert den Zähler.
 */
function renderTodos() {
  const container = document.getElementById('todoList');

  if (currentTodos.length === 0) {
    container.innerHTML = emptyStateHtml('✅', 'Keine Todos vorhanden');
    return;
  }

  // Open items first, then done
  const sorted = [...currentTodos].sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (a.status !== 'open' && b.status === 'open') return 1;
    return 0;
  });

  // No inline onchange/onclick with an interpolated id: todo ids are parsed
  // out of <cwd>/todo/todos.md (`<!-- id:(\S+) -->`), i.e. from a file any
  // agent — or a cloned repo — can write. Inside an inline handler the browser
  // HTML-decodes the attribute before JS parses it, so escapeAttr's &#39;
  // would turn back into a quote and let a crafted id run arbitrary code.
  // Delegated listeners read the same value as data, never as code.
  container.innerHTML = sorted.map(t => {
    const checked = t.status === 'done' ? 'checked' : '';
    const doneClass = t.status === 'done' ? 'todo-item--done' : '';
    return `
      <div class="todo-item ${doneClass}" data-id="${escapeAttr(t.id)}" draggable="true">
        <span class="todo-item__grip">⠿</span>
        <label class="todo-item__check">
          <input type="checkbox" ${checked} data-toggle-todo="${escapeAttr(t.id)}" />
        </label>
        <span class="todo-item__text" data-tooltip="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
        <button class="todo-item__delete" data-delete-todo="${escapeAttr(t.id)}" data-tooltip="Löschen">🗑️</button>
      </div>
    `;
  }).join('');

  // Re-attached per render (innerHTML above replaced the previous nodes).
  container.onchange = (e) => {
    const box = e.target.closest('[data-toggle-todo]');
    if (box) toggleTodo(box.dataset.toggleTodo);
  };
  container.onclick = (e) => {
    const del = e.target.closest('[data-delete-todo]');
    if (del) deleteTodo(del.dataset.deleteTodo);
  };

  initTodoDragDrop(container);
}

/**
 * Initialisiert Drag-and-Drop-Reordering für die Todo-Elemente.
 * Persistiert die neue Reihenfolge nach dem Drop via Backend-API.
 *
 * @param {HTMLElement} container - Das DOM-Element das die Todo-Items enthält
 */
function initTodoDragDrop(container) {
  let dragEl = null;

  container.querySelectorAll('.todo-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      dragEl = el;
      el.classList.add('todo-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      if (dragEl) dragEl.classList.remove('todo-item--dragging');
      dragEl = null;
      container.querySelectorAll('.todo-item--drag-over').forEach(x => x.classList.remove('todo-item--drag-over'));
      // Persist new order
      const orderedIds = [...container.querySelectorAll('.todo-item[data-id]')].map(x => x.dataset.id);
      // Update local array to match new order
      const byId = new Map(currentTodos.map(t => [t.id, t]));
      currentTodos = orderedIds.map(id => byId.get(id)).filter(Boolean);
      if (todosCwd) {
        desktop.todos.reorder(todosCwd, orderedIds);
      }
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragEl || el === dragEl) return;
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        container.insertBefore(dragEl, el);
      } else {
        container.insertBefore(dragEl, el.nextSibling);
      }
    });

    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (el !== dragEl) el.classList.add('todo-item--drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('todo-item--drag-over');
    });
  });
}

/**
 * Liest den Text aus dem Eingabefeld und erstellt ein neues Todo.
 * Leert das Eingabefeld bei Erfolg und aktualisiert die Anzeige.
 *
 * @returns {Promise<void>}
 */
async function addTodo() {
  const input = document.getElementById('todoInput');
  const text = input.value.trim();
  if (!text || !todosCwd) return;

  try {
    currentTodos = await desktop.todos.add(todosCwd, { text }) || currentTodos;
  } catch (e) {
    console.warn('[todos] Hinzufügen fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht hinzugefügt werden', 'error');
    return;
  }
  input.value = '';
  renderTodos();
}

/**
 * Wechselt den Status eines Todos zwischen 'open' und 'done'.
 *
 * @param {string} todoId - Die ID des umzuschaltenden Todos
 * @returns {Promise<void>}
 */
async function toggleTodo(todoId) {
  const todo = currentTodos.find(t => t.id === todoId);
  if (!todo || !todosCwd) return;
  const newStatus = todo.status === 'done' ? 'open' : 'done';
  try {
    currentTodos = await desktop.todos.update(todosCwd, todoId, { status: newStatus }) || currentTodos;
  } catch (e) {
    console.warn('[todos] Aktualisieren fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht aktualisiert werden', 'error');
    return;
  }
  renderTodos();
}

/**
 * Löscht ein Todo aus der aktiven Session.
 *
 * @param {string} todoId - Die ID des zu löschenden Todos
 * @returns {Promise<void>}
 */
async function deleteTodo(todoId) {
  if (!todosCwd) return;
  try {
    currentTodos = await desktop.todos.delete(todosCwd, todoId) || currentTodos;
  } catch (e) {
    console.warn('[todos] Löschen fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht gelöscht werden', 'error');
    return;
  }
  renderTodos();
}
