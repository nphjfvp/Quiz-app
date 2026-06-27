# Lerntrainer – Roadmap & Feature-Plan

> Dieses Dokument ist der zentrale Plan für die Weiterentwicklung. Es überlebt
> Session-Resets (die Umgebung ist ephemeral – nur committeter Code bleibt).
> Jede neue Session kann hier direkt weitermachen.

> **Achtung – PWA-Vorsprung:** Diese Roadmap ist primär auf den Python-Desktop
> bezogen. Viele Punkte (Streak/Heatmap, Fehler-Tagebuch, Karteikarten, FSRS,
> KI-Erklärung bei Fehlern, Cloud-Sync per Account, Shop/Economy, Mini-Games)
> sind in der PWA (`pwa/`) bereits umgesetzt – siehe `pwa/CLAUDE.md`. Offene
> PWA-Punkte stattdessen dort priorisieren.

## Architektur-Überblick (Ist-Zustand)

- **Desktop**: Python 3.10 + CustomTkinter (`src/app.py`, ~5200 Zeilen)
  - `src/models.py` – Dataclasses (Quiz, Question, Folder, FormulaSheet …) + DataStore (JSON-Persistenz)
  - `src/ai_service.py` – OpenRouter-Anbindung, alle KI-Features (default `deepseek/deepseek-chat`)
  - `src/quiz_engine.py` – QuizSession, SpacedRepetition, DeadlinePlanner
  - `src/fsrs.py` – FSRS-Algorithmus (Anki-artig)
  - `src/i18n.py` – DE/EN Übersetzungen (immer BEIDE Sprachen pflegen!)
  - `src/theme.py` – COLORS, apply_theme, is_dark
  - `src/cloud_sync.py` – Firebase Firestore Sync via **Sync-Code** (KEIN Auth)
- **Builds**: PyInstaller (`Lerntrainer.spec`, `python -m PyInstaller`)

### Wichtige Konventionen
- i18n: jede neue UI-Zeichenkette als Key in DE **und** EN in `src/i18n.py`.
- Experimentelle Features mit `# ── EXPERIMENTAL: <Name> ── START/END` markieren,
  standardmäßig per Settings-Toggle **aus**, Label trägt `(EXPERIMENTELL)`.
- Nach Änderungen: `python -c "import ast; ast.parse(open('src/app.py').read())"`.
- Branch: `claude/amazing-ramanujan-eclxvm`. Commit-Messages mit Co-Authored-By.
- KI-Modell-Blocking existiert (`disabled_models` in settings) – teure Modelle
  ausgegraut, nur per Doppelklick+Bestätigung wählbar.

## Bereits umgesetzt
- Ordner/Klausur-System (mehrere Quiz-PDFs gruppieren)
- Interaktive Auswertung (klickbare Fragen, rot/grün, KI-Chat pro Frage, markieren)
- Interaktiver Formel-Explorer (Slider + Live-Berechnung) + KI-Erklärung mit Stil-Auswahl
- Modell-Blocking gegen versehentliche teure API-Calls
- Erstnutzer-Walkthrough (Toplevel-Overlay, 8 Schritte)
- Freier KI-Chat während Quiz
- KI-Validierung für Freitext mit User-Override
- Fragen während Quiz markieren
- Optimale Lösungswege (KI pre-solved, Schritt-für-Schritt + Merkhilfe)
- **EXPERIMENTAL**: KI-Fragenerstellung im Editor (Toggle, default aus)

---

## Roadmap (priorisiert)

### Phase 1 – Fundament
1. **Account/Login-System** – Firebase Auth, echter Login, Basis für alles Weitere.
   - Sync zwischen Desktop + PWA über Account ODER weiterhin Sync-Code/Export.
   - Wichtig: Apps bleiben **standalone** nutzbar, Account ist optional (siehe Phase 7).
2. **KI-Memory-System** – Lernprofil (Schwächen, Lernstil, bevorzugte Erklärtiefe).
   - Als strukturierter Text/JSON gespeichert, NICHT im Modell → **modell-übergreifend**
     (DeepSeek, Claude, GPT lesen dasselbe Profil als System-Prompt).
   - Verwaltungs-UI: einzelne Memory-Einträge **gezielt löschbar**.
   - Basis existiert teilweise (`use_memory`, `load_memory`/`save_memory` im DataStore).

