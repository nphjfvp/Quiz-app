# Lerntrainer – Quiz App

Eine Desktop- und Web-Quiz-App für Klausurvorbereitung mit KI-gestützter Fragengenerierung und Cloud-Sync zwischen Geräten.

## Features

### Fragetypen
- **Single Choice** – Eine richtige Antwort aus mehreren Optionen
- **Multiple Choice** – Mehrere richtige Antworten
- **Freitext** – Freie Texteingabe (Tippfehler-Toleranz + optionale KI-Prüfung)
- **Lückentext** – Fehlende Begriffe ergänzen
- **Mathe-Formel** – Formeleingabe mit Taschenrechner-Keypad, LaTeX-Vorschau und intelligentem Vergleich
- **Drag & Drop** – Begriffe 1:1 zuordnen
- **Kategorie-Zuordnung** – Begriffe in Kategorien einsortieren
- **Diagramm beschriften** – Labels auf Diagramme zuordnen
- **Bildregion markieren** – Bereich im Bild anklicken

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
> IndexedDB, Service Worker). Der Desktop-Client (Python) besteht
> weiterhin, die PWA ist aber das aktuelle Hauptziel. Feature-Stand siehe
> `CLAUDE.md` (Projekt-Gedächtnis).

Lokal starten (statische Dateien):

```bash
cd pwa
python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

Die PWA ist installierbar (manifest + service worker) und offline-fähig.
KI-Features benötigen einen OpenRouter-API-Key (in den Einstellungen).
KaTeX ist self-hosted (`pwa/lib/katex/`) und im Service Worker vorgecacht.

### PWA-Funktionsumfang

**Lernen & Wiederholen**
- Alle 9 Fragetypen, Klausur-/Einzel-/Schwächen-/Themen-Modus, Daily Learning
- FSRS-4.5 Spaced Repetition (abschaltbar) + Leitner-Box-Übersicht
- Daily mit **Lernphasen** (Grundlagen/Vertiefen) und **Themen ausblenden**
- Karteikarten, Pomodoro, Fehler-Tagebuch, markierte Fragen, Ordner/Klausuren
- Statistik mit 13-Wochen-Heatmap, 17 Achievements + Streaks

**KI (über OpenRouter)**
- Quiz-Generierung aus Text, Bild und **PDF** – PDF 3-stufig:
  **Nur Text** · **Hybrid** (Volltext + nur Bildseiten als Vision) · **Alle als Bild**
- KI-Tutor, Deep-Learn, Sokrates, Formel-Training (Scaffolding)
- Pro Frage: KI-Erklärung, „Einfacher erklären", gestufte Hinweise;
  pro Quiz: KI-Zusammenfassung
- **KI-Memory**: personalisiert Prompts, erfasst Schwächen automatisch
- **Modell-Kostensperre** (Free direkt, kostenpflichtige sperrbar) + Feature-Toggles

**Gamification**
- 6 Mini-Games (Tower Defense, Quiz Battle, Speed-Quiz, Millionär, Hangman, Boss-Fight)
- **Coin-Economy** + **Shop**: Avatar-Designer, ausbaubares Haus, App-/Game-Skins, Deko

**Sonstiges**
- Export pro Quiz als **HTML** (mit eingebetteten Bildern) oder **JSON**
- Untere Tab-Bar-Navigation, Light/Dark-Theme, Cloud-Sync (Account oder Sync-Code)

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

## Cloud-Sync einrichten

1. Auf jedem Gerät (Desktop + PWA) **Einstellungen** öffnen
2. Unter **Cloud-Sync** denselben Code eingeben (z.B. `mein-geheimer-code-2026`)
3. Auf dem Hauptgerät: **"In Cloud hochladen"**
4. Auf den anderen Geräten: **"Aus Cloud laden"**

Danach teilen sich alle Geräte dieselben Quizzes und den Lernfortschritt.

> **Hinweis:** Der Sync-Code ist wie ein Passwort – wer ihn kennt, kann auf deine Daten zugreifen. Wähle einen Code, der nicht leicht zu erraten ist.
