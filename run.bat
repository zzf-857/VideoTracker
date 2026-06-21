@echo off
title VideoTracker 启动器 (开发调试)
echo ===================================================
echo   正在配置国内镜像源并拉起 VideoTracker...
echo ===================================================
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npm run dev
echo ===================================================
echo   启动进程已退出，请检查上方是否有报错信息。
echo ===================================================
pause
