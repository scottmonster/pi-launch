import { accessSync, constants, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = '@earendil-works/pi-coding-agent';
export const repoRoot = fileURLToPath(new URL('.', import.meta.url));
export const wrapperPath = fileURLToPath(new URL('./bin/pi.mjs', import.meta.url));
export const shimMarker = '# pi-launch shim';
const wrapperMarker = '// pi-launch wrapper';

// The real Pi lives in a private npm prefix that is never on PATH, so the
// wrapper is the only `pi` any program can find. `pi update` updates it in place.
export function privatePrefix() {
  return process.env.PI_LAUNCH_PREFIX || join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'pi-launch/pi');
}

export function isPiLaunch(path) {
  try {
    const real = realpathSync(path);
    if (real === realpathSync(wrapperPath)) return true;
    const head = readFileSync(real, 'utf8').slice(0, 200);
    return head.includes(shimMarker) || head.includes(wrapperMarker);
  } catch {
    return false;
  }
}

export function findRealPi({ override = process.env.PI_LAUNCH_REAL_PI, prefix = privatePrefix() } = {}) {
  const candidate = override ? resolve(override) : join(prefix, 'bin/pi');
  if (isPiLaunch(candidate)) throw new Error(`${candidate} points to pi-launch itself`);
  try {
    accessSync(candidate, constants.X_OK);
    return realpathSync(candidate);
  } catch (error) {
    if (override) throw new Error(`Invalid PI_LAUNCH_REAL_PI: ${error.message}`);
    throw new Error(`Pi is not installed at ${prefix}. Re-run the pi-launch installer (or \`npm run install-user\` in ${repoRoot}).`);
  }
}

// Other npm Pi installations on PATH can shadow the wrapper for programs whose
// PATH puts them first. Returns their executables so callers can warn/remove them.
export function findOtherPis(path = process.env.PATH ?? '') {
  const found = new Set();
  for (const dir of path.split(delimiter)) {
    const candidate = join(dir || '.', 'pi');
    try {
      accessSync(candidate, constants.X_OK);
      if (!isPiLaunch(candidate)) found.add(realpathSync(candidate));
    } catch { /* not present */ }
  }
  return [...found];
}

export function findPiRoot(executable) {
  let root = dirname(executable);
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (pkg.name === PACKAGE) return { root, version: pkg.version };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  throw new Error(`Cannot locate the Pi npm package for ${executable}. Standalone binaries and shell shims are unsupported; set PI_LAUNCH_REAL_PI to the npm Pi executable.`);
}

export function assertCompatible({ root, version }) {
  for (const relative of ['dist/cli.js', 'dist/core/settings-manager.js']) {
    try { accessSync(join(root, relative), constants.R_OK); }
    catch { throw new Error(`Pi ${version} is missing ${relative}; an unbundled npm installation is required.`); }
  }
}
