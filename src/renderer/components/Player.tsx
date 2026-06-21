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
        gap.style.position = 'absolute';
        gap.style.left = `${pct}%`;
        gap.style.top = '0';
        gap.style.bottom = '0';
        gap.style.width = '2px';
        gap.style.backgroundColor = '#000000'; // 用播放器背景色切断
        gap.style.transform = 'translateX(-50%)';
        
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

    let handleMouseMove: ((e: MouseEvent) => void) | null = null;
    let handleMouseLeave: (() => void) | null = null;

    if (progressEl && tipEl) {
      handleMouseMove = (e: MouseEvent) => {
        if (!activeChapters || activeChapters.length === 0 || art.duration <= 0) return;
        
        const rect = progressEl.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const hoverTime = pct * art.duration;
        
        const ch = getChapterAtTime(hoverTime);
        if (!ch) return;

        let streamOrigin = '';
        try {
          streamOrigin = new URL(videoUrl).origin;
        } catch (err) {}

        const thumbUrl = streamOrigin
          ? `${streamOrigin}/thumbnail?videoPath=${encodeURIComponent(videoPath)}&time=${ch.time}`
          : '';

        let thumbContainer = tipEl.querySelector('.custom-tip-thumb-box') as HTMLElement;
        if (!thumbContainer) {
          thumbContainer = document.createElement('div');
          thumbContainer.className = 'custom-tip-thumb-box';
          thumbContainer.style.display = 'flex';
          thumbContainer.style.flexDirection = 'column';
          thumbContainer.style.alignItems = 'center';
          thumbContainer.style.gap = '4px';
          thumbContainer.style.marginBottom = '6px';
          thumbContainer.style.padding = '2px';
          thumbContainer.style.backgroundColor = 'rgba(0,0,0,0.85)';
          thumbContainer.style.borderRadius = '8px';
          thumbContainer.style.overflow = 'hidden';
          thumbContainer.style.border = '1px solid rgba(255,255,255,0.15)';
          
          tipEl.insertBefore(thumbContainer, tipEl.firstChild);
        }

        thumbContainer.innerHTML = `
          <img src="${thumbUrl}" style="width: 120px; height: 68px; object-fit: cover; border-radius: 6px; display: block;" onerror="this.style.display='none'" />
          <div style="font-size: 9px; color: #fff; max-width: 120px; text-align: center; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px 0 4px; line-height: 1.2;">
            ${ch.text}
          </div>
        `;
      };

      handleMouseLeave = () => {
        const thumbContainer = tipEl.querySelector('.custom-tip-thumb-box') as HTMLElement;
        if (thumbContainer) {
          thumbContainer.remove();
        }
      };

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
      if (handleMouseMove && progressEl) {
        progressEl.removeEventListener('mousemove', handleMouseMove);
      }
      if (handleMouseLeave && progressEl) {
        progressEl.removeEventListener('mouseleave', handleMouseLeave);
      }
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
