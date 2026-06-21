import React, { useState, useEffect, useRef } from 'react';
import { storageService } from '../services/storage';

export interface Chapter {
  time: number;
  text: string;
  rawTime: string;
}

// 格式化时间戳秒数为时分秒，如 3725 -> "01:02:05" 或 320 -> "05:20"
export function formatSeconds(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 解析 MM:SS 或 HH:MM:SS 为秒数
export function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

// 正则解析时间轴文本
export function parseTimeline(text: string): Chapter[] {
  if (!text) return [];
  const lines = text.split('\n');
  const chapters: Chapter[] = [];
  const regex = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$/;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const match = regex.exec(trimmed);
    if (match) {
      const h = match[1];
      const m = match[2];
      const s = match[3];
      const title = match[4];
      
      const rawTime = h ? `${h}:${m}:${s}` : `${m}:${s}`;
      const time = timeStringToSeconds(rawTime);
      
      chapters.push({
        time,
        text: title.trim(),
        rawTime
      });
    }
  }
  
  return chapters.sort((a, b) => a.time - b.time);
}

interface ChapterSidebarProps {
  videoPath: string;
  videoUrl: string;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onChaptersChange: (chapters: Chapter[]) => void;
  // 截图生成状态回调
  onStartGeneration?: (times: number[]) => void;
  thumbnailUpdateSignal: number;
  onClearChapters?: () => void;
}

