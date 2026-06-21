import React, { useState, useEffect } from 'react';
import { storageService, DailyLog, PlayedVideoLog, MediaSourceConfig } from '../services/storage';

interface AnalyticsProps {
  refreshSignal: number;
  onRefresh: () => void;
}

export default function Analytics({ refreshSignal, onRefresh }: AnalyticsProps) {
  const [dailyLogs, setDailyLogs] = useState<Record<string, DailyLog>>({});
  const [weeklyDuration, setWeeklyDuration] = useState<number[]>(new Array(7).fill(0)); // 周一到周日学习秒数
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);
  
  // 视图切换：'minute' (分钟) 或 'hour' (小时)
  const [unit, setUnit] = useState<'minute' | 'hour'>('minute');

  // 时间段选择：最近 30 | 90 | 180 | 365 天
  const [daysRange, setDaysRange] = useState<30 | 90 | 180 | 365>(365);
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; dateStr: string; videoPath: string } | null>(null);

  useEffect(() => {
    storageService.loadData().then(data => {
      setDailyLogs(data.dailyLogs);
      setSources(data.sources);
      
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

  // 生成年度热力图数据（全尺寸网格，永远固定为 365天，共53列）
  const getFullYearGrid = () => {
    const today = new Date();
    const grid = [];
    
    for (let i = 364; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const log = dailyLogs[dateStr];
      const duration = log ? log.totalDuration : 0;

      let bgClass = 'bg-black/[0.08]';
      if (duration > 3600 * 2) bgClass = 'bg-primary'; // >2h
      else if (duration > 3600) bgClass = 'bg-primary/80'; // >1h
      else if (duration > 1800) bgClass = 'bg-primary/55'; // >30m
      else if (duration > 0) bgClass = 'bg-primary/30'; // >0m

      grid.push({
        dateStr,
        duration,
        bgClass,
        dayOfWeek: date.getDay(),
        daysAgo: i
      });
    }
    return grid;
  };

  const gridData = getFullYearGrid();
  const columns: typeof gridData[] = [];
  let currentColumn: typeof gridData = [];

  const firstDay = gridData.length > 0 ? gridData[0].dayOfWeek : 0;
  for (let i = 0; i < firstDay; i++) {
    currentColumn.push({ dateStr: '', duration: 0, bgClass: 'opacity-0 pointer-events-none', dayOfWeek: i, daysAgo: 999 });
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
      currentColumn.push({ dateStr: '', duration: 0, bgClass: 'opacity-0 pointer-events-none', dayOfWeek: currentColumn.length, daysAgo: 999 });
    }
    columns.push(currentColumn);
  }

  // 动态计算底部对齐的月份标识
  const getMonthLabels = () => {
    let lastMonth = '';
    return columns.map((col) => {
      const validCell = col.find(c => c.dateStr !== '');
      if (!validCell) return { label: '', isDim: true };
      const date = new Date(validCell.dateStr);
      const mName = `${date.getMonth() + 1}月`;
      const hasActiveCell = col.some(c => c.dateStr !== '' && c.daysAgo < daysRange);
      if (mName !== lastMonth) {
        lastMonth = mName;
        return { label: mName, isDim: !hasActiveCell };
      }
      return { label: '', isDim: !hasActiveCell };
    });
  };
  const monthLabels = getMonthLabels();

  // 期间数据分析
  const getRangeStats = (days: number) => {
    let totalSecs = 0;
    let activeDays = 0;
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const log = dailyLogs[dateStr];
      if (log && log.totalDuration > 0) {
        totalSecs += log.totalDuration;
        activeDays++;
      }
    }
    return {
      totalDuration: totalSecs,
      activeDays,
      rate: Math.round((activeDays / days) * 100)
    };
  };
  const rangeStats = getRangeStats(daysRange);

  // 年度热力图固定 53 列等分正方形格子配置
  const heatmapConfig = {
    cellClass: 'w-full aspect-square rounded-[3px]',
    colStyle: { flex: '1 1 0%', minWidth: '8px', maxWidth: '24px' },
    gapClass: 'gap-1',
    containerGapClass: 'gap-1'
  };

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
    // 1. 尝试使用已保存的 sourceName (排除默认的 "本地" / "本地源" 占位符)
    if (video.sourceName && video.sourceName !== '本地' && video.sourceName !== '本地源') {
      return video.sourceName;
    }

    // 2. 动态从已注册的数据源中进行路径前缀匹配
    const normPath = video.path.replace(/\\/g, '/').toLowerCase();
    for (const source of sources) {
      if (source.type === 'local') {
        const normSourcePath = source.path.replace(/\\/g, '/').toLowerCase();
        if (normPath.startsWith(normSourcePath)) {
          return source.name;
        }
      } else {
        // 对于 webdav 和 alist，匹配其 URL 的 pathname 部分
        try {
          const url = new URL(source.path);
          let pathname = url.pathname;
          if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
          if (pathname && normPath.startsWith(pathname.toLowerCase())) {
            return source.name;
          }
        } catch (e) {
          if (normPath.includes(source.name.toLowerCase())) {
            return source.name;
          }
        }
      }
    }

    // 3. 兜底逻辑
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
                  <div className="w-2.5 h-2.5 bg-black/[0.08] rounded-sm" />
                  <div className="w-2.5 h-2.5 bg-primary/30 rounded-sm" />
                  <div className="w-2.5 h-2.5 bg-primary/55 rounded-sm" />
                  <div className="w-2.5 h-2.5 bg-primary/80 rounded-sm" />
                  <div className="w-2.5 h-2.5 bg-primary rounded-sm" />
                </div>
                <span>多</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 overflow-x-auto pb-2 custom-scrollbar">
            {/* 网格区：宽度 w-full 保持铺满，每一列 flex-1 撑满，格子 w-full 自适应正方形大小，且带有时光聚光灯高亮动效 */}
            <div className={`flex ${heatmapConfig.containerGapClass} w-full min-w-[640px] pb-1`}>
              {columns.map((column, colIdx) => (
                <div 
                  key={colIdx} 
                  style={heatmapConfig.colStyle}
                  className={`flex flex-col ${heatmapConfig.gapClass}`}
                >
                  {column.map((cell, cellIdx) => (
                    <div
                      key={cellIdx}
                      className={`heatmap-cell ${cell.bgClass} ${heatmapConfig.cellClass} transition-all duration-300 ${
                        cell.daysAgo >= daysRange 
                          ? (cell.duration > 0 
                              ? 'opacity-[0.15] pointer-events-none scale-[0.95] saturate-[0.2]' 
                              : 'opacity-[0.25] pointer-events-none scale-[0.95]')
                          : 'opacity-100'
                      }`}
                      title={cell.dateStr && cell.daysAgo < daysRange ? `${cell.dateStr} : 学习 ${formatValue(cell.duration)} ${getUnitLabel()}` : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
            
            {/* 动态月份底部标识：列宽度与上方完全镜像等宽对齐，超出激活天数段的月份设为半透明 */}
            <div className={`flex ${heatmapConfig.containerGapClass} w-full min-w-[640px] mt-2 select-none`}>
              {monthLabels.map((item, idx) => (
                <div
                  key={idx}
                  style={heatmapConfig.colStyle}
                  className={`text-[9px] font-bold text-on-surface-variant text-left overflow-visible whitespace-nowrap transition-opacity duration-300 ${
                    item.isDim ? 'opacity-15' : 'opacity-85'
                  }`}
                >
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 下方自适应双列排版 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
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
            <section className="p-6 rounded-2xl bg-[#1D1D1F] text-white relative group border border-black/5 shadow-sm shadow-black/10 flex flex-row items-center justify-between gap-6 min-h-[160px]">
              <div className="relative z-10 flex-1 flex flex-col justify-between h-full gap-4">
                <div>
                  <span className="text-white/50 font-bold text-xs uppercase tracking-wider">总览看板</span>
                  <h4 className="text-3xl font-headline font-extrabold text-white mt-1.5 tracking-tight">专注达成</h4>
                </div>
                
                {/* 核心数据指标块，并排展示，填充中间空白 */}
                <div className="flex items-center gap-10 mt-1">
                  <div className="flex flex-col">
                    <span className="text-white/40 text-[10px] font-bold tracking-wider uppercase">累计学习时长</span>
                    <div className="flex items-baseline gap-1 mt-1.5">
                      <span className="text-4xl font-extrabold text-primary tracking-tight">{formatValue(totalSeconds)}</span>
                      <span className="text-xs text-white/50 font-semibold">{getUnitLabel()}</span>
                    </div>
                  </div>
                  
                  {/* 半透明垂直分割线 */}
                  <div className="w-[1px] h-10 bg-white/10 self-center" />
                  
                  <div className="flex flex-col">
                    <span className="text-white/40 text-[10px] font-bold tracking-wider uppercase">历史最长连续</span>
                    <div className="flex items-baseline gap-1 mt-1.5">
                      <span className="text-4xl font-extrabold text-primary tracking-tight">{longestStreak}</span>
                      <span className="text-xs text-white/50 font-semibold">天</span>
                    </div>
                  </div>
                </div>
                
                <p className="text-white/50 text-xs mt-1 font-medium tracking-wide">
                  坚持这个节奏，终将学有所成！✨
                </p>
              </div>
              
              {/* 用于在 flex 布局中占位的相对定位容器 */}
              <div className="relative w-[180px] h-[150px] shrink-0 select-none">
                {/* 绝对定位的破界/溢出容器 */}
                <div className="absolute -right-4 -bottom-8 w-[210px] h-[180px] overflow-visible flex items-center justify-center">
                  {/* 奖杯发光背景 */}
                  <div className="absolute w-32 h-32 rounded-full bg-primary/20 blur-2xl group-hover:bg-primary/30 transition-all duration-500 animate-pulse pointer-events-none" />
                  
                  {/* 星星装饰背景（不旋转，保持水平闪烁） */}
                  <div className="absolute inset-0 pointer-events-none z-0">
                    {/* 左上星 */}
                    <svg className="absolute top-2 left-2 w-4 h-4 text-amber-200 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {/* 右下星 */}
                    <svg className="absolute bottom-4 right-1 w-3.5 h-3.5 text-yellow-100 animate-pulse" style={{ animationDelay: '0.4s' }} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {/* 顶部中央星 */}
                    <svg className="absolute top-1 right-8 w-3 h-3 text-white animate-pulse" style={{ animationDelay: '0.8s' }} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </div>

                  {/* 奖杯本体：大尺寸，浮动，向右倾斜15度，hover时放大10%并旋转到20度 */}
                  <div className="w-[180px] h-[180px] animate-float transform rotate-[15deg] group-hover:rotate-[20deg] group-hover:scale-110 transition-all duration-500 relative z-10 flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_12px_24px_rgba(255,179,0,0.45)]">
                      <defs>
                        {/* 金色渐变：纯粹以金色为主 */}
                        <linearGradient id="cup-gold" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#FFF9C4" /> {/* 浅亮金 */}
                          <stop offset="35%" stopColor="#FBC02D" /> {/* 黄金 */}
                          <stop offset="75%" stopColor="#F57F17" /> {/* 深橘金 */}
                          <stop offset="100%" stopColor="#FBC02D" />
                        </linearGradient>
                        <linearGradient id="inner-gold" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#F57F17" />
                          <stop offset="100%" stopColor="#FBC02D" />
                        </linearGradient>
                        <linearGradient id="base-metal" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#424242" />
                          <stop offset="50%" stopColor="#757575" />
                          <stop offset="100%" stopColor="#212121" />
                        </linearGradient>
                      </defs>

                      {/* 奖杯底座 (多层拉丝质感) */}
                      <path d="M22 80 L78 80 L74 68 L26 68 Z" fill="url(#base-metal)" stroke="#616161" strokeWidth="0.5" />
                      <rect x="30" y="80" width="40" height="6" rx="2" fill="#212121" />
                      <rect x="34" y="86" width="32" height="4" rx="1" fill="#0D0D0D" />

                      {/* 支架/颈部 */}
                      <path d="M44 68 L56 68 L53 52 L47 52 Z" fill="url(#cup-gold)" />
                      <ellipse cx="50" cy="52" rx="6" ry="1.5" fill="#E65100" opacity="0.4" />
                      <path d="M40 68 L60 68 L50 64 Z" fill="#F57F17" opacity="0.3" />

                      {/* 杯身 */}
                      <path d="M24 20 C24 20 22 48 50 52 C78 48 76 20 76 20 Z" fill="url(#cup-gold)" />
                      
                      {/* 杯口深度阴影 */}
                      <ellipse cx="50" cy="20" rx="26" ry="5" fill="url(#inner-gold)" />
                      
                      {/* 杯口边缘亮线 */}
                      <ellipse cx="50" cy="20" rx="26" ry="5" fill="none" stroke="#FFF9C4" strokeWidth="1" />

                      {/* 杯身左侧高光 */}
                      <path d="M25 21 C25 21 23.5 45 50 49.5 C28 47 27 23 27 21 Z" fill="#FFFFFF" opacity="0.25" />

                      {/* 双杯耳 (左) */}
                      <path d="M24 24 C14 24 12 40 24 44 C16 42 16 28 24 28" fill="none" stroke="url(#cup-gold)" strokeWidth="4" strokeLinecap="round" />
                      {/* 双杯耳 (右) */}
                      <path d="M76 24 C86 24 88 40 76 44 C84 42 84 28 76 28" fill="none" stroke="url(#cup-gold)" strokeWidth="4" strokeLinecap="round" />

                      {/* 奖杯中央的胜利之星 */}
                      <path d="M50 26 L53 32 L60 33 L55 38 L56 45 L50 41 L44 45 L45 38 L40 33 L47 32 Z" fill="#FFF9C4" stroke="#E65100" strokeWidth="0.5" />
                      <path d="M50 26 L50 41 L44 45 L45 38 L40 33 L47 32 Z" fill="#FBC02D" opacity="0.5" />
                    </svg>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* 右侧列：历史时间轴 */}
          <div className="col-span-12 lg:col-span-7 flex flex-col min-h-0">
            <section className="apple-card flex flex-col rounded-2xl flex-1 overflow-hidden bg-white/80 border border-black/5 shadow-sm transition-shadow hover:shadow-md">
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
                        {log.playedVideos.map((video, vIdx) => {
                          const isSelected = contextMenu && contextMenu.dateStr === log.dateStr && contextMenu.videoPath === video.path;
                          return (
                            <div 
                              key={vIdx} 
                              onContextMenu={(e) => handleContextMenu(e, log.dateStr, video.path)}
                              className={`text-xs flex items-center justify-between pl-2 border-l-2 py-1.5 transition-all duration-200 cursor-default rounded group ${
                                isSelected 
                                  ? 'bg-primary/10 border-primary text-primary font-semibold translate-x-1 shadow-xs' 
                                  : 'text-on-surface-variant border-transparent hover:border-primary/60 hover:bg-primary/5 hover:text-on-surface hover:translate-x-1 hover:shadow-xs'
                              }`}
                              title="右键可删除该记录"
                            >
                              <div className="flex flex-col min-w-0 pr-4">
                                <span className={`truncate font-medium transition-colors duration-200 ${
                                  isSelected ? 'text-primary' : 'text-on-surface group-hover:text-primary'
                                }`}>
                                  {video.name}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[9px] opacity-70">时间: {video.time}</span>
                                  <span className="text-[9px] text-primary/70 bg-primary/5 px-1 py-0.2 rounded font-medium">
                                    来源: {getSourceLabel(video)}
                                  </span>
                                </div>
                              </div>
                              <span className="font-bold text-primary whitespace-nowrap bg-primary/5 px-1.5 py-0.5 rounded">
                                +{formatValue(video.duration)} {getUnitLabel()}
                              </span>
                            </div>
                          );
                        })}
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
          onClick={(e) => e.stopPropagation()}
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
