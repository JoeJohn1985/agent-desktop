// ── Todos Module ────────────────────────────────────────────
// Extracted from app.js — Todo list management
'use strict';

/** @type {Array<{id: string, text: string, status: 'open'|'done'}>} */
let currentTodos = [];

/**
 * Lädt die Todos einer Session vom Backend und rendert sie.
 * Versteckt die Todo-Sektion wenn keine Session aktiv ist.
 *
 * @param {string|null} sessionId - Die aktive Session-ID oder null
 * @returns {Promise<void>}
 */
async function loadTodos(sessionId) {
  if (!sessionId) {
    currentTodos = [];
    renderTodos();
    document.getElementById('todosSection').style.display = 'none';
    return;
  }
  document.getElementById('todosSection').style.display = '';
  try {
    currentTodos = await copilot.todos.list(sessionId) || [];
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
  const openCount = currentTodos.filter(t => t.status === 'open').length;
  const totalCount = currentTodos.length;
  document.getElementById('todoCount').textContent =
    totalCount > 0 ? `${openCount}/${totalCount}` : '0';

  if (currentTodos.length === 0) {
    container.innerHTML = '<p style="padding:8px 10px;color:var(--text-muted);font-size:12px;">Keine Todos vorhanden</p>';
    return;
  }

  // Open items first, then done
  const sorted = [...currentTodos].sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (a.status !== 'open' && b.status === 'open') return 1;
    return 0;
  });

  container.innerHTML = sorted.map(t => {
    const checked = t.status === 'done' ? 'checked' : '';
    const doneClass = t.status === 'done' ? 'todo-item--done' : '';
    return `
      <div class="todo-item ${doneClass}" data-id="${t.id}" draggable="true">
        <span class="todo-item__grip">⠿</span>
        <label class="todo-item__check">
          <input type="checkbox" ${checked} onchange="toggleTodo('${escapeAttr(t.id)}')" />
        </label>
        <span class="todo-item__text" data-tooltip="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
        <button class="todo-item__delete" onclick="deleteTodo('${escapeAttr(t.id)}')" data-tooltip="Löschen">🗑️</button>
      </div>
    `;
  }).join('');

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
      if (activeSessionId) {
        copilot.todos.reorder(activeSessionId, orderedIds);
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
  if (!text || !activeSessionId) return;

  try {
    currentTodos = await copilot.todos.add(activeSessionId, { text }) || currentTodos;
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
  if (!todo || !activeSessionId) return;
  const newStatus = todo.status === 'done' ? 'open' : 'done';
  try {
    currentTodos = await copilot.todos.update(activeSessionId, todoId, { status: newStatus }) || currentTodos;
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
  if (!activeSessionId) return;
  try {
    currentTodos = await copilot.todos.delete(activeSessionId, todoId) || currentTodos;
  } catch (e) {
    console.warn('[todos] Löschen fehlgeschlagen:', e.message);
    showNotification('Todo konnte nicht gelöscht werden', 'error');
    return;
  }
  renderTodos();
}
