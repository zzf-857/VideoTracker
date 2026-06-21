import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Player from './components/Player';
import Dashboard from './components/Dashboard';
import LogCalendar from './components/LogCalendar';
import SourceManager from './components/SourceManager';
import Settings from './components/Settings';
import Analytics from './components/Analytics';

import { storageService, AppDataStore, MediaSourceConfig, VideoProgress } from './services/storage';
import { useTimer } from './hooks/useTimer';
import { WebDAVClient } from './services/webdav';
import ChapterSidebar, { Chapter } from './components/ChapterSidebar';
import { useRef } from 'react';

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


export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [appData, setAppData] = useState<AppDataStore | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.25);
  const [currentSource, setCurrentSource] = useState<MediaSourceConfig | null>(null);
  
  // 当前播放视频信息
  const [activeVideoUrl, setActiveVideoUrl] = useState<string>('');
  const [activeVideoPath, setActiveVideoPath] = useState<string>('');
  const [activeVideoName, setActiveVideoName] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // 刷新信号
  const [refreshSignal, setRefreshSignal] = useState<number>(0);
  // 挂机弹窗显示
  const [isIdleAlertOpen, setIsIdleAlertOpen] = useState<boolean>(false);

  // 左侧边栏宽度与折叠状态
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [leftHover, setLeftHover] = useState<boolean>(false);

  // 右侧双抽屉展开与缩放状态
  const [isFootprintOpen, setIsFootprintOpen] = useState<boolean>(false);
  const [isChaptersOpen, setIsChaptersOpen] = useState<boolean>(false);
  const [footprintWidth, setFootprintWidth] = useState<number>(320);
  const [chaptersWidth, setChaptersWidth] = useState<number>(340);
  const [isFootprintResizing, setIsFootprintResizing] = useState<boolean>(false);
  const [isChaptersResizing, setIsChaptersResizing] = useState<boolean>(false);

  // 截图生成状态与进度信号
  const [thumbnailUpdateSignal, setThumbnailUpdateSignal] = useState<number>(0);
  const [generationProgress, setGenerationProgress] = useState<{ current: number, total: number } | null>(null);
  const [activeChapters, setActiveChapters] = useState<Chapter[]>([]);
  const [seekSignal, setSeekSignal] = useState<{ seconds: number; time: number } | null>(null);
  const [currentPlayTime, setCurrentPlayTime] = useState<number>(0);

  // 文件树管理
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [isLoadingFileTree, setIsLoadingFileTree] = useState<boolean>(false);

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  };

  const startFootprintResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsFootprintResizing(true);
  };

  const startChaptersResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsChaptersResizing(true);
  };

  // 截图队列句柄
  const queueRef = useRef<number[]>([]);
  const isGeneratingRef = useRef<boolean>(false);
  const hasAutoRestored = useRef<boolean>(false);

  const startGeneration = (times: number[]) => {
    queueRef.current = [...times];
    if (!isGeneratingRef.current) {
      processGenerationQueue();
    }
  };

  const processGenerationQueue = async () => {
    if (queueRef.current.length === 0) {
      isGeneratingRef.current = false;
      setGenerationProgress(null);
      return;
    }

    isGeneratingRef.current = true;
    const total = queueRef.current.length;
    
    const video = document.createElement('video');
    video.src = activeVideoUrl;
    video.muted = true;
    video.crossOrigin = 'anonymous';

    const generateNext = async (): Promise<void> => {
      if (queueRef.current.length === 0) return;
      const time = queueRef.current[0];
      setGenerationProgress({ current: total - queueRef.current.length + 1, total });

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn(`Seek timeout for time ${time}`);
          cleanup();
          queueRef.current.shift();
          resolve();
        }, 12000);

        const onSeeked = async () => {
          clearTimeout(timeout);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 90;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const base64Data = canvas.toDataURL('image/jpeg', 0.85);
              if (window.electronAPI) {
                await window.electronAPI.saveThumbnail(activeVideoPath, time, base64Data);
              }
            }
          } catch (err) {
            console.error(`Error saving frame at ${time}:`, err);
          } finally {
            cleanup();
            queueRef.current.shift();
            setThumbnailUpdateSignal(prev => prev + 1);
            setTimeout(resolve, 300);
          }
        };

        const onError = () => {
          clearTimeout(timeout);
          cleanup();
          queueRef.current.shift();
          resolve();
        };

        const cleanup = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
        };

        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        
        video.currentTime = time;
      });
    };

    let loadSuccess = true;
    await new Promise<void>((resolve) => {
      const onLoadedMetadata = () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        resolve();
      };
      const onError = () => {
        console.error('Failed to load video metadata for thumbnail extraction:', video.error);
        video.removeEventListener('error', onError);
        loadSuccess = false;
        resolve();
      };
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onError);
      video.load();
    });

    if (!loadSuccess) {
      console.error('Thumbnail generation aborted: video load error.');
      alert('视频加载失败或格式不支持，无法生成章节预览图。');
      isGeneratingRef.current = false;
      setGenerationProgress(null);
      return;
    }

    while (queueRef.current.length > 0) {
      if (!video.src || video.src !== activeVideoUrl) {
        break;
      }
      await generateNext();
    }

    video.src = '';
    try {
      video.load();
    } catch(e){}
    
    isGeneratingRef.current = false;
    setGenerationProgress(null);
  };

  useEffect(() => {
    // 切换视频时清空相关状态
    queueRef.current = [];
    isGeneratingRef.current = false;
    setGenerationProgress(null);
    setActiveChapters([]);
    setSeekSignal(null);
    setCurrentPlayTime(0);
    // 当关闭或切视频时，默认把章节抽屉打开，提高交互连贯性
    if (activeVideoPath) {
      setIsChaptersOpen(true);
      setIsFootprintOpen(false);
    } else {
      setIsChaptersOpen(false);
    }
  }, [activeVideoPath]);

  useEffect(() => {
    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = Math.max(80, Math.min(450, mouseMoveEvent.clientX));
        setSidebarWidth(newWidth);
      } else if (isFootprintResizing) {
        const newWidth = Math.max(240, Math.min(600, window.innerWidth - mouseMoveEvent.clientX));
        setFootprintWidth(newWidth);
      } else if (isChaptersResizing) {
        const newWidth = Math.max(280, Math.min(600, window.innerWidth - mouseMoveEvent.clientX));
        setChaptersWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setSidebarWidth(w => {
        if (w < 150) {
          setIsSidebarCollapsed(true);
          return 260; // 恢复默认，备下次展开
        }
        return w;
      });
      setIsResizing(false);
      setIsFootprintResizing(false);
      setIsChaptersResizing(false);
    };

    if (isResizing || isFootprintResizing || isChaptersResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isFootprintResizing, isChaptersResizing]);

  // 加载数据源与启动自动恢复
  useEffect(() => {
    storageService.loadData().then(data => {
      setAppData(data);
      setSources(data.sources);
      
      // 检查是否有上一次播放的视频且尚未执行过自动恢复
      if (!hasAutoRestored.current && data.lastPlayedVideo && data.sources.length > 0) {
        const lastVid = data.lastPlayedVideo;
        let matchingSource = data.sources.find(s => s.id === lastVid.sourceId);
        
        // 健壮防错：如果匹配的 sourceId 不匹配视频文件的绝对路径（比如之前的 Bug 导致写错了关联 ID）
        // 则采用本地路径前缀匹配规则自动纠正为正确的媒体源
        if (!matchingSource || (matchingSource.type === 'local' && !lastVid.path.startsWith(matchingSource.path))) {
          const pathMatched = data.sources.find(s => s.type === 'local' && lastVid.path.startsWith(s.path));
          if (pathMatched) {
            matchingSource = pathMatched;
          }
        }

        if (matchingSource) {
          hasAutoRestored.current = true;
          setCurrentSource(matchingSource);
          
          // 获取上次视频的流地址并自动加载
          getVideoStreamUrlByPath(lastVid.path, matchingSource).then(url => {
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
        const exists = data.sources.some(s => s.id === currentSource?.id);
        if (!currentSource || !exists) {
          setCurrentSource(data.sources[0]);
        }
      } else {
        setCurrentSource(null);
      }
    });
  }, [refreshSignal, currentSource]);

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

  const handleRefresh = () => {
    setRefreshSignal(prev => prev + 1);
  };

  // 切换选项卡时，若切出播放大屏，强制停止计时
  useEffect(() => {
    if (currentTab !== 'dashboard') {
      setIsPlaying(false);
    }
  }, [currentTab]);

  // 选择视频播放
  const handleSelectVideo = (url: string, path: string, name: string) => {
    setActiveVideoUrl(url);
    setActiveVideoPath(path);
    setActiveVideoName(name);
    setIsPlaying(false);
  };

  // 监听播放器事件更新进度
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
    // 这里通常让用户手动在播放器里点 Play 即可
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F5F5F7]">
      {/* 左侧侧边栏 */}
      <div 
        className="h-full relative flex-shrink-0 overflow-hidden z-30"
        style={{ 
          width: isSidebarCollapsed ? 0 : sidebarWidth,
          transition: isResizing ? 'none' : 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <Sidebar
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
          activeVideoPath={activeVideoPath}
          onSelectVideo={handleSelectVideo}
          progressMap={appData?.progress || {}}
          refreshSignal={refreshSignal}
          onCollapse={() => setIsSidebarCollapsed(true)}
          onRefresh={handleRefresh}
          
          sources={sources}
          currentSource={currentSource}
          setCurrentSource={setCurrentSource}
          fileTree={fileTree}
          setFileTree={setFileTree}
          isLoading={isLoadingFileTree}
        />
      </div>

      {/* 左侧拉伸手柄与一键折叠按钮 */}
      <div 
        className="relative flex-shrink-0 z-40"
        onMouseEnter={() => setLeftHover(true)}
        onMouseLeave={() => setLeftHover(false)}
      >
        <div
          onMouseDown={startResizing}
          className={`w-[8px] absolute top-0 bottom-0 cursor-col-resize -translate-x-1/2 transition-colors ${
            isSidebarCollapsed ? 'pointer-events-none' : ''
          } ${
            isResizing ? 'bg-primary' : 'bg-transparent hover:bg-primary/20'
          }`}
          style={{
            left: 0,
          }}
        />
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-12 rounded-full bg-white/95 backdrop-blur-md border border-black/10 flex items-center justify-center shadow-md text-on-surface-variant cursor-pointer z-50 transition-all duration-200 ${
            isSidebarCollapsed || leftHover || isResizing ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
          } hover:bg-primary hover:text-white hover:border-primary active:scale-90`}
          style={{
            left: isSidebarCollapsed ? 6 : 0,
          }}
          title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          <span className="material-symbols-outlined text-[12px] font-bold">
            {isSidebarCollapsed ? 'chevron_right' : 'chevron_left'}
          </span>
        </button>
      </div>

      {/* 中间主要播放与 Dashboard 区域 */}
      <main className="flex-1 flex flex-col relative h-full overflow-hidden">
        {currentTab === 'dashboard' ? (
          <div className="flex-1 p-8 flex flex-col gap-5 h-full overflow-hidden">
            {/* 计划计算面板 (移动到上方，避免下拉框被屏幕裁剪) */}
            <Dashboard
              currentSource={currentSource}
              videoCount={stats.totalCount}
              playedVideoCount={stats.finishedCount}
              totalLocalDuration={stats.totalDuration}
              playedLocalDuration={stats.finishedDuration}
              refreshSignal={refreshSignal}
              playbackSpeed={playbackSpeed}
              onSpeedChange={setPlaybackSpeed}
            />

            {/* 主要播放与占位区域 */}
            <div className="flex-1 min-h-[300px] relative bg-black rounded-2xl overflow-hidden shadow-lg border border-black/5">
              {activeVideoUrl ? (
                <Player
                  videoUrl={activeVideoUrl}
                  videoPath={activeVideoPath}
                  videoName={activeVideoName}
                  playbackSpeed={playbackSpeed}
                  onSpeedChange={setPlaybackSpeed}
                  hotkeys={appData?.settings.hotkeys || {
                    fullscreen: 'f',
                    speedUp: 'c',
                    speedDown: 'x',
                    speedReset: 'z'
                  }}
                  onPlayStateChange={handlePlayStateChange}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleRefresh}
                  activeChapters={activeChapters}
                  seekSignal={seekSignal}
                  sourceId={currentSource?.id}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 bg-gradient-to-b from-[#1e1b4b]/20 to-[#0b0b0f]/10">
                  <span className="material-symbols-outlined text-5xl text-primary/40 mb-3 animate-bounce">play_circle</span>
                  <h3 className="text-base font-bold text-on-surface">开启高效学习之旅</h3>
                  <p className="text-xs text-on-surface-variant mt-1.5 max-w-[280px]">
                     请在左侧侧边栏中选择一个挂载源，并双击具体的课程视频开始播放
                  </p>
                </div>
              )}

              {/* 自动计时状态显示悬浮条 */}
              {isPlaying && (
                <div className="absolute top-4 right-4 bg-white/80 backdrop-blur-md border border-black/5 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-md">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-on-surface">
                    本日计时: {Math.floor(sessionSeconds / 60)} 分 {sessionSeconds % 60} 秒
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : currentTab === 'sources' ? (
          <SourceManager refreshSignal={refreshSignal} onRefresh={handleRefresh} />
        ) : currentTab === 'analytics' ? (
          <Analytics refreshSignal={refreshSignal} onRefresh={handleRefresh} />
        ) : (
          <Settings refreshSignal={refreshSignal} onRefresh={handleRefresh} />
        )}

        {/* 闲置挂机超时毛玻璃对话框 */}
        {isIdleAlertOpen && (
          <div className="fixed inset-0 bg-black/35 backdrop-blur-md flex items-center justify-center z-[200] p-4">
            <div className="bg-white/80 backdrop-blur-xl border border-black/5 rounded-2xl max-w-[400px] w-full p-6 text-center shadow-2xl animate-fade-in">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
                <span className="material-symbols-outlined text-2xl">bedtime</span>
              </div>
              <h3 className="text-base font-extrabold text-on-surface mb-2">对焦专注提醒</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed mb-6">
                系统检测到您已长时间无任何键鼠操作，为了保持记录的精准度，已为您自动暂停学习计时。
              </p>
              <button
                onClick={handleResumeFromIdle}
                className="w-full py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/10"
              >
                继续学习
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 右侧双抽屉栏容器 */}
      {currentTab === 'dashboard' && isFootprintOpen && (
        <div 
          className="h-full relative flex-shrink-0 bg-white/80 backdrop-blur-xl border-l border-black/5 z-30 flex"
          style={{ 
            width: footprintWidth,
            transition: isFootprintResizing ? 'none' : 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          {/* 左边缘拖拽拉手 */}
          <div
            onMouseDown={startFootprintResizing}
            className={`w-[6px] absolute top-0 bottom-0 left-0 cursor-col-resize z-50 hover:bg-primary/20 transition-colors ${
              isFootprintResizing ? 'bg-primary' : 'bg-transparent'
            }`}
          />
          <div className="p-6 h-full w-full overflow-y-auto custom-scrollbar">
            <LogCalendar refreshSignal={refreshSignal} onRefresh={handleRefresh} />
          </div>
        </div>
      )}

      {currentTab === 'dashboard' && isChaptersOpen && (
        <div 
          className="h-full relative flex-shrink-0 bg-white/80 backdrop-blur-xl border-l border-black/5 z-30 flex"
          style={{ 
            width: chaptersWidth,
            transition: isChaptersResizing ? 'none' : 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          {/* 左边缘拖拽拉手 */}
          <div
            onMouseDown={startChaptersResizing}
            className={`w-[6px] absolute top-0 bottom-0 left-0 cursor-col-resize z-50 hover:bg-primary/20 transition-colors ${
              isChaptersResizing ? 'bg-primary' : 'bg-transparent'
            }`}
          />
          <div className="p-4 h-full w-full flex flex-col min-h-0">
            {generationProgress && (
              <div className="mb-3 p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-between text-[10px] text-primary font-bold animate-pulse">
                <span>正在提取章节预览图...</span>
                <span>{generationProgress.current} / {generationProgress.total}</span>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <ChapterSidebar
                videoPath={activeVideoPath}
                videoUrl={activeVideoUrl}
                currentTime={currentPlayTime}
                onSeek={(sec) => {
                  setSeekSignal({ seconds: sec, time: Date.now() });
                }}
                onChaptersChange={setActiveChapters}
                onStartGeneration={startGeneration}
                thumbnailUpdateSignal={thumbnailUpdateSignal}
                onClearChapters={() => {
                  setActiveChapters([]);
                  setThumbnailUpdateSignal(prev => prev + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 最右侧悬浮固定工具 Control Bar (仅在 dashboard Tab 下展示) */}
      {currentTab === 'dashboard' && (
        <div className="h-full w-14 bg-white border-l border-black/5 flex flex-col items-center py-6 gap-5 z-40 relative flex-shrink-0">
          <button
            onClick={() => {
              setIsFootprintOpen(!isFootprintOpen);
              setIsChaptersOpen(false);
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              isFootprintOpen 
                ? 'bg-primary text-white shadow-md shadow-primary/20 scale-105' 
                : 'bg-black/[0.03] text-on-surface hover:bg-black/[0.08] hover:scale-105 active:scale-95'
            }`}
            title="学习足迹"
          >
            <span className="material-symbols-outlined text-[20px]">calendar_month</span>
          </button>

          <button
            onClick={() => {
              if (!activeVideoPath) {
                alert('请先选择视频播放，以使用章节时间轴');
                return;
              }
              setIsChaptersOpen(!isChaptersOpen);
              setIsFootprintOpen(false);
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              !activeVideoPath ? 'opacity-40 cursor-not-allowed' : ''
            } ${
              isChaptersOpen 
                ? 'bg-primary text-white shadow-md shadow-primary/20 scale-105' 
                : 'bg-black/[0.03] text-on-surface hover:bg-black/[0.08] hover:scale-105 active:scale-95'
            }`}
            title="视频章节"
          >
            <span className="material-symbols-outlined text-[20px]">toc</span>
          </button>
        </div>
      )}
    </div>
  );
}
