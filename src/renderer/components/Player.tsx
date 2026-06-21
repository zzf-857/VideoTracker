import React, { useEffect, useRef } from 'react';
import Artplayer from 'artplayer';
import { storageService, VideoProgress } from '../services/storage';

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
  seekSignal
}: PlayerProps) {
  const artRef = useRef<HTMLDivElement>(null);
  const playerInstanceRef = useRef<Artplayer | null>(null);

  // 1. 初始化和销毁 ArtPlayer
  useEffect(() => {
    if (!artRef.current) return;

    let isUnmounting = false;

    // 格式化 highlight
    const highlight = activeChapters.map(c => ({
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

    // 物理进度条分割线绘制
    const updateProgressGaps = () => {
      const duration = art.duration;
      if (!duration || duration <= 0 || !activeChapters || activeChapters.length === 0) return;
      
      let gapContainer = art.template.$progress.querySelector('.custom-progress-gaps') as HTMLElement;
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

      activeChapters.forEach(chapter => {
        if (chapter.time <= 0 || chapter.time >= duration) return;
        const pct = (chapter.time / duration) * 100;
        
        const gap = document.createElement('div');
        gap.className = 'progress-gap-line';
        gap.style.left = `${pct}%`;
        
        gapContainer.appendChild(gap);
      });
    };

    // 进度条 Hover 缩略图增强
    const progressEl = art.template.$progress;
    const tipEl = art.template.$container.querySelector('.art-progress-tip') as HTMLElement;

    const getChapterAtTime = (time: number) => {
      if (!activeChapters || activeChapters.length === 0) return null;
      let activeCh = activeChapters[0];
      for (const ch of activeChapters) {
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

    // 加载进度
    storageService.loadData().then(data => {
      const record = data.progress[videoPath];
      if (record && record.currentTime > 0 && record.currentTime < record.duration - 5) {
        art.currentTime = record.currentTime;
      }
      // 初始化播放器倍速为外部倍速
      art.playbackRate = playbackSpeed;
    });

    // 监听事件
    art.on('ready', () => {
      console.log('ArtPlayer is ready');
      updateProgressGaps();
    });

    art.on('video:durationchange', () => {
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

    // 实时更新当前播放时长
    art.on('video:timeupdate', () => {
      if (isUnmounting) return;
      const currentTime = art.currentTime;
      const duration = art.duration;
      if (duration > 0) {
        if (onTimeUpdate) onTimeUpdate(currentTime, duration);

        // 实时保存播放进度 (每隔 3 秒自动保存一次到本地 Cache，避免频繁 I/O)
        const isFinished = currentTime >= duration * 0.95; // 播放到 95% 即认为看完了
        storageService.saveVideoProgress(videoPath, {
          currentTime,
          duration,
          isFinished
        });
      }
    });

    art.on('video:ended', () => {
      if (onPlayStateChange) onPlayStateChange(false);
      
      // 标记为看毕
      storageService.saveVideoProgress(videoPath, {
        currentTime: art.duration,
        duration: art.duration,
        isFinished: true
      });
      
      if (onEnded) onEnded();
    });

    return () => {
      isUnmounting = true;

      // 强制在卸载前同步执行一次最高精度的落盘，防止 timeupdate 遗漏或被销毁覆写为 0
      if (art && art.currentTime > 0 && art.duration > 0) {
        const isFinished = art.currentTime >= art.duration * 0.95;
        storageService.saveVideoProgress(videoPath, {
          currentTime: art.currentTime,
          duration: art.duration,
          isFinished
        });
      }

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
      hiddenVideo.removeEventListener('seeked', handleHiddenVideoSeeked);
      hiddenVideo.src = '';
      try {
        hiddenVideo.load();
      } catch (e) {}
      
      if (art) {
        art.destroy(true);
      }
      playerInstanceRef.current = null;
    };
  }, [videoUrl, videoPath, activeChapters]);

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

  // 3. 监听全局自定义快捷键（排除输入法和表单聚焦状态）
  useEffect(() => {
    const art = playerInstanceRef.current;
    if (!art) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT'
      )) {
        return;
      }

      let key = e.key.toLowerCase();
      if (e.key === ' ') {
        key = 'space';
      }
      const fullscreenKey = (hotkeys?.fullscreen || 'f').toLowerCase();
      const speedUpKey = (hotkeys?.speedUp || 'c').toLowerCase();
      const speedDownKey = (hotkeys?.speedDown || 'x').toLowerCase();
      const speedResetKey = (hotkeys?.speedReset || 'z').toLowerCase();

      if (key === fullscreenKey) {
        e.preventDefault();
        art.fullscreen = !art.fullscreen;
      } else if (key === speedUpKey) {
        e.preventDefault();
        const nextSpeed = Math.min(4.0, Math.round((playbackSpeed + 0.1) * 100) / 100);
        onSpeedChange(nextSpeed);
        art.notice.show = `倍速: ${nextSpeed}x`;
      } else if (key === speedDownKey) {
        e.preventDefault();
        const nextSpeed = Math.max(0.1, Math.round((playbackSpeed - 0.1) * 100) / 100);
        onSpeedChange(nextSpeed);
        art.notice.show = `倍速: ${nextSpeed}x`;
      } else if (key === speedResetKey) {
        e.preventDefault();
        onSpeedChange(1.0);
        art.notice.show = `倍速: 1.0x`;
      } else if (key === 'space') {
        e.preventDefault();
        if (art.playing) {
          art.pause();
        } else {
          art.play();
        }
      } else if (key === 'arrowleft') {
        e.preventDefault();
        const targetTime = Math.max(0, art.currentTime - 5);
        art.currentTime = targetTime;
        art.notice.show = `快退: -5s`;
      } else if (key === 'arrowright') {
        e.preventDefault();
        const targetTime = Math.min(art.duration, art.currentTime + 5);
        art.currentTime = targetTime;
        art.notice.show = `快进: +5s`;
      } else if (key === 'arrowup') {
        e.preventDefault();
        const targetVol = Math.min(1, art.volume + 0.1);
        art.volume = targetVol;
        art.notice.show = `音量: ${Math.round(targetVol * 100)}%`;
      } else if (key === 'arrowdown') {
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

  // 4. 当外部改变播放器状态（例如触发挂机闲置暂停时）
  useEffect(() => {
    const handlePauseSignal = () => {
      if (playerInstanceRef.current && playerInstanceRef.current.playing) {
        playerInstanceRef.current.pause();
      }
    };
    
    window.dispatchEvent(new CustomEvent('player:pause-signal'));
    window.addEventListener('player:pause-signal', handlePauseSignal);
    return () => {
      window.removeEventListener('player:pause-signal', handlePauseSignal);
    };
  }, []);

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden shadow-lg border border-black/5 bg-[#000000]">
      <div ref={artRef} className="w-full h-full" />
    </div>
  );
}
