import React, { useState, useEffect } from 'react';
import { storageService, MediaSourceConfig } from '../services/storage';

interface DashboardProps {
  currentSource: MediaSourceConfig | null;
  videoCount: number; // 视频集数
  playedVideoCount: number; // 已看完的集数
  totalLocalDuration: number; // 本地视频总时长（秒）
  refreshSignal: number;
}

export default function Dashboard({
  currentSource,
  videoCount,
  playedVideoCount,
  totalLocalDuration,
  refreshSignal
}: DashboardProps) {
  const [dailyHours, setDailyHours] = useState<number>(1.5); // 每日目标学习时长（小时）
  const [dailyEpisodes, setDailyEpisodes] = useState<number>(3); // 每日观看集数
  const [speed, setSpeed] = useState<number>(1.25); // 倍速
  
  // 计算进度百分比
  const progressPercent = videoCount > 0 ? Math.round((playedVideoCount / videoCount) * 100) : 0;

  // 格式化时长为小时
  const totalHours = Math.round((totalLocalDuration / 3600) * 10) / 10;

  // 1. 本地源：根据总时长和倍速计算预计天数
  // 天数 = (总时长 / 倍速) / 每日小时数
  const estimatedDaysByDuration = dailyHours > 0 
    ? Math.ceil((totalHours / speed) / dailyHours) 
    : 0;

  // 2. 远端源：根据总课时和每日集数计算预计天数
  // 天数 = 未看完的视频数 / 每日集数
  const remainingEpisodes = Math.max(0, videoCount - playedVideoCount);
  const estimatedDaysByEpisodes = dailyEpisodes > 0 
    ? Math.ceil(remainingEpisodes / dailyEpisodes) 
    : 0;

  return (
    <div className="glass-panel rounded-2xl flex flex-col lg:flex-row items-center justify-between p-6 border-l-4 border-primary bg-white/80 gap-6 w-full shadow-sm">
      {/* 左侧：计划推算控制器 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 flex-1 w-full">
        {/* 数据源名称及视频数统计 */}
        <div className="flex flex-col pr-4 sm:border-r border-black/5">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">当前课程媒体库</span>
          <span className="font-bold text-base text-on-surface truncate max-w-[200px]">
            {currentSource ? currentSource.name : '未选择挂载源'}
          </span>
          <span className="text-xs text-on-surface-variant mt-1">
            共 {videoCount} 课时 · 已学完 {playedVideoCount} 课时
          </span>
        </div>

        {/* 计划计算器输入调节 */}
        <div className="flex flex-wrap items-center gap-4 flex-1">
          {currentSource?.type === 'local' ? (
            // 本地视频源专属：基于时长的计算
            <>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">每日学习目标</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0.1"
                    max="24"
                    step="0.1"
                    value={dailyHours}
                    onChange={(e) => setDailyHours(Math.max(0.1, parseFloat(e.target.value) || 1.5))}
                    className="w-16 p-1 text-xs border border-black/10 rounded-lg text-center font-bold focus:ring-1 focus:ring-primary focus:border-primary bg-white"
                  />
                  <span className="text-xs text-on-surface-variant">小时</span>
                </div>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">播放倍速</span>
                <select
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="p-1 pr-8 text-xs border border-black/10 rounded-lg font-bold focus:ring-1 focus:ring-primary bg-white"
                >
                  <option value="1.0">1.0 x</option>
                  <option value="1.25">1.25 x</option>
                  <option value="1.5">1.5 x</option>
                  <option value="1.75">1.75 x</option>
                  <option value="2.0">2.0 x</option>
                  <option value="2.5">2.5 x</option>
                  <option value="3.0">3.0 x</option>
                </select>
              </div>
            </>
          ) : (
            // 远端视频源 (WebDAV/Alist)：基于课时数/集数的计算
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">每日预计看几集</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={dailyEpisodes}
                  onChange={(e) => setDailyEpisodes(Math.max(1, parseInt(e.target.value, 10) || 3))}
                  className="w-16 p-1 text-xs border border-black/10 rounded-lg text-center font-bold focus:ring-1 focus:ring-primary focus:border-primary bg-white"
                />
                <span className="text-xs text-on-surface-variant">集</span>
                <span className="text-[10px] text-orange-500 font-bold bg-orange-50 px-2 py-0.5 rounded ml-2 border border-orange-100">
                  远端不支持时长计算
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：计划预计天数与进度显示 */}
      <div className="flex flex-row items-center gap-8 justify-between w-full lg:w-auto lg:justify-end">
        {/* 预计天数结果 (Odometer style) */}
        <div className="flex flex-col min-w-[100px]">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">
            {currentSource?.type === 'local' ? '预计看毕 (倍速后)' : '预计需要'}
          </span>
          <span className="font-headline font-extrabold text-2xl text-primary animate-pulse">
            {currentSource?.type === 'local' 
              ? `${estimatedDaysByDuration} 天` 
              : `${estimatedDaysByEpisodes} 天`}
          </span>
        </div>

        {/* 环形进度条或百分比进度 */}
        <div className="flex flex-col items-end min-w-[160px]">
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">整体完成进度</span>
          <div className="flex items-center gap-3 w-full justify-end">
            <div className="w-24 h-2 bg-black/5 rounded-full overflow-hidden border border-black/5">
              <div 
                className="h-full bg-primary transition-all duration-500" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-sm font-extrabold text-on-surface">{progressPercent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
