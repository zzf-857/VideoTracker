import * as fs from 'fs';
import { getSubtitleTypeFromPath } from '../renderer/services/subtitles';

export interface EditableSubtitleFileResult {
  success: boolean;
  type?: 'srt' | 'vtt';
  content?: string;
  backupPath?: string;
  error?: string;
}

function isRemotePath(filePath: string): boolean {
  return filePath.startsWith('http://') || filePath.startsWith('https://');
}

function getEditableSubtitleType(filePath: string): 'srt' | 'vtt' | null {
  const type = getSubtitleTypeFromPath(filePath);
  return type === 'srt' || type === 'vtt' ? type : null;
}

function validateEditableSubtitleFile(filePath: string): { type: 'srt' | 'vtt' } | { error: string } {
  if (!filePath || isRemotePath(filePath)) {
    return { error: '仅支持编辑本地字幕文件' };
  }

  const type = getEditableSubtitleType(filePath);
  if (!type) {
    return { error: '仅支持编辑 srt / vtt 字幕文件' };
  }

  if (!fs.existsSync(filePath)) {
    return { error: '字幕文件不存在' };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return { error: '字幕路径不是文件' };
  }

  return { type };
}

function writeTextFileAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

export function readEditableSubtitleFile(filePath: string): EditableSubtitleFileResult {
  try {
    const validation = validateEditableSubtitleFile(filePath);
    if ('error' in validation) {
      return { success: false, error: validation.error };
    }

    return {
      success: true,
      type: validation.type,
      content: fs.readFileSync(filePath, 'utf-8')
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || '字幕文件读取失败'
    };
  }
}

export function writeEditableSubtitleFile(filePath: string, content: string): EditableSubtitleFileResult {
  try {
    const validation = validateEditableSubtitleFile(filePath);
    if ('error' in validation) {
      return { success: false, error: validation.error };
    }

    const backupPath = `${filePath}.bak`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    writeTextFileAtomically(filePath, content);

    return {
      success: true,
      type: validation.type,
      backupPath
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || '字幕文件保存失败'
    };
  }
}
