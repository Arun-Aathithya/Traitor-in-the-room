@echo off
cd /d "%~dp0desktop"
where node >nul 2>nul || (echo Install Node.js 18 or newer from https://nodejs.org first & pause & exit /b 1)
echo Installing build tools (needs internet, first time takes a few minutes)...
call npm install
if errorlevel 1 (echo npm install failed & pause & exit /b 1)
call npm run dist
if errorlevel 1 (echo Build failed & pause & exit /b 1)
echo.
echo Done. The installer is in desktop\dist
explorer dist
pause
