# Lerntrainer – Quiz App

Eine Desktop- und Mobile-Quiz-App für Klausurvorbereitung mit KI-gestützter Fragengenerierung und Cloud-Sync zwischen allen Geräten.

## Features

### Fragetypen
- **Single Choice** – Eine richtige Antwort aus mehreren Optionen
- **Multiple Choice** – Mehrere richtige Antworten
- **Freitext** – Freie Texteingabe
- **Lückentext** – Fehlende Begriffe ergänzen
- **Mathe-Formel** – Formeleingabe mit Taschenrechner-Keypad, LaTeX-Vorschau und intelligentem Vergleich
- **Drag & Drop** – Begriffe zuordnen
- **Diagramm beschriften** – Labels auf Diagramme zuordnen

### 3 Wege Fragen hinzuzufügen
1. **Manuell** – Alle Fragetypen einzeln erstellen
2. **KI-Generierung** – Fragen automatisch aus Vorlesungsfolien generieren (via OpenRouter API)
3. **Import** – Fragen aus Übungsdokumenten importieren (KI-gestützt)

### Lernmodi
- **Klausur-Modus** – Alle Fragen mit Timer, Auswertung am Ende
- **Einzelfragen** – Sofortige Korrektur nach jeder Frage
- **Schwächen üben** – Spaced Repetition (Leitner-System)
- **Themen-Modus** – 20 zufällige Fragen
- **Daily Learning** – Täglicher Lernplan basierend auf Klausurterminen

### Mathe-Modus (Desktop)
- Taschenrechner-Keypad (Ziffern, Operatoren, griechische Buchstaben, LaTeX)
- LaTeX-Vorschau in Echtzeit
- Zeichenfläche für Rechenwege (Stylus/Maus)
- KI-Analyse von handschriftlichen Lösungswegen

### Cloud-Sync
Synchronisiere Quizzes und Lernfortschritt zwischen Desktop (Windows/Mac/Linux), iPhone, iPad und Android über einen gemeinsamen **Sync-Code**.

### Leitner-Box System
Spaced Repetition mit 5 Boxen – schwache Fragen werden häufiger wiederholt.

---

## PWA / Web-App (aktive Hauptcodebase)

> **Hinweis:** Die aktive Entwicklung findet in `pwa/` statt (Vanilla-JS SPA,
> IndexedDB, Service Worker). Desktop (Python) und Mobile (Expo) bestehen
> weiterhin, die PWA ist aber das aktuelle Hauptziel. Feature-Stand siehe
> `pwa/CLAUDE.md` (Projekt-Gedächtnis).

Lokal starten (statische Dateien):

```bash
cd pwa
python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

Die PWA ist installierbar (manifest + service worker) und offline-fähig.
KI-Features benötigen einen OpenRouter-API-Key (in den Einstellungen).

---

## Desktop-App

### Installation

```bash
pip install -r requirements.txt
```

### Starten

```bash
python main.py
```

### KI-Einrichtung

1. OpenRouter API-Key besorgen: https://openrouter.ai
2. In der App unter **Einstellungen** den Key eingeben
3. Empfohlene Modelle: `deepseek/deepseek-chat`, `google/gemini-2.5-flash`

### Technologie

- Python 3.11+
- CustomTkinter (moderne Tkinter-Oberfläche)
- OpenRouter API für KI-Features
- JSON-basierte Datenspeicherung
- Firestore REST-API für Cloud-Sync

---

## Mobile-App (Expo / React Native)

Die Mobile-App bietet Quiz spielen, Daily Learning, KI-Chat und Cloud-Sync auf iPhone, iPad und Android.

### Voraussetzungen

- [Node.js](https://nodejs.org/) (v18+)
- [Expo Go](https://expo.dev/go) auf dem Handy/Tablet (aus App Store / Play Store)
- Handy und PC im selben WLAN

### Installation & Start

```bash
cd mobile
npm install --legacy-peer-deps
npx expo start
```

QR-Code mit Expo Go (Android) oder der Kamera-App (iOS) scannen.

### Features

- **Quiz spielen** – Alle Fragetypen (SC, MC, Freitext, Lückentext, Mathe)
- **Daily Learning** – Täglicher Lernplan mit Klausur-Countdown
- **KI-Chat** – Fragen stellen, Hilfe und Erklärungen bekommen
- **Cloud-Sync** – Sync-Code eingeben → Daten mit Desktop teilen

---

## Cloud-Sync einrichten

1. Auf jedem Gerät (Desktop + Mobile) **Einstellungen** öffnen
2. Unter **Cloud-Sync** denselben Code eingeben (z.B. `mein-geheimer-code-2026`)
3. Auf dem Hauptgerät: **"In Cloud hochladen"**
4. Auf den anderen Geräten: **"Aus Cloud laden"**

Danach teilen sich alle Geräte dieselben Quizzes und den Lernfortschritt.

> **Hinweis:** Der Sync-Code ist wie ein Passwort – wer ihn kennt, kann auf deine Daten zugreifen. Wähle einen Code, der nicht leicht zu erraten ist.
