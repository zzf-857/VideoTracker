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

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [appData, setAppData] = useState<AppDataStore | null>(null);
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

  // 加载数据
  useEffect(() => {
    storageService.loadData().then(data => {
      setAppData(data);
      if (data.sources.length > 0 && !currentSource) {
        setCurrentSource(data.sources[0]);
      }
    });
  }, [refreshSignal]);

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
    onIdleTimeout: handleIdleTimeout
  });

  // 获取该挂载源下所有的视频统计信息（计算课时数和已学完数）
  const getSourceStats = () => {
    if (!appData || !currentSource) return { totalCount: 0, finishedCount: 0, totalDuration: 0 };

    let totalCount = 0;
    let finishedCount = 0;
    let totalDuration = 0;

    // 扫描所有进度记录，找出以当前 source.path 开头（或 WebDAV 下匹配）的视频记录
    const basePath = currentSource.path;
    
    for (const [vPath, prog] of Object.entries(appData.progress)) {
      if (vPath.startsWith(basePath) || vPath.includes(basePath)) {
        totalCount++;
        if (prog.isFinished) {
          finishedCount++;
        }
        // 如果播放过有 duration，则累加
        if (prog.duration > 0) {
          totalDuration += prog.duration;
        } else {
          // 未播放过的视频，估算为 30 分钟 (1800 秒)
          totalDuration += 1800;
        }
      }
    }

    // 若 progress 还没记录，提供最基本的视频统计（如果是本地，读取叶子节点数量，这在 Sidebar 加载后可通过树状节点获得。为了简单，直接读 progress 大小或提供基础显示）
    if (totalCount === 0) {
      // 降级使用基础数值
      return { totalCount: 10, finishedCount: 0, totalDuration: 10 * 1800 };
    }

    return { totalCount, finishedCount, totalDuration };
  };

  const stats = getSourceStats();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F5F5F7]">
      {/* 侧边栏 */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        activeVideoPath={activeVideoPath}
        onSelectVideo={handleSelectVideo}
        progressMap={appData?.progress || {}}
        refreshSignal={refreshSignal}
      />

      {/* 右侧主工作区域 */}
      <main className="flex-1 flex flex-col relative h-full overflow-hidden">
        {currentTab === 'dashboard' && (
          <div className="flex-1 p-8 grid grid-cols-12 gap-6 relative z-10 h-full overflow-hidden">
            {/* 中间：播放器区域 (占 8 列) */}
            <section className="col-span-8 flex flex-col gap-5 h-full overflow-hidden">
              <div className="flex-1 min-h-[300px] relative bg-black rounded-2xl overflow-hidden shadow-lg border border-black/5">
                {activeVideoUrl ? (
                  <Player
                    videoUrl={activeVideoUrl}
                    videoPath={activeVideoPath}
                    videoName={activeVideoName}
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

              {/* 底部计划计算面板 */}
              <Dashboard
                currentSource={currentSource}
                videoCount={stats.totalCount}
                playedVideoCount={stats.finishedCount}
                totalLocalDuration={stats.totalDuration}
                refreshSignal={refreshSignal}
              />
            </section>

            {/* 右侧：日历热力图与自动日志时间轴 (占 4 列) */}
            <section className="col-span-4 h-full overflow-hidden">
              <LogCalendar refreshSignal={refreshSignal} />
            </section>
          </div>
        )}

        {currentTab === 'sources' && (
          <SourceManager refreshSignal={refreshSignal} onRefresh={handleRefresh} />
        )}

        {currentTab === 'analytics' && (
          <Analytics refreshSignal={refreshSignal} />
        )}

        {currentTab === 'settings' && (
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
    </div>
  );
}
