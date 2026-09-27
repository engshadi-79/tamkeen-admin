@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Tamkeen folder watcher - setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 pause
