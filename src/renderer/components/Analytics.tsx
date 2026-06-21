import React, { useState, useEffect } from 'react';
import { storageService, DailyLog } from '../services/storage';

interface AnalyticsProps {
  refreshSignal: number;
}

export default function Analytics({ refreshSignal }: AnalyticsProps) {
  const [dailyLogs, setDailyLogs] = useState<Record<string, DailyLog>>({});
  const [weeklyDuration, setWeeklyDuration] = useState<number[]>(new Array(7).fill(0)); // 周一到周日学习秒数
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);

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

  const calculateLongestStreak = (logs: Record<string, DailyLog>) => {
    // 获取所有有学习记录的日期，并按时间排序
    const dates = Object.keys(logs)
      .filter(date => logs[date].totalDuration > 0)
      .sort();

    if (dates.length === 0) return 0;

    let maxStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < dates.length; i++) {
      const prevDate = new Date(dates[i - 1]);
      const currDate = new Date(dates[i]);
      
      // 计算两个日期相差的天数
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

  // 生成年度热力图数据（全尺寸网格，365天，每列7个格子，共53列）
  const getFullHeatmapGrid = () => {
    const today = new Date();
    const grid = [];
    
    // 倒推 364 天（共 365 天，52周多）
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

  // 按星期几分列排列热力图（经典 GitHub 贡献图排列）
  const columns: typeof fullGrid[] = [];
  let currentColumn: typeof fullGrid = [];

  // 获取第一天是星期几，用空白格子填充第一列
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

  // 格式化秒为小时
  const formatHours = (seconds: number) => {
    return Math.round((seconds / 3600) * 10) / 10;
  };

  // 生成勋章状态
  const getBadges = () => {
    return [
      { id: '1', name: '初学乍练', desc: '累计学习满 1 小时', icon: 'auto_stories', unlocked: totalSeconds >= 3600 },
      { id: '2', name: '小试身手', desc: '累计学习满 10 小时', icon: 'workspace_premium', unlocked: totalSeconds >= 36000 },
      { id: '3', name: '持之以恒', desc: '历史最长连续学习 3 天', icon: 'local_fire_department', unlocked: longestStreak >= 3 },
      { id: '4', name: '真学霸', desc: '历史最长连续学习 7 天', icon: 'military_tech', unlocked: longestStreak >= 7 }
    ];
  };

  const badges = getBadges();

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
    // 按日期倒序
    return logs.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  };

  const sortedLogs = getAllLogsSorted();

  // 最近 7 天的星期标签（从 6 天前到今天）
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

  // 计算最近 7 天最大时长，做柱状图的比例缩放
  const maxWeeklySecs = Math.max(...weeklyDuration, 1);

  return (
    <div className="max-w-[1200px] mx-auto py-8 px-4 h-full overflow-y-auto custom-scrollbar">
      <header className="mb-8">
        <h2 className="text-2xl font-headline font-extrabold text-on-surface tracking-tight">全量数据大屏</h2>
        <p className="text-sm text-on-surface-variant mt-1">
          全方位分析您的学习时长、学习热度以及知识成长趋势
        </p>
      </header>

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* 左侧：时长统计柱状图 & 勋章墙 */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* 最近 7 天学习柱状图 */}
          <section className="apple-card p-6 rounded-2xl bg-white/80">
            <h3 className="font-bold text-sm text-on-surface mb-6">最近 7 天学习趋势 (小时)</h3>
            <div className="h-40 flex items-end justify-between gap-3 px-1">
              {weeklyDuration.map((duration, idx) => {
                const heightPercent = Math.max(10, Math.round((duration / maxWeeklySecs) * 100));
                const isToday = idx === 6;
                return (
                  <div key={idx} className="flex flex-col items-center gap-2 flex-1">
                    <div 
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-md transition-all duration-500 hover:opacity-85 ${
                        isToday ? 'bg-primary shadow-sm shadow-primary/20' : 'bg-primary/20'
                      }`}
                      title={`学习 ${formatHours(duration)} 小时`}
                    />
                    <span className={`text-[10px] font-semibold ${isToday ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>
                      {weeklyDays[idx]}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 勋章卡片 */}
          <section className="apple-card p-6 rounded-2xl bg-white/80">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-sm text-on-surface">学习成就勋章</h3>
              <span className="text-[10px] font-bold text-on-surface-variant">
                已解锁 {badges.filter(b => b.unlocked).length} / {badges.length}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {badges.map(badge => (
                <div 
                  key={badge.id}
                  className={`p-3 rounded-2xl border flex flex-col items-center text-center transition-all ${
                    badge.unlocked 
                      ? 'bg-blue-50/40 border-blue-100/50 hover:scale-105' 
                      : 'bg-black/[0.02] border-black/5 opacity-40 grayscale'
                  }`}
                >
                  <span className={`material-symbols-outlined text-3xl mb-1.5 ${
                    badge.unlocked ? 'text-primary' : 'text-on-surface-variant'
                  }`} style={badge.unlocked ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                    {badge.icon}
                  </span>
                  <span className="text-xs font-bold text-on-surface">{badge.name}</span>
                  <span className="text-[9px] text-on-surface-variant mt-1 leading-tight">{badge.desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 数据总览卡片 */}
          <section className="apple-card p-6 rounded-2xl bg-[#1D1D1F] text-white relative overflow-hidden group">
            <div className="relative z-10">
              <span className="text-white/60 font-bold text-[9px] uppercase tracking-wider">总览看板</span>
              <h4 className="text-xl font-headline font-extrabold text-white mt-2">专注达成</h4>
              <p className="text-white/70 text-xs mt-1">您已累计学习了 <span className="text-primary font-extrabold text-sm">{formatHours(totalSeconds)}</span> 小时。坚持这个节奏，终将学有所成！</p>
            </div>
            <span className="material-symbols-outlined text-[80px] text-white/5 absolute right-2 bottom-0 pointer-events-none group-hover:text-white/10 transition-colors">
              bolt
            </span>
          </section>
        </div>

        {/* 右侧：年度 365 天热力图 & 日志时间轴 */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* 年度大热力图 */}
          <section className="apple-card p-6 rounded-2xl bg-white/80">
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

            {/* GitHub 贡献热力图网格 */}
            <div className="flex flex-col gap-1 overflow-x-auto pb-2 custom-scrollbar">
              <div className="flex gap-1.5">
                {columns.map((column, colIdx) => (
                  <div key={colIdx} className="flex flex-col gap-1.5">
                    {column.map((cell, cellIdx) => (
                      <div
                        key={cellIdx}
                        className={`heatmap-cell ${cell.bgClass} w-2.5 h-2.5 rounded-[2px]`}
                        title={cell.dateStr ? `${cell.dateStr} : 学习 ${formatHours(cell.duration)} 小时` : undefined}
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

          {/* 学习足迹时间轴 */}
          <section className="apple-card flex flex-col rounded-2xl h-[400px] overflow-hidden bg-white/80">
            <div className="p-4 border-b border-black/5">
              <h3 className="font-bold text-sm text-on-surface">学习历史时间轴</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
              {sortedLogs.map((log, idx) => (
                <div key={idx} className="flex gap-4 relative">
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
                        在该日期学习了 {formatHours(log.totalDuration)} 小时
                      </h4>
                      <span className="text-[10px] font-semibold text-on-surface-variant">{log.dateStr}</span>
                    </div>
                    
                    <div className="space-y-1.5 mt-2">
                      {log.playedVideos.map((video, vIdx) => (
                        <div key={vIdx} className="text-xs text-on-surface-variant flex items-center justify-between pl-2 border-l border-black/5">
                          <span className="truncate pr-4">{video.name}</span>
                          <span className="font-bold text-primary whitespace-nowrap bg-primary/5 px-1.5 py-0.5 rounded">
                            +{formatHours(video.duration)} 小时
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
  );
}
