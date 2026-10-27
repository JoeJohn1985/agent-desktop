jest.mock('child_process', () => ({ execFile: jest.fn() }));
const { createNativeSkills } = require('../src/native-skills');
const path = require('path');

const skill = (name = 'same', enabled = true, source = 'personal-copilot', dir = 'one') =>
  ({ name, enabled, source, path: path.resolve(dir, name), description: 'fixture' });

test('native catalog groups all personal/custom/plugin sources, not project or builtin', async () => {
  const data = [skill(), skill('custom', false, 'custom'), skill('plugin', true, 'plugin'),
    skill('project', true, 'project'), skill('builtin', true, 'builtin')];
  const run = jest.fn().mockResolvedValue(JSON.stringify(data));
  const service = createNativeSkills({ run });
  const groups = await service.groups([{ providers: ['copilot', 'anthropic'], directory: 'shared', skills: [] }]);
  expect(groups.flatMap(g => g.skills).map(s => s.name)).toEqual(['same', 'custom', 'plugin']);
  expect(groups[0].native).toBe(true);
  expect(groups.at(-1).providers).toEqual(['anthropic']);
  expect(run.mock.calls[0][0]).toEqual(['skill', 'list', '--json']);
});

test('native disable validates exact catalog identity and verifies every same-name source', async () => {
  const data = [skill(), skill('same', true, 'custom', 'two')];
  const run = jest.fn()
    .mockResolvedValueOnce(JSON.stringify(data)).mockResolvedValueOnce('disabled')
    .mockResolvedValueOnce(JSON.stringify(data.map(s => ({ ...s, enabled: false }))));
  const service = createNativeSkills({ run });
  await service.setEnabled('copilot', data[0].path, false);
  expect(run.mock.calls[1][0]).toEqual(['skill', 'disable', 'same']);
});

test.each([
  ['anthropic', 'x', false], ['claude-code', 'x', true],
  ['copilot', {}, false], ['copilot', 'x', 'false'],
])('unsupported or malformed mutations never execute commands (%s)', async (provider, id, enabled) => {
  const run = jest.fn();
  await expect(createNativeSkills({ run }).setEnabled(provider, id, enabled)).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

test.each(['missing', 'builtin', 'project', '-option'])('stale/excluded/option identities are rejected: %s', async mode => {
  const entry = skill(mode === '-option' ? mode : 'same', true, mode);
  const run = jest.fn().mockResolvedValue(JSON.stringify(mode === 'missing' ? [] : [entry]));
  await expect(createNativeSkills({ run }).setEnabled('copilot', entry.path, false)).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(1);
});

test('unconfirmed changes and CLI failures stay visible', async () => {
  const run = jest.fn().mockResolvedValue(JSON.stringify([skill()]));
  await expect(createNativeSkills({ run }).setEnabled('copilot', skill().path, false)).rejects.toThrow('nicht bestätigt');
  const failed = createNativeSkills({ run: jest.fn().mockRejectedValue(new Error('CLI unavailable')) });
  expect((await failed.groups([]))[0].error).toBe('CLI unavailable');
  await expect(failed.filterEnabled([skill()])).rejects.toThrow('CLI unavailable');
});

test('disabled names cannot be injected from any source, enabled ones remain', async () => {
  const run = jest.fn().mockResolvedValue(JSON.stringify([skill('same', false), skill('other')]));
  const data = [{ name: 'same', source: 'project' }, { name: 'same', source: 'builtin' }, { name: 'other' }];
  expect(await createNativeSkills({ run }).filterEnabled(data, path.resolve('project'))).toEqual([{ name: 'other' }]);
  expect(run.mock.calls[0][1]).toBe(path.resolve('project'));
});

test.each(['{}', '[{"name":"incomplete"}]', 'bad json'])('unknown catalog never invents enabled state', async output => {
  await expect(createNativeSkills({ run: async () => output }).list()).rejects.toThrow();
});

test('CLI execution never uses a shell and passes the exact catalog name as one argument', async () => {
  const { execFile } = require('child_process');
  const entry = skill('safe & echo not-a-shell');
  execFile.mockImplementation((_binary, args, _opts, callback) => {
    if (args.includes('list')) callback(null, JSON.stringify([{ ...entry, enabled: !execFile.mock.calls.some(c => c[1].includes('disable')) }]), '');
    else callback(null, 'disabled', '');
  });
  await createNativeSkills({ binary: 'copilot.exe', env: { FIXTURE: '1' } })
    .setEnabled('copilot', entry.path, false);
  expect(execFile.mock.calls[1]).toEqual([
    'copilot.exe', ['--no-auto-update', 'skill', 'disable', entry.name],
    expect.objectContaining({ shell: false, windowsHide: true, env: { FIXTURE: '1' } }),
    expect.any(Function),
  ]);
});
