# Lingua (Android / iOS app)

`www/` is the whole app. There is no server any more: `www/lingua-native.js` is the in-app backend
(media library scan, AI calls, Back button) and a tiny native plugin reads your Media folder.

## Get the APK (GitHub Actions, nothing to install)
1. Push this folder to your GitHub repo (keep `.github/`). If the repo still contains an `android/` folder you may delete it; the build recreates it.
2. Actions > "Build Android APK" > Run workflow.
3. Download `lingua-debug-apk`, unzip, install `app-debug.apk`.

## First launch on the phone
- Put your files in `/storage/emulated/0/Media/Movies` and `/storage/emulated/0/Media/TV Shows` (same layout server.py used).
- The app asks for "All files access". Tap OK, switch it on for Lingua, press Back to return. The library loads by itself.
- AI: tap a word while watching > AI settings > paste a Gemini / Claude / OpenAI key. (Local llama-server cannot run inside the app.)
- YouTube: paste your YouTube API key in the Socials tab as before.

## Back button
Closes sheets/panel, leaves the player, goes from video > feed > platforms, from flashcard sub-pages to the hub, then to Library. Only on Library does Back close the app.

## Local build (optional)
```
npm install
npx cap add android
npm run assets -- --android
npm run android        # syncs, patches, opens Android Studio
```
iOS needs a Mac + Xcode; the iOS folder-access part is not written yet (library will be empty on iOS).
