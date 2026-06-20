# Lerntrainer – Quiz App

Eine Desktop-Quiz-App für Klausurvorbereitung mit KI-gestützter Fragengenerierung.

## Features

### Fragetypen
- **Single Choice** – Eine richtige Antwort aus mehreren Optionen
- **Multiple Choice** – Mehrere richtige Antworten
- **Freitext** – Freie Texteingabe
- **Lückentext** – Fehlende Begriffe ergänzen
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

### Leitner-Box System
Spaced Repetition mit 5 Boxen – schwache Fragen werden häufiger wiederholt.

## Installation

```bash
pip install -r requirements.txt
```

## Starten

```bash
python main.py
```

## KI-Einrichtung

1. OpenRouter API-Key besorgen: https://openrouter.ai
2. In der App unter "Einstellungen" den Key eingeben
3. Empfohlene Modelle: `deepseek/deepseek-chat`, `google/gemini-2.5-flash`

## Technologie

- Python 3.11+
- CustomTkinter (moderne Tkinter-Oberfläche)
- OpenRouter API für KI-Features
- JSON-basierte Datenspeicherung

## Geplant (nächste Schritte)

- Klausurvorbereitung mit automatischem Lernplan
- Lernmodus mit Kurzfassungen zu Themen
- PDF/PPTX-Import für Folien
- Statistiken und Lernfortschritt über Zeit
