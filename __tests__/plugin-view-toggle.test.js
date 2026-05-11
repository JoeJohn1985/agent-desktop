/**
 * Tests für Plugin-View Toggle und Marketplace-Management Logik.
 *
 * Da renderer/app.js ein Browser-Script ist, extrahieren wir die
 * Zustandslogik (state machine) für den Plugin-View Toggle und testen sie isoliert.
 * Ergänzt ui-state-machine.test.js um Plugin-spezifische Zustandsübergänge.
 */

// ── Plugin View State Machine (extrahiert aus renderer/app.js) ──

class PluginViewStateMachine {
  constructor() {
    this.pluginsViewActive = false;
  }

  /**
   * Toggle: Wenn pluginsView aktiv → switchToChatView, sonst → switchToPluginsView.
   * Entspricht dem onclick="pluginsViewActive ? switchToChatView() : switchToPluginsView()"
   */
  togglePluginView() {
    if (this.pluginsViewActive) {
      this.switchToChatView();
    } else {
      this.switchToPluginsView();
    }
  }

  switchToPluginsView() {
    this.pluginsViewActive = true;
  }

  switchToChatView() {
    if (!this.pluginsViewActive) return; // guard wie in app.js
    this.pluginsViewActive = false;
  }
}

// ── Marketplace Order Logic (extrahiert aus app.js loadPlugins) ──

/**
 * Marketplaces werden in der Reihenfolge gerendert, wie sie in der `marketplaces`-Array
 * stehen. Beim Hinzufügen wird per `loadPlugins()` die Liste neu geladen.
 * Die Reihenfolge kommt vom Backend (listMarketplaces).
 * 
 * Wir testen hier die Rendering-Reihenfolge: Index 0 wird zuerst im HTML ausgegeben.
 */
function getMarketplaceSectionIds(marketplaces) {
  return marketplaces.map((_, i) => `plugin-section-mp-${i}`);
}

/**
 * Simuliert die Entfernen-Button-Generierung pro Marketplace.
 */
function getRemoveButtonHtml(marketplace) {
  const name = marketplace.name || marketplace.marketplace;
  return `<button class="plugin-section__remove-btn" onclick="removeMarketplace('${name}')" title="Marketplace entfernen">✕</button>`;
}

// ── Tests: Plugin-View Toggle ────────────────────────────────

describe('Plugin-View Toggle State Machine', () => {
  let sm;

  beforeEach(() => {
    sm = new PluginViewStateMachine();
  });

  test('initial ist pluginsViewActive false', () => {
    expect(sm.pluginsViewActive).toBe(false);
  });

  test('erster Klick auf Plugin-Button öffnet Plugin-View', () => {
    sm.togglePluginView();
    expect(sm.pluginsViewActive).toBe(true);
  });

  test('zweiter Klick auf Plugin-Button schließt Plugin-View', () => {
    sm.togglePluginView(); // öffnen
    sm.togglePluginView(); // schließen
    expect(sm.pluginsViewActive).toBe(false);
  });

  test('dritter Klick öffnet wieder', () => {
    sm.togglePluginView(); // öffnen
    sm.togglePluginView(); // schließen
    sm.togglePluginView(); // öffnen
    expect(sm.pluginsViewActive).toBe(true);
  });

  test('switchToChatView tut nichts wenn bereits in Chat-View', () => {
    expect(sm.pluginsViewActive).toBe(false);
    sm.switchToChatView(); // guard: keine Änderung
    expect(sm.pluginsViewActive).toBe(false);
  });

  test('switchToPluginsView setzt pluginsViewActive auf true', () => {
    sm.switchToPluginsView();
    expect(sm.pluginsViewActive).toBe(true);
  });

  test('switchToChatView setzt pluginsViewActive auf false', () => {
    sm.switchToPluginsView();
    sm.switchToChatView();
    expect(sm.pluginsViewActive).toBe(false);
  });

  test('Tab-Wechsel zu Chat schließt Plugin-View (Szenario)', () => {
    sm.switchToPluginsView();
    expect(sm.pluginsViewActive).toBe(true);
    // Beim Tab-Wechsel wird switchToChatView() aufgerufen
    sm.switchToChatView();
    expect(sm.pluginsViewActive).toBe(false);
  });
});

// ── Tests: Marketplace Rendering-Reihenfolge ─────────────────

