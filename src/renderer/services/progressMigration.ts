import type { AppDataStore, MediaSourceConfig, PlayedVideoLog, VideoProgress } from './storage';

export interface MigrationTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  duration?: number;
  children?: MigrationTreeNode[];
}

interface ProgressEntry {
  path: string;
  normalizedPath: string;
  name: string;
  size?: number;
  duration?: number;
  progress: VideoProgress;
}

interface CurrentVideoEntry {
  node: MigrationTreeNode;
  normalizedPath: string;
  name: string;
  relativePath: string;
}

export interface ProgressMigrationOptions {
  data: AppDataStore;
  currentSource: MediaSourceConfig;
  fileTree: MigrationTreeNode[];
  previousSourceRoot?: string;
}

export interface MigratedProgressPath {
  from: string;
  to: string;
  reason: 'normalized-path' | 'relative-path' | 'name-and-size' | 'size-and-duration' | 'unique-size' | 'stale-name';
}

export interface MigratedDailyLogPath {
  date: string;
  from: string;
  to: string;
  reason: 'progress-migration' | 'relative-path' | 'sibling-root';
}

export interface ProgressMigrationResult {
  data: AppDataStore;
  changed: boolean;
  migratedPaths: MigratedProgressPath[];
  migratedDailyLogPaths: MigratedDailyLogPath[];
  filledSizePaths: string[];
}

