# Quiz-JSON-Format (Import-Vorlage)

Diese Datei beschreibt das JSON-Format für Quiz-Dateien, die in den **Lerntrainer**
(EXE/Desktop **und** PWA) importiert werden können. Beide Apps verwenden dasselbe Format.

## Grundregeln

- **Eine Datei = ein Quiz-Objekt** (die PWA akzeptiert auch ein Array `[ {...}, {...} ]`,
  die Desktop-EXE nur ein einzelnes Objekt — für maximale Kompatibilität: ein Objekt pro Datei).
- Pflichtfelder pro Frage: `question_type` und `text`.
- **Keine `id`-Felder nötig** — sie werden beim Import automatisch neu vergeben.
- LaTeX/Formeln in `$...$` setzen. Im JSON müssen Backslashes verdoppelt werden: `\\frac`, `\\sqrt`.
- Datei als **UTF-8** speichern (Umlaute sind erlaubt).

## Top-Level-Struktur

```json
{
  "name": "Titel des Quiz",
  "description": "kurze Beschreibung (optional)",
  "exam_date": "2026-07-01",
  "questions": [ ... ]
}
```

## Gemeinsame Felder jeder Frage

| Feld            | Typ    | Pflicht | Bedeutung                                  |
|-----------------|--------|---------|--------------------------------------------|
| `question_type` | string | ja      | siehe Typen unten                          |
| `text`          | string | ja      | die Fragestellung                          |
| `points`        | int    | nein    | Punkte (Standard 1)                        |
| `topic`         | string | nein    | Thema/Kapitel (für Statistiken)            |
| `explanation`   | string | nein    | Erklärung, wird nach Antwort angezeigt     |

## Fragetypen

### 1. single_choice — genau eine Antwort richtig
```json
{
  "question_type": "single_choice",
  "text": "Was ist die Hauptstadt von Frankreich?",
  "points": 1,
  "topic": "Geografie",
  "explanation": "Paris ist seit dem Mittelalter Hauptstadt.",
  "options": [
    { "text": "Paris",  "is_correct": true },
    { "text": "Lyon",   "is_correct": false },
    { "text": "Berlin", "is_correct": false }
  ]
}
```

### 2. multiple_choice — mehrere Antworten richtig
Wie `single_choice`, aber mehrere `"is_correct": true`.

### 3. free_text — Freitextantwort
```json
{
  "question_type": "free_text",
  "text": "Nenne das Gesetz von Ohm.",
  "correct_text": "U = R * I; Spannung gleich Widerstand mal Strom",
  "topic": "Physik"
}
```
Mehrere akzeptierte Antworten mit `;` oder `|` trennen. (Bei falscher Antwort kann
zusätzlich eine KI prüfen, ob es inhaltlich trotzdem richtig ist — API-Key in den
Einstellungen vorausgesetzt.)

### 4. fill_blank — Lückentext
`___` (drei Unterstriche) markiert jede Lücke im `text`; `blanks` enthält die
Lösungen in derselben Reihenfolge.
```json
{
  "question_type": "fill_blank",
  "text": "Die Hauptstadt von ___ ist ___.",
  "blanks": ["Frankreich", "Paris"]
}
```

### 5. math_formula — Rechenergebnis
```json
{
  "question_type": "math_formula",
  "text": "Berechne $2 + 2$.",
  "correct_formula": "4",
  "tolerance": 0.01
}
```
`tolerance` erlaubt numerische Abweichung (z. B. Rundung).

### 6. drag_drop — Paare zuordnen
```json
{
  "question_type": "drag_drop",
  "text": "Ordne die Begriffe zu:",
  "drag_drop_pairs": [
    { "source": "Hund", "target": "Tier" },
    { "source": "Rose", "target": "Pflanze" }
  ]
}
```

### 7. drag_category — in Kategorien einsortieren
Wie `drag_drop`, wobei `target` der Kategoriename ist (mehrere `source` können
dieselbe Kategorie haben).

### Weitere Typen (bildbasiert, nur im Editor sinnvoll)
- `diagram_label` — Beschriftungen auf einem Bild platzieren (braucht Bild + Koordinaten).
- `mark_image` — Region auf einem Bild markieren.

Diese benötigen ein Bild und werden am besten direkt im Editor erstellt.

## Vollständiges Beispiel

```json
{
  "name": "Grundlagen E-Technik",
  "description": "Kapitel 1 – Gleichstrom",
  "questions": [
    {
      "question_type": "single_choice",
      "text": "Welche Einheit hat die elektrische Spannung?",
      "topic": "Grundgrößen",
      "explanation": "Die Spannung wird in Volt (V) gemessen.",
      "options": [
        { "text": "Volt",   "is_correct": true },
        { "text": "Ampere", "is_correct": false },
        { "text": "Ohm",    "is_correct": false }
      ]
    },
    {
      "question_type": "fill_blank",
      "text": "Das Ohmsche Gesetz lautet U = ___ · ___.",
      "blanks": ["R", "I"]
    },
    {
      "question_type": "math_formula",
      "text": "Ein Widerstand von $10\\,\\Omega$ wird von $2\\,A$ durchflossen. Wie groß ist die Spannung in Volt?",
      "correct_formula": "20",
      "tolerance": 0.01,
      "topic": "Ohmsches Gesetz"
    }
  ]
}
```

## Prompt für eine andere KI

> Erstelle mir eine Quiz-JSON-Datei für meine Lern-App "Lerntrainer".
> Gib NUR gültiges JSON aus (keine Erklärungen, kein Markdown).
> Halte dich exakt an das Format in dieser Datei (QUIZ_JSON_FORMAT.md).
> Verwende `$...$` für Formeln und verdopple Backslashes (`\\frac`).
> Setze keine `id`-Felder. Mein Lernmaterial: [HIER EINFÜGEN]
