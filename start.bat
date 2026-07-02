@echo off
REM One-click launcher for Windows.
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org/ then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, one time only...
  call npm install
)
echo.
echo Starting WorldForge. Open the http://localhost link printed below in your browser.
echo Press Ctrl+C in this window to stop.
echo.
call npm run dev
