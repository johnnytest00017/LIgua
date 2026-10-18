# Lingua mobile (Android + iOS)

Same `www/index.html` runs everywhere. Two ways to ship it:

## A) Fastest: install as a PWA (no store, no build)
Host the `www/` folder over HTTPS (GitHub Pages, Netlify, Cloudflare Pages), open it on the phone:
- Android Chrome: menu > Install app
- iOS Safari: Share > Add to Home Screen

## B) Real native apps with Capacitor
Requires Node 18+.
```
npm install
npx cap add android        # and/or: npx cap add ios
npm run assets             # generates icons/splash from resources/icon.png
npm run android            # opens Android Studio > Run (or Build > Build APK)
npm run ios                # opens Xcode (macOS only) > Run
```
iOS needs a Mac with Xcode (or a cloud Mac such as Codemagic / GitHub Actions macos runner) and an Apple developer account to install beyond 7 days / publish.
Android builds fine on Windows with Android Studio.

After `cap add ios`, open `ios/App/App/Info.plist` and add:
```
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoads</key><true/></dict>
```
so the app can reach your home server over plain http.

## Using your Lingua server.py (media library, YouTube proxy, AI)
The phone can't see your PC's `localhost`. Run server.py on your PC, bind it to 0.0.0.0, then in the app tap the gear and enter `http://<PC-LAN-IP>:<port>`.
server.py must send CORS headers: `Access-Control-Allow-Origin: *` (and handle OPTIONS for POST /api/ai).
Without a server, the app still works: flashcards, word lookup (Wiktionary / MyMemory), your own AI key (Anthropic/OpenAI/Gemini), sample content.

## Notes
- Fonts load from Google Fonts; they fall back to system fonts offline.
- Progress is stored in WebView localStorage (per device, not synced).
- YouTube embeds can show error 153 inside a native WebView; if that happens, the YouTube Data API key path still lists videos but playback needs a different player plugin.

## Get an APK without installing anything (GitHub Actions)
1. Create a GitHub repo and push this folder to it (including `.github/`).
2. Repo > Actions > "Build Android APK" > Run workflow.
3. When it finishes, download `lingua-debug-apk` from the run page, unzip, and install `app-debug.apk` on your phone (allow "install unknown apps").
This is a debug-signed APK: fine for personal use, not for Play Store upload.
