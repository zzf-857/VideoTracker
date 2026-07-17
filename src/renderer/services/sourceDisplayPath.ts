export interface DisplayableSourcePath {
  type: 'local' | 'webdav' | 'alist';
  path: string;
}

export function getSourceDisplayPath(source: DisplayableSourcePath): string {
  if (source.type === 'local') {
    return source.path;
  }

  try {
    return decodeURIComponent(source.path);
  } catch {
    return source.path;
  }
}
