import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readEditableSubtitleFile,
  writeEditableSubtitleFile
} from '../src/main/subtitleFiles';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'videotracker-subtitle-file-test-'));
}

test('reads editable local srt subtitle text', () => {
  const tempDir = createTempDir();
  const subtitlePath = path.join(tempDir, 'lesson.srt');
  const content = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';
  fs.writeFileSync(subtitlePath, content, 'utf-8');

  const result = readEditableSubtitleFile(subtitlePath);

  assert.equal(result.success, true);
  assert.equal(result.type, 'srt');
  assert.equal(result.content, content);
});

test('rejects unsupported or remote subtitle files for editing', () => {
  const tempDir = createTempDir();
  const assPath = path.join(tempDir, 'styled.ass');
  fs.writeFileSync(assPath, '[Script Info]\n', 'utf-8');

  assert.equal(readEditableSubtitleFile(assPath).success, false);
  assert.equal(readEditableSubtitleFile('https://example.com/lesson.srt').success, false);
});

test('writes subtitle text and keeps the first backup intact', () => {
  const tempDir = createTempDir();
  const subtitlePath = path.join(tempDir, 'lesson.vtt');
  const original = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOld\n';
  const firstUpdate = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nNew\n';
  const secondUpdate = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nNew again\n';
  fs.writeFileSync(subtitlePath, original, 'utf-8');

  const firstResult = writeEditableSubtitleFile(subtitlePath, firstUpdate);
  const backupPath = `${subtitlePath}.bak`;
  const secondResult = writeEditableSubtitleFile(subtitlePath, secondUpdate);

  assert.equal(firstResult.success, true);
  assert.equal(firstResult.backupPath, backupPath);
  assert.equal(secondResult.success, true);
  assert.equal(fs.readFileSync(subtitlePath, 'utf-8'), secondUpdate);
  assert.equal(fs.readFileSync(backupPath, 'utf-8'), original);
});
