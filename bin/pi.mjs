#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { assertCompatible, findPiRoot, findRealPi } from '../launcher.mjs';

try {
  if (typeof process.execve !== 'function') throw new Error('pi-launch requires Node 22.15+ with process.execve');
  const installation = findPiRoot(findRealPi());
  assertCompatible(installation);
  const bootstrap = fileURLToPath(new URL('../bootstrap.mjs', import.meta.url));
  // Replace rather than spawn: terminal ownership, signals, exit status and all
  // inherited file descriptors belong directly to the Pi process.
  process.execve(process.execPath, [process.execPath, bootstrap, installation.root, ...process.argv.slice(2)], process.env);
} catch (error) {
  console.error(`pi-launch: ${error.message}`);
  process.exitCode = 1;
}
