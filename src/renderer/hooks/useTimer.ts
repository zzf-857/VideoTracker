import { useState, useEffect, useRef } from 'react';
import { storageService } from '../services/storage';

interface TimerOptions {
  videoPath: string;
  videoName: string;
  isPlaying: boolean;
  idleTimeoutMinutes: number; // 闲置超时时长（分钟）
  onIdleTimeout?: () => void; // 闲置超时的回调（比如暂停播放器）
}

export function useTimer({
  videoPath,
  videoName,
  isPlaying,
  idleTimeoutMinutes,
  onIdleTimeout
}: TimerOptions) {
  const [sessionSeconds, setSessionSeconds] = useState(0); // 本次播放累加的学习秒数
  const isPlayingRef = useRef(isPlaying);
  const videoPathRef = useRef(videoPath);
  const videoNameRef = useRef(videoName);
  const accumulatedSecondsRef = useRef(0); // 当前视频未保存的临时累加秒数
  
  // 闲置检测
  const lastActivityTimeRef = useRef(Date.now());
  const checkIdleIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 同步 Refs
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    // 切换视频时，先把上一个视频累加的时长保存到本地存储
    if (videoPathRef.current && videoPathRef.current !== videoPath && accumulatedSecondsRef.current > 0) {
      storageService.addLearningTime(
        videoPathRef.current,
        videoNameRef.current,
        accumulatedSecondsRef.current
      );
      accumulatedSecondsRef.current = 0;
      setSessionSeconds(0);
    }
    videoPathRef.current = videoPath;
    videoNameRef.current = videoName;
  }, [videoPath, videoName]);

  // 1. 每秒自动计时的核心定时器
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (isPlaying) {
      // 激活时重置活动时间，防止一播放就直接判定为挂机
      lastActivityTimeRef.current = Date.now();

      timer = setInterval(() => {
        // 每秒累加
        accumulatedSecondsRef.current += 1;
        setSessionSeconds(prev => prev + 1);

        // 每隔 30 秒自动做一次本地增量持久化备份，防止软件意外崩溃导致记录完全丢失
        if (accumulatedSecondsRef.current % 30 === 0) {
          storageService.addLearningTime(
            videoPathRef.current,
            videoNameRef.current,
            30
          );
          accumulatedSecondsRef.current -= 30; // 扣减已保存的时间
        }
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, videoPath]);

  // 2. 挂载/卸载时，把未存的时长持久化
  useEffect(() => {
    return () => {
      if (accumulatedSecondsRef.current > 0 && videoPathRef.current) {
        storageService.addLearningTime(
          videoPathRef.current,
          videoNameRef.current,
          accumulatedSecondsRef.current
        );
        accumulatedSecondsRef.current = 0;
      }
    };
  }, []);

  // 3. 用户闲置检测逻辑 (全局监听鼠标移动、按键)
  useEffect(() => {
    const handleActivity = () => {
      lastActivityTimeRef.current = Date.now();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('wheel', handleActivity);

    // 每 5 秒轮询检查一次是否超时
    checkIdleIntervalRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;

      const idleMs = Date.now() - lastActivityTimeRef.current;
      const timeoutMs = idleTimeoutMinutes * 60 * 1000;

      if (idleMs >= timeoutMs) {
        console.log(`User idle detected! Inactive for ${idleTimeoutMinutes} minutes.`);
        // 触发暂停回调
        if (onIdleTimeout) {
          onIdleTimeout();
        }
      }
    }, 5000);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
      
      if (checkIdleIntervalRef.current) {
        clearInterval(checkIdleIntervalRef.current);
      }
    };
  }, [idleTimeoutMinutes, onIdleTimeout]);

  // 手动保存（例如在视频暂停、切换、关闭页面时调用）
  const flush = async () => {
    if (accumulatedSecondsRef.current > 0 && videoPathRef.current) {
      await storageService.addLearningTime(
        videoPathRef.current,
        videoNameRef.current,
        accumulatedSecondsRef.current
      );
      accumulatedSecondsRef.current = 0;
    }
  };

  return {
    sessionSeconds,
    flush
  };
}
