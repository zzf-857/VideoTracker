import type { VideoProgress } from './storage';

export interface PlanningTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: PlanningTreeNode[];
}

interface ProgressData {
  progress: Record<string, VideoProgress>;
}

export interface SourceStats {
  totalCount: number;
  finishedCount: number;
  totalDuration: number;
  finishedDuration: number;
  watchedDuration: number;
}

export interface LocalDurationPlan {
  fullDays: number;
  remainingDays: number;
  remainingDuration: number;
}

const FALLBACK_VIDEO_DURATION_SECONDS = 1800;

function flattenVideos(nodes: PlanningTreeNode[]): PlanningTreeNode[] {
  let videos: PlanningTreeNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      if (node.children) {
        videos = videos.concat(flattenVideos(node.children));
      }
    } else {
      videos.push(node);
    }
  }
  return videos;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateSourceStats({
  data,
  fileTree
}: {
  data: ProgressData | null;
  fileTree: PlanningTreeNode[];
}): SourceStats {
  if (!data) {
    return {
      totalCount: 0,
      finishedCount: 0,
      totalDuration: 0,
      finishedDuration: 0,
      watchedDuration: 0
    };
  }

  const flatVideos = flattenVideos(fileTree);
  let finishedCount = 0;
  let totalDuration = 0;
  let finishedDuration = 0;
  let watchedDuration = 0;

  for (const video of flatVideos) {
    const progress = data.progress[video.path];
    const videoDuration = progress?.duration && progress.duration > 0
      ? progress.duration
      : FALLBACK_VIDEO_DURATION_SECONDS;

    totalDuration += videoDuration;

    if (!progress) {
      continue;
    }

    if (progress.isFinished) {
      finishedCount++;
      finishedDuration += videoDuration;
      watchedDuration += videoDuration;
    } else {
      watchedDuration += clamp(progress.currentTime || 0, 0, videoDuration);
    }
  }

  return {
    totalCount: flatVideos.length,
    finishedCount,
    totalDuration,
    finishedDuration,
    watchedDuration
  };
}

export function calculateLocalDurationPlan({
  totalDuration,
  watchedDuration,
  playbackSpeed,
  dailyHours
}: {
  totalDuration: number;
  watchedDuration: number;
  playbackSpeed: number;
  dailyHours: number;
}): LocalDurationPlan {
  const safeSpeed = playbackSpeed > 0 ? playbackSpeed : 1;
  const remainingDuration = Math.max(0, totalDuration - watchedDuration);

  if (dailyHours <= 0) {
    return {
      fullDays: 0,
      remainingDays: 0,
      remainingDuration
    };
  }

  return {
    fullDays: Math.ceil((totalDuration / 3600 / safeSpeed) / dailyHours),
    remainingDays: Math.ceil((remainingDuration / 3600 / safeSpeed) / dailyHours),
    remainingDuration
  };
}
