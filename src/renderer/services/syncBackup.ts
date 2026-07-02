import type { AppDataStore } from './storage';

export const REMOTE_BACKUP_FILE_NAME = 'videotracker_sync_data.json';
export const RESTORE_SAFETY_BACKUP_KEY = 'app_data_before_webdav_restore';

export interface SyncBackupResult {
  success: boolean;
  message: string;
}

export interface UploadBackupStorage {
  loadData: () => Promise<AppDataStore>;
}

export interface RestoreBackupStorage extends UploadBackupStorage {
  replaceLocalBackup: (key: string, data: AppDataStore) => Promise<boolean>;
  replaceData: (data: AppDataStore) => Promise<boolean>;
}

export interface UploadBackupClient {
  uploadFile: (fileName: string, content: string) => Promise<boolean>;
}

export interface RestoreBackupClient {
  downloadFile: (fileName: string) => Promise<string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppDataStoreLike(value: unknown): value is AppDataStore {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.progress) &&
    isRecord(value.dailyLogs) &&
    Array.isArray(value.sources) &&
    isRecord(value.settings)
  );
}

function stringifyBackup(data: AppDataStore): string {
  return JSON.stringify(data, null, 2);
}

export async function uploadLocalBackup(
  storage: UploadBackupStorage,
  client: UploadBackupClient
): Promise<SyncBackupResult> {
  try {
    const localData = await storage.loadData();
    const uploadSuccess = await client.uploadFile(REMOTE_BACKUP_FILE_NAME, stringifyBackup(localData));

    if (!uploadSuccess) {
      return { success: false, message: '上传 WebDAV 备份失败，请检查账号权限或网络状态' };
    }

    return { success: true, message: '已用本机当前数据覆盖 WebDAV 主备份' };
  } catch (err: any) {
    console.error('Upload WebDAV backup failed:', err);
    return { success: false, message: `上传 WebDAV 备份异常: ${err.message || err}` };
  }
}

export async function restoreRemoteBackup(
  storage: RestoreBackupStorage,
  client: RestoreBackupClient
): Promise<SyncBackupResult> {
  try {
    const localData = await storage.loadData();
    const remoteText = await client.downloadFile(REMOTE_BACKUP_FILE_NAME);

    if (!remoteText) {
      return { success: false, message: 'WebDAV 上没有可恢复的主备份，本地数据未改动' };
    }

    let remoteData: unknown;
    try {
      remoteData = JSON.parse(remoteText);
    } catch {
      return { success: false, message: 'WebDAV 主备份内容不是有效 JSON，本地数据未改动' };
    }

    if (!isAppDataStoreLike(remoteData)) {
      return { success: false, message: 'WebDAV 主备份结构不完整，本地数据未改动' };
    }

    const backupSuccess = await storage.replaceLocalBackup(RESTORE_SAFETY_BACKUP_KEY, localData);
    if (!backupSuccess) {
      return { success: false, message: '恢复前本地安全快照写入失败，已取消覆盖操作' };
    }

    const replaceSuccess = await storage.replaceData(remoteData);
    if (!replaceSuccess) {
      return { success: false, message: '本地安全快照已保留，但云端覆盖本地失败' };
    }

    return {
      success: true,
      message: '已从 WebDAV 主备份恢复，本地恢复前快照已更新'
    };
  } catch (err: any) {
    console.error('Restore WebDAV backup failed:', err);
    return { success: false, message: `从 WebDAV 恢复异常: ${err.message || err}` };
  }
}
