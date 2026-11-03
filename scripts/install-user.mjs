import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { wrapperPath } from '../launcher.mjs';

const home = homedir();
const bin = join(home, '.local/bin');
const links = ['pi', 'pi-launch'].map(name => join(bin, name));
// Preflight before changing anything: never overwrite an unrelated executable.
for (const link of links) {
  try {
    lstatSync(link);
    if (realpathSync(link) !== realpathSync(wrapperPath)) throw new Error(`Refusing to overwrite ${link}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A dangling symlink also must not be overwritten.
    try { lstatSync(link); throw new Error(`Refusing to overwrite dangling symlink ${link}`); }
    catch (inner) { if (inner.code !== 'ENOENT') throw inner; }
  }
}
mkdirSync(bin, { recursive: true });
for (const link of links) if (!existsSync(link)) symlinkSync(wrapperPath, link);
const marker = '# >>> pi-launch >>>';
const block = `\n${marker}\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< pi-launch <<<\n`;
const startupFiles = new Set([
  ...['.zshrc', '.bashrc', '.profile'].map(filename => join(home, filename)),
  join(process.env.ZDOTDIR || home, '.zshrc'),
]);
for (const path of startupFiles) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!current.includes(marker)) {
    if (existsSync(path)) {
      const backup = `${path}.before-pi-launch`;
      if (!existsSync(backup)) writeFileSync(backup, current, { mode: lstatSync(path).mode & 0o777 });
    }
    writeFileSync(path, current + block);
  }
}
console.log(`Installed ${links.join(' and ')}\nOpen a new shell, or run: export PATH="$HOME/.local/bin:$PATH"; rehash 2>/dev/null || hash -r`);
