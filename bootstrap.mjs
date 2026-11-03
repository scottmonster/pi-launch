import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installSettingsComments } from './settings-comments.mjs';

try {
  const root = process.argv[2];
  const { FileSettingsStorage, SettingsManager } = await import(pathToFileURL(join(root, 'dist/core/settings-manager.js')).href);
  if (typeof FileSettingsStorage?.prototype?.withLock !== 'function' ||
      FileSettingsStorage.prototype.withLock.length !== 2 ||
      typeof SettingsManager?.create !== 'function') {
    throw new Error('Pi settings API changed; update pi-launch. No settings files were modified.');
  }
  installSettingsComments(FileSettingsStorage);
  const cliPath = join(root, 'dist/cli.js');
  process.argv = [process.execPath, cliPath, ...process.argv.slice(3)];
  await import(pathToFileURL(cliPath).href);
} catch (error) {
  console.error(`pi-launch: ${error.message}`);
  process.exitCode = 1;
}
