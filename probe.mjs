// Executed only in a disposable directory by compatibility.mjs. Never start a
// Pi session or CLI here: only exercise the actual settings API with explicit paths.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAdapter } from './adapter.mjs';
import { parseSettings } from './settings-comments.mjs';

try {
  const [root, scratch] = process.argv.slice(2);
  const { SettingsManager } = await loadAdapter(root);
  const agent = join(scratch, 'agent');
  const project = join(scratch, 'project');
  mkdirSync(agent, { recursive: true });
  mkdirSync(join(project, '.pi'), { recursive: true });
  const globalFile = join(agent, 'settings.json');
  const projectFile = join(project, '.pi/settings.json');
  const globalText = `// global preference\n{\n  "theme": "dark", // theme comment\n  "compaction": { /* nested budget */ "enabled": true, "reserveTokens": 16384, },\n  "customValue": "https://example.test/*literal*/",\n}\n`;
  const projectText = '{ /* project preference */ "quietStartup": true, }\n';
  writeFileSync(globalFile, globalText);
  writeFileSync(projectFile, projectText);
  const manager = SettingsManager.create(project, agent, { projectTrusted: false });
  assert.equal(manager.getTheme(), 'dark', 'commented global settings were not loaded');
  assert.equal(manager.getCompactionEnabled(), true);
  assert.notEqual(manager.getQuietStartup(), true, 'untrusted project settings were loaded');
  await manager.flush();
  assert.equal(readFileSync(globalFile, 'utf8'), globalText, 'reading settings rewrote the file');
  assert.equal(readFileSync(projectFile, 'utf8'), projectText);
  manager.setProjectTrusted(true);
  await manager.reload();
  assert.equal(manager.getQuietStartup(), true, 'trusted project settings were not loaded');
  manager.setTheme('light');
  manager.setCompactionEnabled(false);
  manager.setProjectExtensionPaths(['./probe.ts']);
  await manager.flush();
  assert.deepEqual(manager.drainErrors(), [], 'Pi reported settings errors');
  const globalResult = readFileSync(globalFile, 'utf8');
  const projectResult = readFileSync(projectFile, 'utf8');
  for (const comment of ['// global preference', '// theme comment', '/* nested budget */']) {
    assert.ok(globalResult.includes(comment), `lost comment: ${comment}`);
  }
  assert.ok(projectResult.includes('/* project preference */'));
  const settings = parseSettings(globalResult);
  assert.equal(settings.theme, 'light');
  assert.equal(settings.compaction.enabled, false);
  assert.equal(settings.compaction.reserveTokens, 16384);
  assert.equal(settings.customValue, 'https://example.test/*literal*/');
  assert.deepEqual(parseSettings(projectResult).extensions, ['./probe.ts']);
  const reloaded = SettingsManager.create(project, agent, { projectTrusted: true });
  assert.equal(reloaded.getTheme(), 'light');
  assert.equal(reloaded.getCompactionEnabled(), false);
  assert.equal(reloaded.getQuietStartup(), true);
  assert.deepEqual(reloaded.drainErrors(), []);
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
