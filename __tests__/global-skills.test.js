const { buildGlobalSkillsList } = require('../src/context-list');
const { skillDirs } = require('../src/context-paths');
const path = require('path');

test('global discovery uses existing provider roots and override, never projects, builtins or SSH', async () => {
  const override = path.resolve('fixture-global');
  const scan = jest.fn().mockResolvedValue([{ name: 'same' }]);
  const groups = await buildGlobalSkillsList({
    skillDirs, skillsDirOverride: override, scanSkillDirectory: scan,
    userSkillIcon: () => '', yamlParse: () => ({}),
  });
  expect(groups.find(g => g.providers.includes('copilot')).directory).toBe(override);
  expect(groups.find(g => g.providers.includes('claude-code')).directory).toBe(skillDirs('claude-code', null).global[0]);
  expect(groups.flatMap(g => g.providers)).not.toContain('claude-code-ssh');
  expect(groups.flatMap(g => g.providers)).not.toContain('gemini');
  expect(groups).toHaveLength(6);
  expect(groups.every(g => g.skills[0].name === 'same')).toBe(true);
  expect(scan.mock.calls.every(call => call[1] === 'global')).toBe(true);
});

test('shared roots are scanned once; a failed root does not hide others', async () => {
  const shared = path.resolve('shared');
  const scan = jest.fn().mockRejectedValue(new Error('access denied'));
  const groups = await buildGlobalSkillsList({
    skillDirs: () => ({ global: [shared], project: [path.resolve('never')] }),
    scanSkillDirectory: scan,
  });
  expect(groups).toHaveLength(1);
  expect(groups[0].providers).toContain('copilot');
  expect(groups[0].providers).toContain('anthropic');
  expect(groups[0].error).toBe('access denied');
  expect(scan).toHaveBeenCalledTimes(1);
});
