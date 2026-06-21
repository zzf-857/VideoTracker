import React, { useState, useEffect } from 'react';
import { storageService, DailyLog, PlayedVideoLog, MediaSourceConfig, getLocalDateString } from '../services/storage';

interface LogCalendarProps {
  refreshSignal: number;
  onRefresh: () => void;
}

export default function LogCalendar({ refreshSignal, onRefresh }: LogCalendarProps) {
  const [dailyLogs, setDailyLogs] = useState<Record<string, DailyLog>>({});
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [streakDays, setStreakDays] = useState(0);
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);

  useEffect(() => {
    storageService.loadData().then(data => {
      setDailyLogs(data.dailyLogs);
      setSources(data.sources);
      
      const today = getLocalDateString();
      setSelectedDate(prev => prev || today);
      
      // 计算连续学习天数
      calculateStreak(data.dailyLogs);
    });
  }, [refreshSignal]);

  // 计算 GitHub 贡献连续学习天数
  const calculateStreak = (logs: Record<string, DailyLog>) => {
    let streak = 0;
    let checkDate = new Date();
    
    // 检查今天是否学了，如果没有，从昨天开始算
    const todayStr = getLocalDateString(checkDate);
    if (logs[todayStr] && logs[todayStr].totalDuration > 0) {
      streak = 1;
    } else {
      // 检查昨天
      checkDate.setDate(checkDate.getDate() - 1);
      const yesterdayStr = getLocalDateString(checkDate);
      if (logs[yesterdayStr] && logs[yesterdayStr].totalDuration > 0) {
        streak = 1;
      } else {
        setStreakDays(0);
        return;
      }
    }

    // 循环往前推算
    while (true) {
      checkDate.setDate(checkDate.getDate() - 1);
      const dateStr = getLocalDateString(checkDate);
      if (logs[dateStr] && logs[dateStr].totalDuration > 0) {
        streak++;
      } else {
        break;
      }
    }
    
    setStreakDays(streak);
  };

  // 生成最近 35 天的日历格子数据（类似主工作台右侧 mini 热力图）
  const getHeatmapGrid = () => {
    const grid = [];
    const today = new Date();
    // 从 34 天前开始，到今天结束，共 35 天
    for (let i = 34; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = getLocalDateString(date);
      const log = dailyLogs[dateStr];
      const duration = log ? log.totalDuration : 0;
      
      // 根据学习总秒数计算热力图分级
      let bgClass = 'bg-black/[0.03]';
      if (duration > 3600 * 2) bgClass = 'bg-primary'; // 2小时以上
      else if (duration > 3600) bgClass = 'bg-primary/70'; // 1小时以上
      else if (duration > 1800) bgClass = 'bg-primary/40'; // 30分钟以上
      else if (duration > 0) bgClass = 'bg-primary/20'; // 有学习
      
      grid.push({
        dateStr,
        dateObj: date,
        duration,
        bgClass
      });
    }
    return grid;
  };

  // 格式化学习时长（秒 -> 小时分钟）
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0 分钟';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    if (hrs > 0) {
      return `${hrs} 小时 ${mins} 分钟`;
    }
    return `${mins} 分钟`;
  };

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



  const heatmapCells = getHeatmapGrid();
  const selectedLog = dailyLogs[selectedDate];

  return (
    <div className="flex flex-col gap-6 h-full relative">
      {/* 活跃热力图卡片 */}
      <div className="bg-white/50 border border-black/5 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-on-surface">活跃热力图</span>
          <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {streakDays > 0 ? `连续学习 ${streakDays} 天` : '开始今日学习吧'}
          </span>
        </div>
        
        {/* 35天小格热力图网格 */}
        <div className="grid grid-cols-7 gap-1.5">
          {heatmapCells.map((cell, idx) => (
            <div
              key={idx}
              onClick={() => setSelectedDate(cell.dateStr)}
              className={`contribution-cell ${cell.bgClass} cursor-pointer rounded-[3px] aspect-square w-full hover:scale-110 active:scale-95 transition-all ${
                selectedDate === cell.dateStr ? 'ring-2 ring-primary ring-offset-1' : ''
              }`}
              title={`${cell.dateStr} : 学习 ${formatDuration(cell.duration)}`}
            />
          ))}
        </div>
        
        {/* 热力图图例指示 */}
        <div className="mt-4 flex justify-between items-center text-[10px] text-on-surface-variant font-semibold">
          <span>少</span>
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 bg-black/[0.03] rounded-[1px]" />
            <div className="w-2.5 h-2.5 bg-primary/20 rounded-[1px]" />
            <div className="w-2.5 h-2.5 bg-primary/40 rounded-[1px]" />
            <div className="w-2.5 h-2.5 bg-primary/70 rounded-[1px]" />
            <div className="w-2.5 h-2.5 bg-primary rounded-[1px]" />
          </div>
          <span>多</span>
        </div>
      </div>

      {/* 当日播放历史详情卡片 */}
      <div className="flex-1 bg-white/50 border border-black/5 rounded-2xl flex flex-col overflow-hidden shadow-sm">
        <div className="p-4 border-b border-black/5 flex items-center gap-2 bg-black/[0.01]">
          <span className="material-symbols-outlined text-[18px] text-on-surface">history</span>
          <span className="text-sm font-semibold text-on-surface">
            {selectedDate === getLocalDateString() ? '今天' : selectedDate} 学习足迹
          </span>
        </div>
        
        <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
          {selectedLog && selectedLog.playedVideos.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs text-on-surface-variant bg-black/[0.02] p-2.5 rounded-xl border border-black/5 flex justify-between items-center">
                <span>当日总学习时长：</span>
                <span className="font-bold text-primary">{formatDuration(selectedLog.totalDuration)}</span>
              </div>
              
              <div className="space-y-2">
                {selectedLog.playedVideos.map((video, idx) => (
                  <div 
                    key={idx} 
                    className="p-3 bg-white border border-black/5 rounded-xl flex items-center justify-between hover:shadow-sm transition-all relative select-none cursor-default"
                  >
                    <div className="flex flex-col flex-1 min-w-0 pr-3">
                      <span className="text-xs font-semibold text-on-surface truncate">{video.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-on-surface-variant">播放于 {video.time}</span>
                        <span className="text-[9px] text-primary/70 bg-primary/5 px-1 py-0.2 rounded-md font-medium">
                          来源: {getSourceLabel(video)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-primary whitespace-nowrap bg-primary/5 px-2 py-1 rounded-lg">
                      + {formatDuration(video.duration)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-60 py-10">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant mb-2">hourglass_empty</span>
              <span className="text-xs text-on-surface-variant">该日期没有任何学习记录</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
