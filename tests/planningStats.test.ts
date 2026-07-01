import assert from 'node:assert/strict';
import {
  calculateLocalDurationPlan,
  calculateSourceStats,
  type PlanningTreeNode
} from '../src/renderer/services/planningStats';
import type { AppDataStore } from '../src/renderer/services/storage';

const makeStore = (progress: AppDataStore['progress']): Pick<AppDataStore, 'progress'> => ({
  progress
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

test('calculates remaining local plan from watched progress, not full duration', () => {
  const totalDuration = 54 * 3600;
  const watchedDuration = 14 * 3600;

  const plan = calculateLocalDurationPlan({
    totalDuration,
    watchedDuration,
    playbackSpeed: 1,
    dailyHours: 2
  });

  assert.equal(plan.remainingDays, 20);
  assert.equal(plan.fullDays, 27);
  assert.equal(plan.remainingDuration, 40 * 3600);
});

test('source stats count partial progress as watched duration', () => {
  const fileTree: PlanningTreeNode[] = [
    { name: 'lesson-1.mp4', path: 'lesson-1.mp4', isDir: false },
    { name: 'lesson-2.mp4', path: 'lesson-2.mp4', isDir: false },
    { name: 'lesson-3.mp4', path: 'lesson-3.mp4', isDir: false }
  ];

  const stats = calculateSourceStats({
    data: makeStore({
      'lesson-1.mp4': {
        currentTime: 3600,
        duration: 7200,
        isFinished: false,
        lastPlayedTime: 1
      },
      'lesson-2.mp4': {
        currentTime: 7200,
        duration: 7200,
        isFinished: true,
        lastPlayedTime: 2
      }
    }),
    fileTree
  });

  assert.equal(stats.totalCount, 3);
  assert.equal(stats.finishedCount, 1);
  assert.equal(stats.totalDuration, 16200);
  assert.equal(stats.finishedDuration, 7200);
  assert.equal(stats.watchedDuration, 10800);
});
