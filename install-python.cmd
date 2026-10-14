@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer first.
  pause
  exit /b 1
)
if not exist "node_modules\tsx\package.json" (
  call npm ci --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node --import tsx tools\setup-python.ts %*
pause
