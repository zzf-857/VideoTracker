import React, { useState, useEffect } from 'react';
import { storageService, MediaSourceConfig } from '../services/storage';
import CustomSelect from './CustomSelect';

interface DashboardProps {
  currentSource: MediaSourceConfig | null;
  videoCount: number; // 视频集数
  playedVideoCount: number; // 已看完的集数
  totalLocalDuration: number; // 本地视频总时长（秒）
  playedLocalDuration: number; // 本地已看完视频总时长（秒）
  refreshSignal: number;
  playbackSpeed: number;
  onSpeedChange: (speed: number) => void;
}

export default function Dashboard({
  currentSource,
  videoCount,
  playedVideoCount,
  totalLocalDuration,
  playedLocalDuration,
  refreshSignal,
  playbackSpeed,
  onSpeedChange
}: DashboardProps) {
  const [dailyHours, setDailyHours] = useState<number>(1.5); // 每日目标学习时长（小时）
  const [dailyEpisodes, setDailyEpisodes] = useState<number>(3); // 每日观看集数
  const speed = playbackSpeed;
  const setSpeed = onSpeedChange;
  const [statViewMode, setStatViewMode] = useState<'count' | 'duration'>('count'); // 统计文字模式
  const [pauseOnBlur, setPauseOnBlur] = useState<boolean>(true);
  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(false);

  useEffect(() => {
    storageService.loadData().then(data => {
      setPauseOnBlur(data.settings.pauseOnBlur ?? true);
      setAutoPlayNext(data.settings.autoPlayNext ?? false);
    });
  }, [refreshSignal]);

  const handleTogglePauseOnBlur = async (checked: boolean) => {
    setPauseOnBlur(checked);
    const data = await storageService.loadData();
    const updatedSettings = { ...data.settings, pauseOnBlur: checked };
    await storageService.saveData({ settings: updatedSettings });
  };

  const handleToggleAutoPlayNext = async (checked: boolean) => {
    setAutoPlayNext(checked);
    const data = await storageService.loadData();
    const updatedSettings = { ...data.settings, autoPlayNext: checked };
    await storageService.saveData({ settings: updatedSettings });
    window.dispatchEvent(new CustomEvent('settings:updated'));
  };
  
  // 计算进度百分比
  const progressPercent = videoCount > 0 ? Math.round((playedVideoCount / videoCount) * 100) : 0;

  // 格式化时长为小时
  const totalHours = Math.round((totalLocalDuration / 3600) * 10) / 10;

  // 格式化时长为 xx小时xx分钟
  const formatDurationToHoursMinutes = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分钟`;
  };

  // 1. 本地源：根据总时长 and 倍速计算预计天数
  // 天数 = (总时长 / 倍速) / 每日小时数
  const estimatedDaysByDuration = dailyHours > 0 
    ? Math.ceil((totalHours / speed) / dailyHours) 
    : 0;

  // 2. 远端源：根据总课时 and 每日集数计算预计天数
  // 天数 = 未看完的视频数 / 每日集数
  const remainingEpisodes = Math.max(0, videoCount - playedVideoCount);
  const estimatedDaysByEpisodes = dailyEpisodes > 0 
    ? Math.ceil(remainingEpisodes / dailyEpisodes) 
    : 0;

  return (
    <div className="glass-panel rounded-2xl flex flex-wrap items-center justify-between p-5 border-l-4 border-primary bg-white/80 gap-6 w-full shadow-sm relative z-20 overflow-visible">
      {/* 1. 当前媒体库基本信息 */}
      <div className="flex flex-col min-w-[200px] flex-1 max-w-full">
        <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">当前课程媒体库</span>
        <span className="font-bold text-base text-on-surface truncate max-w-[240px]" title={currentSource ? currentSource.name : ''}>
          {currentSource ? currentSource.name : '未选择挂载源'}
        </span>
        <span 
          onClick={() => setStatViewMode(prev => prev === 'count' ? 'duration' : 'count')}
          className="text-xs text-on-surface-variant hover:text-primary transition-colors cursor-pointer select-none underline decoration-dotted mt-1 w-fit"
          title="点击切换统计单位 (课时数 / 视频时长)"
        >
          {statViewMode === 'count' ? (
            `共 ${videoCount} 课时 · 已学完 ${playedVideoCount} 课时`
          ) : (
            `共 ${formatDurationToHoursMinutes(totalLocalDuration)} · 已学完 ${formatDurationToHoursMinutes(playedLocalDuration)}`
          )}
        </span>
      </div>

      {/* 2. 计划调节输入区 (精致微灰胶囊条) */}
      <div className="flex flex-wrap items-center gap-5 min-w-[240px] flex-1 py-2 px-4 bg-black/[0.02] border border-black/5 rounded-xl overflow-visible">
        {currentSource?.type === 'local' ? (
          <>
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">每日学习目标</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0.1"
                  max="24"
                  step="0.1"
                  value={dailyHours}
                  onChange={(e) => setDailyHours(Math.max(0.1, parseFloat(e.target.value) || 1.5))}
                  className="w-14 p-1 text-xs border border-black/10 rounded-lg text-center font-bold focus:ring-1 focus:ring-primary focus:border-primary bg-white"
                />
                <span className="text-[11px] text-on-surface-variant">小时</span>
              </div>
            </div>

            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">播放倍速</span>
              {(() => {
                const defaultOptions = [
                  { value: 1, label: '1.0 x' },
                  { value: 1.25, label: '1.25 x' },
                  { value: 1.5, label: '1.5 x' },
                  { value: 1.75, label: '1.75 x' },
                  { value: 2, label: '2.0 x' },
                  { value: 2.5, label: '2.5 x' },
                  { value: 3, label: '3.0 x' }
                ];
                const hasSpeed = defaultOptions.some(o => Math.abs(o.value - speed) < 0.01);
                const speedOptions = hasSpeed
                  ? defaultOptions
                  : [...defaultOptions, { value: speed, label: `${speed.toFixed(2).replace(/\.?0+$/, '')} x` }].sort((a, b) => a.value - b.value);
                
                return (
                  <CustomSelect
                    value={speed}
                    onChange={(val) => setSpeed(val)}
                    options={speedOptions}
                    className="min-w-[80px]"
                    variant="card"
                  />
                );
              })()}
            </div>
          </>
        ) : (
          <div className="flex flex-col">
            <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">每日预计看几集</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={dailyEpisodes}
                  onChange={(e) => setDailyEpisodes(Math.max(1, parseInt(e.target.value, 10) || 3))}
                  className="w-14 p-1 text-xs border border-black/10 rounded-lg text-center font-bold focus:ring-1 focus:ring-primary focus:border-primary bg-white"
                />
                <span className="text-[11px] text-on-surface-variant">集</span>
              </div>
              <span className="text-[9px] text-orange-500 font-bold bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100/50">
                远端不支持时长计算
              </span>
            </div>
          </div>
        )}

        {/* 失去焦点自动暂停开关 */}
        <div className="flex flex-col select-none">
          <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">失焦自动暂停</span>
          <div className="flex items-center h-[32px]">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={pauseOnBlur}
                onChange={(e) => handleTogglePauseOnBlur(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#E9E9EA] rounded-full peer-checked:bg-green-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full shadow-sm" />
            </label>
          </div>
        </div>

        {/* 自动连播开关 */}
        <div className="flex flex-col select-none">
          <span className="text-[9px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">自动连播</span>
          <div className="flex items-center h-[32px]">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoPlayNext}
                onChange={(e) => handleToggleAutoPlayNext(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#E9E9EA] rounded-full peer-checked:bg-green-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full shadow-sm" />
            </label>
          </div>
        </div>
      </div>

      {/* 3. 统计结果与总进度百分比 */}
      <div className="flex items-center justify-between xl:justify-end gap-6 min-w-[260px] flex-1">
        {/* 预计看毕 */}
        <div className="flex flex-col min-w-[100px]">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
            {currentSource?.type === 'local' ? '预计看毕 (倍速后)' : '预计需要'}
          </span>
          <span className="font-headline font-extrabold text-xl text-primary mt-0.5">
            {currentSource?.type === 'local' 
              ? `${estimatedDaysByDuration} 天` 
              : `${estimatedDaysByEpisodes} 天`}
          </span>
        </div>

        {/* 整体进度 */}
        <div className="flex flex-col items-end flex-1 max-w-[160px]">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">整体完成进度</span>
          <div className="flex items-center gap-2.5 w-full justify-end">
            <div className="w-full h-1.5 bg-black/5 rounded-full overflow-hidden border border-black/5">
              <div 
                className="h-full bg-primary transition-all duration-500" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs font-extrabold text-on-surface">{progressPercent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
