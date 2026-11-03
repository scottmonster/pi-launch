import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { assertCompatible, findPiRoot, findRealPi, wrapperPath } from '../launcher.mjs';
import { installSettingsComments } from '../settings-comments.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-launch-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'dist/core'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.4.0', type: 'module' }));
  const executable = join(root, 'dist/cli.js');
  writeFileSync(executable, '#!/usr/bin/env node\n');
  chmodSync(executable, 0o755);
  writeFileSync(join(root, 'dist/core/settings-manager.js'), 'export class FileSettingsStorage { withLock(scope, fn) {} }\nexport class SettingsManager { static create() {} }');
  return { root, executable };
}

test('discovers real Pi after any wrapper aliases and rejects recursive overrides', t => {
  const { root, executable } = fixture(t);
  const first = join(root, 'wrapper-bin');
  const second = join(root, 'real-bin');
  mkdirSync(first); mkdirSync(second);
  symlinkSync(wrapperPath, join(first, 'pi'));
  symlinkSync(executable, join(second, 'pi'));
  assert.equal(findRealPi({ path: [first, second].join(delimiter), override: '' }), executable);
  assert.deepEqual(findPiRoot(executable), { root, version: '1.4.0' });
  assert.throws(() => findRealPi({ override: join(first, 'pi') }), /itself/);
  assert.throws(() => findRealPi({ path: first, override: '' }), /Cannot find/);
});

test('unsupported versions fail closed', t => {
  const { root } = fixture(t);
  assert.throws(() => assertCompatible({ root, version: '2.0.0' }), /unsupported/);
  assertCompatible({ root, version: '1.4.0' });
});

test('forwards arguments, stdin, stdout, stderr, environment, cwd and exit status', t => {
  const { root, executable } = fixture(t);
  writeFileSync(executable, `import {readFileSync} from 'node:fs';
console.log(JSON.stringify({args:process.argv.slice(2),input:readFileSync(0,'utf8'),env:process.env.TEST_FORWARD,cwd:process.cwd()}));
console.error('stderr forwarded'); process.exitCode=17;`);
  const result = spawnSync(process.execPath, [wrapperPath, '--', 'a b', '', '--print'], {
    cwd: root, input: 'hello\n', encoding: 'utf8',
    env: { ...process.env, PI_LAUNCH_REAL_PI: executable, TEST_FORWARD: 'preserved' },
  });
  assert.equal(result.status, 17, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['--', 'a b', '', '--print'], input: 'hello\n', env: 'preserved', cwd: root });
  assert.equal(result.stderr, 'stderr forwarded\n');
});

test('signals reach the exec-replaced Pi process', { timeout: 10000 }, async t => {
  const { executable } = fixture(t);
  writeFileSync(executable, "console.log('ready'); setInterval(() => {}, 1000);");
  const child = spawn(process.execPath, [wrapperPath], { env: { ...process.env, PI_LAUNCH_REAL_PI: executable }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exit = once(child, 'exit');
  await once(child.stdout, 'data');
  child.kill('SIGTERM');
  assert.deepEqual(await exit, [null, 'SIGTERM']);
});

test('installed Pi integration preserves global and project comments under real locks', async t => {
  let installation;
  try { installation = findPiRoot(findRealPi()); }
  catch { t.skip('No npm Pi available'); return; }
  assertCompatible(installation);
  const { FileSettingsStorage, SettingsManager } = await import(pathToFileURL(join(installation.root, 'dist/core/settings-manager.js')).href);
  installSettingsComments(FileSettingsStorage);
  const { root } = fixture(t);
  const agent = join(root, 'agent');
  mkdirSync(agent); mkdirSync(join(root, '.pi'));
  const globalFile = join(agent, 'settings.json');
  const projectFile = join(root, '.pi/settings.json');
  writeFileSync(globalFile, '{ // global\n "theme":"dark", }');
  writeFileSync(projectFile, '{ /* project */ "quietStartup":true, }');
  const manager = SettingsManager.create(root, agent);
  assert.equal(manager.getTheme(), 'dark');
  manager.setProjectTrusted(true);
  await manager.reload();
  assert.equal(manager.getQuietStartup(), true);
  manager.setTheme('light');
  manager.setProjectExtensionPaths(['./example.ts']);
  await manager.flush();
  assert.match(readFileSync(globalFile, 'utf8'), /\/\/ global/);
  assert.match(readFileSync(globalFile, 'utf8'), /"light"/);
  assert.match(readFileSync(projectFile, 'utf8'), /\/\* project \*\//);
  assert.match(readFileSync(projectFile, 'utf8'), /example\.ts/);
});
