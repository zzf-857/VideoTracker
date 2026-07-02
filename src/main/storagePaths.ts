import * as fs from 'fs';
import * as path from 'path';

export interface ResetStoragePathOptions {
  moveData?: boolean;
}

export interface ResetStoragePathResult {
  success: true;
  defaultPath: string;
  movedFiles: string[];
}

function getJsonDataFiles(directoryPath: string): string[] {
  if (!fs.existsSync(directoryPath)) return [];

  return fs.readdirSync(directoryPath)
    .filter(fileName => fileName.endsWith('.json') && fileName !== 'path_config.json');
}

function moveJsonDataFiles(sourcePath: string, targetPath: string): string[] {
  const movedFiles = getJsonDataFiles(sourcePath);
  fs.mkdirSync(targetPath, { recursive: true });

  for (const fileName of movedFiles) {
    fs.copyFileSync(path.join(sourcePath, fileName), path.join(targetPath, fileName));
  }

  for (const fileName of movedFiles) {
    fs.unlinkSync(path.join(sourcePath, fileName));
  }

  return movedFiles;
}

export function resetStoragePathToDefault(
  defaultPath: string,
  currentPath: string,
  options: ResetStoragePathOptions = {}
): ResetStoragePathResult {
  fs.mkdirSync(defaultPath, { recursive: true });

  const normalizedDefaultPath = path.resolve(defaultPath);
  const normalizedCurrentPath = path.resolve(currentPath || defaultPath);
  const shouldMoveData = options.moveData !== false
    && normalizedCurrentPath.toLowerCase() !== normalizedDefaultPath.toLowerCase();

  const movedFiles = shouldMoveData
    ? moveJsonDataFiles(normalizedCurrentPath, normalizedDefaultPath)
    : [];

  const configPathFile = path.join(normalizedDefaultPath, 'path_config.json');
  if (fs.existsSync(configPathFile)) {
    fs.unlinkSync(configPathFile);
  }

  return { success: true, defaultPath: normalizedDefaultPath, movedFiles };
}
