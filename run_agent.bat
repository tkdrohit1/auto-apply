@echo off
title JobForge Desktop Agent Client
echo =====================================================================
echo                Booting JobForge Local Desktop Agent
echo =====================================================================
echo [System] Ensuring 'websockets' python library is installed...
pip install websockets
if %ERRORLEVEL% neq 0 (
    echo [Error] Failed to install websockets library. Ensure python/pip is in PATH.
    pause
    exit /b
)
echo [System] Checking Playwright browser drivers...
python -m playwright install chromium
if %ERRORLEVEL% neq 0 (
    echo [Warning] Playwright driver install encountered errors, attempting to run anyway...
)
echo =====================================================================
echo [System] Starting Desktop Agent Daemon...
echo =====================================================================
cd desktop_agent
python agent.py
pause
