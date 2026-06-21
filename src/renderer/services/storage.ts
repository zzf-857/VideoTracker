// 检查是否处于 Electron 环境
const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;

export interface VideoProgress {
  currentTime: number;
  duration: number;
  isFinished: boolean;
  lastPlayedTime: number;
}

export interface PlayedVideoLog {
  path: string;
  name: string;
  duration: number; // 当天观看的秒数
  time: string; // 播放的时间点, 如 "14:30"
}

export interface DailyLog {
  totalDuration: number; // 当天总学习时长（秒）
  playedVideos: PlayedVideoLog[];
}

export interface MediaSourceConfig {
  id: string;
  name: string;
  type: 'local' | 'webdav' | 'alist';
  path: string; // 本地绝对路径，或 WebDAV 目录 URL
  settings?: {
    url?: string;
    username?: string;
    password?: string;
  };
}

export interface AppSettings {
  idleTimeout: number; // 闲置超时时长（分钟），默认 15
  autoSync: boolean;
  webdavSyncUrl?: string;
  webdavUser?: string;
  webdavPassword?: string;
}

// 统一数据接口
export interface AppDataStore {
  progress: Record<string, VideoProgress>; // key 是视频的相对路径或唯一标识
  dailyLogs: Record<string, DailyLog>; // key 是 "YYYY-MM-DD"
  sources: MediaSourceConfig[];
  settings: AppSettings;
}

const DEFAULT_DATA: AppDataStore = {
  progress: {},
  dailyLogs: {},
  sources: [],
  settings: {
    idleTimeout: 15,
    autoSync: false,
  }
};

class StorageService {
  private cache: AppDataStore | null = null;

  async loadData(): Promise<AppDataStore> {
    if (this.cache) return this.cache;

    if (isElectron) {
      const data = await (window as any).electronAPI.getData('app_data');
      this.cache = data || { ...DEFAULT_DATA };
    } else {
      const local = localStorage.getItem('videotracker_app_data');
      this.cache = local ? JSON.parse(local) : { ...DEFAULT_DATA };
    }

    // 确保必要字段存在
    this.cache = {
      progress: this.cache?.progress || {},
      dailyLogs: this.cache?.dailyLogs || {},
      sources: this.cache?.sources || [],
      settings: this.cache?.settings || { idleTimeout: 15, autoSync: false }
    };

    return this.cache;
  }

  async saveData(data: Partial<AppDataStore>): Promise<boolean> {
    const current = await this.loadData();
    const updated = { ...current, ...data };
    this.cache = updated;

    if (isElectron) {
      return await (window as any).electronAPI.saveData('app_data', updated);
    } else {
      localStorage.setItem('videotracker_app_data', JSON.stringify(updated));
      return true;
    }
  }

  // 快捷方法：更新单个视频进度
  async saveVideoProgress(videoKey: string, progress: Omit<VideoProgress, 'lastPlayedTime'>): Promise<void> {
    const data = await this.loadData();
    data.progress[videoKey] = {
      ...progress,
      lastPlayedTime: Date.now()
    };
    await this.saveData({ progress: data.progress });
  }

  // 快捷方法：增加今日学习时长与播放日志
  async addLearningTime(videoPath: string, videoName: string, durationSeconds: number): Promise<void> {
    if (durationSeconds <= 0) return;
    
    const data = await this.loadData();
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0].substring(0, 5); // "HH:MM"

    if (!data.dailyLogs[today]) {
      data.dailyLogs[today] = {
        totalDuration: 0,
        playedVideos: []
      };
    }

    const todayLog = data.dailyLogs[today];
    todayLog.totalDuration += durationSeconds;

    // 寻找今天是否已经看过了该视频，如果有，合并观看时间；如果没有，新增一条
    const existingVideo = todayLog.playedVideos.find(v => v.path === videoPath);
    if (existingVideo) {
      existingVideo.duration += durationSeconds;
      existingVideo.time = nowTime; // 更新最后播放时间
    } else {
      todayLog.playedVideos.push({
        path: videoPath,
        name: videoName,
        duration: durationSeconds,
        time: nowTime
      });
    }

    await this.saveData({ dailyLogs: data.dailyLogs });
  }
}

export const storageService = new StorageService();
