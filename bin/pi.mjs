#!/usr/bin/env bun
// pi-launch wrapper (marker used to recognize pi-launch from any checkout)
import { fileURLToPath } from 'node:url';
import { findOtherPis, findPiRoot, findRealPi, scriptArgs } from '../launcher.mjs';
import { ensureCompatible } from '../compatibility.mjs';
import { runUpdate } from '../update.mjs';

try {
  if (!process.versions.bun || typeof process.execve !== 'function') throw new Error('pi-launch requires Bun 1.3+ (run: bun upgrade)');
  const installation = findPiRoot(findRealPi());
  // An explicit override is a deliberate choice; only warn for the default setup.
  for (const other of process.env.PI_LAUNCH_REAL_PI ? [] : findOtherPis()) {
    console.error(`pi-launch: warning: another Pi is on PATH (${other}); programs that find it first bypass pi-launch. Run \`pi launch update\` to remove it.`);
  }
  ensureCompatible(installation);
  const bootstrap = fileURLToPath(new URL('../bootstrap.mjs', import.meta.url));
  const args = process.argv.slice(2);
  if (args[0] === 'update') {
    await runUpdate(bootstrap, installation, args);
  } else {
    // Normal runs replace rather than spawn, retaining direct terminal/signals.
    process.execve(process.execPath, [process.execPath, ...scriptArgs(bootstrap, installation.root, ...args)], process.env);
  }
} catch (error) {
  console.error(`pi-launch: ${error.message}`);
  process.exitCode = 1;
}
