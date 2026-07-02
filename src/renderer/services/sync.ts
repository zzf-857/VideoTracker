import { storageService, AppDataStore } from './storage';
import { WebDAVClient } from './webdav';
import {
  restoreRemoteBackup,
  SyncBackupResult,
  uploadLocalBackup
} from './syncBackup';

class SyncService {
  private getClient(store: AppDataStore): WebDAVClient | null {
    const { webdavSyncUrl, webdavUser, webdavPassword } = store.settings;
    if (!webdavSyncUrl) return null;
    return new WebDAVClient(webdavSyncUrl, webdavUser, webdavPassword);
  }

  private async withClient(
    action: (client: WebDAVClient) => Promise<SyncBackupResult>
  ): Promise<SyncBackupResult> {
    const localData = await storageService.loadData();
    const client = this.getClient(localData);

    if (!client) {
      return { success: false, message: '未配置 WebDAV 备份目录' };
    }

    return action(client);
  }

  async uploadLocalBackup(): Promise<SyncBackupResult> {
    return this.withClient(client => uploadLocalBackup(storageService, client));
  }

  async restoreFromRemoteBackup(): Promise<SyncBackupResult> {
    return this.withClient(client => restoreRemoteBackup(storageService, client));
  }
}

export const syncService = new SyncService();
