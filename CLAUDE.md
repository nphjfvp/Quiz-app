# Lerntrainer – Projekt-Gedächtnis (für Claude)

> **Zweck dieser Datei:** Damit ich (Claude) in jeder neuen Session sofort weiß,
> was es schon gibt, und **keine bereits implementierten Features als "neue Idee"
> vorschlage**. Diese Datei wird automatisch in jeden Session-Kontext geladen.
> Bei Änderungen am Code: **diese Datei mit aktualisieren.**
>
> Ergänzend: `ROADMAP.md` (Zukunftsplan, primär Desktop) und `README.md`.

## Drei Plattformen / Codebases

| Ordner    | Stack                                   | Status / Rolle |
|-----------|-----------------------------------------|----------------|
| `pwa/`    | Vanilla-JS SPA, ES-Module, IndexedDB, Service Worker | **Aktive Hauptcodebase.** Hier passiert die Entwicklung. |
| `src/`    | Python 3.11 + CustomTkinter (Desktop)   | Älterer Desktop-Client (~5200 Z. in `app.py`). |
| `mobile/` | Expo SDK 54 / React Native              | Eigene Mobile-App (eigene `CLAUDE.md`/`AGENTS.md`). |

KI läuft überall über **OpenRouter** (API-Key in Settings). Cloud-Sync über
Firebase (Account **oder** Sync-Code, beides standalone-fähig).

Branch für Entwicklung: `claude/amazing-ramanujan-eclxvm`.
Commit-Messages mit `Co-Authored-By`. NIE das Modell-ID in Commits/Code schreiben.

---

## PWA – was bereits EXISTIERT (nicht erneut vorschlagen!)

### Architektur
- `js/app.js` – Router-Registrierung + Init (SW, Account-Restore).
- `js/router.js` – Hash-Routing, Cleanup-Hooks, Screen-Einblende-Animation (`screen-enter`).
- `js/store.js` – IndexedDB-KV-Store. Persistiert: quizzes, progress, settings,
  daily, marked, stats, error_diary, folders, fsrs, **coins** (Economy),
  **game_scores** (Highscores), achievements, math_tasks, materials.
- `js/quiz-engine.js` – `checkAnswer` für ALLE Fragetypen, Leitner-`updateProgress`, `QuizSession`.
- `js/ai-service.js` – komplette OpenRouter-Anbindung (s.u.), `MODELS`-Liste mit tier/price/context/vision.
- `js/fsrs.js` – vollständiger FSRS-4.5-Scheduler (Anki-artig).
- `js/firebase-sync.js` – Auth + Sync (push/pull/Sync-Code).
- Utils: `games-util.js` (Quiz-Quelle-Picker für Games), `math-keyboard.js`,
  `editable-formula.js`, `blackout.js` (Bild-Schwärzung zum Abfragen), `utils.js` (esc, mathEsc).
- KaTeX wird in `index.html` bereits eingebunden → **LaTeX-Rendering existiert produktiv** (`mathEsc`).
- PWA-Härtung: automatische Cache/SW-Recovery + Boot-Wächter in `index.html`.

### Fragetypen (alle in quiz-engine implementiert)
single_choice, multiple_choice, free_text, fill_blank (Lückentext),
drag_drop, drag_category, math_formula (mit Toleranz + Formel-Eval),
diagram_label (Labels auf Diagramm platzieren), mark_image (Region anklicken).
Freitext: Levenshtein-Tippfehlertoleranz + optional KI-Validierung.

### Screens (`js/screens/`) – alle vorhanden
- **home** – Welcome, Streak-Bar, Daily-Card, 4 Hauptkacheln, "Weitere Tools"-Grid, markiert/Fehler-Rows, zuletzt gelernt.
- **my-quizzes / quiz-modes / quiz / results** – Quiz-Liste, Modus-Wahl, Spielen, Auswertung.
  - **results** hat bereits **KI-Erklärung** + **KI-Tutor pro falscher Frage**, klickbare Detail-Ansicht.