export default function ChapterSidebar({
  videoPath,
  videoUrl,
  currentTime,
  onSeek,
  onChaptersChange,
  onStartGeneration,
  thumbnailUpdateSignal,
  onClearChapters
}: ChapterSidebarProps) {
  const [rawText, setRawText] = useState<string>('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(-1);
  const [existingThumbs, setExistingThumbs] = useState<Set<number>>(new Set());
  
  const activeItemRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // 1. 初始化加载已保存的时间轴
  useEffect(() => {
    storageService.loadData().then(data => {
      const savedText = data.timelines?.[videoPath] || '';
      setRawText(savedText);
      const parsed = parseTimeline(savedText);
      setChapters(parsed);
      onChaptersChange(parsed);
      
      if (parsed.length > 0) {
        checkExistingThumbnails(parsed.map(c => c.time));
      } else {
        setExistingThumbs(new Set());
      }
    });
    setIsEditing(false);
  }, [videoPath]);

  // 2. 检查哪些预览图已存在于磁盘上
  const checkExistingThumbnails = async (times: number[]) => {
    if (window.electronAPI && times.length > 0) {
      try {
        const existed: number[] = await window.electronAPI.checkThumbnails(videoPath, times);
        setExistingThumbs(new Set(existed));
      } catch (err) {
        console.error('Failed to check thumbnails:', err);
      }
    }
  };

  // 监听缩略图生成完毕的信号，重新检查
  useEffect(() => {
    if (chapters.length > 0) {
      checkExistingThumbnails(chapters.map(c => c.time));
    }
  }, [thumbnailUpdateSignal, chapters]);

  // 3. 计算当前播放时间属于哪一个章节
  useEffect(() => {
    if (chapters.length === 0) {
      setActiveChapterIndex(-1);
      return;
    }
    
    // 找到最接近且小于等于当前播放秒数的章节
    let activeIdx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (currentTime >= chapters[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }
    
    if (activeIdx !== activeChapterIndex) {
      setActiveChapterIndex(activeIdx);
    }
  }, [currentTime, chapters, activeChapterIndex]);

  // 4. 当激活的章节发生变化时，自动滚动对焦
  useEffect(() => {
    if (activeChapterIndex !== -1 && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [activeChapterIndex]);

  // 5. 保存并生成时间轴
  const handleGenerate = async () => {
    await storageService.saveTimeline(videoPath, rawText);
    const parsed = parseTimeline(rawText);
    setChapters(parsed);
    onChaptersChange(parsed);
    setIsEditing(false);

    if (parsed.length > 0) {
      // 触发截图生成流程
      const times = parsed.map(c => c.time);
      if (onStartGeneration) {
        onStartGeneration(times);
      }
    }
  };

  // 6. 清除所有章节和图片缓存
  const handleClear = async () => {
    if (!window.confirm('确定要清除该视频的时间轴以及所有的章节预览图缓存吗？')) {
      return;
    }
    
    await storageService.deleteTimeline(videoPath);
    setRawText('');
    setChapters([]);
    setExistingThumbs(new Set());
    onChaptersChange([]);
    
    if (window.electronAPI) {
      await window.electronAPI.clearThumbnails(videoPath);
    }
    
    if (onClearChapters) {
      onClearChapters();
    }
    
    setIsEditing(false);
  };

  // 获取视频截图访问的原点
  let streamOrigin = '';
  try {
    if (videoUrl) {
      streamOrigin = new URL(videoUrl).origin;
    }
  } catch (e) {
    console.error('Failed to parse stream origin:', e);
  }

  return (
    <div className="flex flex-col h-full bg-white/50 border border-black/5 rounded-2xl overflow-hidden shadow-sm">
      {/* 头部标题与控制 */}
      <div className="p-4 border-b border-black/5 flex items-center justify-between bg-black/[0.01]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-on-surface">toc</span>
          <span className="text-sm font-semibold text-on-surface">视频章节</span>
        </div>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border ${
            isEditing 
              ? 'bg-black/5 border-black/10 text-on-surface hover:bg-black/10'
              : 'bg-primary/10 border-primary/10 text-primary hover:bg-primary/20'
          }`}
        >
          <span className="material-symbols-outlined text-[12px]">{isEditing ? 'close' : 'edit'}</span>
          {isEditing ? '取消' : chapters.length > 0 ? '编辑' : '添加时间轴'}
        </button>
      </div>

      {/* 核心内容区 */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* 编辑器滑出面板 */}
        {isEditing && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-md z-10 p-4 flex flex-col gap-3 transition-all duration-200">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-on-surface-variant flex justify-between">
                <span>粘贴时间节点文本:</span>
                <span className="text-[9px] text-on-surface-variant/60 font-normal">格式: 分:秒 章节名 (如 05:20 课程开始)</span>
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="00:00 教程概述&#10;05:20 程序语言是什么&#10;01:02:45 注释"
                className="flex-1 w-full text-xs p-3 border border-black/10 rounded-xl bg-black/[0.02] focus:outline-none focus:border-primary focus:bg-white resize-none font-mono leading-relaxed"
              />
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={handleGenerate}
                disabled={!rawText.trim()}
                className="flex-1 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-md shadow-primary/10"
              >
                生成章节
              </button>
              {chapters.length > 0 && (
                <button
                  onClick={handleClear}
                  className="py-2 px-3 border border-red-200 text-red-500 hover:bg-red-50 text-xs font-bold rounded-xl active:scale-95 transition-all"
                  title="清除所有时间节点和物理缓存"
                >
                  清除所有
                </button>
              )}
            </div>
          </div>
        )}

        {/* 章节列表 */}
        <div 
          ref={listContainerRef}
          className="flex-1 p-4 overflow-y-auto custom-scrollbar space-y-2.5"
        >
          {chapters.length > 0 ? (
            chapters.map((chapter, idx) => {
              const isActive = idx === activeChapterIndex;
              const hasThumb = existingThumbs.has(chapter.time);
              const thumbUrl = hasThumb && streamOrigin
                ? `${streamOrigin}/thumbnail?videoPath=${encodeURIComponent(videoPath)}&time=${chapter.time}&t=${thumbnailUpdateSignal}`
                : '';

              return (
                <div
                  key={idx}
                  ref={isActive ? activeItemRef : null}
                  onClick={() => onSeek(chapter.time)}
                  className={`group flex gap-3 p-2 rounded-xl hover:bg-black/5 active:bg-black/[0.08] transition-all cursor-pointer border ${
                    isActive
                      ? 'bg-primary/5 border-primary/20 shadow-sm'
                      : 'bg-white border-black/5 hover:border-black/10'
                  }`}
                >
                  {/* 左侧缩略图容器 */}
                  <div className="relative w-[110px] aspect-[16/9] rounded-lg overflow-hidden bg-black/[0.05] border border-black/5 flex-shrink-0">
                    {hasThumb && thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={chapter.text}
                        className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center opacity-40">
                        <span className="material-symbols-outlined text-[16px] animate-pulse">image</span>
                        <span className="text-[8px] mt-0.5 scale-90">提取帧中</span>
                      </div>
                    )}
                    {/* 右下角时间标志 */}
                    <span className="absolute bottom-1 right-1 bg-black/65 backdrop-blur-[2px] text-[8px] font-bold text-white px-1 py-0.5 rounded-[4px] font-mono">
                      {chapter.rawTime}
                    </span>
                  </div>

                  {/* 右侧文本 */}
                  <div className="flex-1 flex flex-col justify-center min-w-0 pr-1">
                    <span className={`text-xs font-semibold leading-snug truncate-2-lines transition-colors ${
                      isActive ? 'text-primary font-bold' : 'text-on-surface'
                    }`}>
                      {chapter.text}
                    </span>
                    <span className="text-[9px] text-on-surface-variant/60 font-semibold mt-1">
                      起止点: {chapter.rawTime}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center opacity-60">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant mb-2">auto_awesome_motion</span>
              <span className="text-xs text-on-surface-variant font-semibold">该视频尚未标注章节时间轴</span>
              <button
                onClick={() => setIsEditing(true)}
                className="mt-4 px-4 py-2 bg-primary/10 border border-primary/10 text-primary text-xs font-bold rounded-xl hover:bg-primary/20 active:scale-95 transition-all"
              >
                立即添加时间轴
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
