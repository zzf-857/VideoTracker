import React, { useEffect, useRef, useState } from 'react';
import { storageService } from '../services/storage';
import { useTimer } from '../hooks/useTimer';

export default function PipPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // 从 URL 读取参数
  const getParam = (name: string) => {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  };

  const videoUrl = decodeURIComponent(getParam('videoUrl'));
  const videoPath = decodeURIComponent(getParam('videoPath'));
  const videoName = decodeURIComponent(getParam('videoName'));
  const startSeconds = parseFloat(getParam('currentTime')) || 0;

  // 1. 初始化视频播放位置
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.src = videoUrl;
    video.currentTime = startSeconds;
    video.volume = volume;
    
    // 自动播放
    video.play().catch(e => console.log('Autoplay blocked:', e));
  }, [videoUrl]);

  // 2. 使用计时器 hook 同步今日学习时长！将超时时间设为极大以实际上免除挂机判定
  const { sessionSeconds } = useTimer({
    videoPath,
    videoName,
    isPlaying,
    idleTimeoutMinutes: 60, 
    onIdleTimeout: () => {}
  });

  // 3. 实时更新进度存入本地存储
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    const dur = video.duration || 0;
    setDuration(dur);

    if (dur > 0) {
      const isFinished = video.currentTime >= dur * 0.95;
      storageService.saveVideoProgress(videoPath, {
        currentTime: video.currentTime,
        duration: dur,
        isFinished
      });
    }
  };

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleEnded = () => {
    setIsPlaying(false);
    // 标记为看毕
    const dur = videoRef.current?.duration || 0;
    if (dur > 0) {
      storageService.saveVideoProgress(videoPath, {
        currentTime: dur,
        duration: dur,
        isFinished: true
      });
    }
  };

  // 控制条自动隐藏
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isPlaying && showControls) {
      timeout = setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
    return () => clearTimeout(timeout);
  }, [isPlaying, showControls]);

  // 鼠标移动显示控制栏
  const handleMouseMove = () => {
    setShowControls(true);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const handleToggleAlwaysOnTop = () => {
    const nextState = !alwaysOnTop;
    setAlwaysOnTop(nextState);
    if ((window as any).electronAPI) {
      (window as any).electronAPI.setPipAlwaysOnTop(nextState);
    }
  };

  const handleClose = () => {
    if ((window as any).electronAPI) {
      (window as any).electronAPI.closePipWindow();
    }
  };

  // 格式化时间
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const newVol = parseFloat(e.target.value);
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    video.muted = nextMute;
  };

  return (
    <div 
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className="w-screen h-screen relative bg-black overflow-hidden flex flex-col group text-white font-sans select-none"
    >
      {/* 拖拽顶栏 (WebkitAppRegion) */}
      <div 
        style={{ WebkitAppRegion: 'drag' } as any}
        className={`absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between px-3 z-50 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <span className="text-[10px] font-bold truncate max-w-[60%] tracking-tight text-white/90 drop-shadow-md">
          {videoName}
        </span>
        <div style={{ WebkitAppRegion: 'no-drag' } as any} className="flex items-center gap-1">
          {/* 置顶/取消置顶按钮 */}
          <button 
            onClick={handleToggleAlwaysOnTop}
            className="w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
            title={alwaysOnTop ? "取消置顶" : "开启置顶"}
          >
            <span className="material-symbols-outlined text-[16px] text-white">
              {alwaysOnTop ? 'push_pin' : 'keep_pin'}
            </span>
          </button>
          {/* 关闭窗口并返回主程序按钮 */}
          <button 
            onClick={handleClose}
            className="w-6 h-6 rounded hover:bg-red-500 flex items-center justify-center transition-colors cursor-pointer"
            title="关闭浮窗，返回主台"
          >
            <span className="material-symbols-outlined text-[16px] text-white">close</span>
          </button>
        </div>
      </div>

      {/* 核心播放区域 */}
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer"
        preload="auto"
      />

      {/* 底部悬浮控制栏 */}
      <div 
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 flex flex-col gap-1.5 z-50 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* 进度条 */}
        <div className="flex items-center gap-2 w-full">
          <span className="text-[9px] font-mono text-white/80">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={handleProgressChange}
            className="flex-1 h-1 rounded-full appearance-none bg-white/20 accent-primary cursor-pointer outline-none hover:h-1.5 transition-all"
          />
          <span className="text-[9px] font-mono text-white/80">{formatTime(duration)}</span>
        </div>

        {/* 底部控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 播放/暂停 */}
            <button 
              onClick={togglePlay}
              className="text-white hover:text-primary transition-colors cursor-pointer flex items-center"
            >
              <span className="material-symbols-outlined text-[20px]">
                {isPlaying ? 'pause' : 'play_arrow'}
              </span>
            </button>

            {/* 音量控制 */}
            <div className="flex items-center gap-1 group/vol">
              <button 
                onClick={toggleMute}
                className="text-white hover:text-primary transition-colors cursor-pointer flex items-center"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isMuted ? 'volume_off' : volume > 0.5 ? 'volume_up' : 'volume_down'}
                </span>
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-12 h-1 bg-white/20 accent-primary rounded-full appearance-none cursor-pointer outline-none transition-all"
              />
            </div>
          </div>

          <div className="text-[9px] text-white/60 font-mono">
            {isPlaying && `今日已学: ${Math.floor(sessionSeconds / 60)}分${sessionSeconds % 60}秒`}
          </div>
        </div>
      </div>
    </div>
  );
}
