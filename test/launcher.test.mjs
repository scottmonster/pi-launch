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
import { ensureCompatible, installationFingerprint } from '../compatibility.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-launch-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'dist/core'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.4.0', type: 'module' }));
  const executable = join(root, 'dist/cli.js');
  writeFileSync(executable, '#!/usr/bin/env node\n');
  chmodSync(executable, 0o755);
  writeFileSync(join(root, 'dist/core/settings-manager.js'), readFileSync(new URL('../fixtures/mock-settings.mjs', import.meta.url)));
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

test('new versions are accepted when behavior passes, and successful checks are cached', t => {
  const { root, executable } = fixture(t);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ ...manifest, version: '1.5.0' }));
  const installation = findPiRoot(executable);
  const options = { cacheDir: join(root, 'cache'), report() {} };
  assertCompatible(installation);
  assert.equal(ensureCompatible(installation, options).cached, false);
  assert.equal(ensureCompatible(installation, options).cached, true);
  const previous = installationFingerprint(installation);
  writeFileSync(executable, '// changed without a version bump');
  assert.notEqual(installationFingerprint(installation), previous);
  assert.equal(ensureCompatible(installation, options).cached, false);
  const key = installationFingerprint(installation);
  writeFileSync(join(root, 'cache', `${key}.json`), 'invalid cache');
  assert.equal(ensureCompatible(installation, options).cached, false);
});

test('behavior failures are rejected even when the API shape is unchanged', t => {
  const { root, executable } = fixture(t);
  const file = join(root, 'dist/core/settings-manager.js');
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, source.replace("setTheme(value) { this.write('global', 'theme', value); }", 'setTheme(value) {}'));
  assert.throws(() => ensureCompatible(findPiRoot(executable), { cacheDir: join(root, 'cache'), report() {} }), /compatibility check failed/);
});

test('an unavailable cache does not block a successful compatibility check', t => {
  const { root, executable } = fixture(t);
  const cacheDir = join(root, 'not-a-directory');
  writeFileSync(cacheDir, '');
  const messages = [];
  const result = ensureCompatible(findPiRoot(executable), { cacheDir, report: message => messages.push(message) });
  assert.equal(result.cached, false);
  assert.ok(messages.some(message => message.includes('could not be cached')));
});

test('broken settings API blocks startup and is never cached as verified', t => {
  const { root, executable } = fixture(t);
  writeFileSync(join(root, 'dist/core/settings-manager.js'), 'export class FileSettingsStorage {}');
  writeFileSync(executable, "console.log('SHOULD NOT RUN');");
  const result = spawnSync(process.execPath, [wrapperPath], {
    encoding: 'utf8', env: { ...process.env, PI_LAUNCH_REAL_PI: executable, PI_LAUNCH_CACHE_DIR: join(root, 'cache') },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /compatibility check failed/);
  assert.throws(() => ensureCompatible(findPiRoot(executable), { cacheDir: join(root, 'cache'), report() {} }), /compatibility check failed/);
});

test('forwards arguments, stdin, stdout, stderr, environment, cwd and exit status', t => {
  const { root, executable } = fixture(t);
  writeFileSync(executable, `import {readFileSync} from 'node:fs';
console.log(JSON.stringify({args:process.argv.slice(2),input:readFileSync(0,'utf8'),env:process.env.TEST_FORWARD,cwd:process.cwd()}));
console.error('stderr forwarded'); process.exitCode=17;`);
  const result = spawnSync(process.execPath, [wrapperPath, '--', 'a b', '', '--print'], {
    cwd: root, input: 'hello\n', encoding: 'utf8',
    env: { ...process.env, PI_LAUNCH_REAL_PI: executable, PI_LAUNCH_CACHE_DIR: join(root, 'cache'), TEST_FORWARD: 'preserved' },
  });
  assert.equal(result.status, 17, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['--', 'a b', '', '--print'], input: 'hello\n', env: 'preserved', cwd: root });
  assert.match(result.stderr, /stderr forwarded\n$/);
});

test('signals reach the exec-replaced Pi process', { timeout: 10000 }, async t => {
  const { root, executable } = fixture(t);
  writeFileSync(executable, "console.log('ready'); setInterval(() => {}, 1000);");
  const child = spawn(process.execPath, [wrapperPath], { env: { ...process.env, PI_LAUNCH_REAL_PI: executable, PI_LAUNCH_CACHE_DIR: join(root, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exit = once(child, 'exit');
  await once(child.stdout, 'data');
  child.kill('SIGTERM');
  assert.deepEqual(await exit, [null, 'SIGTERM']);
});

for (const { broken, status } of [{ broken: false, status: 0 }, { broken: true, status: 0 }, { broken: true, status: 23 }]) {
  test(`update rechecks the changed installation (broken=${broken}) and preserves exit ${status}`, t => {
    const { root, executable } = fixture(t);
    writeFileSync(executable, `import {readFileSync,writeFileSync} from 'node:fs';
if(process.argv[2]==='update') {
  const root=${JSON.stringify(root)};
  const manifest=JSON.parse(readFileSync(root+'/package.json','utf8'));
  manifest.version='1.5.0';
  writeFileSync(root+'/package.json',JSON.stringify(manifest));
  if(${broken}) writeFileSync(root+'/dist/core/settings-manager.js','export class FileSettingsStorage {}');
  console.log('update ran'); process.exitCode=${status};
} else { console.log('normal launch'); }`);
    const options = { encoding: 'utf8', env: { ...process.env, PI_LAUNCH_REAL_PI: executable, PI_LAUNCH_CACHE_DIR: join(root, 'cache') } };
    const result = spawnSync(process.execPath, [wrapperPath, 'update', '--self'], options);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, 'update ran\n');
    assert.match(result.stderr, /checking settings compatibility with Pi 1\.5\.0/);
    assert.match(result.stderr, broken ? /post-update verification failed/ : /verified for Pi 1\.5\.0/);
    const next = spawnSync(process.execPath, [wrapperPath, '--version'], options);
    assert.equal(next.status, broken ? 1 : 0, next.stderr);
    assert.equal(next.stdout, broken ? '' : 'normal launch\n');
    if (!broken) assert.equal(next.stderr, '');
  });
}

test('update supervisor preserves termination signals', { timeout: 10000 }, async t => {
  const { root, executable } = fixture(t);
  writeFileSync(executable, "console.log('updating'); setInterval(() => {}, 1000);");
  const child = spawn(process.execPath, [wrapperPath, 'update'], {
    env: { ...process.env, PI_LAUNCH_REAL_PI: executable, PI_LAUNCH_CACHE_DIR: join(root, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
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
