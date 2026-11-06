// Installs pi-launch so it is the only `pi` on PATH:
//  1. Real Pi goes into a private Bun global directory (not on PATH).
//  2. ~/.local/bin/pi and pi-launch become small shims pointing at it.
//  3. Other npm/Bun Pi installations on PATH are uninstalled.
// Re-running is safe. Pass --keep-other-pi to skip step 3.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { PACKAGE, findOtherPis, findPiRoot, findRealPi, isPiLaunch, privatePrefix, privateRoot, repoRoot, shimScript } from '../launcher.mjs';
import { ensureCompatible } from '../compatibility.mjs';

if (!process.versions.bun || typeof process.execve !== 'function') throw new Error('pi-launch requires Bun 1.3+ (run: bun upgrade)');
const keepOther = process.argv.includes('--keep-other-pi');
const home = homedir();
const bin = join(home, '.local/bin');
const shims = ['pi', 'pi-launch'].map(name => join(bin, name));
const prefix = privatePrefix();

function run(command, args, env = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}
const has = command => spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;

// Never overwrite an unrelated executable.
for (const shim of shims) {
  let exists = false;
  try { lstatSync(shim); exists = true; } catch { /* absent */ }
  if (exists && !isPiLaunch(shim)) throw new Error(`Refusing to overwrite ${shim}; it is not pi-launch.`);
}

// 1. Private Pi. Keep the version you already have (private, else one on PATH).
const others = findOtherPis().map(executable => {
  try { return { executable, ...findPiRoot(executable) }; } catch { return { executable }; }
});
let current;
try { current = findPiRoot(findRealPi({ override: '' })); } catch { /* not installed */ }
if (current?.root !== privateRoot(prefix)) {
  // Missing, or an older npm-layout install: (re)install with Bun, then swap in.
  const version = current?.version ?? others.find(other => other.version)?.version ?? 'latest';
  const staging = `${prefix}.new`;
  rmSync(staging, { recursive: true, force: true });
  run(process.execPath, ['install', '-g', '--ignore-scripts', `${PACKAGE}@${version}`], { BUN_INSTALL: staging });
  rmSync(prefix, { recursive: true, force: true });
  renameSync(staging, prefix);
} else {
  console.log(`Private Pi ${current.version} already installed at ${prefix}`);
}
const installation = findPiRoot(findRealPi({ override: '' }));
ensureCompatible(installation);

// 2. Shims.
mkdirSync(bin, { recursive: true });
for (const path of shims) {
  const temporary = join(bin, `.${basename(path)}.pi-launch.tmp`);
  writeFileSync(temporary, shimScript({ prefix, src: repoRoot.replace(/\/$/, '') }), { mode: 0o755 });
  renameSync(temporary, path);
}

// 3. Remove other Pi installations that could shadow the wrapper.
const leftovers = [];
for (const other of others) {
  const npmPrefix = other.root?.match(/^(.*)\/lib\/node_modules\/@earendil-works\/pi-coding-agent$/)?.[1];
  const bunPrefix = other.root?.match(/^(.*)\/install\/global\/node_modules\/@earendil-works\/pi-coding-agent$/)?.[1];
  if (!keepOther && npmPrefix && has('npm')) run('npm', ['uninstall', '-g', '--prefix', npmPrefix, PACKAGE]);
  else if (!keepOther && bunPrefix) run(process.execPath, ['remove', '-g', PACKAGE], { BUN_INSTALL: bunPrefix });
  else leftovers.push(other.executable);
}

// PATH block so shells find ~/.local/bin (most systems already include it).
const marker = '# >>> pi-launch >>>';
const block = `\n${marker}\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< pi-launch <<<\n`;
for (const path of new Set(['.zshrc', '.bashrc', '.profile'].map(name => join(home, name)).concat(join(process.env.ZDOTDIR || home, '.zshrc')))) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (text.includes(marker)) continue;
  if (existsSync(path) && !existsSync(`${path}.before-pi-launch`)) writeFileSync(`${path}.before-pi-launch`, text);
  writeFileSync(path, text + block);
}

console.log(`\nInstalled pi-launch:
  real Pi ${installation.version}: ${installation.root}
  shims:  ${shims.join(', ')}`);
for (const leftover of leftovers) console.log(`  warning: another Pi remains on PATH and may bypass pi-launch: ${leftover}`);
console.log('Run `hash -r` (bash) or `rehash` (zsh) in open shells.');
