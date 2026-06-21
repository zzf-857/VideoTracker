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
  onEnded
}: PlayerProps) {
  const artRef = useRef<HTMLDivElement>(null);
  const playerInstanceRef = useRef<Artplayer | null>(null);

  // 1. 初始化和销毁 ArtPlayer
  useEffect(() => {
    if (!artRef.current) return;

    // 初始化 ArtPlayer
    const art = new Artplayer({
      container: artRef.current,
      url: videoUrl,
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
      hotkey: false, // 禁用 ArtPlayer 默认自带的快捷键，防止与自定义热键重复触发冲突
    });

    playerInstanceRef.current = art;

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
    });

    art.on('play', () => {
      if (onPlayStateChange) onPlayStateChange(true);
    });

    art.on('pause', () => {
      if (onPlayStateChange) onPlayStateChange(false);
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
      if (art) {
        art.destroy(true);
      }
      playerInstanceRef.current = null;
    };
  }, [videoUrl, videoPath]);

  // 2. 同步外部倍速状态变化到播放器
  useEffect(() => {
    if (playerInstanceRef.current) {
      if (playerInstanceRef.current.playbackRate !== playbackSpeed) {
        playerInstanceRef.current.playbackRate = playbackSpeed;
      }
    }
  }, [playbackSpeed]);

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
