@echo off
rem Double click to run the Neurals front end locally (Windows).
rem Put site-v2\ and hero-lab\ in the root of the neurals repo first, then put this file there too.
cd /d "%~dp0"
if not exist site-v2 ( echo Put this file in the repo root next to site-v2 and hero-lab. & pause & exit /b 1 )
if not exist node_modules call npm install
if not exist hero-lab\node_modules ( cd hero-lab & call npm install & cd .. )
start "neurals 3d" cmd /c npx vite hero-lab --config hero-lab/vite.config.ts --port 5212 --strictPort
set VITE_THEME=white
set VITE_INDEXER_URL=https://neurals-production.up.railway.app/api
start "neurals site" cmd /c npx vite site-v2 --port 5215 --strictPort
timeout /t 5 >nul
start http://localhost:5215
