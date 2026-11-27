@echo off
chcp 65001 >nul
title Vesper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 没有找到 Node.js。请安装 Node.js 22 或更新版本，然后重新双击。
  pause
  exit /b 1
)

echo.
echo Vesper 正在准备网易云接口和新版网页，浏览器会自动打开。
echo 首次运行会按需安装依赖，请保持网络连接。
echo 演示期间保持本窗口打开，按 Ctrl+C 退出。
echo.
node tools\start-vesper.mjs %*
if errorlevel 1 pause
