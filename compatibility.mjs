import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertCompatible, scriptArgs } from './launcher.mjs';

const ownRoot = fileURLToPath(new URL('.', import.meta.url));

export function installationFingerprint({ root }) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ schema: 1, root: realpathSync(root), runtime: process.versions.bun ?? process.version, executable: process.execPath, platform: process.platform, arch: process.arch }));
  function add(path, label) {
    hash.update(label + '\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  add(join(root, 'package.json'), 'pi/package.json');
  function walk(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const label = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, label);
      else if (/\.(?:[cm]?js|json)$/.test(entry.name)) add(path, label);
    }
  }
  walk(join(root, 'dist'), 'pi/dist');
  for (const name of ['adapter.mjs', 'settings-comments.mjs', 'probe.mjs', 'bootstrap.mjs', 'compatibility.mjs', 'launcher.mjs', 'bun.lock']) {
    add(join(ownRoot, name), `launcher/${name}`);
  }
  return hash.digest('hex');
}

export function ensureCompatible(installation, {
  cacheDir = process.env.PI_LAUNCH_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'pi-launch', 'verified'),
  report = message => console.error(`pi-launch: ${message}`),
} = {}) {
  assertCompatible(installation);
  const fingerprint = installationFingerprint(installation);
  const cacheFile = join(cacheDir, `${fingerprint}.json`);
  try {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (cached.fingerprint === fingerprint && cached.verified === true) return { fingerprint, cached: true };
  } catch { /* Missing, damaged or inaccessible cache: re-test, never assume compatibility. */ }
  report(`checking settings compatibility with Pi ${installation.version}…`);
  const scratch = mkdtempSync(join(tmpdir(), 'pi-launch-probe-'));
  try {
    const result = spawnSync(process.execPath, scriptArgs(join(ownRoot, 'probe.mjs'), installation.root, scratch), {
      cwd: scratch,
      env: { ...process.env, HOME: scratch, XDG_CONFIG_HOME: join(scratch, 'config'), XDG_CACHE_HOME: join(scratch, 'cache'), PI_CODING_AGENT_DIR: join(scratch, 'agent'), PI_OFFLINE: '1' },
      input: '', encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const reason = result.error?.message || result.stderr.trim() || `probe exited with ${result.signal || result.status}`;
      throw new Error(`Settings compatibility check failed for Pi ${installation.version}. Pi was not started and user settings were not modified by the check. Update pi-launch or restore a working Pi installation.\n${reason}`);
    }
    if (installationFingerprint(installation) !== fingerprint) {
      throw new Error('Pi or pi-launch changed during compatibility testing. Retry after the update finishes.');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const temporaryCache = join(cacheDir, `.${fingerprint}.${randomUUID()}.tmp`);
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    writeFileSync(temporaryCache, JSON.stringify({ fingerprint, verified: true, version: installation.version, checkedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    renameSync(temporaryCache, cacheFile);
  } catch (error) {
    report(`compatibility passed, but the result could not be cached: ${error.message}`);
  } finally {
    try { rmSync(temporaryCache, { force: true }); } catch { /* Cache access must not block a successful probe. */ }
  }
  report(`settings compatibility verified for Pi ${installation.version}`);
  return { fingerprint, cached: false };
}
