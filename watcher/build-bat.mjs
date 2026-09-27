/* يبني ملف باتش واحداً يحتوي كل شيء: المراقب وبرنامج التجهيز داخله.
   شغّله بعد أي تعديل على watch-folder.mjs أو setup.ps1:
     node build-bat.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "مراقب-تمكين.bat");

const header = String.raw`@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Tamkeen folder watcher

rem ===== one self-contained file: extracts the watcher, then runs the Arabic setup =====

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required and was not found on this machine.
  echo   Opening the download page: install the LTS version, then run this file again.
  echo.
  start https://nodejs.org/ar/download
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$src=[IO.File]::ReadAllLines('%~f0',[Text.Encoding]::UTF8); $a=[Array]::IndexOf($src,':::JS:::'); $b=[Array]::IndexOf($src,':::PS1:::'); if($a -lt 0 -or $b -lt 0){exit 1}; [IO.File]::WriteAllLines((Join-Path '%~dp0' 'watch-folder.mjs'), $src[($a+1)..($b-1)], (New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllLines((Join-Path '%~dp0' 'setup.ps1'), $src[($b+1)..($src.Length-1)], (New-Object Text.UTF8Encoding($true)))"
if errorlevel 1 (
  echo   Could not extract the watcher files.
  pause
  exit /b 1
)

if /i "%~1"=="/extract" (
  echo   Extracted watch-folder.mjs and setup.ps1 next to this file.
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 pause
exit /b

rem ================== do not edit below this line ==================
`;

const js = fs.readFileSync(path.join(HERE, "watch-folder.mjs"), "utf8").replace(/\r\n/g, "\n").split("\n");
const ps1 = fs.readFileSync(path.join(HERE, "setup.ps1"), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");

const lines = [...header.split("\n"), ":::JS:::", ...js, ":::PS1:::", ...ps1];
fs.writeFileSync(OUT, lines.join("\r\n"), "utf8");
console.log(`تم بناء ${path.basename(OUT)} — ${lines.length} سطراً، ${Math.round(fs.statSync(OUT).size / 1024)} ك.ب`);
