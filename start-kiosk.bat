@echo off
title Photobox Kiosk Launcher
echo ====================================
echo   PHOTOBOX KIOSK - AUTO LAUNCHER
echo ====================================
echo.

REM --- Configuration ---
set BACKEND_DIR=%~dp0photobox-backend
set FRONTEND_DIR=%~dp0photobox-frontend
set KIOSK_URL=http://localhost:4321
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"

REM --- Step 1: Start Backend ---
echo [1/3] Starting Backend Server...
cd /d "%BACKEND_DIR%"
start "Photobox Backend" /min cmd /c "node server.js"
echo       Backend started on http://localhost:3000

REM --- Step 2: Start Frontend Dev Server ---
echo [2/3] Starting Frontend Dev Server...
cd /d "%FRONTEND_DIR%"
start "Photobox Frontend" /min cmd /c "npm run dev"
echo       Frontend starting on %KIOSK_URL%

REM --- Step 3: Wait for servers to initialize ---
echo [3/3] Waiting for servers to start...
timeout /t 8 /nobreak >nul

REM --- Step 4: Launch Chrome in Kiosk Mode ---
echo.
echo Launching Chrome in Kiosk Mode...
start "" %CHROME_PATH% --kiosk --disable-infobars --disable-session-crashed-bubble --noerrdialogs --disable-translate --no-first-run --fast --fast-start --disable-features=TranslateUI --autoplay-policy=no-user-gesture-required %KIOSK_URL%

echo.
echo ====================================
echo   PHOTOBOX IS RUNNING
echo   Press Ctrl+C to shutdown
echo ====================================
echo.
echo To exit Kiosk Mode: Alt+F4 on Chrome
echo To access Admin: %KIOSK_URL%/admin
echo.
pause
