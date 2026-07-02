import assert from 'node:assert/strict';
import { DEFAULT_SUBTITLE_STYLE } from '../src/renderer/services/subtitles';
import { storageService } from '../src/renderer/services/storage';

type StorageMap = Record<string, string>;

const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function test(name: string, fn: () => Promise<void> | void) {
  tests.push({ name, fn });
}

class MemoryStorage {
  store: StorageMap = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
}

function seedStorage(seed: unknown) {
  const memoryStorage = new MemoryStorage();
  memoryStorage.setItem('videotracker_app_data', JSON.stringify(seed));
  (globalThis as any).localStorage = memoryStorage;
  storageService.clearCache();

  return { storageService, memoryStorage };
}

test('derives the global subtitle style from the latest legacy subtitle record', async () => {
  const legacyStyle = {
    fontSize: 32,
    textColor: '#ffd700',
    backgroundColor: '#101820',
    backgroundOpacity: 0.45,
    positionX: 40,
    positionY: 74
  };

  const { storageService } = seedStorage({
    progress: {},
    dailyLogs: {},
    sources: [],
    settings: {
      idleTimeout: 15,
      autoSync: false,
      hotkeys: {}
    },
    subtitles: {
      'D:\\Course\\old.srt': {
        path: 'D:\\Course\\old.srt',
        name: 'old.srt',
        type: 'srt',
        offset: 0,
        enabled: true,
        style: DEFAULT_SUBTITLE_STYLE,
        lastUsedTime: 10
      },
      'D:\\Course\\latest.srt': {
        path: 'D:\\Course\\latest.srt',
        name: 'latest.srt',
        type: 'srt',
        offset: 0,
        enabled: true,
        style: legacyStyle,
        lastUsedTime: 99
      }
    }
  });

  const data = await storageService.loadData();

  assert.deepEqual(data.settings.subtitleStyle, legacyStyle);
});

test('saves subtitle display style globally and keeps video subtitle records file-only', async () => {
  const { storageService, memoryStorage } = seedStorage({
    progress: {},
    dailyLogs: {},
    sources: [],
    settings: {
      idleTimeout: 15,
      autoSync: false,
      hotkeys: {}
    },
    subtitles: {}
  });

  const style = {
    fontSize: 30,
    textColor: '#00d4ff',
    backgroundColor: '#172554',
    backgroundOpacity: 0.5,
    positionX: 45,
    positionY: 78
  };

  await storageService.saveSubtitleStyle(style);
  await storageService.saveSubtitle('D:\\Course\\lesson.mp4', {
    path: 'D:\\Course\\lesson.srt',
    name: 'lesson.srt',
    type: 'srt',
    offset: 1,
    enabled: true,
    style: DEFAULT_SUBTITLE_STYLE,
    lastUsedTime: 123
  });

  const rawData = JSON.parse(memoryStorage.store.videotracker_app_data);

  assert.deepEqual(rawData.settings.subtitleStyle, style);
  assert.equal(rawData.subtitles['D:\\Course\\lesson.mp4'].style, undefined);
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
