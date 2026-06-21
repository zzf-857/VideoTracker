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

  // 时间段选择：最近 30 | 90 | 180 | 365 天
  const [daysRange, setDaysRange] = useState<30 | 90 | 180 | 365>(365);
  
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

  // 生成热力图数据（全尺寸网格，支持 days 天数，每列 7 个格子）
  const getHeatmapGrid = (days: number) => {
    const today = new Date();
    const grid = [];
    
    for (let i = days - 1; i >= 0; i--) {
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

  const gridData = getHeatmapGrid(daysRange);
  const columns: typeof gridData[] = [];
  let currentColumn: typeof gridData = [];

  const firstDay = gridData.length > 0 ? gridData[0].dayOfWeek : 0;
  for (let i = 0; i < firstDay; i++) {
    currentColumn.push({ dateStr: '', duration: 0, bgClass: 'opacity-0 pointer-events-none', dayOfWeek: i });
  }

  for (const cell of gridData) {
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

  // 动态计算底部对齐的月份标识
  const getMonthLabels = () => {
    let lastMonth = '';
    return columns.map((col) => {
      const validCell = col.find(c => c.dateStr !== '');
      if (!validCell) return '';
      const date = new Date(validCell.dateStr);
      const mName = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      if (mName !== lastMonth) {
        lastMonth = mName;
        return mName;
      }
      return '';
    });
  };
  const monthLabels = getMonthLabels();

  // 自适应格子尺寸配置
  const heatmapConfig = {
    30: {
      cellClass: 'w-7 h-7 rounded-md',
      gapClass: 'gap-2',
      containerGapClass: 'gap-2',
      cellWidth: '28px'
    },
    90: {
      cellClass: 'w-5 h-5 rounded-md',
      gapClass: 'gap-1.5',
      containerGapClass: 'gap-1.5',
      cellWidth: '20px'
    },
    180: {
      cellClass: 'w-4 h-4 rounded-sm',
      gapClass: 'gap-1',
      containerGapClass: 'gap-1',
      cellWidth: '16px'
    },
    365: {
      cellClass: 'w-2.5 h-2.5 rounded-[2px]',
      gapClass: 'gap-1',
      containerGapClass: 'gap-1',
      cellWidth: '10px'
    }
  }[daysRange];

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
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
            <h3 className="font-bold text-sm text-on-surface">
              {daysRange === 365 ? '年度' : daysRange === 180 ? '半年' : daysRange === 90 ? '季度' : '月度'}学习热力图 (最近 {daysRange} 天)
            </h3>
            
            {/* 时间间隔切换 Pills */}
            <div className="flex items-center gap-4 self-end sm:self-auto">
              <div className="flex bg-black/[0.04] p-1 rounded-xl gap-0.5 border border-black/5 scale-90 origin-right">
                {([30, 90, 180, 365] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDaysRange(d)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                      daysRange === d
                        ? 'bg-white text-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {d}天
                  </button>
                ))}
              </div>

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
          </div>

          <div className="flex flex-col gap-1.5 overflow-x-auto pb-2 custom-scrollbar">
            <div className={`flex ${heatmapConfig.containerGapClass}`}>
              {columns.map((column, colIdx) => (
                <div key={colIdx} className={`flex flex-col ${heatmapConfig.gapClass}`}>
                  {column.map((cell, cellIdx) => (
                    <div
                      key={cellIdx}
                      className={`heatmap-cell ${cell.bgClass} ${heatmapConfig.cellClass} transition-all duration-200`}
                      title={cell.dateStr ? `${cell.dateStr} : 学习 ${formatValue(cell.duration)} ${getUnitLabel()}` : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
            {/* 动态月份底部标识 */}
            <div className={`flex ${heatmapConfig.containerGapClass} mt-2 select-none`}>
              {monthLabels.map((label, idx) => (
                <div
                  key={idx}
                  style={{ width: heatmapConfig.cellWidth }}
                  className="text-[9px] font-bold text-on-surface-variant text-left overflow-visible whitespace-nowrap"
                >
                  {label}
                </div>
              ))}
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
                    <div key={idx} className="flex flex-col items-center gap-2 flex-1 group relative">
                      {/* 迷你浮动 Tooltip 气泡 */}
                      <div className="absolute bottom-[calc(100%-8px)] left-1/2 -translate-x-1/2 bg-[#1D1D1F] text-white text-[9px] font-bold px-2 py-0.5 rounded shadow-md opacity-0 scale-90 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 transition-all duration-200 whitespace-nowrap z-20">
                        {formatValue(duration)} {getUnitLabel()}
                      </div>
                      
                      {/* 固定高度的容器，让百分比高度生效，并用 justify-end 让柱子从底部向上长 */}
                      <div className="h-28 w-full flex flex-col justify-end">
                        <div 
                          style={{ height: `${heightPercent}%` }}
                          className={`w-full rounded-md transition-all duration-300 origin-bottom transform cursor-pointer ${
                            isToday 
                              ? 'bg-primary shadow-sm shadow-primary/20 hover:scale-x-105 hover:scale-y-105 hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/30' 
                              : 'bg-primary/20 hover:bg-primary/40 hover:scale-x-105 hover:scale-y-105 hover:-translate-y-0.5'
                          }`}
                          title={`学习 ${formatValue(duration)} ${getUnitLabel()}`}
                        />
                      </div>
                      <span className={`text-[10px] font-semibold transition-colors duration-200 group-hover:text-primary ${isToday ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>
                        {weeklyDays[idx]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 数据概览卡片 - 移除 apple-card 防止背景颜色被 rgba(255,255,255,0.8) 覆盖 */}
            <section className="p-6 rounded-2xl bg-[#1D1D1F] text-white relative overflow-hidden group border border-black/5 shadow-sm shadow-black/10 flex flex-row items-center justify-between gap-6 min-h-[160px]">
              <div className="relative z-10 flex-1 max-w-[65%]">
                <span className="text-white/60 font-bold text-[9px] uppercase tracking-wider">总览看板</span>
                <h4 className="text-xl font-headline font-extrabold text-white mt-2">专注达成</h4>
                <p className="text-white/70 text-xs mt-2.5 leading-relaxed">
                  您已累计学习了 <span className="text-primary font-extrabold text-sm bg-white/10 px-2 py-0.5 rounded">{formatValue(totalSeconds)}</span> {getUnitLabel()}。<br />
                  最长连续学习天数：<span className="text-primary font-extrabold text-sm bg-white/10 px-2 py-0.5 rounded">{longestStreak}</span> 天。<br />
                  坚持这个节奏，终将学有所成！
                </p>
              </div>
              
              <div className="relative flex items-center justify-center pr-2 select-none w-[110px] h-[110px] shrink-0">
                {/* 奖杯发光背景 */}
                <div className="absolute w-20 h-20 rounded-full bg-primary/20 blur-xl group-hover:bg-primary/30 transition-all duration-500 animate-pulse pointer-events-none" />
                <svg viewBox="0 0 100 100" className="w-24 h-24 animate-float relative z-10 drop-shadow-[0_4px_12px_rgba(245,166,35,0.3)]">
                  <defs>
                    <linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFE066" />
                      <stop offset="30%" stopColor="#F5A623" />
                      <stop offset="70%" stopColor="#D0021B" />
                      <stop offset="100%" stopColor="#F8E71C" />
                    </linearGradient>
                    <linearGradient id="star-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFF" />
                      <stop offset="100%" stopColor="#F5A623" />
                    </linearGradient>
                  </defs>
                  
                  {/* 底部基座 */}
                  <path d="M25 80 L75 80 L70 70 L30 70 Z" fill="#2C2C2E" stroke="#48484A" strokeWidth="1" />
                  <rect x="35" y="80" width="30" height="5" rx="1.5" fill="#1C1C1E" />
                  
                  {/* 支架/颈部 */}
                  <path d="M42 70 L58 70 L54 58 L46 58 Z" fill="url(#gold-grad)" />
                  <ellipse cx="50" cy="58" rx="8" ry="2" fill="#D0021B" opacity="0.3" />

                  {/* 杯身 */}
                  <path d="M30 25 C30 25 30 50 50 55 C70 50 70 25 70 25 Z" fill="url(#gold-grad)" />
                  <path d="M50 25 C50 25 50 50 50 55 C50 50 70 25 70 25 Z" fill="#FFE066" opacity="0.2" /> {/* 高光 */}

                  {/* 杯耳 (左) */}
                  <path d="M30 30 C20 30 20 45 30 48 M30 34 C24 34 24 42 30 44" fill="none" stroke="url(#gold-grad)" strokeWidth="3" strokeLinecap="round" />
                  {/* 杯耳 (右) */}
                  <path d="M70 30 C80 30 80 45 70 48 M70 34 C76 34 76 42 70 44" fill="none" stroke="url(#gold-grad)" strokeWidth="3" strokeLinecap="round" />

                  {/* 星星闪烁 (装饰) */}
                  <path d="M22 15 L24 20 L29 21 L24 22 L22 27 L20 22 L15 21 L20 20 Z" fill="url(#star-grad)" className="animate-pulse" style={{ animationDelay: '0.2s' }} />
                  <path d="M78 12 L79.5 16 L83.5 17 L79.5 18 L78 22 L76.5 18 L72.5 17 L76.5 16 Z" fill="url(#star-grad)" className="animate-pulse" style={{ animationDelay: '0.8s' }} />
                  <path d="M50 15 L51 18 L54 18.5 L51 19 L50 22 L49 19 L46 18.5 L49 18 Z" fill="#FFF" className="animate-pulse" />
                </svg>
              </div>
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
