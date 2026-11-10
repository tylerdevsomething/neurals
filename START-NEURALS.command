#!/bin/bash
# Double click to run the Neurals front end locally (macOS).
# Put site-v2/ and hero-lab/ in the root of the neurals repo first, then put this file there too.
cd "$(dirname "$0")"
if [ ! -d site-v2 ] || [ ! -d hero-lab ]; then echo "Put this file in the repo root next to site-v2/ and hero-lab/."; read -r; exit 1; fi
[ -d node_modules ] || npm install
[ -d hero-lab/node_modules ] || (cd hero-lab && npm install)
npx vite hero-lab --config hero-lab/vite.config.ts --port 5212 --strictPort &
VITE_THEME=white VITE_INDEXER_URL=https://neurals-production.up.railway.app/api npx vite site-v2 --port 5215 --strictPort &
sleep 4
open "http://localhost:5215"
echo "Neurals is running at http://localhost:5215 (3D pages on 5212). Close this window to stop it."
wait
