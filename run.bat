@echo off
title JobForge AI - Job Automation Suite
echo =====================================================================
echo                Initializing JobForge AI Suite
echo =====================================================================
echo [System] Checking for required Python packages...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [Error] Failed to install Python dependencies. Ensure Python and Pip are in your PATH.
    pause
    exit /b
)
echo [System] Checking Playwright browser drivers...
python -m playwright install chromium
if %ERRORLEVEL% neq 0 (
    echo [Error] Failed to install Playwright browser binaries.
    pause
    exit /b
)
echo.
echo =====================================================================
echo [System] Booting FastAPI backend and starting web server...
echo [System] Access Dashboard at: http://127.0.0.1:8000
echo =====================================================================
python app.py
pause
