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
  sourceName?: string; // 视频来源名称
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

export interface AppHotkeys {
  fullscreen: string; // 默认 'f'
  speedUp: string;    // 默认 'c'
  speedDown: string;  // 默认 'x'
  speedReset: string; // 默认 'z'
  search?: string;     // 默认 'ctrl+f'
}

export interface AppSettings {
  idleTimeout: number; // 闲置超时时长（分钟），默认 15
  autoSync: boolean;
  webdavSyncUrl?: string;
  webdavUser?: string;
  webdavPassword?: string;
  hotkeys: AppHotkeys;
  pauseOnBlur?: boolean; // 失去焦点自动暂停播放，默认 true
  autoPlayNext?: boolean; // 是否开启自动连播，默认 false
}

// 统一数据接口
export interface AppDataStore {
  progress: Record<string, VideoProgress>; // key 是视频的相对路径或唯一标识
  dailyLogs: Record<string, DailyLog>; // key 是 "YYYY-MM-DD"
  sources: MediaSourceConfig[];
  settings: AppSettings;
  timelines?: Record<string, string>; // key 是视频的相对路径或唯一标识
  lastPlayedVideo?: {
    path: string;
    name: string;
    sourceId: string;
  };
}

const DEFAULT_DATA: AppDataStore = {
  progress: {},
  dailyLogs: {},
  sources: [],
  settings: {
    idleTimeout: 15,
    autoSync: false,
    hotkeys: {
      fullscreen: 'f',
      speedUp: 'c',
      speedDown: 'x',
      speedReset: 'z',
      search: 'ctrl+f'
    },
    pauseOnBlur: true,
    autoPlayNext: false
  },
  timelines: {}
};

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
      settings: {
        idleTimeout: this.cache?.settings?.idleTimeout ?? 15,
        autoSync: this.cache?.settings?.autoSync ?? false,
        webdavSyncUrl: this.cache?.settings?.webdavSyncUrl,
        webdavUser: this.cache?.settings?.webdavUser,
        webdavPassword: this.cache?.settings?.webdavPassword,
        hotkeys: {
          fullscreen: this.cache?.settings?.hotkeys?.fullscreen ?? 'f',
          speedUp: this.cache?.settings?.hotkeys?.speedUp ?? 'c',
          speedDown: this.cache?.settings?.hotkeys?.speedDown ?? 'x',
          speedReset: this.cache?.settings?.hotkeys?.speedReset ?? 'z',
          search: this.cache?.settings?.hotkeys?.search ?? 'ctrl+f'
        },
        pauseOnBlur: this.cache?.settings?.pauseOnBlur ?? true,
        autoPlayNext: this.cache?.settings?.autoPlayNext ?? false
      },
      timelines: this.cache?.timelines || {},
      lastPlayedVideo: this.cache?.lastPlayedVideo
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

  // 快捷方法：保存视频时间轴文本
  async saveTimeline(videoPath: string, text: string): Promise<void> {
    const data = await this.loadData();
    if (!data.timelines) {
      data.timelines = {};
    }
    data.timelines[videoPath] = text;
    await this.saveData({ timelines: data.timelines });
  }

  // 快捷方法：删除视频时间轴文本
  async deleteTimeline(videoPath: string): Promise<void> {
    const data = await this.loadData();
    if (data.timelines && data.timelines[videoPath]) {
      delete data.timelines[videoPath];
      await this.saveData({ timelines: data.timelines });
    }
  }

  // 快捷方法：保存最近一次播放的视频信息
  async saveLastPlayedVideo(path: string, name: string, sourceId: string): Promise<void> {
    const data = await this.loadData();
    data.lastPlayedVideo = { path, name, sourceId };
    await this.saveData({ lastPlayedVideo: data.lastPlayedVideo });
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
  async addLearningTime(videoPath: string, videoName: string, durationSeconds: number, sourceName?: string): Promise<void> {
    if (durationSeconds <= 0) return;
    
    const data = await this.loadData();
    const today = getLocalDateString();
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
      if (sourceName) {
        existingVideo.sourceName = sourceName;
      }
    } else {
      todayLog.playedVideos.push({
        path: videoPath,
        name: videoName,
        duration: durationSeconds,
        time: nowTime,
        sourceName: sourceName
      });
    }

    await this.saveData({ dailyLogs: data.dailyLogs });
  }

  // 快捷方法：删除指定日期下的特定视频观看记录
  async deleteVideoLog(dateStr: string, videoPath: string): Promise<AppDataStore> {
    const data = await this.loadData();
    const log = data.dailyLogs[dateStr];
    if (log) {
      // 找出要删除的视频记录，并扣减总时间
      const videoIndex = log.playedVideos.findIndex(v => v.path === videoPath);
      if (videoIndex !== -1) {
        const deletedDuration = log.playedVideos[videoIndex].duration;
        log.totalDuration = Math.max(0, log.totalDuration - deletedDuration);
        log.playedVideos.splice(videoIndex, 1);
        
        // 如果该日期没有视频记录了，可以直接删除该日期
        if (log.playedVideos.length === 0) {
          delete data.dailyLogs[dateStr];
        }
      }
    }
    await this.saveData({ dailyLogs: data.dailyLogs });
    return data;
  }
}

export const storageService = new StorageService();

export function getEventHotkeyString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  
  let key = e.key.toLowerCase();
  if (e.key === ' ') {
    key = 'space';
  }
  
  if (['control', 'shift', 'alt', 'meta'].includes(key)) {
    return '';
  }
  
  parts.push(key);
  return parts.join('+');
}

export function formatHotkeyForDisplay(hotkeyStr: string): string {
  if (!hotkeyStr) return '无';
  return hotkeyStr
    .split('+')
    .map(part => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'alt') return 'Alt';
      if (part === 'shift') return 'Shift';
      if (part === 'space') return 'Space';
      return part.toUpperCase();
    })
    .join(' + ');
}
