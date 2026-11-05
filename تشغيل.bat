@echo off
setlocal
title Tamkeen Agent - http://localhost:4180
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the automatic agent.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\playwright-core\package.json" (
  echo Installing the local browser driver...
  call npm install --prefix "%~dp0" --save-exact playwright-core@1.64.1
  if errorlevel 1 (
    echo Could not install the browser driver.
    pause
    exit /b 1
  )
)

echo Starting the local Tamkeen agent at http://localhost:4180
echo Edge will open the center system in a separate window.
echo Keep this window open. Close it to stop the agent.
echo If port 4180 is already in use, close the older Tamkeen window and try again.
echo.
node "%~dp0tools\ksach-agent-server.js"

echo.
echo Tamkeen agent stopped.
pause
