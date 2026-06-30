import assert from 'node:assert/strict';
import { migrateProgressForFileTree } from '../src/renderer/services/progressMigration';
import type { AppDataStore, MediaSourceConfig } from '../src/renderer/services/storage';

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: TreeNode[];
};

const makeStore = (overrides: Partial<AppDataStore>): AppDataStore => ({
  progress: {},
  dailyLogs: {},
  sources: [],
  settings: {
    idleTimeout: 15,
    autoSync: false,
    hotkeys: {
      fullscreen: 'f',
      speedUp: 'c',
      speedDown: 'x',
      speedReset: 'z'
    }
  },
  timelines: {},
  ...overrides
});

const localSource = (path: string): MediaSourceConfig => ({
  id: 'source-local',
  name: 'Local Course',
  type: 'local',
  path
});

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('migrates progress, timeline, and last played video when only the source root changes', () => {
  const oldPath = 'D:\\Courses\\React\\01-intro.mp4';
  const newPath = 'E:\\Learning\\React\\01-intro.mp4';
  const store = makeStore({
    progress: {
      [oldPath]: {
        currentTime: 80,
        duration: 600,
        isFinished: false,
        lastPlayedTime: 1000,
        size: 1024
      }
    },
    timelines: {
      [oldPath]: '00:00 Intro'
    },
    lastPlayedVideo: {
      path: oldPath,
      name: '01-intro.mp4',
      sourceId: 'source-local'
    }
  });

  const result = migrateProgressForFileTree({
    data: store,
    currentSource: localSource('E:\\Learning'),
    previousSourceRoot: 'D:\\Courses',
    fileTree: [
      {
        name: 'React',
        path: 'E:\\Learning\\React',
        isDir: true,
        children: [
          {
            name: '01-intro.mp4',
            path: newPath,
            isDir: false,
            size: 1024
          }
        ]
      }
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(result.data.progress[newPath]?.currentTime, 80);
  assert.equal(result.data.progress[newPath]?.size, 1024);
  assert.equal(result.data.progress[oldPath], undefined);
  assert.equal(result.data.timelines?.[newPath], '00:00 Intro');
  assert.equal(result.data.timelines?.[oldPath], undefined);
  assert.equal(result.data.lastPlayedVideo?.path, newPath);
});

test('migrates a moved video by matching file name and size', () => {
  const oldPath = 'D:\\Courses\\React\\Part 1\\02-state.mp4';
  const newPath = 'D:\\Courses\\React\\Moved\\02-state.mp4';
  const store = makeStore({
    progress: {
      [oldPath]: {
        currentTime: 120,
        duration: 900,
        isFinished: false,
        lastPlayedTime: 2000,
        size: 2048
      }
    },
    timelines: {
      [oldPath]: '02:00 State'
    }
  });

  const result = migrateProgressForFileTree({
    data: store,
    currentSource: localSource('D:\\Courses'),
    fileTree: [
      {
        name: 'React',
        path: 'D:\\Courses\\React',
        isDir: true,
        children: [
          {
            name: 'Moved',
            path: 'D:\\Courses\\React\\Moved',
            isDir: true,
            children: [
              {
                name: '02-state.mp4',
                path: newPath,
                isDir: false,
                size: 2048
              }
            ]
          }
        ]
      }
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(result.data.progress[newPath]?.currentTime, 120);
  assert.equal(result.data.timelines?.[newPath], '02:00 State');
  assert.equal(result.data.progress[oldPath], undefined);
});

test('migrates progress when only path casing or slash style changes', () => {
  const oldPath = 'D:\\Courses\\React\\04-context.mp4';
  const newPath = 'd:/courses/react/04-context.mp4';
  const store = makeStore({
    progress: {
      [oldPath]: {
        currentTime: 60,
        duration: 400,
        isFinished: false,
        lastPlayedTime: 2500,
        size: 3072
      }
    }
  });

  const result = migrateProgressForFileTree({
    data: store,
    currentSource: localSource('d:/courses'),
    fileTree: [
      {
        name: '04-context.mp4',
        path: newPath,
        isDir: false,
        size: 3072
      }
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(result.data.progress[newPath]?.currentTime, 60);
  assert.equal(result.data.progress[oldPath], undefined);
});

test('fills missing size for existing progress without migrating paths', () => {
  const path = 'D:\\Courses\\React\\03-effects.mp4';
  const store = makeStore({
    progress: {
      [path]: {
        currentTime: 30,
        duration: 300,
        isFinished: false,
        lastPlayedTime: 3000
      }
    }
  });

  const result = migrateProgressForFileTree({
    data: store,
    currentSource: localSource('D:\\Courses'),
    fileTree: [
      {
        name: '03-effects.mp4',
        path,
        isDir: false,
        size: 4096
      }
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(result.data.progress[path]?.size, 4096);
});

test('migrates a renamed video when file size uniquely identifies the stale record', () => {
  const oldPath = 'D:\\Courses\\React\\old-name.mp4';
  const newPath = 'D:\\Courses\\React\\new-name.mp4';
  const store = makeStore({
    progress: {
      [oldPath]: {
        currentTime: 240,
        duration: 1200,
        isFinished: false,
        lastPlayedTime: 4000,
        size: 8192
      }
    }
  });

  const result = migrateProgressForFileTree({
    data: store,
    currentSource: localSource('D:\\Courses'),
    fileTree: [
      {
        name: 'new-name.mp4',
        path: newPath,
        isDir: false,
        size: 8192
      }
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(result.data.progress[newPath]?.currentTime, 240);
  assert.equal(result.data.progress[oldPath], undefined);
});

test('does not migrate stale name matches when more than one candidate exists', () => {
  const oldPathA = 'D:\\Courses\\A\\01.mp4';
  const oldPathB = 'D:\\Courses\\B\\01.mp4';
  const newPath = 'D:\\Courses\\C\\01.mp4';
  const store = makeStore({
    progress: {
      [oldPathA]: {
        currentTime: 10,
        duration: 100,
        isFinished: false,
        lastPlayedTime: 5000
      },
      [oldPathB]: {
        currentTime: 20,
        duration: 200,
        isFinished: false,
        lastPlayedTime: 6000
      }
    }
  });

  const result = migrateProgressForFileTree({
    data: store,
    currentSource: localSource('D:\\Courses'),
    fileTree: [
      {
        name: '01.mp4',
        path: newPath,
        isDir: false
      }
    ]
  });

  assert.equal(result.changed, false);
  assert.equal(result.data.progress[newPath], undefined);
  assert.equal(result.data.progress[oldPathA]?.currentTime, 10);
  assert.equal(result.data.progress[oldPathB]?.currentTime, 20);
});
