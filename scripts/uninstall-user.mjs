// Reverses install-user: restores a plain global Pi (same version), converts
// global settings back to plain JSON (with a backup), then removes the shims,
// the private Pi, the cache and the PATH blocks.
// Options: --no-restore (don't reinstall plain Pi), --keep-comments (leave settings as-is).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PACKAGE, findPiRoot, findRealPi, isPiLaunch, privatePrefix } from '../launcher.mjs';
import { parseSettings } from '../settings-comments.mjs';

const restore = !process.argv.includes('--no-restore');
const stripComments = !process.argv.includes('--keep-comments');
const home = homedir();
const shims = ['pi', 'pi-launch'].map(name => join(home, '.local/bin', name));
// Prefer the prefix recorded in the installed shim over the current environment.
const recorded = shims.map(shim => { try { return /PI_LAUNCH_PREFIX='([^']*)'/.exec(readFileSync(shim, 'utf8'))?.[1]; } catch { return undefined; } }).find(Boolean);
const prefix = recorded || privatePrefix();
const npm = existsSync(join(dirname(process.execPath), 'npm')) ? join(dirname(process.execPath), 'npm') : 'npm';

let version = 'latest';
try { version = findPiRoot(findRealPi({ override: '', prefix })).version; } catch { /* no private install */ }

// 1. Restore plain Pi first; if this fails, nothing has been removed yet.
if (restore) {
  console.log(`$ npm install -g ${PACKAGE}@${version}`);
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` };
  const result = spawnSync(npm, ['install', '-g', `${PACKAGE}@${version}`], { stdio: 'inherit', env });
  if (result.status !== 0) throw new Error('Reinstalling plain Pi failed; nothing was removed. Retry, or use --no-restore.');
}

// 2. Plain Pi can't read comments or trailing commas.
const settingsFile = join(process.env.PI_CODING_AGENT_DIR || join(home, '.pi/agent'), 'settings.json');
if (stripComments && existsSync(settingsFile)) {
  const text = readFileSync(settingsFile, 'utf8');
  let plain = true;
  try { JSON.parse(text); } catch { plain = false; }
  if (!plain) {
    const backup = `${settingsFile}.pi-launch-backup`;
    copyFileSync(settingsFile, backup);
    writeFileSync(settingsFile, JSON.stringify(parseSettings(text), null, 2) + '\n');
    console.log(`Converted ${settingsFile} to plain JSON (original with comments: ${backup})`);
  }
}

// 3. Remove pi-launch's files. Never remove an executable that isn't ours.
for (const shim of shims) {
  if (isPiLaunch(shim)) rmSync(shim);
  else if (existsSync(shim)) console.log(`Left ${shim} alone: it is not pi-launch`);
}
rmSync(prefix, { recursive: true, force: true });
try { rmdirSync(dirname(prefix)); } catch { /* not empty or already gone */ }
rmSync(join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'pi-launch'), { recursive: true, force: true });
const block = /\n?# >>> pi-launch >>>\n[\s\S]*?# <<< pi-launch <<<\n?/g;
for (const path of new Set(['.zshrc', '.bashrc', '.profile'].map(name => join(home, name)).concat(join(process.env.ZDOTDIR || home, '.zshrc')))) {
  if (!existsSync(path)) continue;
  const current = readFileSync(path, 'utf8');
  if (block.test(current)) writeFileSync(path, current.replace(block, ''));
  block.lastIndex = 0;
}

console.log(`\npi-launch uninstalled.${restore ? ` Plain Pi ${version} is installed globally.` : ''}
Project .pi/settings.json files with comments must be converted by hand.
Run \`hash -r\` (bash) or \`rehash\` (zsh) in open shells.`);
