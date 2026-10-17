@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 墨笔 · 小说创作工作台

where node >nul 2>nul
if errorlevel 1 goto nonode

node scripts\launch.mjs
if errorlevel 1 pause
exit /b

:nonode
echo.
echo   没有检测到 Node.js。
echo   请先安装 Node.js（选 LTS 版本，22 或更高），安装完成后重新双击 start.bat。
echo   正在为你打开下载页面……
echo.
start "" https://nodejs.org/zh-cn/download
pause
