import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Player from './components/Player';
import Dashboard from './components/Dashboard';
import LogCalendar from './components/LogCalendar';
import SourceManager from './components/SourceManager';
import Settings from './components/Settings';
import Analytics from './components/Analytics';

import ChapterSidebar, { Chapter } from './components/ChapterSidebar';
import { useAppData, TreeNode } from './hooks/useAppData';
import { storageService, MediaSourceConfig } from './services/storage';

export default function App() {
  const {
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
    rightSidebarStatus,
    handleRightSidebarStatusChange,
    fileTree,
    setFileTree,
    isLoadingFileTree,
    playQueue,
    setPlayQueue,
    refreshSignal,
    isIdleAlertOpen,
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
  } = useAppData();

  const [currentTab, setCurrentTab] = useState<string>('dashboard');

  // 左侧边栏宽度与拉伸状态
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [leftHover, setLeftHover] = useState<boolean>(false);

  // 右侧双抽屉展开与缩放状态
  const isFootprintOpen = rightSidebarStatus === 'footprint';
  const isChaptersOpen = rightSidebarStatus === 'chapters' && !!activeVideoPath;
  const [footprintWidth, setFootprintWidth] = useState<number>(320);
  const [chaptersWidth, setChaptersWidth] = useState<number>(340);
  const [isFootprintResizing, setIsFootprintResizing] = useState<boolean>(false);
  const [isChaptersResizing, setIsChaptersResizing] = useState<boolean>(false);

  // 截图生成状态与进度信号
  const [thumbnailUpdateSignal, setThumbnailUpdateSignal] = useState<number>(0);
  const [generationProgress, setGenerationProgress] = useState<{ current: number, total: number } | null>(null);
  const [activeChapters, setActiveChapters] = useState<Chapter[]>([]);
  const [seekSignal, setSeekSignal] = useState<{ seconds: number; time: number } | null>(null);

  // 自动更新通知状态
  const [updateNoticeVersion, setUpdateNoticeVersion] = useState<string | null>(null);

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
          handleSidebarCollapse(true);
          return 260;
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

  // 截图队列句柄
  const queueRef = useRef<number[]>([]);
  const isGeneratingRef = useRef<boolean>(false);

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
    // 切换视频时只清空与当前视频绑定的临时状态；右侧栏选项由用户手动选择并持久化。
    queueRef.current = [];
    isGeneratingRef.current = false;
    setGenerationProgress(null);
    setActiveChapters([]);
    setSeekSignal(null);
  }, [activeVideoPath]);

  // 切换选项卡时，若切出播放大屏，强制停止计时
  useEffect(() => {
    if (currentTab !== 'dashboard') {
      setIsPlaying(false);
    }
  }, [currentTab]);

  // 监听全局自动更新消息（主要是在后台自动下载完成时提示用户）
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUpdateMessage) return;

    const unsubscribe = window.electronAPI.onUpdateMessage((data: any) => {
      const { status, version, isPortable } = data;
      if (status === 'downloaded' && version && !isPortable) {
        setUpdateNoticeVersion(version);
      }
    });

    return () => unsubscribe();
  }, []);

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
          onCollapse={() => handleSidebarCollapse(true)}
          onRefresh={handleRefresh}
          
          sources={sources}
          currentSource={currentSource}
          setCurrentSource={setCurrentSource}
          fileTree={fileTree}
          setFileTree={setFileTree}
          isLoading={isLoadingFileTree}
          onPlayQueueChange={setPlayQueue}
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
          onClick={() => handleSidebarCollapse(!isSidebarCollapsed)}
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
              watchedLocalDuration={stats.watchedDuration}
              refreshSignal={refreshSignal}
              playbackSpeed={playbackSpeed}
              onSpeedChange={handleSpeedChange}
            />

            {/* 主要播放与占位区域 */}
            <div className="flex-1 min-h-[300px] relative bg-black rounded-2xl overflow-hidden shadow-lg border border-black/5">
              {activeVideoUrl ? (
                (() => {
                  const nextVideo = (() => {
                    if (!playQueue || playQueue.length === 0 || !activeVideoPath) return null;
                    const idx = playQueue.findIndex(item => item.path === activeVideoPath);
                    if (idx !== -1 && idx < playQueue.length - 1) {
                      return playQueue[idx + 1];
                    }
                    return null;
                  })();

                  return (
                    <Player
                      videoUrl={activeVideoUrl}
                      videoPath={activeVideoPath}
                      videoName={activeVideoName}
                      playbackSpeed={playbackSpeed}
                      onSpeedChange={handleSpeedChange}
                      hotkeys={appData?.settings.hotkeys || {
                        fullscreen: 'f',
                        speedUp: 'c',
                        speedDown: 'x',
                        speedReset: 'z'
                      }}
                      onPlayStateChange={handlePlayStateChange}
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={handleVideoEnded}
                      activeChapters={activeChapters}
                      seekSignal={seekSignal}
                      sourceId={currentSource?.id}
                      nextVideoName={appData?.settings.autoPlayNext ? nextVideo?.name : undefined}
                      pauseOnBlur={appData?.settings.pauseOnBlur}
                      isFinished={activeVideoPath ? (appData?.progress[activeVideoPath]?.isFinished || false) : false}
                    />
                  );
                })()
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
              handleRightSidebarStatusChange(rightSidebarStatus === 'footprint' ? 'closed' : 'footprint');
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
              handleRightSidebarStatusChange(rightSidebarStatus === 'chapters' ? 'closed' : 'chapters');
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

      {/* 自动更新完成全局提示气泡 */}
      {updateNoticeVersion && (
        <div className="fixed bottom-6 right-6 z-[1000] w-80 bg-white/95 backdrop-blur-xl border border-black/5 rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.15)] flex flex-col gap-3 animate-fade-in select-none">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/10 text-green-600 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[20px] font-bold">system_update_alt</span>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-xs text-on-surface">新版本就绪</h4>
              <p className="text-[10px] text-on-surface-variant leading-relaxed mt-0.5">
                新版本 v{updateNoticeVersion} 已经后台下载完成，是否立即重启升级？
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-black/[0.03] pt-3">
            <button
              onClick={() => setUpdateNoticeVersion(null)}
              className="px-3 py-1.5 bg-black/[0.03] hover:bg-black/[0.06] text-on-surface text-[10px] font-bold rounded-lg transition-all cursor-pointer"
            >
              稍后
            </button>
            <button
              onClick={() => {
                if (window.electronAPI && window.electronAPI.quitAndInstall) {
                  window.electronAPI.quitAndInstall();
                }
              }}
              className="px-4 py-1.5 bg-primary hover:opacity-90 text-white text-[10px] font-bold rounded-lg transition-all shadow-sm shadow-primary/20 cursor-pointer"
            >
              立即重启
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
