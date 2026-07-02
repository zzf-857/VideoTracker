import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetStoragePathToDefault } from '../src/main/storagePaths';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'videotracker-storage-test-'));
}

test('moves json data back to the default storage path before clearing path config', () => {
  const root = createTempRoot();
  const defaultPath = path.join(root, 'default');
  const customPath = path.join(root, 'custom');
  fs.mkdirSync(defaultPath, { recursive: true });
  fs.mkdirSync(customPath, { recursive: true });

  fs.writeFileSync(path.join(defaultPath, 'path_config.json'), JSON.stringify({ storagePath: customPath }), 'utf-8');
  fs.writeFileSync(path.join(customPath, 'app_data.json'), '{"sources":[{"name":"custom"}]}', 'utf-8');
  fs.writeFileSync(path.join(customPath, 'other.json'), '{"ok":true}', 'utf-8');
  fs.writeFileSync(path.join(customPath, 'path_config.json'), '{"ignored":true}', 'utf-8');

  const result = resetStoragePathToDefault(defaultPath, customPath, { moveData: true });

  assert.equal(result.success, true);
  assert.deepEqual(result.movedFiles.sort(), ['app_data.json', 'other.json']);
  assert.equal(fs.existsSync(path.join(defaultPath, 'path_config.json')), false);
  assert.equal(fs.readFileSync(path.join(defaultPath, 'app_data.json'), 'utf-8'), '{"sources":[{"name":"custom"}]}');
  assert.equal(fs.readFileSync(path.join(defaultPath, 'other.json'), 'utf-8'), '{"ok":true}');
  assert.equal(fs.existsSync(path.join(defaultPath, 'path_config.json')), false);
  assert.equal(fs.existsSync(path.join(customPath, 'app_data.json')), false);
  assert.equal(fs.existsSync(path.join(customPath, 'other.json')), false);
  assert.equal(fs.existsSync(path.join(customPath, 'path_config.json')), true);
});

test('can clear path config without moving data when explicitly requested', () => {
  const root = createTempRoot();
  const defaultPath = path.join(root, 'default');
  const customPath = path.join(root, 'custom');
  fs.mkdirSync(defaultPath, { recursive: true });
  fs.mkdirSync(customPath, { recursive: true });

  fs.writeFileSync(path.join(defaultPath, 'path_config.json'), JSON.stringify({ storagePath: customPath }), 'utf-8');
  fs.writeFileSync(path.join(customPath, 'app_data.json'), '{"sources":[{"name":"custom"}]}', 'utf-8');

  const result = resetStoragePathToDefault(defaultPath, customPath, { moveData: false });

  assert.equal(result.success, true);
  assert.deepEqual(result.movedFiles, []);
  assert.equal(fs.existsSync(path.join(defaultPath, 'path_config.json')), false);
  assert.equal(fs.existsSync(path.join(defaultPath, 'app_data.json')), false);
  assert.equal(fs.existsSync(path.join(customPath, 'app_data.json')), true);
});
