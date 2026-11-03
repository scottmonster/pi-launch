import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installSettingsComments } from './settings-comments.mjs';

export async function loadAdapter(root) {
  const api = await import(pathToFileURL(join(root, 'dist/core/settings-manager.js')).href);
  if (typeof api.FileSettingsStorage?.prototype?.withLock !== 'function' ||
      api.FileSettingsStorage.prototype.withLock.length !== 2 ||
      typeof api.SettingsManager?.create !== 'function') {
    throw new Error('Pi settings API changed; update pi-launch. No user settings files were modified.');
  }
  installSettingsComments(api.FileSettingsStorage);
  return api;
}
