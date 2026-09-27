@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Tamkeen folder watcher
where node >nul 2>nul || (
  echo Node.js is not installed. Get it from https://nodejs.org  ^(LTS^)
  pause
  exit /b 1
)
node watch-folder.mjs %*
pause