### Phase 1.5 – Design-Overhaul (NACH Account, VOR Rest)
- Modernes UI, Inspiration Duolingo/Anki/Quizlet – aber eigener Stil, dezenter.
- Zuerst zentrale Design-Tokens in `theme.py` ausbauen (Farben, Spacing, Fonts, Radien).
- Erst umbauen wenn finale Screen-Liste steht → kein doppelter Aufwand.
- User will hier nach seinen Ideen gefragt werden.

### Phase 2 – Lern-Intelligenz
3. **Lernphasen-System** – Grundlagen → Vertiefung → Klausurvorbereitung.
   - Themen pro Phase ein-/ausschaltbar fürs Daily Quiz (Toggle pro Thema),
     damit man nicht mit Thema 9 zugeballert wird bevor Thema 2 sitzt.
4. **Schwäche-Modus v2** – existiert grob; verbessern: Radar-Chart, gezielteres
   Targeting, automatische Mini-Quizzes aus schwachen Themen.
5. **Klausur-Simulation v2** – existiert grob; verbessern: eigene Zeitlimits,
   Themen-Gewichtung, Schwierigkeitsverteilung, Klausur-Archiv mit Vergleich.

### Phase 3 – Motivation & Tracking
6. **Streak-System + Lern-Heatmap** – tägliche Serien, GitHub-Style Kalender.
7. **Fehler-Tagebuch** – chronologisches Log falscher Antworten, Zeitfilter,
   Fortschritt über Zeit. Daten existieren großteils (AnswerResult/progress).
8. **Lernfortschritt-Zusammenfassung** – KI-generiert „Was habe ich im Zeitraum X
   gelernt", wählbarer Zeitraum.
9. **Wochenreport** – per Push/Email.

### Phase 4 – KI-Features
10. **Erklär-Tiefe wählbar** – vor jeder Erklärung: Kurz / Normal / Ausführlich /
    Ganz von vorne. (Wie weit die KI ausholt vorher auswählen.)
11. **Audio-Modus (PASSIVES LERNEN)** – ZURÜCKGESTELLT. Erste Umsetzung mit
    `pyttsx3` (las Fragen vor) wurde wieder entfernt – das war NICHT die Idee.
    Echte Idee: Unterwegs (kein Quiz möglich) bekommt man die **Erklärungen/
    Hilfestellungen zu ausgewählten/schweren Fragen** vorgelesen → passives Lernen.
    Problem: ohne natürliche KI-Stimme (TTS-API wie OpenAI/ElevenLabs) lohnt es
    sich kaum. Erst wieder angehen wenn eine gute TTS-Stimme verfügbar ist.
12. **Lernplan-Generator** – Klausurtermin eingeben → Stoff auf verfügbare Tage verteilt.
13. **Erklär-Levels** – „Noch einfacher"-Button, schrittweise Vereinfachung.

### Phase 5 – Sharing & Community
14. **QR-Code Export** – Quiz als QR → öffnet HTML-Quiz im Browser.
15. **HTML-Export** – einzelne .html (CSS+JS+Daten inline), offline, per WhatsApp/
    AirDrop teilbar. Quiz-Engine in JS nachbauen (SC/MC/Freitext/Lücke/D&D).
    Einschränkung: kein KI-Chat (API-Key wäre im Klartext), kein Sync.
16. **Peer-Review-Modus** – Freunde bewerten gegenseitig Freitext-Antworten (braucht Account).
17. **Lerngruppen** – Quiz teilen, gemeinsam lernen.

### Phase 6 – Bonus
18. **Formel-Scanner** – Kamera erkennt handgeschriebene Formeln, prüft Korrektheit.
19. **Notizen pro Frage** – eigene Anmerkungen, beim nächsten Mal angezeigt.
20. **Multi-Quiz-Vergleich** – zwei Versuche nebeneinander, Fortschritt sichtbar.
21. **Druckmodus** – Quiz als PDF für handschriftliches Üben.
22. **Karteikarten-Modus** – Flashcard-Swipe in der PWA.

### Phase 7 – Standalone Apps (übergreifendes Prinzip)
23. **Zwei unabhängige, aber synchronisierbare Apps** – Desktop + PWA jeweils
    vollständig **standalone** nutzbar. Verbindung über Account ODER Export möglich,
    aber **kein Muss**. Jede App funktioniert komplett ohne die andere.

---

## Empfohlene Reihenfolge
Account-System → Design-Overhaul → KI-Memory → Lernphasen → Streak/Heatmap →
Fehler-Tagebuch → Klausur-Sim v2 → Schwäche-Modus v2 → QR/HTML-Export → Rest.
