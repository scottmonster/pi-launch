import { accessSync, constants, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const wrapperPath = fileURLToPath(new URL('./bin/pi.mjs', import.meta.url));

export function findRealPi({ path = process.env.PATH ?? '', override = process.env.PI_LAUNCH_REAL_PI } = {}) {
  const self = realpathSync(wrapperPath);
  const candidates = override ? [resolve(override)] : path.split(delimiter).map(dir => join(dir || '.', 'pi'));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (realpathSync(candidate) === self) {
        if (override) throw new Error('PI_LAUNCH_REAL_PI points to pi-launch itself');
        continue;
      }
      return realpathSync(candidate);
    } catch (error) {
      if (override) throw new Error(`Invalid PI_LAUNCH_REAL_PI: ${error.message}`);
    }
  }
  throw new Error('Cannot find the real pi on PATH. Install Pi or set PI_LAUNCH_REAL_PI to its executable.');
}

export function findPiRoot(executable) {
  let root = dirname(executable);
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (pkg.name === '@earendil-works/pi-coding-agent') return { root, version: pkg.version };
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
