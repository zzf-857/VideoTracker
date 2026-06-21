import { storageService, AppDataStore } from './storage';
import { WebDAVClient } from './webdav';

const SYNC_FILE_NAME = 'videotracker_sync_data.json';

class SyncService {
  private getClient(store: AppDataStore): WebDAVClient | null {
    const { webdavSyncUrl, webdavUser, webdavPassword } = store.settings;
    if (!webdavSyncUrl) return null;
    return new WebDAVClient(webdavSyncUrl, webdavUser, webdavPassword);
  }

  // 1. 双向智能合并数据
  private mergeData(local: AppDataStore, remote: AppDataStore): AppDataStore {
    const merged: AppDataStore = {
      progress: { ...local.progress },
      dailyLogs: { ...local.dailyLogs },
      sources: [...local.sources], // 媒体库以本地为准，避免多端路径冲突
      settings: { ...local.settings } // 设置也以本地为准
    };

    // 合并播放进度
    for (const [key, remoteProg] of Object.entries(remote.progress)) {
      const localProg = local.progress[key];
      if (!localProg || remoteProg.lastPlayedTime > localProg.lastPlayedTime) {
        merged.progress[key] = remoteProg;
      }
    }

    // 合并日历学习日志
    for (const [date, remoteLog] of Object.entries(remote.dailyLogs)) {
      const localLog = local.dailyLogs[date];
      if (!localLog) {
        merged.dailyLogs[date] = remoteLog;
      } else {
        // 同一天都有记录，进行智能合并
        const mergedVideos = [...localLog.playedVideos];
        
        for (const remoteVideo of remoteLog.playedVideos) {
          const localVideo = mergedVideos.find(v => v.path === remoteVideo.path);
          if (localVideo) {
            // 取两端观看时长最大值，或更新为最新的观看时间
            localVideo.duration = Math.max(localVideo.duration, remoteVideo.duration);
            localVideo.time = remoteVideo.time > localVideo.time ? remoteVideo.time : localVideo.time;
          } else {
            mergedVideos.push(remoteVideo);
          }
        }

        // 重新计算总时长
        const totalDuration = mergedVideos.reduce((sum, v) => sum + v.duration, 0);

        merged.dailyLogs[date] = {
          totalDuration,
          playedVideos: mergedVideos
        };
      }
    }

    return merged;
  }

  // 2. 一键云端双向同步 (下载 -> 合并 -> 上传)
  async sync(): Promise<{ success: boolean; message: string }> {
    try {
      const localData = await storageService.loadData();
      const client = this.getClient(localData);
      
      if (!client) {
        return { success: false, message: '未配置 WebDAV 同步源' };
      }

      // 尝试下载云端数据
      const remoteText = await client.downloadFile(SYNC_FILE_NAME);
      
      if (!remoteText) {
        // 如果云端没有同步文件，直接上传本地作为首个云端备份
        const uploadSuccess = await client.uploadFile(SYNC_FILE_NAME, JSON.stringify(localData, null, 2));
        if (uploadSuccess) {
          return { success: true, message: '首次同步：已成功上传本地配置到云端' };
        } else {
          return { success: false, message: '上传云端失败，请检查账号权限' };
        }
      }

      // 解析云端数据
      const remoteData: AppDataStore = JSON.parse(remoteText);

      // 双向智能合并
      const mergedData = this.mergeData(localData, remoteData);

      // 写回本地
      await storageService.saveData(mergedData);

      // 上传合并后的最新数据到云端
      const uploadSuccess = await client.uploadFile(SYNC_FILE_NAME, JSON.stringify(mergedData, null, 2));
      
      if (uploadSuccess) {
        return { success: true, message: '同步完成：数据合并成功并已同步至云端' };
      } else {
        return { success: true, message: '本地已合并云端数据，但上传云端备份失败' };
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      return { success: false, message: `同步异常: ${err.message || err}` };
    }
  }
}

export const syncService = new SyncService();
