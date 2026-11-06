#!/usr/bin/env bash
# Kept for Termux/WSL users. The real work lives in patch-android.mjs so it behaves identically on Windows.
# Run after `npx cap add android` / `npx cap sync android`. Safe to run repeatedly.
set -e
cd "$(dirname "$0")/.."
exec node scripts/patch-android.mjs
