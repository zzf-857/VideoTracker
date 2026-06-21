@echo off
title VideoTracker Launcher
echo ===================================================
echo   Configuring Electron Mirror and Launching App...
echo ===================================================
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npm run dev
echo ===================================================
echo   Process exited. Please check any errors above.
echo ===================================================
pause