function toPathname(value: string): string {
  if (!value) return '';
  try {
    if (/^https?:\/\//i.test(value)) {
      return decodeURIComponent(new URL(value).pathname);
    }
  } catch {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(value: string): string {
  return toPathname(value)
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

function getBaseName(pathValue: string, fallbackName?: string): string {
  const name = fallbackName || toPathname(pathValue).replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  return name.toLowerCase();
}

function getRelativePath(pathValue: string, rootValue?: string): string {
  const normalizedPath = normalizePath(pathValue);
  const normalizedRoot = normalizePath(rootValue || '');
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return '';
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

function collectVideos(nodes: MigrationTreeNode[]): MigrationTreeNode[] {
  const videos: MigrationTreeNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      if (node.children) {
        videos.push(...collectVideos(node.children));
      }
    } else {
      videos.push(node);
    }
  }
  return videos;
}

function isDurationClose(left?: number, right?: number): boolean {
  if (!left || !right) return false;
  return Math.abs(left - right) <= Math.max(2, Math.min(left, right) * 0.01);
}

function findUniqueCandidate(
  entries: ProgressEntry[],
  usedOldPaths: Set<string>,
  predicate: (entry: ProgressEntry) => boolean
): ProgressEntry | null {
  const matches = entries.filter(entry => !usedOldPaths.has(entry.path) && predicate(entry));
  return matches.length === 1 ? matches[0] : null;
}

function addToGroup<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function getUniqueEntry(entries: CurrentVideoEntry[]): CurrentVideoEntry | null {
  return entries.length === 1 ? entries[0] : null;
}

function cloneData(data: AppDataStore): AppDataStore {
  return {
    ...data,
    progress: { ...data.progress },
    dailyLogs: Object.fromEntries(
      Object.entries(data.dailyLogs || {}).map(([date, log]) => [
        date,
        {
          ...log,
          playedVideos: log.playedVideos.map(video => ({ ...video }))
        }
      ])
    ),
    timelines: data.timelines ? { ...data.timelines } : {}
  };
}

function createCurrentVideoEntries(videos: MigrationTreeNode[], sourceRoot: string): CurrentVideoEntry[] {
  return videos.map(video => ({
    node: video,
    normalizedPath: normalizePath(video.path),
    name: getBaseName(video.path, video.name),
    relativePath: getRelativePath(video.path, sourceRoot)
  }));
}

function isSamePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function isLaterTime(left: string, right: string): boolean {
  return left > right;
}

function getSiblingRootRelativePath(pathValue: string, currentRootValue: string): string | null {
  const normalizedPath = normalizePath(pathValue);
  const normalizedRoot = normalizePath(currentRootValue);
  const rootParentEnd = normalizedRoot.lastIndexOf('/');
  if (rootParentEnd <= 0) return null;

  const rootParent = normalizedRoot.slice(0, rootParentEnd);
  if (!normalizedPath.startsWith(`${rootParent}/`)) return null;

  const siblingRootAndRelative = normalizedPath.slice(rootParent.length + 1);
  const relativeStart = siblingRootAndRelative.indexOf('/');
  if (relativeStart === -1) return '';

  return siblingRootAndRelative.slice(relativeStart + 1);
}

function migrateDailyLogsForFileTree(options: {
  data: AppDataStore;
  currentSource: MediaSourceConfig;
  videoEntries: CurrentVideoEntry[];
  migratedPaths: MigratedProgressPath[];
  previousSourceRoot?: string;
}): { changed: boolean; migratedPaths: MigratedDailyLogPath[] } {
  const { data, currentSource, videoEntries, migratedPaths, previousSourceRoot } = options;
  const entriesByNormalizedPath = new Map<string, CurrentVideoEntry>();
  const entriesByRelativePath = new Map<string, CurrentVideoEntry[]>();

  for (const entry of videoEntries) {
    entriesByNormalizedPath.set(entry.normalizedPath, entry);
    if (entry.relativePath) {
      addToGroup(entriesByRelativePath, entry.relativePath, entry);
    }
  }

  const entriesByProgressMigration = new Map<string, CurrentVideoEntry>();
  for (const migration of migratedPaths) {
    const targetEntry = entriesByNormalizedPath.get(normalizePath(migration.to));
    if (targetEntry) {
      entriesByProgressMigration.set(normalizePath(migration.from), targetEntry);
    }
  }

  const resolveTarget = (video: PlayedVideoLog): { entry: CurrentVideoEntry; reason: MigratedDailyLogPath['reason'] } | null => {
    const normalizedPath = normalizePath(video.path);
    if (entriesByNormalizedPath.has(normalizedPath)) {
      return null;
    }

    const progressMigrationEntry = entriesByProgressMigration.get(normalizedPath);
    if (progressMigrationEntry) {
      return { entry: progressMigrationEntry, reason: 'progress-migration' };
    }

    if (previousSourceRoot) {
      const previousRelativePath = getRelativePath(video.path, previousSourceRoot);
      const relativeMatch = getUniqueEntry(entriesByRelativePath.get(previousRelativePath) || []);
      if (relativeMatch) {
        return { entry: relativeMatch, reason: 'relative-path' };
      }
    }

    if (currentSource.type === 'local') {
      const siblingRootRelativePath = getSiblingRootRelativePath(video.path, currentSource.path);
      if (siblingRootRelativePath) {
        const siblingRootMatches = (entriesByRelativePath.get(siblingRootRelativePath) || []).filter(entry => {
          return data.progress[entry.node.path] !== undefined;
        });
        const siblingRootMatch = getUniqueEntry(siblingRootMatches);
        if (siblingRootMatch) {
          return { entry: siblingRootMatch, reason: 'sibling-root' };
        }
      }
    }

    return null;
  };

  let changed = false;
  const migratedDailyLogPaths: MigratedDailyLogPath[] = [];

  for (const [date, log] of Object.entries(data.dailyLogs || {})) {
    let logChanged = false;
    const mergedVideos = new Map<string, PlayedVideoLog>();

    for (const video of log.playedVideos) {
      const target = resolveTarget(video);
      const nextVideo: PlayedVideoLog = target
        ? {
            ...video,
            path: target.entry.node.path,
            name: target.entry.node.name || video.name,
            sourceName: currentSource.name || video.sourceName
          }
        : { ...video };
      const mergeKey = normalizePath(nextVideo.path);
      const existingVideo = mergedVideos.get(mergeKey);

      if (target) {
        if (!isSamePath(video.path, target.entry.node.path)) {
          migratedDailyLogPaths.push({
            date,
            from: video.path,
            to: target.entry.node.path,
            reason: target.reason
          });
          logChanged = true;
        }

        if (video.name !== nextVideo.name || video.sourceName !== nextVideo.sourceName) {
          logChanged = true;
        }
      }

      if (existingVideo) {
        existingVideo.duration += nextVideo.duration;
        if (isLaterTime(nextVideo.time, existingVideo.time)) {
          existingVideo.time = nextVideo.time;
        }
        if (nextVideo.name) {
          existingVideo.name = nextVideo.name;
        }
        if (nextVideo.sourceName) {
          existingVideo.sourceName = nextVideo.sourceName;
        }
        logChanged = true;
      } else {
        mergedVideos.set(mergeKey, nextVideo);
      }
    }

    if (logChanged) {
      const playedVideos = Array.from(mergedVideos.values());
      data.dailyLogs[date] = {
        ...log,
        totalDuration: playedVideos.reduce((sum, video) => sum + video.duration, 0),
        playedVideos
      };
      changed = true;
    }
  }

  return {
    changed,
    migratedPaths: migratedDailyLogPaths
  };
}

export function migrateProgressForFileTree(options: ProgressMigrationOptions): ProgressMigrationResult {
  const { data, currentSource, fileTree, previousSourceRoot } = options;
  const nextData = cloneData(data);
  const videos = collectVideos(fileTree);
  const currentVideoEntries = createCurrentVideoEntries(videos, currentSource.path);
  const currentPathSet = new Set(videos.map(video => normalizePath(video.path)));
  const sourceRoot = currentSource.path;
  const progressEntries: ProgressEntry[] = Object.entries(data.progress).map(([path, progress]) => ({
    path,
    normalizedPath: normalizePath(path),
    name: getBaseName(path),
    size: progress.size,
    duration: progress.duration,
    progress
  }));

  const usedOldPaths = new Set<string>();
  const migratedPaths: MigratedProgressPath[] = [];
  const filledSizePaths: string[] = [];

  const findMigrationCandidate = (video: MigrationTreeNode): MigratedProgressPath | null => {
    const newPath = video.path;
    const newNormalizedPath = normalizePath(newPath);
    const newName = getBaseName(newPath, video.name);
    const newRelativePath = getRelativePath(newPath, sourceRoot);
    const size = video.size;

    const normalizedPathMatch = findUniqueCandidate(progressEntries, usedOldPaths, entry => {
      return entry.path !== newPath && entry.normalizedPath === newNormalizedPath;
    });
    if (normalizedPathMatch) {
      return { from: normalizedPathMatch.path, to: newPath, reason: 'normalized-path' };
    }

    const staleEntries = progressEntries.filter(entry => !currentPathSet.has(entry.normalizedPath));

    if (previousSourceRoot) {
      const oldRelativeMatch = findUniqueCandidate(staleEntries, usedOldPaths, entry => {
        return getRelativePath(entry.path, previousSourceRoot) === newRelativePath;
      });
      if (oldRelativeMatch) {
        return { from: oldRelativeMatch.path, to: newPath, reason: 'relative-path' };
      }
    }

    if (typeof size === 'number') {
      const nameAndSizeMatch = findUniqueCandidate(staleEntries, usedOldPaths, entry => {
        return entry.name === newName && entry.size === size;
      });
      if (nameAndSizeMatch) {
        return { from: nameAndSizeMatch.path, to: newPath, reason: 'name-and-size' };
      }

      const sizeAndDurationMatch = findUniqueCandidate(staleEntries, usedOldPaths, entry => {
        return entry.size === size && isDurationClose(entry.duration, video.duration);
      });
      if (sizeAndDurationMatch) {
        return { from: sizeAndDurationMatch.path, to: newPath, reason: 'size-and-duration' };
      }

      const uniqueSizeMatch = findUniqueCandidate(staleEntries, usedOldPaths, entry => entry.size === size);
      if (uniqueSizeMatch) {
        return { from: uniqueSizeMatch.path, to: newPath, reason: 'unique-size' };
      }
    }

    const staleNameMatch = findUniqueCandidate(staleEntries, usedOldPaths, entry => entry.name === newName);
    if (staleNameMatch) {
      return { from: staleNameMatch.path, to: newPath, reason: 'stale-name' };
    }

    return null;
  };

  for (const video of videos) {
    const existingProgress = nextData.progress[video.path];
    if (existingProgress) {
      if (typeof video.size === 'number' && existingProgress.size !== video.size) {
        nextData.progress[video.path] = {
          ...existingProgress,
          size: video.size
        };
        filledSizePaths.push(video.path);
      }
      continue;
    }

    const migration = findMigrationCandidate(video);
    if (!migration) continue;

    const oldProgress = nextData.progress[migration.from];
    if (!oldProgress) continue;

    nextData.progress[migration.to] = {
      ...oldProgress,
      size: typeof video.size === 'number' ? video.size : oldProgress.size
    };
    delete nextData.progress[migration.from];

    if (nextData.timelines && nextData.timelines[migration.from] !== undefined && nextData.timelines[migration.to] === undefined) {
      nextData.timelines[migration.to] = nextData.timelines[migration.from];
      delete nextData.timelines[migration.from];
    }

    if (nextData.lastPlayedVideo?.path === migration.from) {
      nextData.lastPlayedVideo = {
        ...nextData.lastPlayedVideo,
        path: migration.to,
        name: video.name || nextData.lastPlayedVideo.name
      };
    }

    usedOldPaths.add(migration.from);
    migratedPaths.push(migration);
  }

  const dailyLogMigration = migrateDailyLogsForFileTree({
    data: nextData,
    currentSource,
    videoEntries: currentVideoEntries,
    migratedPaths,
    previousSourceRoot
  });

  return {
    data: nextData,
    changed: migratedPaths.length > 0 || filledSizePaths.length > 0 || dailyLogMigration.changed,
    migratedPaths,
    migratedDailyLogPaths: dailyLogMigration.migratedPaths,
    filledSizePaths
  };
}
