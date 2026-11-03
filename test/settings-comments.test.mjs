import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installSettingsComments, parseSettings, updateSettings } from '../settings-comments.mjs';

const source = `// preferences\n{\n  // model choice\n  "defaultModel": "example",\n  "url": "https://example.com/*not a comment*/",\n  "compaction": {\n    /* budget */ "reserveTokens": 100,\n    "enabled": true,\n  },\n}\n`;

test('parses comments, trailing commas, BOM, and comment-like strings', () => {
  assert.equal(parseSettings('\uFEFF' + source).url, 'https://example.com/*not a comment*/');
});

test('preserves comments while changing nested and top-level fields', () => {
  const next = parseSettings(source);
  next.defaultModel = 'updated';
  next.compaction.reserveTokens = 200;
  next.theme = 'dark';
  const result = updateSettings(source, JSON.stringify(next));
  for (const comment of ['// preferences', '// model choice', '/* budget */']) assert.ok(result.includes(comment));
  assert.deepEqual(parseSettings(result), next);
});

test('unchanged data retains exact bytes', () => {
  assert.equal(updateSettings(source, JSON.stringify(parseSettings(source))), source);
});

test('supports deletion and array replacement', () => {
  const original = '{ /* keep */ "a": 1, "list": [1, 2], "nested": {"x": 1} }';
  const next = { list: [3], nested: {} };
  assert.deepEqual(parseSettings(updateSettings(original, JSON.stringify(next))), next);
});

test('rejects malformed settings instead of overwriting them', () => {
  for (const text of ['{"a":}', '{/* unclosed', '[]', 'null', '', '{"a":1} garbage']) {
    assert.throws(() => parseSettings(text), SyntaxError);
  }
});

test('storage wrapper handles reads, writes, absent files, and repeat installation', () => {
  class Storage {
    text = source;
    withLock(_scope, callback) {
      const next = callback(this.text);
      if (next !== undefined) this.text = next;
    }
  }
  installSettingsComments(Storage);
  installSettingsComments(Storage);
  const storage = new Storage();
  storage.withLock('global', current => { assert.equal(JSON.parse(current).defaultModel, 'example'); });
  assert.equal(storage.text, source);
  storage.withLock('global', current => JSON.stringify({ ...JSON.parse(current), theme: 'dark' }));
  assert.ok(storage.text.includes('// model choice'));
  assert.equal(parseSettings(storage.text).theme, 'dark');
  storage.text = undefined;
  storage.withLock('project', current => {
    assert.equal(current, undefined);
    return '{"theme":"light"}';
  });
  assert.equal(storage.text, '{"theme":"light"}');
});
