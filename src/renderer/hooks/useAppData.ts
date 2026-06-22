import { useState, useEffect, useRef } from 'react';
import { storageService, AppDataStore, MediaSourceConfig, VideoProgress } from '../services/storage';
import { useTimer } from './useTimer';
import { WebDAVClient } from '../services/webdav';

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: TreeNode[];
  isLoaded?: boolean;
}

export async function getVideoStreamUrlByPath(filePath: string, source: MediaSourceConfig): Promise<string> {
  if (!source) return '';
  if (source.type === 'local') {
    if ('electronAPI' in window) {
      return await (window as any).electronAPI.getVideoStreamUrl(filePath);
    }
    return '';
  } else {
    const parsedUrl = new URL(source.settings?.url || '');
    if (source.settings?.username && source.settings?.password) {
      parsedUrl.username = encodeURIComponent(source.settings.username);
      parsedUrl.password = encodeURIComponent(source.settings.password);
    }
    
    const relative = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const urlPath = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname.slice(0, -1) : parsedUrl.pathname;
    
    if (filePath.startsWith(urlPath)) {
      parsedUrl.pathname = filePath;
    } else {
      parsedUrl.pathname = `${urlPath}${relative}`;
    }
    
    const remoteUrl = parsedUrl.toString();
    if ('electronAPI' in window) {
      return await (window as any).electronAPI.getVideoStreamUrl(remoteUrl);
    }
    return remoteUrl;
  }
}

