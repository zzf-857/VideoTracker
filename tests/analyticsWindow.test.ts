import assert from 'node:assert/strict';
import {
  buildSevenDayWindow,
  buildSevenDayTweenSteps,
  calculateActiveStudyDays,
  getOverviewEndDateForSelectedDate,
  shiftSevenDayWindowFromEdge
} from '../src/renderer/services/analyticsWindow';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('builds a seven day window ending at the selected end date', () => {
  assert.deepEqual(buildSevenDayWindow('2026-07-07'), [
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
    '2026-07-04',
    '2026-07-05',
    '2026-07-06',
    '2026-07-07'
  ]);
});

test('uses the heatmap selected date as the overview end date', () => {
  assert.equal(getOverviewEndDateForSelectedDate('2026-06-12'), '2026-06-12');
});

test('counts only days with positive learning duration', () => {
  assert.equal(calculateActiveStudyDays({
    '2026-07-01': { totalDuration: 120 },
    '2026-07-02': { totalDuration: 0 },
    '2026-07-03': { totalDuration: 1 }
  }), 2);
});

test('shifts one day left when the left edge is selected and older records exist', () => {
  const windowDates = buildSevenDayWindow('2026-07-07');
  const nextEndDate = shiftSevenDayWindowFromEdge({
    clickedDate: '2026-07-01',
    currentEndDate: '2026-07-07',
    windowDates,
    availableDateStrings: ['2026-06-28', '2026-07-01', '2026-07-07']
  });

  assert.equal(nextEndDate, '2026-07-06');
});

test('does not shift right from the right edge when no newer records exist', () => {
  const windowDates = buildSevenDayWindow('2026-07-07');
  const nextEndDate = shiftSevenDayWindowFromEdge({
    clickedDate: '2026-07-07',
    currentEndDate: '2026-07-07',
    windowDates,
    availableDateStrings: ['2026-07-01', '2026-07-07']
  });

  assert.equal(nextEndDate, '2026-07-07');
});

test('shifts one day right when the right edge is selected and newer records exist', () => {
  const windowDates = buildSevenDayWindow('2026-07-07');
  const nextEndDate = shiftSevenDayWindowFromEdge({
    clickedDate: '2026-07-07',
    currentEndDate: '2026-07-07',
    windowDates,
    availableDateStrings: ['2026-07-01', '2026-07-07', '2026-07-10']
  });

  assert.equal(nextEndDate, '2026-07-08');
});

test('builds day-by-day tween steps with fast middle movement and slower ending', () => {
  const steps = buildSevenDayTweenSteps('2026-07-01', '2026-07-06');

  assert.deepEqual(steps.map(step => step.endDate), [
    '2026-07-02',
    '2026-07-03',
    '2026-07-04',
    '2026-07-05',
    '2026-07-06'
  ]);
  assert.deepEqual(new Set(steps.map(step => step.direction)), new Set(['right']));
  assert.ok(steps[0].delayMs < steps[steps.length - 1].delayMs);
});

test('builds reverse day-by-day tween steps for older selected dates', () => {
  const steps = buildSevenDayTweenSteps('2026-07-06', '2026-07-03');

  assert.deepEqual(steps.map(step => step.endDate), [
    '2026-07-05',
    '2026-07-04',
    '2026-07-03'
  ]);
  assert.deepEqual(new Set(steps.map(step => step.direction)), new Set(['left']));
});
