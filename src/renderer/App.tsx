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

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: TreeNode[];
  isLoaded?: boolean;
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

  // 双侧边栏宽度与折叠状态
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [leftHover, setLeftHover] = useState<boolean>(false);

  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(320);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState<boolean>(false);
  const [isRightResizing, setIsRightResizing] = useState<boolean>(false);
  const [rightHover, setRightHover] = useState<boolean>(false);

  // 文件树管理
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [isLoadingFileTree, setIsLoadingFileTree] = useState<boolean>(false);

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  };

  const startRightResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsRightResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = Math.max(80, Math.min(450, mouseMoveEvent.clientX));
        setSidebarWidth(newWidth);
      } else if (isRightResizing) {
        const newWidth = Math.max(80, Math.min(500, window.innerWidth - mouseMoveEvent.clientX));
        setRightSidebarWidth(newWidth);
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
      setRightSidebarWidth(w => {
        if (w < 200) {
          setIsRightSidebarCollapsed(true);
          return 320; // 恢复默认
        }
        return w;
      });
      setIsResizing(false);
      setIsRightResizing(false);
    };

    if (isResizing || isRightResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isRightResizing]);

  // 加载数据源
  useEffect(() => {
    storageService.loadData().then(data => {
      setAppData(data);
      setSources(data.sources);
      if (data.sources.length > 0) {
        const exists = data.sources.some(s => s.id === currentSource?.id);
        if (!currentSource || !exists) {
          setCurrentSource(data.sources[0]);
        }
      } else {
        setCurrentSource(null);
      }
    });
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

  const handleRefresh = () => {
    setRefreshSignal(prev => prev + 1);
  };

  // 选择视频播放
  const handleSelectVideo = (url: string, path: string, name: string) => {
    setActiveVideoUrl(url);
    setActiveVideoPath(path);
    setActiveVideoName(name);
    setIsPlaying(false);
  };

  // 监听播放器事件更新进度
  const handleTimeUpdate = (currentTime: number, duration: number) => {
    // 这里也可以用来处理实时页面状态同步，但主要已在 Player.tsx 中每隔几秒或暂停时处理
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
    sourceName: currentSource?.name || '本地'
  });

  // 维护一个运行期间时长获取失败的视频路径列表，避免无限重复重试
  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set());

  // 解析某个节点的播放 URL
  const getVideoStreamUrl = async (node: TreeNode): Promise<string> => {
    if (!currentSource) return '';
    if (currentSource.type === 'local') {
      if ('electronAPI' in window) {
        return await (window as any).electronAPI.getVideoStreamUrl(node.path);
      }
      return '';
    } else {
      const parsedUrl = new URL(currentSource.settings?.url || '');
      if (currentSource.settings?.username && currentSource.settings?.password) {
        parsedUrl.username = encodeURIComponent(currentSource.settings.username);
        parsedUrl.password = encodeURIComponent(currentSource.settings.password);
      }
      
      const relative = node.path.startsWith('/') ? node.path : `/${node.path}`;
      const urlPath = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname.slice(0, -1) : parsedUrl.pathname;
      
      if (node.path.startsWith(urlPath)) {
        parsedUrl.pathname = node.path;
      } else {
        parsedUrl.pathname = `${urlPath}${relative}`;
      }
      
      const remoteUrl = parsedUrl.toString();
      if ('electronAPI' in window) {
        return await (window as any).electronAPI.getVideoStreamUrl(remoteUrl);
      }
      return remoteUrl;
    }
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

      {/* 右侧拉伸手柄与一键折叠按钮 (仅在 dashboard 下与三栏并列) */}
      {currentTab === 'dashboard' && (
        <div 
          className="relative flex-shrink-0 z-40"
          onMouseEnter={() => setRightHover(true)}
          onMouseLeave={() => setRightHover(false)}
        >
          <div
            onMouseDown={startRightResizing}
            className={`w-[8px] absolute top-0 bottom-0 cursor-col-resize -translate-x-1/2 transition-colors ${
              isRightSidebarCollapsed ? 'pointer-events-none' : ''
            } ${
              isRightResizing ? 'bg-primary' : 'bg-transparent hover:bg-primary/20'
            }`}
            style={{
              left: 0,
            }}
          />
          <button
            onClick={() => setIsRightSidebarCollapsed(!isRightSidebarCollapsed)}
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-12 rounded-full bg-white/95 backdrop-blur-md border border-black/10 flex items-center justify-center shadow-md text-on-surface-variant cursor-pointer z-50 transition-all duration-200 ${
              isRightSidebarCollapsed || rightHover || isRightResizing ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
            } hover:bg-primary hover:text-white hover:border-primary active:scale-90`}
            style={{
              left: isRightSidebarCollapsed ? -6 : 0,
            }}
            title={isRightSidebarCollapsed ? "展开日历" : "收起日历"}
          >
            <span className="material-symbols-outlined text-[12px] font-bold">
              {isRightSidebarCollapsed ? 'chevron_left' : 'chevron_right'}
            </span>
          </button>
        </div>
      )}

      {/* 右侧侧边栏 - 日历 (仅在 dashboard 下与三栏并列) */}
      {currentTab === 'dashboard' && (
        <div 
          className="h-full relative flex-shrink-0 overflow-hidden bg-white/80 backdrop-blur-xl border-l border-black/5 z-30"
          style={{ 
            width: isRightSidebarCollapsed ? 0 : rightSidebarWidth,
            transition: isRightResizing ? 'none' : 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <div className="p-6 h-full overflow-y-auto custom-scrollbar">
            <LogCalendar refreshSignal={refreshSignal} onRefresh={handleRefresh} />
          </div>
        </div>
      )}
    </div>
  );
}
