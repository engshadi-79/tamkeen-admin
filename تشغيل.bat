@echo off
title Tamkeen - http://localhost:4180
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
echo Tamkeen is running at http://localhost:4180
echo Keep this window open while you work. Close it to stop.
echo.
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{$c=New-Object Net.Sockets.TcpClient('127.0.0.1',4180);$c.Close();break}catch{Start-Sleep -Milliseconds 250}};Start-Process 'http://localhost:4180/'"
%PY% -m http.server 4180 --bind 127.0.0.1
echo.
echo Server stopped. If it failed: make sure Python is installed and port 4180 is free.
pause
