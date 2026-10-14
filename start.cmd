@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\sharp\package.json" goto install
if not exist "node_modules\tsx\package.json" goto install
goto launch
:install
  call npm ci --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
:launch
node --import tsx "%~dp0app\server.ts" --open %*
if errorlevel 1 pause
