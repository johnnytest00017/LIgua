#!/usr/bin/env bash
# Run after `npx cap add android` / `npx cap sync android`. Safe to run repeatedly.
set -e
cd "$(dirname "$0")/.."
MA=$(find android/app/src/main/java -name MainActivity.java | head -1)
if [ -z "$MA" ]; then echo "android/ not found: run 'npx cap add android' first"; exit 1; fi
DIR=$(dirname "$MA")
PKG=$(grep -m1 '^package ' "$MA" | sed 's/^package \(.*\);.*/\1/')
echo "package: $PKG"
sed "s/__PKG__/$PKG/" native/android/LinguaStoragePlugin.java.tpl > "$DIR/LinguaStoragePlugin.java"
sed "s/__PKG__/$PKG/" native/android/MainActivity.java.tpl > "$MA"
MF=android/app/src/main/AndroidManifest.xml
if ! grep -q MANAGE_EXTERNAL_STORAGE "$MF"; then
  sed -i 's|<application|<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />\n    <application|' "$MF"
fi
grep -n 'uses-permission' "$MF"
echo "patched OK"
