import assert from 'node:assert/strict';
import {
  REMOTE_BACKUP_FILE_NAME,
  RESTORE_SAFETY_BACKUP_KEY,
  restoreRemoteBackup,
  uploadLocalBackup
} from '../src/renderer/services/syncBackup';
import type { AppDataStore } from '../src/renderer/services/storage';

const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function test(name: string, fn: () => Promise<void> | void) {
  tests.push({ name, fn });
}

function makeStore(name: string): AppDataStore {
  return {
    progress: {
      [`${name}.mp4`]: {
        currentTime: name === 'local' ? 120 : 360,
        duration: 900,
        isFinished: false,
        lastPlayedTime: name === 'local' ? 1000 : 2000
      }
    },
    dailyLogs: {},
    sources: [{ id: name, name, type: 'local', path: `D:\\${name}` }],
    settings: {
      idleTimeout: 15,
      autoSync: false,
      hotkeys: {
        fullscreen: 'f',
        speedUp: 'c',
        speedDown: 'x',
        speedReset: 'z',
        search: 'ctrl+f'
      }
    },
    timelines: {
      [`${name}.mp4`]: `${name} note`
    },
    subtitles: {}
  };
}

test('uploads the current local data as the WebDAV backup without merging', async () => {
  const localData = makeStore('local');
  const uploads: Array<{ fileName: string; content: string }> = [];

  const result = await uploadLocalBackup(
    { loadData: async () => localData },
    {
      uploadFile: async (fileName, content) => {
        uploads.push({ fileName, content });
        return true;
      }
    }
  );

  assert.equal(result.success, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].fileName, REMOTE_BACKUP_FILE_NAME);
  assert.deepEqual(JSON.parse(uploads[0].content), localData);
});

test('restores the remote backup only after replacing the local safety backup', async () => {
  const localData = makeStore('local');
  const remoteData = makeStore('remote');
  const calls: string[] = [];
  let backupData: AppDataStore | null = null;
  let restoredData: AppDataStore | null = null;

  const result = await restoreRemoteBackup(
    {
      loadData: async () => {
        calls.push('load-local');
        return localData;
      },
      replaceLocalBackup: async (key, data) => {
        calls.push(`replace-backup:${key}`);
        backupData = data;
        return true;
      },
      replaceData: async data => {
        calls.push('replace-local');
        restoredData = data;
        return true;
      }
    },
    {
      downloadFile: async fileName => {
        calls.push(`download:${fileName}`);
        return JSON.stringify(remoteData);
      }
    }
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    'load-local',
    `download:${REMOTE_BACKUP_FILE_NAME}`,
    `replace-backup:${RESTORE_SAFETY_BACKUP_KEY}`,
    'replace-local'
  ]);
  assert.deepEqual(backupData, localData);
  assert.deepEqual(restoredData, remoteData);
});

test('does not touch local data when the remote backup is missing', async () => {
  const localData = makeStore('local');
  const calls: string[] = [];

  const result = await restoreRemoteBackup(
    {
      loadData: async () => localData,
      replaceLocalBackup: async () => {
        calls.push('replace-backup');
        return true;
      },
      replaceData: async () => {
        calls.push('replace-local');
        return true;
      }
    },
    {
      downloadFile: async () => null
    }
  );

  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});

test('does not replace local data when the safety backup cannot be written', async () => {
  const localData = makeStore('local');
  const remoteData = makeStore('remote');
  const calls: string[] = [];

  const result = await restoreRemoteBackup(
    {
      loadData: async () => localData,
      replaceLocalBackup: async () => {
        calls.push('replace-backup');
        return false;
      },
      replaceData: async () => {
        calls.push('replace-local');
        return true;
      }
    },
    {
      downloadFile: async () => JSON.stringify(remoteData)
    }
  );

  assert.equal(result.success, false);
  assert.deepEqual(calls, ['replace-backup']);
});

async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      throw error;
    }
  }
}

run();
