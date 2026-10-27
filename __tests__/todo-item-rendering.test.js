const { escapeHtml, escapeAttr } = require('../src/renderer-logic');

describe('Todo-Item Rendering', () => {
  function renderTodoItem(todo) {
    const checked = todo.status === 'done' ? 'checked' : '';
    const doneClass = todo.status === 'done' ? 'todo-item--done' : '';
    return `
      <div class="todo-item ${doneClass}" data-id="${todo.id}" draggable="true">
        <span class="todo-item__grip">⠿</span>
        <label class="todo-item__check">
          <input type="checkbox" ${checked} onchange="toggleTodo('${escapeAttr(todo.id)}')" />
        </label>
        <span class="todo-item__text" data-tooltip="${escapeHtml(todo.text)}">${escapeHtml(todo.text)}</span>
        <button class="todo-item__delete" onclick="deleteTodo('${escapeAttr(todo.id)}')" data-tooltip="Löschen">🗑️</button>
      </div>
    `;
  }

  test('Lösch-Button enthält 🗑️ Icon (nicht ✕)', () => {
    const html = renderTodoItem({ id: 'test-1', text: 'Test Todo', status: 'open' });
    expect(html).toContain('🗑️');
    expect(html).not.toContain('>✕<');
  });

  test('Lösch-Button hat data-tooltip="Löschen"', () => {
    const html = renderTodoItem({ id: 'test-1', text: 'Test Todo', status: 'open' });
    expect(html).toContain('data-tooltip="Löschen"');
  });

  test('offenes Todo hat kein checked und kein done-class', () => {
    const html = renderTodoItem({ id: 'test-1', text: 'Offen', status: 'open' });
    expect(html).not.toContain('todo-item--done');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toMatch(/checkbox"\s+checked/);
  });

  test('erledigtes Todo hat checked und done-class', () => {
    const html = renderTodoItem({ id: 'test-2', text: 'Erledigt', status: 'done' });
    expect(html).toContain('todo-item--done');
    expect(html).toContain('checked');
  });

  test('HTML-Escaping in Todo-Text', () => {
    const html = renderTodoItem({ id: 'test-3', text: '<script>alert("xss")</script>', status: 'open' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
