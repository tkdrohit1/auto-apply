@echo off
title JobForge - Chrome Extension Launcher
echo =====================================================================
echo                JobForge Chrome Extension Deployment
echo =====================================================================
echo.
echo Your Chrome Extension client is successfully created and ready!
echo Folder Location: [C:\Users\Rohit\Desktop\autoapply\chrome_extension]
echo.
echo =====================================================================
echo          HOW TO LOAD THE CHROME EXTENSION IN GOOGLE CHROME
echo =====================================================================
echo  1. Open Google Chrome.
echo  2. In the URL address bar, type:  chrome://extensions  and press Enter.
echo  3. Toggle ON the "Developer Mode" switch in the top-right corner.
echo  4. Click the "Load unpacked" button in the top-left corner.
echo  5. Select the following folder from your desktop:
echo     [C:\Users\Rohit\Desktop\autoapply\chrome_extension]
echo.
echo =====================================================================
echo That's it! The extension will connect to the Cloud Server automatically.
echo.
echo [System] Booting the Cloud SaaS Backend server now...
echo [System] Access Dashboard at: http://127.0.0.1:8000
echo =====================================================================
timeout /t 5
cd cloud_server
python app.py
pause
