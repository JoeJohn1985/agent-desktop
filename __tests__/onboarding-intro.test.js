/**
 * Tests für Onboarding Step 4: Kurzeinführung / Intro-Slides (v0.17.x).
 *
 * Getestet werden:
 * 1. _introSlides Daten — 3 Slides mit icon, title, text; korrekte Reihenfolge
 * 2. IntroStepStateMachine — extrahierte reine State-Logik ohne DOM:
 *    - renderIntroSlide: Zurück/Weiter-Sichtbarkeit, aktiver Dot pro Slide
 *    - updateIntroNextButton: textContent + onclick pro Slide
 *    - Navigation: Weiter/Zurück mit Grenzprüfung
 *    - renderIntroStep: Initialisiert Slide auf 0
 * 3. HTML-Generierung: renderIntroSlideHTML erzeugt korrektes Markup
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// Extrahierte Daten aus renderer/app.js (_introSlides)
// ═══════════════════════════════════════════════════════════════

const _introSlides = [
  { icon: '💬', title: 'Chat-Tabs', text: 'Jede Aufgabe bekommt ihren eigenen Tab. Starte neue Chats mit dem + Button und wechsle zwischen ihnen.' },
  { icon: '🤖', title: 'Skills & Agents', text: 'Aktiviere Skills über das Plugin-Menü. Deine eingerichteten Agents findest du als Befehle direkt im Chat.' },
  { icon: '🚀', title: 'Alles bereit!', text: 'Du kannst jederzeit zurückkehren und weitere Agents und Skills in den Einstellungen hinzufügen.' }
];

// ═══════════════════════════════════════════════════════════════
// Extrahierte Logik: renderIntroSlide HTML-Generierung
// ═══════════════════════════════════════════════════════════════

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Erzeugt das HTML für einen Intro-Slide (pure Funktion, kein DOM nötig).
 * Spiegelt die Logik von renderIntroSlide() in renderer/app.js wider.
 */
