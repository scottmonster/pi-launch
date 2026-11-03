import { isDeepStrictEqual } from 'node:util';
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';

export const patchKey = Symbol.for('pi-settings-comments.installed');

export function parseSettings(text) {
  const errors = [];
  const value = parse(text.replace(/^\uFEFF/, ''), errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: false,
  });
  if (errors.length) {
    const first = errors[0];
    throw new SyntaxError(`Invalid settings JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  if (!isObject(value)) throw new SyntaxError('Settings must be a JSON object');
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function updateSettings(text, nextText) {
  const before = parseSettings(text);
  const after = parseSettings(nextText);
  const indentation = text.match(/\n([\t ]+)"/)?.[1] ?? '  ';
  const options = { formattingOptions: {
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  } };
  function visit(oldValue, newValue, path) {
    if (isDeepStrictEqual(oldValue, newValue)) return;
    if (isObject(oldValue) && isObject(newValue)) {
      for (const key of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
        visit(oldValue[key], newValue[key], [...path, key]);
      }
    } else {
      text = applyEdits(text, modify(text, path, newValue, options));
    }
  }
  visit(before, after, []);
  // Refuse a write if the edit library ever produces a different configuration.
  if (!isDeepStrictEqual(parseSettings(text), after)) {
    throw new Error('Comment-preserving settings update failed validation');
  }
  return text;
}

/** Wrap the storage boundary, retaining Pi's existing file locks and trust checks. */
export function installSettingsComments(FileSettingsStorage) {
  if (FileSettingsStorage.prototype[patchKey]) return;
  const original = FileSettingsStorage.prototype.withLock;
  if (typeof original !== 'function') throw new Error('Unsupported Pi settings storage API');
  FileSettingsStorage.prototype.withLock = function (scope, callback) {
    return original.call(this, scope, (current) => {
      const normalized = current ? JSON.stringify(parseSettings(current)) : current;
      const next = callback(normalized);
      if (next === undefined || !current) return next;
      return updateSettings(current, next);
    });
  };
  Object.defineProperty(FileSettingsStorage.prototype, patchKey, { value: true });
  globalThis[patchKey] = true;
}
