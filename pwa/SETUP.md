# Lerntrainer PWA – Setup Guide

## Lokal testen (Browser)
```bash
cd pwa
npx serve . -l 3000
# → http://localhost:3000 öffnen
```

## Als PWA installieren
1. App im Chrome/Safari öffnen
2. Chrome: Menü → "App installieren" / Safari: Teilen → "Zum Home-Bildschirm"
3. Die App funktioniert jetzt offline!

## Android APK (Play Store)
```bash
cd pwa
npm install @capacitor/core @capacitor/cli
npx cap init Lerntrainer com.lerntrainer.app --web-dir .
npm install @capacitor/android
npx cap add android
npx cap sync
npx cap open android    # Öffnet Android Studio
```
In Android Studio: Build → Generate Signed Bundle / APK

## iOS App (App Store)
```bash
cd pwa
npm install @capacitor/core @capacitor/cli
npx cap init Lerntrainer com.lerntrainer.app --web-dir .
npm install @capacitor/ios
npx cap add ios
npx cap sync
npx cap open ios        # Öffnet Xcode
```
In Xcode: Product → Archive → Distribute App

## Icons ersetzen
Ersetze `icons/icon-192.png` (192×192) und `icons/icon-512.png` (512×512) mit echten Icons.
Für Capacitor: Nutze `npx capacitor-assets generate` mit einem 1024×1024 Icon.

## Quizze importieren
1. **Account-Sync**: Anmelden mit dem gleichen Account wie auf dem Desktop → Automatischer Sync
2. **Sync-Code**: Code vom Desktop eingeben unter Einstellungen
3. **JSON-Import**: Quiz-Datei (.json) direkt importieren
