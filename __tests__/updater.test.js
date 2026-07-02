'use strict';

// Pure-logic tests for the git-based self-updater: semver parsing/compare,
// ls-remote tag parsing, latest-stable selection, update detection.

const {
  parseSemver,
  compareSemver,
  parseTagsFromLsRemote,
  pickLatestStableTag,
  isUpdateAvailable,
} = require('../src/updater');

describe('updater: parseSemver', () => {
  it('parst mit und ohne v-Präfix', () => {
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: null });
  });
  it('erkennt Prerelease', () => {
    expect(parseSemver('v0.33.0-beta.1')).toEqual({ major: 0, minor: 33, patch: 0, pre: 'beta.1' });
  });
  it('liefert null bei Unsinn', () => {
    expect(parseSemver('foo')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver(null)).toBeNull();
  });
});

describe('updater: compareSemver', () => {
  it('vergleicht numerisch', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
  });
  it('Release rangiert höher als Prerelease derselben Version', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta')).toBe(1);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(-1);
  });
  it('unparsebare Eingaben sind am niedrigsten', () => {
    expect(compareSemver('foo', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', 'foo')).toBe(1);
  });
});

describe('updater: parseTagsFromLsRemote', () => {
  it('extrahiert Tags und entfernt ^{}-Duplikate', () => {
    const out = [
      'abc123\trefs/tags/v0.31.0',
      'def456\trefs/tags/v0.32.0',
      'def456\trefs/tags/v0.32.0^{}',
    ].join('\n');
    expect(parseTagsFromLsRemote(out)).toEqual(['v0.31.0', 'v0.32.0']);
  });
  it('leer bei leerer Eingabe', () => {
    expect(parseTagsFromLsRemote('')).toEqual([]);
  });
});

describe('updater: pickLatestStableTag', () => {
  it('wählt den höchsten stabilen Tag', () => {
    expect(pickLatestStableTag(['v0.31.0', 'v0.32.0', 'v0.9.0'])).toBe('v0.32.0');
  });
  it('ignoriert Prereleases und Unsinn', () => {
    expect(pickLatestStableTag(['v0.32.0', 'v0.33.0-beta.1', 'nightly'])).toBe('v0.32.0');
  });
  it('null wenn kein stabiler Tag', () => {
    expect(pickLatestStableTag(['v1.0.0-rc.1', 'foo'])).toBeNull();
    expect(pickLatestStableTag([])).toBeNull();
  });
});

describe('updater: isUpdateAvailable', () => {
  it('true wenn Tag neuer als lokale Version', () => {
    expect(isUpdateAvailable('0.32.0', 'v0.33.0')).toBe(true);
  });
  it('false wenn gleich oder älter', () => {
    expect(isUpdateAvailable('0.32.0', 'v0.32.0')).toBe(false);
    expect(isUpdateAvailable('0.32.0', 'v0.31.0')).toBe(false);
  });
  it('false ohne Tag', () => {
    expect(isUpdateAvailable('0.32.0', null)).toBe(false);
  });
});
