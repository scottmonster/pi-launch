// Minimal functional Pi settings API used by launcher/probe regression tests.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class FileSettingsStorage {
  constructor(project, agent) {
    this.paths = { global: join(agent, 'settings.json'), project: join(project, '.pi/settings.json') };
  }
  withLock(scope, callback) {
    const path = this.paths[scope];
    const next = callback(existsSync(path) ? readFileSync(path, 'utf8') : undefined);
    if (next !== undefined) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, next);
    }
  }
}

export class SettingsManager {
  static create(project, agent, options = {}) { return new SettingsManager(project, agent, options); }
  constructor(project, agent, options) {
    this.storage = new FileSettingsStorage(project, agent);
    this.trusted = options.projectTrusted ?? true;
    this.reload();
  }
  reload() {
    const read = scope => {
      let value = {};
      this.storage.withLock(scope, current => { value = current ? JSON.parse(current) : {}; });
      return value;
    };
    this.global = read('global');
    this.project = this.trusted ? read('project') : {};
  }
  value(key) { return this.project[key] ?? this.global[key]; }
  write(scope, key, value) {
    this.storage.withLock(scope, current => JSON.stringify({ ...(current ? JSON.parse(current) : {}), [key]: value }));
    this.reload();
  }
  getTheme() { return this.value('theme'); }
  setTheme(value) { this.write('global', 'theme', value); }
  getCompactionEnabled() { return this.value('compaction')?.enabled ?? true; }
  setCompactionEnabled(value) { this.write('global', 'compaction', { ...this.value('compaction'), enabled: value }); }
  getQuietStartup() { return this.value('quietStartup') ?? false; }
  setProjectTrusted(value) { this.trusted = value; }
  setProjectExtensionPaths(value) { this.write('project', 'extensions', value); }
  async flush() {}
  drainErrors() { return []; }
}
