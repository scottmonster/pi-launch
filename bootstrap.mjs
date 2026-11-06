import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAdapter } from './adapter.mjs';
import { cliEntry } from './launcher.mjs';

try {
  const root = process.argv[2];
  await loadAdapter(root);
  const cliPath = join(root, cliEntry());
  process.argv = [process.execPath, cliPath, ...process.argv.slice(3)];
  await import(pathToFileURL(cliPath).href);
} catch (error) {
  console.error(`pi-launch: ${error.message}`);
  process.exitCode = 1;
}
