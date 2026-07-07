export function parseLocalDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalDays(dateStr: string, days: number): string {
  const date = parseLocalDateString(dateStr);
  date.setDate(date.getDate() + days);
  return formatLocalDateString(date);
}

export function buildSevenDayWindow(endDateStr: string): string[] {
  const dates: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    dates.push(addLocalDays(endDateStr, -offset));
  }
  return dates;
}

export function getOverviewEndDateForSelectedDate(selectedDate: string): string {
  return selectedDate;
}

export function shiftSevenDayWindowFromEdge(options: {
  clickedDate: string;
  currentEndDate: string;
  windowDates: string[];
  availableDateStrings: string[];
}): string {
  const [leftEdge] = options.windowDates;
  const rightEdge = options.windowDates[options.windowDates.length - 1];
  const activeDates = options.availableDateStrings
    .filter(Boolean)
    .sort();

  if (options.clickedDate === leftEdge) {
    const hasOlderRecord = activeDates.some(dateStr => dateStr < leftEdge);
    return hasOlderRecord ? addLocalDays(options.currentEndDate, -1) : options.currentEndDate;
  }

  if (options.clickedDate === rightEdge) {
    const hasNewerRecord = activeDates.some(dateStr => dateStr > rightEdge);
    return hasNewerRecord ? addLocalDays(options.currentEndDate, 1) : options.currentEndDate;
  }

  return options.currentEndDate;
}

export interface SevenDayTweenStep {
  endDate: string;
  direction: 'left' | 'right';
  delayMs: number;
}

function getDateDiffInDays(fromDateStr: string, toDateStr: string): number {
  const fromTime = parseLocalDateString(fromDateStr).getTime();
  const toTime = parseLocalDateString(toDateStr).getTime();
  return Math.round((toTime - fromTime) / (1000 * 60 * 60 * 24));
}

function getTweenStepDelay(remainingDays: number): number {
  if (remainingDays > 90) return 8;
  if (remainingDays > 45) return 12;
  if (remainingDays > 21) return 18;
  if (remainingDays > 10) return 30;
  if (remainingDays > 5) return 54;
  if (remainingDays > 2) return 90;
  if (remainingDays > 1) return 140;
  return 220;
}

export function buildSevenDayTweenSteps(fromEndDate: string, toEndDate: string): SevenDayTweenStep[] {
  const diffDays = getDateDiffInDays(fromEndDate, toEndDate);
  if (diffDays === 0) return [];

  const direction = diffDays > 0 ? 'right' : 'left';
  const stepDirection = diffDays > 0 ? 1 : -1;
  const totalSteps = Math.abs(diffDays);
  const steps: SevenDayTweenStep[] = [];

  for (let step = 1; step <= totalSteps; step += 1) {
    const remainingDays = totalSteps - step + 1;
    steps.push({
      endDate: addLocalDays(fromEndDate, step * stepDirection),
      direction,
      delayMs: getTweenStepDelay(remainingDays)
    });
  }

  return steps;
}