function renderIntroSlideHTML(slideIndex) {
  const slide = _introSlides[slideIndex];
  const dots = _introSlides.map((_, i) =>
    `<span class="onboarding-intro__dot${i === slideIndex ? ' onboarding-intro__dot--active' : ''}"></span>`
  ).join('');

  const prevHidden = slideIndex === 0 ? ' style="visibility:hidden"' : '';
  const nextHidden = slideIndex >= _introSlides.length - 1 ? ' style="visibility:hidden"' : '';

  return `
    <div class="onboarding-intro">
      <span class="onboarding-intro__icon">${slide.icon}</span>
      <h2 class="onboarding-intro__title">${escapeHtml(slide.title)}</h2>
      <p class="onboarding-intro__text">${escapeHtml(slide.text)}</p>
      <div class="onboarding-intro__dots">${dots}</div>
      <div class="onboarding-intro__nav">
        <button class="action-btn onboarding-intro__btn-prev"${prevHidden}>← Zurück</button>
        <button class="action-btn onboarding-intro__btn-next"${nextHidden}>Weiter →</button>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// State Machine für Intro-Step (extrahierte Logik aus app.js)
// ═══════════════════════════════════════════════════════════════

/**
 * State Machine für den Intro-Step im Onboarding.
 * Bildet die Logik von renderIntroStep, renderIntroSlide,
 * updateIntroNextButton und Navigation ab.
 */
class IntroStepStateMachine {
  constructor() {
    this.slide = 0;
    this.totalSlides = _introSlides.length;
    // btnNext (der globale "Weiter →" / "Fertig 🎉" Button in der Onboarding-Leiste)
    this.btnNextText = 'Weiter →';
    this.btnNextDisabled = false;
    this.btnNextOnclick = null; // null = kein finishOnboarding, truthy = finishOnboarding gesetzt
    // Inline Prev/Next Buttons (innerhalb des Slide-Contents)
    this.prevVisible = false;
    this.nextVisible = true;
    // Aktiver Dot
    this.activeDot = 0;
  }

  /** renderIntroStep: Initialisiert den Intro-Step */
  init() {
    this.slide = 0;
    this._updateSlideState();
    this._updateBtnNext();
  }

  /** Weiter-Button im Slide geklickt */
  next() {
    if (this.slide < this.totalSlides - 1) {
      this.slide++;
      this._updateSlideState();
      this._updateBtnNext();
    }
  }

  /** Zurück-Button im Slide geklickt */
  prev() {
    if (this.slide > 0) {
      this.slide--;
      this._updateSlideState();
      this._updateBtnNext();
    }
  }

  /** Spiegelt renderIntroSlide(): Sichtbarkeit der Inline-Buttons + Dot */
  _updateSlideState() {
    this.prevVisible = this.slide > 0;
    this.nextVisible = this.slide < this.totalSlides - 1;
    this.activeDot = this.slide;
  }

  /** Spiegelt updateIntroNextButton(): Text + onclick des globalen Buttons */
  _updateBtnNext() {
    if (this.slide >= this.totalSlides - 1) {
      this.btnNextDisabled = false;
      this.btnNextText = 'Fertig 🎉';
      this.btnNextOnclick = null; // nextOnboardingStep handles finish
    } else {
      this.btnNextDisabled = true;
      this.btnNextText = 'Weiter →';
      this.btnNextOnclick = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TEIL 1: _introSlides Daten
// ═══════════════════════════════════════════════════════════════

describe('_introSlides Daten', () => {
  test('genau 3 Slides vorhanden', () => {
    expect(_introSlides).toHaveLength(3);
  });

  test('jeder Slide hat icon, title, text', () => {
    for (const slide of _introSlides) {
      expect(slide).toHaveProperty('icon');
      expect(slide).toHaveProperty('title');
      expect(slide).toHaveProperty('text');
    }
  });

  test('kein Feld ist leer oder undefined', () => {
    for (const slide of _introSlides) {
      expect(slide.icon).toBeTruthy();
      expect(slide.title).toBeTruthy();
      expect(slide.text).toBeTruthy();
    }
  });

  test('Slide 0: 💬 Chat-Tabs', () => {
    expect(_introSlides[0].icon).toBe('💬');
    expect(_introSlides[0].title).toBe('Chat-Tabs');
  });

  test('Slide 1: 🤖 Skills & Agents', () => {
    expect(_introSlides[1].icon).toBe('🤖');
    expect(_introSlides[1].title).toBe('Skills & Agents');
  });

  test('Slide 2: 🚀 Alles bereit!', () => {
    expect(_introSlides[2].icon).toBe('🚀');
    expect(_introSlides[2].title).toBe('Alles bereit!');
  });

  test('Slide-Reihenfolge: Chat-Tabs → Skills & Agents → Alles bereit!', () => {
    const titles = _introSlides.map(s => s.title);
    expect(titles).toEqual(['Chat-Tabs', 'Skills & Agents', 'Alles bereit!']);
  });

  test('alle Texte sind nicht-trivial (mindestens 20 Zeichen)', () => {
    for (const slide of _introSlides) {
      expect(slide.text.length).toBeGreaterThanOrEqual(20);
    }
  });

  test('alle Icons sind einzelne Emoji-Zeichen', () => {
    for (const slide of _introSlides) {
      // Emoji sind 1-2 Code Points, also string.length ≤ 2
      expect(slide.icon.length).toBeLessThanOrEqual(2);
      expect(slide.icon.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 2: Intro-Step UI State Machine
// ═══════════════════════════════════════════════════════════════

describe('Intro-Step UI State Machine', () => {
  let sm;

  beforeEach(() => {
    sm = new IntroStepStateMachine();
  });

  // ── Initialisierung ──

  test('Konstruktor: Slide 0, prevVisible=false, nextVisible=true', () => {
    expect(sm.slide).toBe(0);
    expect(sm.prevVisible).toBe(false);
    expect(sm.nextVisible).toBe(true);
    expect(sm.activeDot).toBe(0);
  });

  test('init() setzt Slide auf 0 und aktualisiert State', () => {
    // Erst weiternavigieren, dann init()
    sm.next();
    sm.next();
    expect(sm.slide).toBe(2);

    sm.init();
    expect(sm.slide).toBe(0);
    expect(sm.prevVisible).toBe(false);
    expect(sm.nextVisible).toBe(true);
    expect(sm.btnNextText).toBe('Weiter →');
    expect(sm.btnNextOnclick).toBeNull();
  });

  // ── renderIntroSlide: Slide-Sichtbarkeit ──

  test('Slide 0: Zurück ausgeblendet, Weiter sichtbar', () => {
    sm.init();
    expect(sm.prevVisible).toBe(false);
    expect(sm.nextVisible).toBe(true);
  });

  test('Slide 1: Zurück UND Weiter sichtbar', () => {
    sm.init();
    sm.next();
    expect(sm.slide).toBe(1);
    expect(sm.prevVisible).toBe(true);
    expect(sm.nextVisible).toBe(true);
  });

  test('Slide 2 (letzter): Weiter ausgeblendet, Zurück sichtbar', () => {
    sm.init();
    sm.next();
    sm.next();
    expect(sm.slide).toBe(2);
    expect(sm.prevVisible).toBe(true);
    expect(sm.nextVisible).toBe(false);
  });

  // ── Dot-Indikator ──

  test('Dot-Indikator: korrekter aktiver Dot pro Slide', () => {
    sm.init();
    expect(sm.activeDot).toBe(0);

    sm.next();
    expect(sm.activeDot).toBe(1);

    sm.next();
    expect(sm.activeDot).toBe(2);

    sm.prev();
    expect(sm.activeDot).toBe(1);
  });

  // ── updateIntroNextButton ──

  test('Slide 0: btnNext textContent = "Weiter →", disabled = true (user uses internal nav)', () => {
    sm.init();
    expect(sm.btnNextText).toBe('Weiter →');
    expect(sm.btnNextOnclick).toBeNull();
    expect(sm.btnNextDisabled).toBe(true);
  });

  test('Slide 1: btnNext textContent = "Weiter →", disabled = true', () => {
    sm.init();
    sm.next();
    expect(sm.btnNextText).toBe('Weiter →');
    expect(sm.btnNextOnclick).toBeNull();
    expect(sm.btnNextDisabled).toBe(true);
  });

  test('Slide 2: btnNext textContent = "Fertig 🎉", disabled = false (finish via nextOnboardingStep)', () => {
    sm.init();
    sm.next();
    sm.next();
    expect(sm.btnNextText).toBe('Fertig 🎉');
    expect(sm.btnNextOnclick).toBeNull();
    expect(sm.btnNextDisabled).toBe(false);
  });

  test('Zurück von Slide 2 auf 1: btnNext wechselt zurück zu "Weiter →", disabled', () => {
    sm.init();
    sm.next();
    sm.next();
    expect(sm.btnNextText).toBe('Fertig 🎉');

    sm.prev();
    expect(sm.btnNextText).toBe('Weiter →');
    expect(sm.btnNextOnclick).toBeNull();
    expect(sm.btnNextDisabled).toBe(true);
  });

  // ── Navigation ──

  test('Weiter-Klick: Slide erhöht sich 0→1→2', () => {
    sm.init();
    expect(sm.slide).toBe(0);

    sm.next();
    expect(sm.slide).toBe(1);

    sm.next();
    expect(sm.slide).toBe(2);
  });

  test('Zurück-Klick: Slide verringert sich 2→1→0', () => {
    sm.init();
    sm.next();
    sm.next();
    expect(sm.slide).toBe(2);

    sm.prev();
    expect(sm.slide).toBe(1);

    sm.prev();
    expect(sm.slide).toBe(0);
  });

  test('Grenze: nicht unter 0', () => {
    sm.init();
    expect(sm.slide).toBe(0);

    sm.prev(); // sollte ignoriert werden
    expect(sm.slide).toBe(0);
    expect(sm.prevVisible).toBe(false);

    sm.prev(); // nochmal
    expect(sm.slide).toBe(0);
  });

  test('Grenze: nicht über 2', () => {
    sm.init();
    sm.next();
    sm.next();
    expect(sm.slide).toBe(2);

    sm.next(); // sollte ignoriert werden
    expect(sm.slide).toBe(2);
    expect(sm.nextVisible).toBe(false);

    sm.next(); // nochmal
    expect(sm.slide).toBe(2);
  });

  test('Hin-und-Her-Navigation: konsistenter State', () => {
    sm.init();
    sm.next();   // 0→1
    sm.next();   // 1→2
    sm.prev();   // 2→1
    sm.prev();   // 1→0
    sm.next();   // 0→1

    expect(sm.slide).toBe(1);
    expect(sm.prevVisible).toBe(true);
    expect(sm.nextVisible).toBe(true);
    expect(sm.btnNextText).toBe('Weiter →');
    expect(sm.activeDot).toBe(1);
  });

  // ── renderIntroStep ──

  test('renderIntroStep (init) nach Navigation setzt alles zurück', () => {
    sm.next();
    sm.next();
    expect(sm.slide).toBe(2);
    expect(sm.btnNextText).toBe('Fertig 🎉');

    sm.init(); // = renderIntroStep
    expect(sm.slide).toBe(0);
    expect(sm.btnNextText).toBe('Weiter →');
    expect(sm.prevVisible).toBe(false);
    expect(sm.nextVisible).toBe(true);
    expect(sm.activeDot).toBe(0);
    expect(sm.btnNextOnclick).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 3: HTML-Generierung (renderIntroSlideHTML)
// ═══════════════════════════════════════════════════════════════

describe('renderIntroSlideHTML', () => {
  test('Slide 0: enthält Icon, Titel, Text', () => {
    const html = renderIntroSlideHTML(0);
    expect(html).toContain('💬');
    expect(html).toContain('Chat-Tabs');
    expect(html).toContain('Jede Aufgabe bekommt');
  });

  test('Slide 1: enthält Icon, Titel, Text', () => {
    const html = renderIntroSlideHTML(1);
    expect(html).toContain('🤖');
    expect(html).toContain('Skills &amp; Agents');
    expect(html).toContain('Plugin-Menü');
  });

  test('Slide 2: enthält Icon, Titel, Text', () => {
    const html = renderIntroSlideHTML(2);
    expect(html).toContain('🚀');
    expect(html).toContain('Alles bereit!');
    expect(html).toContain('Einstellungen');
  });

  test('Slide 0: Zurück-Button hat visibility:hidden', () => {
    const html = renderIntroSlideHTML(0);
    expect(html).toMatch(/btn-prev"?\s+style="visibility:hidden"/);
  });

  test('Slide 0: Weiter-Button hat KEIN visibility:hidden', () => {
    const html = renderIntroSlideHTML(0);
    // Weiter-Button sollte KEIN style="visibility:hidden" haben
    expect(html).toMatch(/btn-next"?>/);
    expect(html).not.toMatch(/btn-next"?\s+style="visibility:hidden"/);
  });

  test('Slide 1: weder Zurück noch Weiter hat visibility:hidden', () => {
    const html = renderIntroSlideHTML(1);
    expect(html).not.toMatch(/btn-prev"?\s+style="visibility:hidden"/);
    expect(html).not.toMatch(/btn-next"?\s+style="visibility:hidden"/);
  });

  test('Slide 2: Weiter-Button hat visibility:hidden', () => {
    const html = renderIntroSlideHTML(2);
    expect(html).toMatch(/btn-next"?\s+style="visibility:hidden"/);
  });

  test('Slide 2: Zurück-Button hat KEIN visibility:hidden', () => {
    const html = renderIntroSlideHTML(2);
    expect(html).not.toMatch(/btn-prev"?\s+style="visibility:hidden"/);
  });

  // ── Dot-Indikator im HTML ──

  test('Slide 0: genau 1 aktiver Dot (erster)', () => {
    const html = renderIntroSlideHTML(0);
    const activeDots = html.match(/onboarding-intro__dot--active/g);
    expect(activeDots).toHaveLength(1);
    // Erster Dot ist aktiv: die Spans der Dots extrahieren
    const dotSection = html.match(/onboarding-intro__dots">(.*?)<\/div>/s);
    expect(dotSection).toBeTruthy();
    const spans = dotSection[1].match(/<span[^>]*>/g);
    expect(spans).toHaveLength(3);
    // Erster Span enthält --active
    expect(spans[0]).toContain('onboarding-intro__dot--active');
    expect(spans[1]).not.toContain('--active');
    expect(spans[2]).not.toContain('--active');
  });

  test('Slide 1: genau 1 aktiver Dot (zweiter)', () => {
    const html = renderIntroSlideHTML(1);
    const activeDots = html.match(/onboarding-intro__dot--active/g);
    expect(activeDots).toHaveLength(1);
  });

  test('Slide 2: genau 1 aktiver Dot (dritter)', () => {
    const html = renderIntroSlideHTML(2);
    const activeDots = html.match(/onboarding-intro__dot--active/g);
    expect(activeDots).toHaveLength(1);
  });

  test('jeder Slide hat genau 3 Dots', () => {
    for (let i = 0; i < 3; i++) {
      const html = renderIntroSlideHTML(i);
      const allDots = html.match(/onboarding-intro__dot"/g) || [];
      const activeDots = html.match(/onboarding-intro__dot--active/g) || [];
      // 2 inaktive + 1 aktiver = 3 Dots total
      expect(allDots.length + activeDots.length).toBe(3);
    }
  });

  // ── HTML-Struktur ──

  test('enthält korrektes CSS-Klassen-Grundgerüst', () => {
    const html = renderIntroSlideHTML(0);
    expect(html).toContain('onboarding-intro__icon');
    expect(html).toContain('onboarding-intro__title');
    expect(html).toContain('onboarding-intro__text');
    expect(html).toContain('onboarding-intro__dots');
    expect(html).toContain('onboarding-intro__nav');
    expect(html).toContain('onboarding-intro__btn-prev');
    expect(html).toContain('onboarding-intro__btn-next');
  });

  test('escapeHtml: Sonderzeichen im Titel werden escaped', () => {
    // Slide 1 hat "&" in "Skills & Agents"
    const html = renderIntroSlideHTML(1);
    expect(html).toContain('Skills &amp; Agents');
    expect(html).not.toMatch(/<h2[^>]*>.*Skills & Agents.*<\/h2>/);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEIL 4: escapeHtml Hilfsfunktion
// ═══════════════════════════════════════════════════════════════

describe('escapeHtml', () => {
  test('escaped &', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  test('escaped <', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  test('escaped "', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  test('leerer String bleibt leer', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('String ohne Sonderzeichen bleibt unverändert', () => {
    expect(escapeHtml('Hallo Welt')).toBe('Hallo Welt');
  });
});
