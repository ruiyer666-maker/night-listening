@echo off
chcp 65001 >nul
title Vesper - 网易云接口服务
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 没有找到 Node.js。请安装 Node.js 22 或更新版本，然后重新双击。
  pause
  exit /b 1
)

echo.
echo 仅启动网易云接口服务。新版播放器可直接双击“启动.bat”，会自动启动接口。
echo.
node tools\start-vesper.mjs --api-only --no-open %*
if errorlevel 1 pause