export function useAppData() {
  const [appData, setAppData] = useState<AppDataStore | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.25);
  const [currentSource, setCurrentSource] = useState<MediaSourceConfig | null>(null);
  const currentSourceRef = useRef<MediaSourceConfig | null>(null);
  currentSourceRef.current = currentSource;
  
  // 当前播放视频信息
  const [activeVideoUrl, setActiveVideoUrl] = useState<string>('');
  const [activeVideoPath, setActiveVideoPath] = useState<string>('');
  const [activeVideoName, setActiveVideoName] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentPlayTime, setCurrentPlayTime] = useState<number>(0);

  // 刷新信号
  const [refreshSignal, setRefreshSignal] = useState<number>(0);
  // 挂机弹窗显示
  const [isIdleAlertOpen, setIsIdleAlertOpen] = useState<boolean>(false);

  // 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // 文件树管理
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [isLoadingFileTree, setIsLoadingFileTree] = useState<boolean>(false);
  const [playQueue, setPlayQueue] = useState<{ path: string; name: string }[]>([]);

  const hasAutoRestored = useRef<boolean>(false);

  // 加载数据源与启动自动恢复
  useEffect(() => {
    let active = true;
    console.log('[AutoRestore] useEffect triggered. refreshSignal:', refreshSignal);
    storageService.loadData().then(data => {
      if (!active) return;
      setAppData(data);
      setSources(data.sources);
      setPlaybackSpeed(data.settings.playbackSpeed ?? 1.25);
      setIsSidebarCollapsed(data.settings.isSidebarCollapsed ?? false);
      
      console.log('[AutoRestore] Loaded appData. lastPlayedVideo:', data.lastPlayedVideo);
      
      // 检查是否有上一次播放的视频且尚未执行过自动恢复
      if (!hasAutoRestored.current && data.lastPlayedVideo && data.sources.length > 0) {
        const lastVid = data.lastPlayedVideo;
        let matchingSource = data.sources.find(s => s.id === lastVid.sourceId);
        
        console.log('[AutoRestore] Initial check. matchingSource by ID:', matchingSource?.name);
        
        // 健壮防错：统一转换为小写与正斜杠进行比对，防止 Windows 下盘符大小写或反斜杠带来的字符比对不一致问题
        const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase();
        const normVidPath = normalizePath(lastVid.path);
        
        if (!matchingSource || (matchingSource.type === 'local' && !normVidPath.startsWith(normalizePath(matchingSource.path)))) {
          const pathMatched = data.sources.find(s => s.type === 'local' && normVidPath.startsWith(normalizePath(s.path)));
          console.log('[AutoRestore] Path matching fallback result:', pathMatched?.name);
          if (pathMatched) {
            matchingSource = pathMatched;
          }
        }

        if (matchingSource) {
          hasAutoRestored.current = true;
          console.log('[AutoRestore] Applying source:', matchingSource.name);
          setCurrentSource(matchingSource);
          
          // 获取上次视频的流地址并自动加载
          getVideoStreamUrlByPath(lastVid.path, matchingSource).then(url => {
            if (!active) return;
            console.log('[AutoRestore] Resolved stream URL:', url);
            if (url) {
              setActiveVideoUrl(url);
              setActiveVideoPath(lastVid.path);
              setActiveVideoName(lastVid.name);
              setIsPlaying(false);
            }
          }).catch(err => {
            console.error('Auto restore video failed:', err);
          });
          return;
        }
      }

      if (data.sources.length > 0) {
        const currentSourceVal = currentSourceRef.current;
        const exists = data.sources.some(s => s.id === currentSourceVal?.id);
        console.log('[AutoRestore] Fallback path. exists:', exists, 'currentSource:', currentSourceVal?.name);
        if (!currentSourceVal || !exists) {
          console.log('[AutoRestore] Setting default source:', data.sources[0].name);
          setCurrentSource(data.sources[0]);
        }
      } else {
        setCurrentSource(null);
      }
    });

    return () => {
      active = false;
    };
  }, [refreshSignal]);

  // 加载当前源下的首层文件树
  useEffect(() => {
    if (!currentSource) {
      setFileTree([]);
      return;
    }

    setIsLoadingFileTree(true);

    if (currentSource.type === 'local') {
      if ('electronAPI' in window) {
        (window as any).electronAPI.scanFolder(currentSource.path)
          .then((tree: TreeNode[]) => {
            setFileTree(tree);
            setIsLoadingFileTree(false);
          })
          .catch((err: any) => {
            console.error(err);
            setFileTree([]);
            setIsLoadingFileTree(false);
          });
      } else {
        setFileTree([]);
        setIsLoadingFileTree(false);
      }
    } else {
      const client = new WebDAVClient(
        currentSource.settings?.url || '',
        currentSource.settings?.username,
        currentSource.settings?.password
      );
      
      let startPath = '';
      if (currentSource.path) {
        try {
          if (currentSource.path.startsWith('http://') || currentSource.path.startsWith('https://')) {
            startPath = new URL(currentSource.path).pathname;
          } else {
            startPath = currentSource.path;
          }
        } catch {
          startPath = currentSource.path;
        }
      }

      client.readDir(startPath)
        .then((files: any[]) => {
          const tree: TreeNode[] = files.map(f => ({
            name: f.name,
            path: f.path,
            isDir: f.isDir,
            size: f.size,
            mtime: f.mtime,
            children: f.isDir ? [] : undefined,
            isLoaded: false
          }));
          setFileTree(tree);
          setIsLoadingFileTree(false);
        })
        .catch(err => {
          console.error(err);
          setFileTree([]);
          setIsLoadingFileTree(false);
        });
    }
  }, [currentSource]);

  const handleSpeedChange = async (speed: number) => {
    setPlaybackSpeed(speed);
    await storageService.updateSettings({ playbackSpeed: speed });
  };

  const handleSidebarCollapse = async (collapsed: boolean) => {
    setIsSidebarCollapsed(collapsed);
    await storageService.updateSettings({ isSidebarCollapsed: collapsed });
  };

  const handleRefresh = () => {
    setRefreshSignal(prev => prev + 1);
  };

  // 视频播放结束时的自动连播逻辑
  const handleVideoEnded = async () => {
    handleRefresh(); // 更新已看标记和进度日历

    const data = await storageService.loadData();
    if (data.settings.autoPlayNext && playQueue.length > 0 && currentSource) {
      const currentIdx = playQueue.findIndex(item => item.path === activeVideoPath);
      if (currentIdx !== -1 && currentIdx < playQueue.length - 1) {
        const nextVideo = playQueue[currentIdx + 1];
        
        // 延时 500ms，为渲染已学完状态更新提供安全缓冲
        setTimeout(async () => {
          try {
            const streamUrl = await getVideoStreamUrlByPath(nextVideo.path, currentSource);
            if (streamUrl) {
              setActiveVideoUrl(streamUrl);
              setActiveVideoPath(nextVideo.path);
              setActiveVideoName(nextVideo.name);
              setIsPlaying(false); // 刚连播过去时，状态保持为暂停（以展示前 2 秒的静止画面）
              console.log(`[AutoPlayNext] Loaded next video, pausing for 2s: ${nextVideo.name}`);
              
              // 2秒钟后自动触发播放
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('player:play-signal'));
              }, 2000);
            }
          } catch (err) {
            console.error('Autoplay next video failed:', err);
          }
        }, 500);
      }
    }
  };

  // 选择视频播放
  const handleSelectVideo = (url: string, path: string, name: string) => {
    setActiveVideoUrl(url);
    setActiveVideoPath(path);
    setActiveVideoName(name);
    setIsPlaying(false);
  };

  // 监听播放器时间更新
  const handleTimeUpdate = (currentTime: number, duration: number) => {
    setCurrentPlayTime(currentTime);
  };

  // 播放状态改变时触发
  const handlePlayStateChange = (playing: boolean) => {
    setIsPlaying(playing);
    if (playing) {
      setIsIdleAlertOpen(false);
    }
  };

  // 触发闲置挂机超时
  const handleIdleTimeout = () => {
    setIsPlaying(false);
    // 向 ArtPlayer 广播暂停信号
    window.dispatchEvent(new CustomEvent('player:pause-signal'));
    setIsIdleAlertOpen(true);
  };

  // 恢复播放（重置挂机）
  const handleResumeFromIdle = () => {
    setIsIdleAlertOpen(false);
  };

  // 自动计时器集成
  const { sessionSeconds } = useTimer({
    videoPath: activeVideoPath,
    videoName: activeVideoName,
    isPlaying: isPlaying,
    idleTimeoutMinutes: appData?.settings.idleTimeout || 15,
    onIdleTimeout: handleIdleTimeout,
    sourceName: currentSource?.name
  });

  // 维护一个运行期间时长获取失败的视频路径列表，避免无限重复重试
  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set());

  // 解析某个节点的播放 URL
  const getVideoStreamUrl = async (node: TreeNode): Promise<string> => {
    if (!currentSource) return '';
    return getVideoStreamUrlByPath(node.path, currentSource);
  };

  // 后台静默扫描未播视频的时长并保存
  useEffect(() => {
    if (!appData || !currentSource || fileTree.length === 0) return;

    let active = true;

    // 递归获取所有平铺视频节点
    const getFlatVideos = (nodes: TreeNode[]): TreeNode[] => {
      let res: TreeNode[] = [];
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) {
            res = res.concat(getFlatVideos(n.children));
          }
        } else {
          res.push(n);
        }
      }
      return res;
    };
    const flatVideos = getFlatVideos(fileTree);

    // 筛选出没有时长记录且不在失败列表中的视频
    const queue = flatVideos.filter(v => {
      const prog = appData.progress[v.path];
      return (!prog || !prog.duration) && !failedPaths.has(v.path);
    });

    if (queue.length === 0) return;

    // 获取时长的辅助 Promise
    const fetchDuration = (url: string): Promise<number> => {
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = url;
        video.crossOrigin = 'anonymous';

        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout'));
        }, 8000); // 8秒超时

        const onLoadedMetadata = () => {
          clearTimeout(timeout);
          const dur = video.duration;
          cleanup();
          if (isNaN(dur) || dur === Infinity || dur <= 0) {
            reject(new Error('Invalid duration'));
          } else {
            resolve(dur);
          }
        };

        const onError = () => {
          clearTimeout(timeout);
          cleanup();
          reject(new Error('Load error'));
        };

        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          video.removeEventListener('error', onError);
          video.src = '';
          try {
            video.load();
          } catch (e) {}
        };

        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('error', onError);
      });
    };

    // 顺序消费队列
    const processQueue = async () => {
      for (const node of queue) {
        if (!active) break;
        try {
          const url = await getVideoStreamUrl(node);
          if (!url) throw new Error('Cannot get stream url');

          const duration = await fetchDuration(url);
          if (!active) break;

          // 保存时长到存储
          await storageService.saveVideoProgress(node.path, {
            currentTime: 0,
            duration,
            isFinished: false
          });

          // 局部更新 state 以刷新 UI，避免调用 loadData 造成全局重新请求的开销
          setAppData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              progress: {
                ...prev.progress,
                [node.path]: {
                  currentTime: 0,
                  duration,
                  isFinished: false,
                  lastPlayedTime: Date.now()
                }
              }
            };
          });
        } catch (err) {
          console.warn(`Failed to silent-fetch duration for ${node.name}:`, err);
          setFailedPaths(prev => {
            const next = new Set(prev);
            next.add(node.path);
            return next;
          });
        }
        // 延时 150ms 处理下一个视频，防卡顿与连接数拥堵
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    };

    processQueue();

    return () => {
      active = false;
    };
  }, [fileTree, appData?.progress, currentSource, failedPaths]);

  // 获取该挂载源下所有的视频统计信息（计算课时数和已学完数）
  const getSourceStats = () => {
    if (!appData || !currentSource) return { totalCount: 0, finishedCount: 0, totalDuration: 0, finishedDuration: 0 };

    const getFlatVideos = (nodes: TreeNode[]): TreeNode[] => {
      let res: TreeNode[] = [];
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) {
            res = res.concat(getFlatVideos(n.children));
          }
        } else {
          res.push(n);
        }
      }
      return res;
    };

    const flatVideos = getFlatVideos(fileTree);
    const totalCount = flatVideos.length;
    let finishedCount = 0;
    let totalDuration = 0;
    let finishedDuration = 0;

    for (const video of flatVideos) {
      const prog = appData.progress[video.path];
      if (prog) {
        const videoDur = prog.duration > 0 ? prog.duration : 1800;
        totalDuration += videoDur;
        if (prog.isFinished) {
          finishedCount++;
          finishedDuration += videoDur;
        }
      } else {
        totalDuration += 1800; // 未播视频估算 30 分钟
      }
    }

    return { totalCount, finishedCount, totalDuration, finishedDuration };
  };

  const stats = getSourceStats();

  return {
    appData,
    sources,
    currentSource,
    setCurrentSource,
    activeVideoUrl,
    activeVideoPath,
    activeVideoName,
    isPlaying,
    setIsPlaying,
    currentPlayTime,
    playbackSpeed,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    fileTree,
    setFileTree,
    isLoadingFileTree,
    playQueue,
    setPlayQueue,
    refreshSignal,
    isIdleAlertOpen,
    setIsIdleAlertOpen,
    sessionSeconds,
    stats,
    handleSelectVideo,
    handleSpeedChange,
    handleSidebarCollapse,
    handleRefresh,
    handleVideoEnded,
    handleTimeUpdate,
    handlePlayStateChange,
    handleIdleTimeout,
    handleResumeFromIdle
  };
}
