#!/usr/bin/env bash
# Stages the brain service's build context into out/brain-deploy/ (Dockerfile.brain as its
# Dockerfile, its own railway.json), for: railway up out/brain-deploy --path-as-root --service brain
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/out/brain-deploy"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$REPO/brain" "$REPO/brainserver" "$REPO/probe" "$REPO/deploy" "$OUT/"
cp "$REPO/package.json" "$REPO/package-lock.json" "$OUT/"
cp "$REPO/Dockerfile.brain" "$OUT/Dockerfile"
cat > "$OUT/railway.json" <<'JSON'
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": { "restartPolicyType": "ALWAYS" }
}
JSON
printf '**/node_modules\n' > "$OUT/.dockerignore"
echo "staged $OUT"
