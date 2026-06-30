import type { AppDataStore, MediaSourceConfig, VideoProgress } from './storage';

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

export interface ProgressMigrationResult {
  data: AppDataStore;
  changed: boolean;
  migratedPaths: MigratedProgressPath[];
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

function cloneData(data: AppDataStore): AppDataStore {
  return {
    ...data,
    progress: { ...data.progress },
    timelines: data.timelines ? { ...data.timelines } : {}
  };
}

export function migrateProgressForFileTree(options: ProgressMigrationOptions): ProgressMigrationResult {
  const { data, currentSource, fileTree, previousSourceRoot } = options;
  const nextData = cloneData(data);
  const videos = collectVideos(fileTree);
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

  return {
    data: nextData,
    changed: migratedPaths.length > 0 || filledSizePaths.length > 0,
    migratedPaths,
    filledSizePaths
  };
}
