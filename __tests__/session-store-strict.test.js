'use strict';

jest.mock('fs', () => ({ mkdirSync: jest.fn(), writeFileSync: jest.fn() }));
jest.mock('../src/data-dir', () => ({ apiSessionsDir: () => 'virtual-sessions' }));
const fs = require('fs');
const { save } = require('../src/providers/session-store');

test('normale Persistenz bleibt best-effort; Compact muss Schreibfehler propagieren', () => {
  const error = new Error('Platte voll');
  fs.writeFileSync.mockImplementation(() => { throw error; });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => save('api-fixture', {})).not.toThrow();
  expect(() => save('api-fixture', {}, { strict: true })).toThrow(error);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
