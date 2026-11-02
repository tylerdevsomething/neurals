#!/usr/bin/env bash
# Downloads the reference brain (SPEC §2) into models/ and checks its SHA-256.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
FILE=qwen2.5-1.5b-instruct-q4_k_m.gguf
URL="https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/$FILE"
mkdir -p "$REPO/models"
OUT="$REPO/models/$FILE"
if [ ! -f "$OUT" ]; then
  curl -fL --retry 3 -o "$OUT.part" "$URL"
  mv "$OUT.part" "$OUT"
fi
# Hugging Face publishes each LFS file's SHA-256 in the X-Linked-Etag header.
WANT="$(curl -fsI "$URL" | tr -d '\r' | awk -F'"' 'tolower($1) ~ /^x-linked-etag/ {print $2}')"
GOT="$(sha256sum "$OUT" | cut -d' ' -f1)"
echo "sha256 $GOT"
[ -z "$WANT" ] || [ "$WANT" = "$GOT" ] || { echo "hash mismatch: Hugging Face says $WANT"; exit 1; }