describe('Marketplace Rendering-Reihenfolge', () => {

  test('Section-IDs werden sequentiell vergeben', () => {
    const marketplaces = [
      { marketplace: 'github/mp-first', plugins: [] },
      { marketplace: 'github/mp-second', plugins: [] },
      { marketplace: 'github/mp-third', plugins: [] },
    ];
    const ids = getMarketplaceSectionIds(marketplaces);
    expect(ids).toEqual([
      'plugin-section-mp-0',
      'plugin-section-mp-1',
      'plugin-section-mp-2',
    ]);
  });

  test('erster Marketplace (Index 0) hat niedrigste Section-ID', () => {
    const marketplaces = [
      { marketplace: 'newest', plugins: [] },
      { marketplace: 'oldest', plugins: [] },
    ];
    const ids = getMarketplaceSectionIds(marketplaces);
    // Index 0 = erster gerendert
    expect(ids[0]).toBe('plugin-section-mp-0');
  });

  test('leere Marketplace-Liste ergibt leere Section-IDs', () => {
    expect(getMarketplaceSectionIds([])).toEqual([]);
  });
});

// ── Tests: Marketplace Remove-Button ─────────────────────────

describe('Marketplace Remove-Button', () => {

  test('generiert Remove-Button mit Marketplace-Name', () => {
    const html = getRemoveButtonHtml({ marketplace: 'github/test', name: 'test-mp' });
    expect(html).toContain('removeMarketplace');
    expect(html).toContain('test-mp');
    expect(html).toContain('plugin-section__remove-btn');
    expect(html).toContain('✕');
  });

  test('verwendet marketplace als Fallback wenn name fehlt', () => {
    const html = getRemoveButtonHtml({ marketplace: 'github/fallback' });
    expect(html).toContain('github/fallback');
  });

  test('Button hat title="Marketplace entfernen"', () => {
    const html = getRemoveButtonHtml({ marketplace: 'x', name: 'y' });
    expect(html).toContain('title="Marketplace entfernen"');
  });
});

// ── Tests: Marketplace Add Spinner State ─────────────────────

describe('Marketplace Add/Remove Spinner-Logik', () => {

  /**
   * Simuliert den State eines Add-Dialogs:
   * - disabled = true → Spinner aktiv
   * - disabled = false → bereit
   */
  class AddDialogState {
    constructor() {
      this.addBtnDisabled = false;
      this.cancelBtnDisabled = false;
      this.inputDisabled = false;
      this.addBtnText = 'Hinzufügen';
    }

    startAdd() {
      this.addBtnDisabled = true;
      this.cancelBtnDisabled = true;
      this.inputDisabled = true;
      this.addBtnText = '<span class="plugin-spinner"></span> Wird hinzugefügt…';
    }

    finishAdd(success) {
      // Dialog wird entfernt (nicht mehr relevant)
      return success ? 'removed' : 'removed';
    }
  }

  test('initial: Button aktiv, kein Spinner', () => {
    const state = new AddDialogState();
    expect(state.addBtnDisabled).toBe(false);
    expect(state.cancelBtnDisabled).toBe(false);
    expect(state.inputDisabled).toBe(false);
    expect(state.addBtnText).toBe('Hinzufügen');
  });

  test('startAdd: alle Buttons/Input disabled, Spinner im Text', () => {
    const state = new AddDialogState();
    state.startAdd();
    expect(state.addBtnDisabled).toBe(true);
    expect(state.cancelBtnDisabled).toBe(true);
    expect(state.inputDisabled).toBe(true);
    expect(state.addBtnText).toContain('plugin-spinner');
    expect(state.addBtnText).toContain('Wird hinzugefügt');
  });

  test('finishAdd: Dialog wird entfernt (egal ob Erfolg/Fehler)', () => {
    const state = new AddDialogState();
    state.startAdd();
    expect(state.finishAdd(true)).toBe('removed');
    expect(state.finishAdd(false)).toBe('removed');
  });

  /**
   * Simuliert den State eines Remove-Buttons.
   */
  class RemoveButtonState {
    constructor() {
      this.disabled = false;
      this.innerHTML = '✕';
    }

    startRemove() {
      this.disabled = true;
      this.innerHTML = '<span class="plugin-spinner plugin-spinner--sm"></span>';
    }
  }

  test('Remove-Button: initial aktiv mit ✕', () => {
    const state = new RemoveButtonState();
    expect(state.disabled).toBe(false);
    expect(state.innerHTML).toBe('✕');
  });

  test('Remove-Button: startRemove zeigt Spinner und disabled', () => {
    const state = new RemoveButtonState();
    state.startRemove();
    expect(state.disabled).toBe(true);
    expect(state.innerHTML).toContain('plugin-spinner');
    expect(state.innerHTML).toContain('plugin-spinner--sm');
  });
});
