import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ensureCompatible } from './compatibility.mjs';
import { findPiRoot, findRealPi, privatePrefix, scriptArgs } from './launcher.mjs';

// Only updates need supervision. Normal launches still exec directly into Pi.
export async function runUpdate(bootstrap, installation, args) {
  // Pi under Bun self-updates with `bun install -g`; BUN_INSTALL keeps that in the private directory.
  const env = { ...process.env, BUN_INSTALL: privatePrefix() };
  const child = spawn(process.execPath, scriptArgs(bootstrap, installation.root, ...args), { stdio: 'inherit', env });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
    const forward = () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
    handlers.set(signal, forward);
    process.on(signal, forward);
  }
  let code, signal;
  try {
    [code, signal] = await once(child, 'exit');
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
  // A cancelled update is not a safe time to probe. Next launch always checks.
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  try {
    // Re-resolve the executable: an updater may replace the link/package.
    ensureCompatible(findPiRoot(findRealPi()));
  } catch (error) {
    console.error(`pi-launch: post-update verification failed; normal launches will remain blocked until compatibility passes.\n${error.message}`);
  }
  // Verification diagnostics must not disguise the update command's result.
  process.exitCode = code;
}