- **editor** – manueller Quiz-Editor (alle Fragetypen) inkl. KI-Bearbeitung einzelner Fragen.
- **ai-generate** – Quiz aus Text / Bild / **PDF-Seiten (Vision)** generieren, Detailgrad wählbar.
- **daily** – täglicher Lernplan, fällige Fragen, falsche zum Wiederholen, Deep-Learn-Themenvorschläge.
- **stats** – Summary, **13-Wochen-Heatmap**, Leitner-Box-Chart, letzte 14 Tage. *(Heatmap existiert!)*
- **sr-dashboard** – Spaced-Repetition-Übersicht, Mastery pro Quiz.
- **achievements** – 17 Erfolge (Antworten-Meilensteine, Streaks 3/7/14/30, Perfekt, Box-5, Nachteule/Frühaufsteher …).
- **error-diary** – Fehler-Tagebuch. **marked** – markierte Fragen.
- **folders** – Ordner/Klausuren gruppieren, Countdown, schwache Fragen zählen.
- **tutor** – freier KI-Lerntutor-Chat. **deep-learn** – geführte Verständnis-Sessions (speicherbar).
- **socratic** – sokratischer Frage-Modus. **scaffold** – Formel-Training (PDF→KI extrahiert Teilaufgaben→löst Schritt für Schritt).
- **cloze** – Lückentext-Generator (KI-Zusammenfassung + Keywords). **study** – Karteikarten-Modus.
- **pomodoro** – Fokus-Timer.
- **settings** – Theme (auto/hell/dunkel), Account, Sync-Code, **API-Key + voller Modell-Selektor**, JSON-Import, Reset.

### Mini-Games (`js/screens/`, alle echt implementiert, Canvas/SVG)
- **tower-defense** – Bloons-artig, Gegner per richtiger Antwort bekämpfen.
- **quiz-battle** – Karten-Kampf inkl. **PvC** (Computer-Gegner).
- **speed-quiz** – Zeitdruck. **millionaire** – Wer wird Millionär (Joker).
- **hangman** – Galgenmännchen. **boss-fight** – Endgegner mit HP/Combo.
- Drumherum: **Coin-Economy** (`loadCoins/addCoins/spendCoins`) + **Highscores** (`game_scores`).

### Shop / Meta-Progression (umgesetzt)
- `js/shop-catalog.js` – Item-Katalog + SVG-Renderer. Avatar = gestapelte SVG-Layer
  (bg→skin→top→face→hat→accessory) im 100×100-viewBox. Haus = `renderHouseSVG(level)`
  (Zelt→Hütte→Haus→Villa→Schloss). Theme-Skins recolorn `--primary` via `applyThemeSkin`.
- `js/screens/shop.js` – Hub mit 3 Tabs: **Charakter** (Slots kaufen/anlegen),
  **Haus** (Stufen-Upgrade), **Skins** (App-Akzentfarben). Kauf via `spendCoins`.
- Store: neuer Key **`profile`** (`loadProfile/saveProfile`): `{ house:{level}, owned:{}, equipped:{} }`.
- Münzen jetzt AUCH beim Lernen: +2 pro richtiger Antwort in `quiz.js`.
- Einstieg: Profil-Strip auf **home** (Avatar + Münzen → Shop), Shop-Button auf **games**,
  Mini-Card "Shop" in Home-Tools. Theme-Skin wird beim Boot in `app.js` angewandt.
- ⚠️ Offen/Ideen: Game-spezifische Skins (Turm-/Ball-Designs), Deko im Haus platzieren,
  Münz-Belohnung bei Quiz-Abschluss/Daily/Streak (aktuell nur pro Antwort + Games).

### KI-Funktionen (`ai-service.js`)
generateQuiz (Text), generateQuizFromImage(s) (Vision/PDF-Seiten),
explainAnswer, askTutor, generateHints (3 gestufte Hinweise),
simplifyExplanation, analyzeClozeKeywords, aiValidateAnswer (Freitext),
editQuestionWithAI, checkFreeTextAI + quickExplain (schnelles Free-Modell für Games),
Mathe-Pipeline: extractMathTasks → solveMathTasks (calc_chain) → generateSimilarTasks (+Verify).

---

## Mockup (`pwa/mockup.html`)
War **nur** ein statischer Klick-Prototyp für ein Redesign (Navigation, neue Screens,
Spielideen Block Blast / Mathe-Solver / Mix-Kampagne, LaTeX-Toggle). **Nicht die echte
App.** Für Feature-Status immer den echten Code unter `pwa/js/` ansehen, nicht das Mockup.

## Vor "neue Ideen": erst hier + im Code prüfen
Schon erledigt und NICHT als neu verkaufen: Heatmap, Achievements/Streaks,
KI-Erklärung bei Fehlern, Bild-/Diagramm-/Formel-Fragen, Fehler-Tagebuch,
Karteikarten, FSRS, Pomodoro, Deep-Learn/Sokrates, PDF→Quiz, Cloud-Sync.
