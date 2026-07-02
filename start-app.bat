@echo off
REM Build and run the INSTALLABLE app (production build). Use start.bat for live editing instead.
where node >nul 2>nul
if errorlevel 1 ( echo Install Node.js LTS from https://nodejs.org/ then re-run this. & pause & exit /b 1 )
if not exist node_modules ( echo Installing dependencies... & call npm install )
echo Building the installable app and starting a local server...
echo When it opens, look for the Install icon in your browser's address bar.
call npm run app
