import React, { useState, useEffect } from 'react';
import { storageService, DailyLog, PlayedVideoLog } from '../services/storage';

interface AnalyticsProps {
  refreshSignal: number;
  onRefresh: () => void;
}

export default function Analytics({ refreshSignal, onRefresh }: AnalyticsProps) {
  const [dailyLogs, setDailyLogs] = useState<Record<string, DailyLog>>({});
  const [weeklyDuration, setWeeklyDuration] = useState<number[]>(new Array(7).fill(0)); // 周一到周日学习秒数
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  
  // 视图切换：'minute' (分钟) 或 'hour' (小时)
  const [unit, setUnit] = useState<'minute' | 'hour'>('minute');
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; dateStr: string; videoPath: string } | null>(null);

  useEffect(() => {
    storageService.loadData().then(data => {
      setDailyLogs(data.dailyLogs);
      
      // 1. 计算总学习时间
      let totalSecs = 0;
      for (const log of Object.values(data.dailyLogs)) {
        totalSecs += log.totalDuration;
      }
      setTotalSeconds(totalSecs);

      // 2. 计算最近 7 天的时长（从今天倒推 7 天）
      const today = new Date();
      const weekly = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dStr = d.toISOString().split('T')[0];
        weekly.push(data.dailyLogs[dStr] ? data.dailyLogs[dStr].totalDuration : 0);
      }
      setWeeklyDuration(weekly);

      // 3. 计算历史最长连续学习天数
      setLongestStreak(calculateLongestStreak(data.dailyLogs));
    });
  }, [refreshSignal]);

  // 全局点击关闭右键菜单
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const calculateLongestStreak = (logs: Record<string, DailyLog>) => {
    const dates = Object.keys(logs)
      .filter(date => logs[date].totalDuration > 0)
      .sort();

    if (dates.length === 0) return 0;

    let maxStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < dates.length; i++) {
      const prevDate = new Date(dates[i - 1]);
      const currDate = new Date(dates[i]);
      
      const diffTime = Math.abs(currDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else if (diffDays > 1) {
        currentStreak = 1;
      }
    }
    
    return maxStreak;
  };

  // 根据当前单位格式化时间值 (秒 -> 分钟/小时)
  const formatValue = (seconds: number) => {
    if (unit === 'minute') {
      return Math.round(seconds / 60);
    } else {
      return Math.round((seconds / 3600) * 10) / 10;
    }
  };

  const getUnitLabel = () => {
    return unit === 'minute' ? '分钟' : '小时';
  };

  // 生成年度热力图数据（全尺寸网格，365天，每列7个格子，共53列）
  const getFullHeatmapGrid = () => {
    const today = new Date();
    const grid = [];
    
    for (let i = 364; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const log = dailyLogs[dateStr];
      const duration = log ? log.totalDuration : 0;

      let bgClass = 'bg-black/5';
      if (duration > 3600 * 2) bgClass = 'bg-primary'; // >2h
      else if (duration > 3600) bgClass = 'bg-primary/70'; // >1h
      else if (duration > 1800) bgClass = 'bg-primary/40'; // >30m
      else if (duration > 0) bgClass = 'bg-primary/20'; // >0m

      grid.push({
        dateStr,
        duration,
        bgClass,
        dayOfWeek: date.getDay()
      });
    }
    return grid;
  };

  const fullGrid = getFullHeatmapGrid();
  const columns: typeof fullGrid[] = [];
  let currentColumn: typeof fullGrid = [];

  const firstDay = fullGrid[0].dayOfWeek;
  for (let i = 0; i < firstDay; i++) {
    currentColumn.push({ dateStr: '', duration: 0, bgClass: 'opacity-0 pointer-events-none', dayOfWeek: i });
  }

  for (const cell of fullGrid) {
    currentColumn.push(cell);
    if (currentColumn.length === 7) {
      columns.push(currentColumn);
      currentColumn = [];
    }
  }
  if (currentColumn.length > 0) {
    while (currentColumn.length < 7) {
      currentColumn.push({ dateStr: '', duration: 0, bgClass: 'opacity-0 pointer-events-none', dayOfWeek: currentColumn.length });
    }
    columns.push(currentColumn);
  }

  // 整理所有历史日志时间轴数据
  const getAllLogsSorted = () => {
    const logs = [];
    for (const [dateStr, log] of Object.entries(dailyLogs)) {
      if (log.playedVideos.length > 0) {
        logs.push({
          dateStr,
          ...log
        });
      }
    }
    return logs.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  };

  const sortedLogs = getAllLogsSorted();

  const getWeeklyDaysLabel = () => {
    const labels = [];
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      labels.push(weekdays[d.getDay()]);
    }
    return labels;
  };

  const weeklyDays = getWeeklyDaysLabel();
  const maxWeeklySecs = Math.max(...weeklyDuration, 1);

  // 获取视频来源文案
  const getSourceLabel = (video: PlayedVideoLog) => {
    if (video.sourceName) return video.sourceName;
    if (video.path.startsWith('http://') || video.path.startsWith('https://')) {
      return '网络源';
    }
    return '本地源';
  };

  // 右键触发
  const handleContextMenu = (e: React.MouseEvent, dateStr: string, videoPath: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      dateStr,
      videoPath
    });
  };

  // 执行删除观看记录
  const handleDeleteVideoLog = async (dateStr: string, videoPath: string) => {
    if (!confirm('确定要删除该条观看记录吗？此操作将扣减当天的学习时间。')) return;
    await storageService.deleteVideoLog(dateStr, videoPath);
    onRefresh();
  };

  return (
    <div className="w-full py-8 px-8 h-full overflow-y-auto custom-scrollbar relative">
      <header className="mb-8 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-headline font-extrabold text-on-surface tracking-tight">全量数据大屏</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            全方位分析您的学习时长、学习热度以及知识成长趋势
          </p>
        </div>
        
        {/* 统计单位切换开关 */}
        <div className="flex bg-black/[0.04] p-1.5 rounded-2xl gap-1 self-start shadow-sm border border-black/5">
          <button
            onClick={() => setUnit('minute')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              unit === 'minute'
                ? 'bg-white text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            按分钟统计
          </button>
          <button
            onClick={() => setUnit('hour')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              unit === 'hour'
                ? 'bg-white text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            按小时统计
          </button>
        </div>
      </header>

      <div className="space-y-6">
        {/* 1. 年度 365 天大热力图 (Spans full width) */}
        <section className="apple-card p-6 rounded-2xl bg-white/80 border border-black/5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-sm text-on-surface">年度学习热力图 (最近 365 天)</h3>
            <div className="flex items-center gap-2 text-[10px] font-bold text-on-surface-variant uppercase">
              <span>少</span>
              <div className="flex gap-0.5">
                <div className="w-2.5 h-2.5 bg-black/5 rounded-sm" />
                <div className="w-2.5 h-2.5 bg-primary/20 rounded-sm" />
                <div className="w-2.5 h-2.5 bg-primary/40 rounded-sm" />
                <div className="w-2.5 h-2.5 bg-primary/70 rounded-sm" />
                <div className="w-2.5 h-2.5 bg-primary rounded-sm" />
              </div>
              <span>多</span>
            </div>
          </div>

          <div className="flex flex-col gap-1 overflow-x-auto pb-2 custom-scrollbar">
            <div className="flex gap-1.5">
              {columns.map((column, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-1.5">
                  {column.map((cell, cellIdx) => (
                    <div
                      key={cellIdx}
                      className={`heatmap-cell ${cell.bgClass} w-2.5 h-2.5 rounded-[2px]`}
                      title={cell.dateStr ? `${cell.dateStr} : 学习 ${formatValue(cell.duration)} ${getUnitLabel()}` : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] font-bold text-on-surface-variant px-1 mt-2 tracking-widest uppercase">
              <span>JAN</span><span>MAR</span><span>MAY</span><span>JUL</span><span>SEP</span><span>NOV</span>
            </div>
          </div>
        </section>

        {/* 下方自适应双列排版 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* 左侧列：柱状图 & 统计概览 */}
          <div className="col-span-12 lg:col-span-5 space-y-6">
            {/* 最近 7 天趋势图 */}
            <section className="apple-card p-6 rounded-2xl bg-white/80 border border-black/5 shadow-sm transition-shadow hover:shadow-md">
              <h3 className="font-bold text-sm text-on-surface mb-6">最近 7 天学习趋势 ({getUnitLabel()})</h3>
              <div className="h-40 flex items-end justify-between gap-3 px-1">
                {weeklyDuration.map((duration, idx) => {
                  const heightPercent = Math.max(10, Math.round((duration / maxWeeklySecs) * 100));
                  const isToday = idx === 6;
                  return (
                    <div key={idx} className="flex flex-col items-center gap-2 flex-1">
                      {/* 固定高度的容器，让百分比高度生效，并用 justify-end 让柱子从底部向上长 */}
                      <div className="h-28 w-full flex flex-col justify-end">
                        <div 
                          style={{ height: `${heightPercent}%` }}
                          className={`w-full rounded-md transition-all duration-500 hover:opacity-85 ${
                            isToday ? 'bg-primary shadow-sm shadow-primary/20' : 'bg-primary/20'
                          }`}
                          title={`学习 ${formatValue(duration)} ${getUnitLabel()}`}
                        />
                      </div>
                      <span className={`text-[10px] font-semibold ${isToday ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>
                        {weeklyDays[idx]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 数据概览卡片 - 移除 apple-card 防止背景颜色被 rgba(255,255,255,0.8) 覆盖 */}
            <section className="p-6 rounded-2xl bg-[#1D1D1F] text-white relative overflow-hidden group border border-black/5 shadow-sm shadow-black/10">
              <div className="relative z-10">
                <span className="text-white/60 font-bold text-[9px] uppercase tracking-wider">总览看板</span>
                <h4 className="text-xl font-headline font-extrabold text-white mt-2">专注达成</h4>
                <p className="text-white/70 text-xs mt-2 leading-relaxed">
                  您已累计学习了 <span className="text-primary font-extrabold text-sm bg-white/10 px-2 py-0.5 rounded">{formatValue(totalSeconds)}</span> {getUnitLabel()}。<br />
                  最长连续学习天数：<span className="text-primary font-extrabold text-sm bg-white/10 px-2 py-0.5 rounded">{longestStreak}</span> 天。<br />
                  坚持这个节奏，终将学有所成！
                </p>
              </div>
              <span className="material-symbols-outlined text-[80px] text-white/5 absolute right-2 bottom-0 pointer-events-none group-hover:text-white/10 transition-colors">
                bolt
              </span>
            </section>
          </div>

          {/* 右侧列：历史时间轴 */}
          <div className="col-span-12 lg:col-span-7">
            <section className="apple-card flex flex-col rounded-2xl h-[470px] overflow-hidden bg-white/80 border border-black/5 shadow-sm transition-shadow hover:shadow-md">
              <div className="p-4 border-b border-black/5">
                <h3 className="font-bold text-sm text-on-surface">学习历史时间轴</h3>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
                {sortedLogs.map((log, idx) => (
                  <div key={idx} className="flex gap-4 relative select-none">
                    {/* 左侧垂直线和小圆点 */}
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center border border-primary/10">
                        <span className="material-symbols-outlined text-[16px]">play_circle</span>
                      </div>
                      {idx < sortedLogs.length - 1 && <div className="w-px flex-1 bg-black/5 my-2" />}
                    </div>
                    
                    {/* 右侧日志卡片 */}
                    <div className="flex-1 pb-4 border-b border-black/[0.02]">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-xs text-on-surface">
                          在该日期学习了 {formatValue(log.totalDuration)} {getUnitLabel()}
                        </h4>
                        <span className="text-[10px] font-semibold text-on-surface-variant">{log.dateStr}</span>
                      </div>
                      
                      <div className="space-y-1.5 mt-2">
                        {log.playedVideos.map((video, vIdx) => (
                          <div 
                            key={vIdx} 
                            onContextMenu={(e) => handleContextMenu(e, log.dateStr, video.path)}
                            className="text-xs text-on-surface-variant flex items-center justify-between pl-2 border-l border-black/5 py-1 hover:bg-black/[0.02] rounded transition-colors cursor-default"
                            title="右键可删除该记录"
                          >
                            <div className="flex flex-col min-w-0 pr-4">
                              <span className="truncate font-medium">{video.name}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[9px] text-on-surface-variant/70">时间: {video.time}</span>
                                <span className="text-[9px] text-primary/70 bg-primary/5 px-1 py-0.2 rounded font-medium">
                                  来源: {getSourceLabel(video)}
                                </span>
                              </div>
                            </div>
                            <span className="font-bold text-primary whitespace-nowrap bg-primary/5 px-1.5 py-0.5 rounded">
                              +{formatValue(video.duration)} {getUnitLabel()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {sortedLogs.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-60 py-20">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">timeline</span>
                    <span className="text-xs text-on-surface-variant">暂无播放足迹历史记录</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* 右键浮动上下文菜单 */}
      {contextMenu && (
        <div 
          className="fixed bg-white border border-black/10 rounded-xl shadow-lg py-1 z-[200] min-w-28 text-xs text-red-500 animate-fade-in"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button 
            onClick={() => {
              handleDeleteVideoLog(contextMenu.dateStr, contextMenu.videoPath);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left hover:bg-red-50 flex items-center gap-1.5 cursor-pointer font-bold transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">delete</span>
            删除该记录
          </button>
        </div>
      )}
    </div>
  );
}
