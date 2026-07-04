import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Artplayer from 'artplayer';
import { storageService, getEventHotkeyString } from '../services/storage';
import type { SubtitleAttachment, SubtitleBatchMatch, SubtitleStyleSettings } from '../services/subtitles';
import {
  buildSubtitleContainerStyle,
  buildSubtitleLineStyle,
  buildArtPlayerSubtitleOption,
  clampSubtitleOffset,
  createSubtitleAttachment,
  DEFAULT_SUBTITLE_STYLE,
  MAX_SUBTITLE_FONT_SIZE,
  MIN_SUBTITLE_FONT_SIZE,
  normalizeSubtitleStyle,
  stepSubtitleOffset
} from '../services/subtitles';
import { Captions, ChevronLeft, ChevronRight, FilePlus2, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

interface PlayerProps {
  videoUrl: string; // 播放直链 (可以是本地 HTTP 转接 Url，或 WebDAV 直链)
  videoPath: string; // 唯一标识路径 (用以保存进度)
  videoName: string;
  playbackSpeed: number; // 当前倍速
  onSpeedChange: (speed: number) => void; // 倍速修改回调
  hotkeys: {
    fullscreen: string;
    speedUp: string;
    speedDown: string;
    speedReset: string;
  };
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onEnded?: () => void;
  activeChapters?: any[]; // 新增：当前章节列表
  seekSignal?: { seconds: number; time: number } | null; // 新增：跳转信号
  sourceId?: string; // 新增：视频所属数据源 ID
  nextVideoName?: string; // 新增：下一个视频的名字 (用于连播提示)
  pauseOnBlur?: boolean; // 新增：失去焦点自动暂停
  isFinished?: boolean; // 新增：视频当前的已学完状态 (由外部驱动，如手动标记)
  onSubtitleChange?: () => void;
  subtitleReloadSignal?: number;
}

export default function Player({
  videoUrl,
  videoPath,
  videoName,
  playbackSpeed,
  onSpeedChange,
  hotkeys,
  onTimeUpdate,
  onPlayStateChange,
  onEnded,
  activeChapters = [],
  seekSignal,
  sourceId = '',
  nextVideoName,
  pauseOnBlur = true,
  isFinished = false,
  onSubtitleChange,
  subtitleReloadSignal = 0
}: PlayerProps) {
  const artRef = useRef<HTMLDivElement>(null);
  const playerInstanceRef = useRef<Artplayer | null>(null);
  const lastTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const wasPlayingBeforeBlur = useRef<boolean>(false);
  const isInitiallyFinishedRef = useRef<boolean>(false);
  const isProgressLoadedRef = useRef<boolean>(false);
  const activeChaptersRef = useRef<any[]>(activeChapters);
  const progressGapUpdaterRef = useRef<(() => void) | null>(null);
  const subtitleAttachmentRef = useRef<SubtitleAttachment | null>(null);
  const subtitleStyleRef = useRef<SubtitleStyleSettings>(DEFAULT_SUBTITLE_STYLE);
  const [isArtReady, setIsArtReady] = useState(false);
  const [subtitleAttachment, setSubtitleAttachment] = useState<SubtitleAttachment | null>(null);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleSettings>(DEFAULT_SUBTITLE_STYLE);
  const [subtitleUrl, setSubtitleUrl] = useState('');
  const [subtitleError, setSubtitleError] = useState('');
  const [isSubtitleLoading, setIsSubtitleLoading] = useState(false);
  const [isSubtitleStylePanelOpen, setIsSubtitleStylePanelOpen] = useState(false);
  const [isSubtitleDragging, setIsSubtitleDragging] = useState(false);
  const [subtitleToolbarHost, setSubtitleToolbarHost] = useState<HTMLElement | null>(null);
  const [playerTitleHost, setPlayerTitleHost] = useState<HTMLElement | null>(null);

  const formatSubtitleOffset = (offset: number) => {
    const safeOffset = clampSubtitleOffset(offset);
    const text = Number.isInteger(safeOffset) ? safeOffset.toFixed(0) : safeOffset.toFixed(1);
    return `${safeOffset > 0 ? '+' : ''}${text}s`;
  };

  const applySubtitleStyleToArt = (style?: Partial<SubtitleStyleSettings> | null) => {
    const art = playerInstanceRef.current;
    const subtitleElement = art?.template?.$subtitle as HTMLElement | undefined;
    if (!subtitleElement) return;

    const normalizedStyle = normalizeSubtitleStyle(style || subtitleStyleRef.current);
    Object.assign(subtitleElement.style, buildSubtitleContainerStyle(normalizedStyle));

    subtitleElement.querySelectorAll<HTMLElement>('.art-subtitle-line').forEach(line => {
      line.textContent = line.textContent?.trim() || '';
      Object.assign(line.style, buildSubtitleLineStyle(normalizedStyle));
    });
  };

  const persistSubtitleAttachment = async (nextAttachment: SubtitleAttachment, notifyChange = false) => {
    const { style: _legacyStyle, ...attachmentWithoutStyle } = nextAttachment;
    const normalizedAttachment: SubtitleAttachment = {
      ...attachmentWithoutStyle,
      offset: clampSubtitleOffset(nextAttachment.offset || 0)
    };
    subtitleAttachmentRef.current = normalizedAttachment;
    setSubtitleAttachment(normalizedAttachment);
    applySubtitleStyleToArt(subtitleStyleRef.current);
    await storageService.saveSubtitle(videoPath, normalizedAttachment);
    if (notifyChange) {
      onSubtitleChange?.();
    }
  };

  const updateSubtitleStyle = (
    styleUpdates: Partial<SubtitleStyleSettings>,
    shouldPersist = true
  ) => {
    const currentAttachment = subtitleAttachmentRef.current;
    if (!currentAttachment) return;

    const nextStyle = normalizeSubtitleStyle({
      ...subtitleStyleRef.current,
      ...styleUpdates
    });

    subtitleStyleRef.current = nextStyle;
    applySubtitleStyleToArt(nextStyle);

    if (shouldPersist) {
      setSubtitleStyle(nextStyle);
      void storageService.saveSubtitleStyle(nextStyle);
    }
  };

  const resetSubtitleStyle = () => {
    updateSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
    const art = playerInstanceRef.current;
    if (art) {
      art.notice.show = '字幕样式已重置';
    }
  };

  useEffect(() => {
    activeChaptersRef.current = activeChapters;
    progressGapUpdaterRef.current?.();
  }, [activeChapters]);

  // 1. 初始化和销毁 ArtPlayer
  useEffect(() => {
    if (!artRef.current) return;

    // 重置相关 Ref，防止切换视频时残留前一个视频的数据导致数据污染 Bug
    lastTimeRef.current = 0;
    durationRef.current = 0;
    isInitiallyFinishedRef.current = false;
    wasPlayingBeforeBlur.current = false;
    isProgressLoadedRef.current = false;
    setIsArtReady(false);
    setSubtitleToolbarHost(null);
    setPlayerTitleHost(null);

    let isUnmounting = false;

    // 格式化 highlight
    const highlight = activeChaptersRef.current.map(c => ({
      time: c.time,
      text: c.text
    }));

    // 初始化 ArtPlayer
    const art = new Artplayer({
      container: artRef.current,
      url: videoUrl,
      // @ts-ignore
      title: videoName,
      volume: 0.5,
      isLive: false,
      muted: false,
      autoplay: false,
      pip: true,
      autoSize: false,
      autoMini: true,
      screenshot: false,
      setting: true,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: false,
      subtitleOffset: true,
      miniProgressBar: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      autoPlayback: true, // 开启记忆播放
      theme: '#0071E3', // Apple Blue 主色
      customType: {},
      plugins: [],
      highlight,
      hotkey: false, // 禁用 ArtPlayer 默认自带的快捷键，防止与自定义热键重复触发冲突
    });

    playerInstanceRef.current = art;
    const artPlayerElement = art.template.$player as HTMLElement;
    const toolbarHost = document.createElement('div');
    toolbarHost.className = 'custom-subtitle-toolbar-host';
    artPlayerElement.appendChild(toolbarHost);
    setSubtitleToolbarHost(toolbarHost);

    const titleHost = document.createElement('div');
    titleHost.className = 'custom-player-title-host';
    artPlayerElement.appendChild(titleHost);
    setPlayerTitleHost(titleHost);

    const handleSubtitlePointerDown = (event: PointerEvent) => {
      const currentAttachment = subtitleAttachmentRef.current;
      if (!currentAttachment || !currentAttachment.enabled || event.button !== 0) return;

      const playerRect = artPlayerElement.getBoundingClientRect();
      const subtitleElement = art.template.$subtitle as HTMLElement | undefined;
      if (!playerRect || !subtitleElement) return;

      event.preventDefault();
      event.stopPropagation();
      setIsSubtitleDragging(true);

      try {
        subtitleElement.setPointerCapture(event.pointerId);
      } catch (err) {
        // Some WebViews do not allow pointer capture for detached subtitle nodes.
      }

      const updatePositionFromPointer = (pointerEvent: PointerEvent, shouldPersist: boolean) => {
        const x = ((pointerEvent.clientX - playerRect.left) / playerRect.width) * 100;
        const y = ((pointerEvent.clientY - playerRect.top) / playerRect.height) * 100;
        updateSubtitleStyle({ positionX: x, positionY: y }, shouldPersist);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        updatePositionFromPointer(moveEvent, false);
      };

      const stopDragging = (upEvent: PointerEvent) => {
        updatePositionFromPointer(upEvent, true);
        setIsSubtitleDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);

        try {
          subtitleElement.releasePointerCapture(event.pointerId);
        } catch (err) {}
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
    };

    const subtitleElement = art.template.$subtitle as HTMLElement | undefined;
    subtitleElement?.addEventListener('pointerdown', handleSubtitlePointerDown);

    art.on('subtitleAfterUpdate', () => {
      applySubtitleStyleToArt(subtitleStyleRef.current);
    });

    // 物理进度条分割线绘制
    const updateProgressGaps = () => {
      const duration = art.duration;
      let gapContainer = art.template.$progress.querySelector('.custom-progress-gaps') as HTMLElement;
      const chaptersForGaps = activeChaptersRef.current;

      if (!duration || duration <= 0 || chaptersForGaps.length === 0) {
        if (gapContainer) {
          gapContainer.innerHTML = '';
        }
        return;
      }

      if (gapContainer) {
        gapContainer.innerHTML = '';
      } else {
        gapContainer = document.createElement('div');
        gapContainer.className = 'custom-progress-gaps';
        gapContainer.style.position = 'absolute';
        gapContainer.style.inset = '0';
        gapContainer.style.pointerEvents = 'none';
        gapContainer.style.zIndex = '10';
        art.template.$progress.appendChild(gapContainer);
      }

      chaptersForGaps.forEach(chapter => {
        if (chapter.time <= 0 || chapter.time >= duration) return;
        const pct = (chapter.time / duration) * 100;
        
        const gap = document.createElement('div');
        gap.className = 'progress-gap-line';
        gap.style.left = `${pct}%`;
        
        gapContainer.appendChild(gap);
      });
    };

    progressGapUpdaterRef.current = updateProgressGaps;

    // 进度条 Hover 缩略图增强
    const progressEl = art.template.$progress;
    const tipEl = art.template.$container.querySelector('.art-progress-tip') as HTMLElement;

    const getChapterAtTime = (time: number) => {
      const chaptersForHover = activeChaptersRef.current;
      if (chaptersForHover.length === 0) return null;
      let activeCh = chaptersForHover[0];
      for (const ch of chaptersForHover) {
        if (time >= ch.time) {
          activeCh = ch;
        } else {
          break;
        }
      }
      return activeCh;
    };

    // 初始化按需截帧的后台 Video
    const hiddenVideo = document.createElement('video');
    hiddenVideo.muted = true;
    hiddenVideo.crossOrigin = 'anonymous';
    hiddenVideo.style.display = 'none';

    // 内存帧缓存 Map
    const thumbnailCache = new Map<number, string>();

    // 截帧控制变量
    let isSeeking = false;
    let nextSeekTime: number | null = null;
    let currentHoverKey: number | null = null;
    let debounceTimer: NodeJS.Timeout | null = null;
    let hasShownNextNotice = false; // 控制单次播放提示一次

    const updatePreviewImage = (imgUrl: string) => {
      const thumbContainer = tipEl.querySelector('.custom-tip-thumb-box') as HTMLElement;
      if (thumbContainer) {
        const imgWrapper = thumbContainer.querySelector('.preview-image-wrapper') as HTMLElement;
        if (imgWrapper) {
          imgWrapper.className = 'preview-image-wrapper'; // 移除 skeleton 样式
          imgWrapper.style.background = '#000';
          imgWrapper.innerHTML = `<img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />`;
        }
      }
    };

    const performSeek = (time: number) => {
      if (isSeeking) {
        nextSeekTime = time;
        return;
      }
      isSeeking = true;
      hiddenVideo.currentTime = time;
    };

    const handleHiddenVideoSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 180;
        canvas.height = 101;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          
          const roundedTime = Math.round(hiddenVideo.currentTime);
          thumbnailCache.set(roundedTime, dataUrl);
          
          if (currentHoverKey === roundedTime) {
            updatePreviewImage(dataUrl);
          }
        }
      } catch (err) {
        console.error('Error drawing frame to canvas:', err);
      } finally {
        isSeeking = false;
        if (nextSeekTime !== null) {
          const timeToSeek = nextSeekTime;
          nextSeekTime = null;
          performSeek(timeToSeek);
        }
      }
    };

    hiddenVideo.addEventListener('seeked', handleHiddenVideoSeeked);

    let handleMouseMove: ((e: MouseEvent) => void) | null = null;
    let handleMouseLeave: (() => void) | null = null;
    let handleMouseEnter: (() => void) | null = null;

    if (progressEl && tipEl) {
      handleMouseEnter = () => {
        if (!hiddenVideo.src) {
          hiddenVideo.src = videoUrl;
          hiddenVideo.load();
        }
      };

      handleMouseMove = (e: MouseEvent) => {
        if (art.duration <= 0) return;
        
        const rect = progressEl.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const hoverTime = pct * art.duration;
        const cacheKey = Math.round(hoverTime);
        
        currentHoverKey = cacheKey;

        // 清除 ArtPlayer 原生写入的时间文本节点以防混淆
        Array.from(tipEl.childNodes).forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = '';
          }
        });

        // 格式化时间字符串
        const formatTimeStr = (secs: number) => {
          const h = Math.floor(secs / 3600);
          const m = Math.floor((secs % 3600) / 60);
          const s = Math.floor(secs % 60);
          if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          }
          return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        };
        const timeText = formatTimeStr(hoverTime);

        // 获取当前时间点的章节
        const ch = getChapterAtTime(hoverTime);

        // 创建自定义的预览容器
        let thumbContainer = tipEl.querySelector('.custom-tip-thumb-box') as HTMLElement;
        if (!thumbContainer) {
          thumbContainer = document.createElement('div');
          thumbContainer.className = 'custom-tip-thumb-box';
          thumbContainer.style.position = 'absolute';
          thumbContainer.style.bottom = '-12px';
          thumbContainer.style.left = '50%';
          thumbContainer.style.transform = 'translateX(-50%)';
          thumbContainer.style.display = 'flex';
          thumbContainer.style.flexDirection = 'column';
          thumbContainer.style.alignItems = 'center';
          thumbContainer.style.padding = '6px';
          thumbContainer.style.background = 'rgba(20, 20, 25, 0.85)';
          thumbContainer.style.backdropFilter = 'blur(12px)';
          thumbContainer.style.webkitBackdropFilter = 'blur(12px)';
          thumbContainer.style.borderRadius = '12px';
          thumbContainer.style.overflow = 'hidden';
          thumbContainer.style.border = '1px solid rgba(255,255,255,0.12)';
          thumbContainer.style.boxShadow = '0 8px 32px 0 rgba(0, 0, 0, 0.4)';
          
          tipEl.insertBefore(thumbContainer, tipEl.firstChild);
        }

        const chapterHtml = ch 
          ? `<div style="font-size: 10px; color: #0071E3; font-weight: bold; background: rgba(0,113,227,0.12); padding: 2px 8px; border-radius: 6px; margin-bottom: 4px; max-width: 168px; text-align: center; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${ch.text}
             </div>`
          : '';

        const hasCached = thumbnailCache.has(cacheKey);

        if (hasCached) {
          const imgUrl = thumbnailCache.get(cacheKey)!;
          thumbContainer.innerHTML = `
            <div class="preview-image-wrapper" style="width: 180px; height: 101px; border-radius: 8px; overflow: hidden; position: relative; background: #000;">
              <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
            </div>
            <div style="margin-top: 6px; display: flex; flex-direction: column; align-items: center; gap: 2px;">
              ${chapterHtml}
              <div style="font-size: 11px; color: #fff; font-weight: 700; font-family: monospace; letter-spacing: 0.5px;">${timeText}</div>
            </div>
          `;
        } else {
          // 如果没有当前缓存，尝试保留展示上一张图，但在上方加上骨架屏遮罩；若没有图，显示空骨架屏
          const lastImgElement = thumbContainer.querySelector('img') as HTMLImageElement;
          const lastSrc = lastImgElement ? lastImgElement.src : '';

          if (lastSrc) {
            thumbContainer.innerHTML = `
              <div class="preview-image-wrapper" style="width: 180px; height: 101px; border-radius: 8px; overflow: hidden; position: relative; background: #000;">
                <img src="${lastSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block; filter: brightness(0.6);" />
                <div class="preview-skeleton" style="position: absolute; inset: 0; opacity: 0.35;"></div>
              </div>
              <div style="margin-top: 6px; display: flex; flex-direction: column; align-items: center; gap: 2px;">
                ${chapterHtml}
                <div style="font-size: 11px; color: #fff; font-weight: 700; font-family: monospace; letter-spacing: 0.5px;">${timeText}</div>
              </div>
            `;
          } else {
            thumbContainer.innerHTML = `
              <div class="preview-image-wrapper preview-skeleton" style="width: 180px; height: 101px; border-radius: 8px; overflow: hidden; position: relative; background: rgba(255,255,255,0.08);">
              </div>
              <div style="margin-top: 6px; display: flex; flex-direction: column; align-items: center; gap: 2px;">
                ${chapterHtml}
                <div style="font-size: 11px; color: #fff; font-weight: 700; font-family: monospace; letter-spacing: 0.5px;">${timeText}</div>
              </div>
            `;
          }

          // 触发防抖 seek
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (!hiddenVideo.src) {
              hiddenVideo.src = videoUrl;
              hiddenVideo.load();
            }
            performSeek(hoverTime);
          }, 150);
        }
      };

      handleMouseLeave = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        const thumbContainer = tipEl.querySelector('.custom-tip-thumb-box') as HTMLElement;
        if (thumbContainer) {
          thumbContainer.remove();
        }
      };

      progressEl.addEventListener('mouseenter', handleMouseEnter);
      progressEl.addEventListener('mousemove', handleMouseMove);
      progressEl.addEventListener('mouseleave', handleMouseLeave);
    }

    // 强制无节流直接保存当前播放进度的方法
    const saveProgressForce = () => {
      if (!isProgressLoadedRef.current) return;
      const finalTime = lastTimeRef.current;
      const finalDuration = durationRef.current;
      if (finalTime > 0 && finalDuration > 0) {
        const isFinished = (finalTime >= finalDuration * 0.95) || isInitiallyFinishedRef.current;
        storageService.saveVideoProgress(videoPath, {
          currentTime: finalTime,
          duration: finalDuration,
          isFinished
        });
      }
    };

    // 监听事件
    art.on('ready', () => {
      console.log('ArtPlayer is ready');
      hasShownNextNotice = false;
      storageService.loadData().then(data => {
        const record = data.progress[videoPath];
        isInitiallyFinishedRef.current = record?.isFinished || false;
        if (record && record.currentTime > 0 && record.currentTime < record.duration - 5) {
          art.currentTime = record.currentTime;
          lastTimeRef.current = record.currentTime;
          durationRef.current = record.duration;
          
          // 优雅的进度恢复气泡提醒
          const m = Math.floor(record.currentTime / 60);
          const s = Math.floor(record.currentTime % 60);
          const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          art.notice.show = `已自动恢复上次播放进度至 ${timeStr}`;
        } else {
          lastTimeRef.current = 0;
          durationRef.current = art.duration || 0;
        }
        art.playbackRate = playbackSpeed;

        // 保存当前视频为最后播放的视频
        if (sourceId) {
          storageService.saveLastPlayedVideo(videoPath, videoName, sourceId);
        }

        // 标记为已成功从存储中恢复/读取完进度，允许后续写入保存
        isProgressLoadedRef.current = true;
        setIsArtReady(true);
      });
      updateProgressGaps();
    });

    art.on('video:durationchange', () => {
      if (art.duration > 0) {
        durationRef.current = art.duration;
      }
      updateProgressGaps();
    });

    art.on('resize', () => {
      updateProgressGaps();
    });

    art.on('play', () => {
      if (onPlayStateChange) onPlayStateChange(true);
    });

    art.on('pause', () => {
      if (onPlayStateChange) onPlayStateChange(false);
      saveProgressForce(); // 暂停时立即保存
    });

    // 原生画中画退出时自动聚焦唤醒主程序
    art.on('video:leavepictureinpicture', () => {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.focusMainWindow();
      }
    });

    // 播放器内部通过设置等控制条改变倍速时，同步给 App 状态
    art.on('video:ratechange', () => {
      if (art.playbackRate !== playbackSpeed) {
        onSpeedChange(art.playbackRate);
      }
    });

    art.on('subtitleOffset', (offset: number) => {
      const currentAttachment = subtitleAttachmentRef.current;
      if (!currentAttachment) return;

      const nextAttachment = {
        ...currentAttachment,
        offset: clampSubtitleOffset(offset),
        lastUsedTime: Date.now()
      };
      subtitleAttachmentRef.current = nextAttachment;
      setSubtitleAttachment(nextAttachment);
      storageService.saveSubtitle(videoPath, nextAttachment);
      onSubtitleChange?.();
    });

    // 实时更新当前播放时长并节流写入
    let lastSavedTime = 0;
    let lastSavedRealTime = 0;

    art.on('video:timeupdate', () => {
      if (isUnmounting) return;
      if (!isProgressLoadedRef.current) return;
      const currentTime = art.currentTime;
      const duration = art.duration;
      if (duration > 0) {
        if (currentTime > 0) {
          lastTimeRef.current = currentTime;
        }
        durationRef.current = duration;
        
        if (onTimeUpdate) onTimeUpdate(currentTime, duration);

        // 如果开启了自动连播，且离结束还剩 5 秒以内，提示用户
        if (nextVideoName && duration - currentTime <= 5 && !hasShownNextNotice) {
          hasShownNextNotice = true;
          art.notice.show = `准备自动连播下一个视频：【${nextVideoName}】`;
        }

        // 节流写入：正常播放时每 2 秒保存一次，避免频繁 I/O
        const now = Date.now();
        const timeDiff = Math.abs(currentTime - lastSavedTime);
        const realTimeDiff = now - lastSavedRealTime;
        const isFinished = (currentTime >= duration * 0.95) || isInitiallyFinishedRef.current;

        if (isFinished || timeDiff >= 2 || realTimeDiff >= 2000) {
          lastSavedTime = currentTime;
          lastSavedRealTime = now;
          storageService.saveVideoProgress(videoPath, {
            currentTime,
            duration,
            isFinished
          });
        }
      }
    });

    art.on('video:ended', () => {
      if (onPlayStateChange) onPlayStateChange(false);
      if (!isProgressLoadedRef.current) return;
      
      // 标记为看毕
      storageService.saveVideoProgress(videoPath, {
        currentTime: art.duration,
        duration: art.duration,
        isFinished: true
      });
      
      if (onEnded) onEnded();
    });

    // 失去/重新获得焦点自动暂停与恢复
    const handleWindowBlur = () => {
      if (!pauseOnBlur) return;

      if (art && art.playing) {
        wasPlayingBeforeBlur.current = true;
        art.pause();
        saveProgressForce(); // 失去焦点暂停并强制保存
      } else {
        wasPlayingBeforeBlur.current = false;
      }
    };

    const handleWindowFocus = () => {
      if (!pauseOnBlur) return;

      if (wasPlayingBeforeBlur.current && art) {
        art.play().catch(err => console.warn('Auto-resume failed on window focus:', err));
        wasPlayingBeforeBlur.current = false;
      }
    };

    // 监听窗口关闭/刷新事件，防止数据丢失
    const handleBeforeUnload = () => {
      saveProgressForce();
    };

    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isUnmounting = true;

      // 强制在卸载前同步执行一次最高精度的落盘，使用 lastTimeRef.current 彻底避免 DOM 重置为 0 的问题
      saveProgressForce();

      // 如果当前处于画中画状态，退出画中画，避免切换视频时遗留冻结旧窗口
      try {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(e => console.warn('Failed to exit PiP on unmount:', e));
        }
      } catch (e) {
        console.warn('PiP exit error:', e);
      }

      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (handleMouseMove && progressEl) {
        progressEl.removeEventListener('mousemove', handleMouseMove);
      }
      if (handleMouseLeave && progressEl) {
        progressEl.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (handleMouseEnter && progressEl) {
        progressEl.removeEventListener('mouseenter', handleMouseEnter);
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (progressGapUpdaterRef.current === updateProgressGaps) {
        progressGapUpdaterRef.current = null;
      }
      hiddenVideo.removeEventListener('seeked', handleHiddenVideoSeeked);
      hiddenVideo.src = '';
      try {
        hiddenVideo.load();
      } catch (e) {}

      subtitleElement?.removeEventListener('pointerdown', handleSubtitlePointerDown);
      setSubtitleToolbarHost(null);
      setPlayerTitleHost(null);
      toolbarHost.remove();
      titleHost.remove();
      
      if (art) {
        art.destroy(true);
      }
      playerInstanceRef.current = null;
      setIsArtReady(false);
    };
  }, [videoUrl, videoPath, sourceId, nextVideoName]);

  // 1.1 读取当前视频已保存的外部字幕配置；无记录时自动匹配同目录字幕
  useEffect(() => {
    let cancelled = false;

    setSubtitleAttachment(null);
    subtitleAttachmentRef.current = null;
    setSubtitleUrl('');
    setSubtitleError('');
    setIsSubtitleStylePanelOpen(false);

    storageService.loadData().then(async data => {
      const savedSubtitle = data.subtitles?.[videoPath];
      const globalSubtitleStyle = normalizeSubtitleStyle(data.settings.subtitleStyle);
      subtitleStyleRef.current = globalSubtitleStyle;
      if (!cancelled) {
        setSubtitleStyle(globalSubtitleStyle);
      }

      const api = (window as any).electronAPI;
      if (!api?.getSubtitleUrl) {
        if (!cancelled && savedSubtitle?.enabled) setSubtitleError('当前环境不支持本地字幕');
        return;
      }

      try {
        let nextAttachment: SubtitleAttachment | null = null;
        let shouldPersist = false;
        let shouldNotifyChange = false;
        let noticeText = '';

        if (savedSubtitle) {
          const { style: legacyStyle, ...subtitleWithoutLegacyStyle } = savedSubtitle;
          nextAttachment = {
            ...subtitleWithoutLegacyStyle,
            offset: clampSubtitleOffset(savedSubtitle.offset ?? 0)
          };
          shouldPersist = Boolean(legacyStyle) || savedSubtitle.offset !== nextAttachment.offset;
        } else if (api.findSubtitleForVideo) {
          const matchedSubtitlePath = await api.findSubtitleForVideo(videoPath);
          if (matchedSubtitlePath) {
            nextAttachment = createSubtitleAttachment(matchedSubtitlePath, { autoMatched: true });
            shouldPersist = true;
            shouldNotifyChange = true;
            noticeText = `已自动匹配字幕：${nextAttachment.name}`;
          }
        }

        if (!nextAttachment) return;

        const url = await api.getSubtitleUrl(nextAttachment.path);
        if (!url) {
          throw new Error('Subtitle file is unavailable');
        }
        if (cancelled) return;

        subtitleAttachmentRef.current = nextAttachment;
        setSubtitleAttachment(nextAttachment);
        setSubtitleUrl(url);
        if (shouldPersist) {
          await storageService.saveSubtitle(videoPath, nextAttachment);
        }
        if (shouldNotifyChange) {
          onSubtitleChange?.();
        }
        if (noticeText && playerInstanceRef.current) {
          playerInstanceRef.current.notice.show = noticeText;
        }
      } catch (err) {
        console.warn('Failed to restore subtitle:', err);
        if (!cancelled) {
          subtitleAttachmentRef.current = null;
          setSubtitleAttachment(null);
          setSubtitleUrl('');
          if (savedSubtitle) {
            await storageService.deleteSubtitle(videoPath);
            onSubtitleChange?.();
          }
          setSubtitleError('字幕文件读取失败');
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  // 1.2 将字幕配置应用到 ArtPlayer
  useEffect(() => {
    const art = playerInstanceRef.current;
    if (!isArtReady || !art) return;

    if (!subtitleAttachment || !subtitleUrl || !subtitleAttachment.enabled) {
      try {
        art.subtitle.show = false;
      } catch (err) {
        console.warn('Failed to hide subtitle:', err);
      }
      return;
    }

    let cancelled = false;

    const subtitleForPlayer = {
      ...subtitleAttachment,
      style: subtitleStyleRef.current
    };

    art.subtitle.init(buildArtPlayerSubtitleOption(subtitleForPlayer, subtitleUrl)).then(() => {
      if (cancelled) return;
      art.subtitle.show = true;
      art.subtitleOffset = clampSubtitleOffset(subtitleAttachment.offset);
      applySubtitleStyleToArt(subtitleStyleRef.current);
      setSubtitleError('');
    }).catch(err => {
      console.error('Failed to load subtitle:', err);
      if (!cancelled) {
        art.subtitle.show = false;
        subtitleAttachmentRef.current = null;
        setSubtitleAttachment(null);
        setSubtitleUrl('');
        storageService.deleteSubtitle(videoPath).then(() => {
          onSubtitleChange?.();
        });
        setSubtitleError('字幕加载失败');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    isArtReady,
    subtitleUrl,
    subtitleAttachment?.path,
    subtitleAttachment?.name,
    subtitleAttachment?.type,
    subtitleAttachment?.encoding,
    subtitleAttachment?.enabled,
    subtitleReloadSignal
  ]);

  // 1.3 字幕偏移变化只更新 offset，不重新加载字幕文件
  useEffect(() => {
    const art = playerInstanceRef.current;
    if (!isArtReady || !art || !subtitleAttachment || !subtitleUrl || !subtitleAttachment.enabled) return;
    art.subtitleOffset = clampSubtitleOffset(subtitleAttachment.offset || 0);
  }, [isArtReady, subtitleAttachment?.offset, subtitleAttachment?.enabled, subtitleUrl]);

  // 1.4 字幕样式变化只更新 DOM，不重新加载字幕文件
  useEffect(() => {
    if (!isArtReady || !subtitleAttachment || !subtitleAttachment.enabled) return;
    applySubtitleStyleToArt(subtitleStyle);
  }, [
    isArtReady,
    subtitleAttachment?.enabled,
    subtitleStyle.fontSize,
    subtitleStyle.textColor,
    subtitleStyle.backgroundColor,
    subtitleStyle.backgroundOpacity,
    subtitleStyle.positionX,
    subtitleStyle.positionY
  ]);

  // 2. 同步外部倍速状态变化到播放器
  useEffect(() => {
    if (playerInstanceRef.current) {
      if (playerInstanceRef.current.playbackRate !== playbackSpeed) {
        playerInstanceRef.current.playbackRate = playbackSpeed;
      }
    }
  }, [playbackSpeed]);

  // 新增：监听外部跳转信号
  useEffect(() => {
    if (seekSignal && playerInstanceRef.current) {
      playerInstanceRef.current.currentTime = seekSignal.seconds;
      playerInstanceRef.current.notice.show = `跳转章节: ${seekSignal.seconds} 秒`;
    }
  }, [seekSignal]);

  // 新增：同步外部的手动标记已学完/未学完状态变化
  useEffect(() => {
    isInitiallyFinishedRef.current = isFinished;
  }, [isFinished]);

  // 3. 监听全局自定义快捷键（排除输入法和表单聚焦状态）
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const art = playerInstanceRef.current;
      if (!art) return;

      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT'
      )) {
        return;
      }

      const pressedHotkey = getEventHotkeyString(e);
      if (!pressedHotkey) return;

      const fullscreenKey = (hotkeys?.fullscreen || 'f').toLowerCase();
      const speedUpKey = (hotkeys?.speedUp || 'c').toLowerCase();
      const speedDownKey = (hotkeys?.speedDown || 'x').toLowerCase();
      const speedResetKey = (hotkeys?.speedReset || 'z').toLowerCase();

      if (pressedHotkey === fullscreenKey) {
        e.preventDefault();
        art.fullscreen = !art.fullscreen;
      } else if (pressedHotkey === speedUpKey) {
        e.preventDefault();
        const nextSpeed = Math.min(4.0, Math.round((playbackSpeed + 0.1) * 100) / 100);
        onSpeedChange(nextSpeed);
        art.notice.show = `倍速: ${nextSpeed}x`;
      } else if (pressedHotkey === speedDownKey) {
        e.preventDefault();
        const nextSpeed = Math.max(0.1, Math.round((playbackSpeed - 0.1) * 100) / 100);
        onSpeedChange(nextSpeed);
        art.notice.show = `倍速: ${nextSpeed}x`;
      } else if (pressedHotkey === speedResetKey) {
        e.preventDefault();
        onSpeedChange(1.0);
        art.notice.show = `倍速: 1.0x`;
      } else if (pressedHotkey === 'space') {
        e.preventDefault();
        if (art.playing) {
          art.pause();
        } else {
          art.play();
        }
      } else if (pressedHotkey === 'arrowleft') {
        e.preventDefault();
        const targetTime = Math.max(0, art.currentTime - 5);
        art.currentTime = targetTime;
        art.notice.show = `快退: -5s`;
      } else if (pressedHotkey === 'arrowright') {
        e.preventDefault();
        const targetTime = Math.min(art.duration, art.currentTime + 5);
        art.currentTime = targetTime;
        art.notice.show = `快进: +5s`;
      } else if (pressedHotkey === 'arrowup') {
        e.preventDefault();
        const targetVol = Math.min(1, art.volume + 0.1);
        art.volume = targetVol;
        art.notice.show = `音量: ${Math.round(targetVol * 100)}%`;
      } else if (pressedHotkey === 'arrowdown') {
        e.preventDefault();
        const targetVol = Math.max(0, art.volume - 0.1);
        art.volume = targetVol;
        art.notice.show = `音量: ${Math.round(targetVol * 100)}%`;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [playbackSpeed, hotkeys, onSpeedChange]);

  // 4. 当外部改变播放器状态（例如触发挂机闲置暂停时，或延迟连播自动唤醒时）
  useEffect(() => {
    const handlePauseSignal = () => {
      if (playerInstanceRef.current && playerInstanceRef.current.playing) {
        playerInstanceRef.current.pause();
      }
    };
    const handlePlaySignal = () => {
      if (playerInstanceRef.current && !playerInstanceRef.current.playing) {
        playerInstanceRef.current.play().catch(err => console.warn('Play signal failed:', err));
      }
    };
    
    window.addEventListener('player:pause-signal', handlePauseSignal);
    window.addEventListener('player:play-signal', handlePlaySignal);
    return () => {
      window.removeEventListener('player:pause-signal', handlePauseSignal);
      window.removeEventListener('player:play-signal', handlePlaySignal);
    };
  }, []);

  const waitForUiYield = () => new Promise<void>(resolve => {
    window.setTimeout(resolve, 0);
  });

  const batchAttachSubtitlesFromDirectory = async (selectedSubtitlePath: string) => {
    const api = (window as any).electronAPI;
    if (!api?.findSubtitleMatchesInDirectory) return;

    try {
      const data = await storageService.loadData();
      const existingVideoPaths = Object.keys(data.subtitles || {});
      const matches: SubtitleBatchMatch[] = await api.findSubtitleMatchesInDirectory(
        videoPath,
        selectedSubtitlePath,
        existingVideoPaths
      );
      const autoMatches = matches.filter(match => match.videoPath !== videoPath);
      if (autoMatches.length === 0) return;

      const chunkSize = 40;
      let attachedCount = 0;

      for (let index = 0; index < autoMatches.length; index += chunkSize) {
        const chunk = autoMatches.slice(index, index + chunkSize);
        const latestData = await storageService.loadData();
        const nextSubtitles = { ...(latestData.subtitles || {}) };
        let changed = false;

        chunk.forEach(match => {
          if (nextSubtitles[match.videoPath]?.path) return;
          try {
            nextSubtitles[match.videoPath] = createSubtitleAttachment(match.subtitlePath, {
              autoMatched: true,
              enabled: true
            });
            attachedCount += 1;
            changed = true;
          } catch (err) {
            console.warn('Failed to create auto matched subtitle attachment:', err);
          }
        });

        if (changed) {
          await storageService.saveData({ subtitles: nextSubtitles });
        }

        await waitForUiYield();
      }

      if (attachedCount > 0) {
        onSubtitleChange?.();
        const art = playerInstanceRef.current;
        if (art) {
          art.notice.show = `已自动挂载 ${attachedCount} 个同目录字幕`;
        }
      }
    } catch (err) {
      console.warn('Failed to batch attach subtitles:', err);
    }
  };

  const handleSelectSubtitle = async () => {
    const api = (window as any).electronAPI;
    if (!api?.selectSubtitleFile || !api?.getSubtitleUrl) {
      setSubtitleError('当前环境不支持本地字幕');
      return;
    }

    setIsSubtitleLoading(true);
    setSubtitleError('');

    try {
      const subtitlePath = await api.selectSubtitleFile();
      if (!subtitlePath) return;

      const nextAttachment = createSubtitleAttachment(subtitlePath);
      const nextUrl = await api.getSubtitleUrl(subtitlePath);
      if (!nextUrl) {
        throw new Error('Subtitle file is unavailable');
      }

      setSubtitleUrl(nextUrl);
      await persistSubtitleAttachment(nextAttachment, true);
      void batchAttachSubtitlesFromDirectory(subtitlePath);

      if (playerInstanceRef.current) {
        playerInstanceRef.current.notice.show = `已加载字幕：${nextAttachment.name}`;
      }
    } catch (err) {
      console.error('Failed to select subtitle:', err);
      setSubtitleError('字幕选择失败');
    } finally {
      setIsSubtitleLoading(false);
    }
  };

  const handleToggleSubtitleEnabled = async () => {
    if (!subtitleAttachment) return;

    const nextEnabled = !subtitleAttachment.enabled;
    const api = (window as any).electronAPI;

    if (nextEnabled && !subtitleUrl) {
      if (!api?.getSubtitleUrl) {
        setSubtitleError('当前环境不支持本地字幕');
        return;
      }

      try {
        const nextUrl = await api.getSubtitleUrl(subtitleAttachment.path);
        if (!nextUrl) {
          throw new Error('Subtitle file is unavailable');
        }
        setSubtitleUrl(nextUrl);
      } catch (err) {
        console.error('Failed to enable subtitle:', err);
        subtitleAttachmentRef.current = null;
        setSubtitleAttachment(null);
        setSubtitleUrl('');
        await storageService.deleteSubtitle(videoPath);
        onSubtitleChange?.();
        setSubtitleError('字幕打开失败');
        return;
      }
    }

    const nextAttachment = {
      ...subtitleAttachment,
      enabled: nextEnabled,
      lastUsedTime: Date.now()
    };

    if (!nextEnabled) {
      setIsSubtitleStylePanelOpen(false);
      const art = playerInstanceRef.current;
      if (art) {
        art.subtitle.show = false;
      }
    }

    await persistSubtitleAttachment(nextAttachment, true);

    const art = playerInstanceRef.current;
    if (art) {
      art.notice.show = nextEnabled ? '字幕已打开' : '字幕已关闭';
    }
  };

  const handleClearSubtitle = async () => {
    subtitleAttachmentRef.current = null;
    setSubtitleAttachment(null);
    setSubtitleUrl('');
    setSubtitleError('');
    setIsSubtitleStylePanelOpen(false);
    await storageService.deleteSubtitle(videoPath);
    onSubtitleChange?.();

    const art = playerInstanceRef.current;
    if (art) {
      art.subtitle.show = false;
      art.notice.show = '已移除字幕';
    }
  };

  const handleChangeSubtitleOffset = async (deltaSeconds: number) => {
    if (!subtitleAttachment) return;

    const nextOffset = stepSubtitleOffset(subtitleAttachment.offset || 0, deltaSeconds);
    const nextAttachment = {
      ...subtitleAttachment,
      offset: nextOffset,
      lastUsedTime: Date.now()
    };

    const art = playerInstanceRef.current;
    if (art) {
      art.subtitleOffset = nextOffset;
      art.notice.show = `字幕偏移：${formatSubtitleOffset(nextOffset)}`;
    }

    await persistSubtitleAttachment(nextAttachment, true);
  };

  const handleResetSubtitleOffset = async () => {
    if (!subtitleAttachment) return;

    const nextAttachment = {
      ...subtitleAttachment,
      offset: 0,
      lastUsedTime: Date.now()
    };

    const art = playerInstanceRef.current;
    if (art) {
      art.subtitleOffset = 0;
      art.notice.show = '字幕偏移已重置';
    }

    await persistSubtitleAttachment(nextAttachment, true);
  };

  const currentSubtitleStyle = subtitleStyle;
  const textColorOptions = ['#ffffff', '#ffd700', '#00d4ff'];
  const backgroundColorOptions = ['#000000', '#101820', '#172554', '#7f1d1d'];

  const playerTitle = (
    <div className="custom-player-title-root" title={videoName}>
      {videoName}
    </div>
  );

  const subtitleToolbar = (
    <div className="custom-subtitle-toolbar-root relative flex max-w-[calc(100vw-24px)] flex-col items-start gap-2">
      <div className={`flex max-w-full items-center gap-1 rounded-md border border-white/10 bg-black/55 px-1.5 py-1 text-white shadow-lg backdrop-blur-md ${isSubtitleDragging ? 'ring-2 ring-primary/70' : ''}`}>
        <button
          type="button"
          onClick={handleSelectSubtitle}
          disabled={isSubtitleLoading}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          title="选择字幕文件"
          aria-label="选择字幕文件"
        >
          <FilePlus2 size={16} />
        </button>

        {subtitleAttachment && (
          <>
            <button
              type="button"
              onClick={handleToggleSubtitleEnabled}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-white/15 ${
                subtitleAttachment.enabled ? 'bg-primary/20 text-primary' : 'text-white/50'
              }`}
              title={subtitleAttachment.enabled ? '关闭字幕' : '打开字幕'}
              aria-label={subtitleAttachment.enabled ? '关闭字幕' : '打开字幕'}
            >
              <Captions size={16} />
            </button>
            <div
              className={`hidden max-w-[180px] items-center gap-1.5 truncate px-1 text-xs font-medium sm:flex ${
                subtitleAttachment.enabled ? 'text-white/85' : 'text-white/50'
              }`}
              title={subtitleAttachment.name}
            >
              <Captions size={15} className="shrink-0 text-white/70" />
              <span className="truncate">{subtitleAttachment.name}</span>
            </div>
            {subtitleAttachment.enabled && (
              <>
                <button
                  type="button"
                  onClick={() => handleChangeSubtitleOffset(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15"
                  title="字幕提前 1 秒"
                  aria-label="字幕提前 1 秒"
                >
                  <ChevronLeft size={17} />
                </button>
                <span
                  className="min-w-10 text-center text-xs font-semibold tabular-nums text-white/85"
                  title="当前字幕偏移"
                >
                  {formatSubtitleOffset(subtitleAttachment.offset || 0)}
                </span>
                <button
                  type="button"
                  onClick={() => handleChangeSubtitleOffset(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15"
                  title="字幕延后 1 秒"
                  aria-label="字幕延后 1 秒"
                >
                  <ChevronRight size={17} />
                </button>
                <button
                  type="button"
                  onClick={handleResetSubtitleOffset}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15"
                  title="重置字幕偏移"
                  aria-label="重置字幕偏移"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsSubtitleStylePanelOpen(open => !open)}
                  className={`flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15 ${
                    isSubtitleStylePanelOpen ? 'bg-white/15 text-white' : ''
                  }`}
                  title="字幕样式"
                  aria-label="字幕样式"
                >
                  <SlidersHorizontal size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleClearSubtitle}
              className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15"
              title="移除字幕"
              aria-label="移除字幕"
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>
      {subtitleAttachment?.enabled && isSubtitleStylePanelOpen && (
        <div className="w-[270px] rounded-lg border border-white/10 bg-black/75 p-3 text-white shadow-xl backdrop-blur-xl">
          <div className="space-y-3">
            <label className="block text-[11px] font-semibold text-white/75">
              <span className="mb-1 flex items-center justify-between">
                <span>字号</span>
                <span className="tabular-nums">{currentSubtitleStyle.fontSize}px</span>
              </span>
              <input
                type="range"
                min={MIN_SUBTITLE_FONT_SIZE}
                max={MAX_SUBTITLE_FONT_SIZE}
                step={1}
                value={currentSubtitleStyle.fontSize}
                onChange={event => updateSubtitleStyle({ fontSize: Number(event.target.value) })}
                className="w-full accent-primary"
              />
            </label>

            <label className="block text-[11px] font-semibold text-white/75">
              <span className="mb-1 flex items-center justify-between">
                <span>透明度</span>
                <span className="tabular-nums">{Math.round(currentSubtitleStyle.backgroundOpacity * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={currentSubtitleStyle.backgroundOpacity}
                onChange={event => updateSubtitleStyle({ backgroundOpacity: Number(event.target.value) })}
                className="w-full accent-primary"
              />
            </label>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-white/75">文字</span>
              <div className="flex gap-1.5">
                {textColorOptions.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => updateSubtitleStyle({ textColor: color })}
                    className={`h-6 w-6 rounded-full border transition ${
                      currentSubtitleStyle.textColor === color ? 'border-primary ring-2 ring-primary/40' : 'border-white/25'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={`文字颜色 ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-white/75">背景</span>
              <div className="flex gap-1.5">
                {backgroundColorOptions.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => updateSubtitleStyle({ backgroundColor: color })}
                    className={`h-6 w-6 rounded-full border transition ${
                      currentSubtitleStyle.backgroundColor === color ? 'border-primary ring-2 ring-primary/40' : 'border-white/25'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={`背景颜色 ${color}`}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={resetSubtitleStyle}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-white/10 text-[11px] font-bold text-white/85 transition hover:bg-white/15"
            >
              <RotateCcw size={13} />
              重置
            </button>
          </div>
        </div>
      )}
      {subtitleError && (
        <div className="max-w-[260px] rounded-md border border-red-400/30 bg-red-950/80 px-3 py-2 text-xs text-red-50 shadow-lg backdrop-blur-md">
          {subtitleError}
        </div>
      )}
    </div>
  );

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-lg border border-black/5 bg-[#000000]">
      <div ref={artRef} className="w-full h-full" />
      {playerTitleHost ? createPortal(playerTitle, playerTitleHost) : null}
      {subtitleToolbarHost ? createPortal(subtitleToolbar, subtitleToolbarHost) : null}
    </div>
  );
}
