# Lerntrainer – Projekt-Gedächtnis (für Claude)

> **Zweck dieser Datei:** Damit ich (Claude) in jeder neuen Session sofort weiß,
> was es schon gibt, und **keine bereits implementierten Features als "neue Idee"
> vorschlage**. Diese Datei wird automatisch in jeden Session-Kontext geladen.
> Bei Änderungen am Code: **diese Datei mit aktualisieren.**
>
> Ergänzend: `ROADMAP.md` (Zukunftsplan, primär Desktop) und `README.md`.

## Zwei Plattformen / Codebases

| Ordner    | Stack                                   | Status / Rolle |
|-----------|-----------------------------------------|----------------|
| `pwa/`    | Vanilla-JS SPA, ES-Module, IndexedDB, Service Worker | **Aktive Hauptcodebase.** Hier passiert die Entwicklung. |
| `src/`    | Python 3.11 + CustomTkinter (Desktop)   | Älterer Desktop-Client (~5200 Z. in `app.py`). |

KI läuft überall über **OpenRouter** (API-Key in Settings). Cloud-Sync über
Firebase (Account **oder** Sync-Code, beides standalone-fähig).

Branch für Entwicklung: `claude/amazing-ramanujan-eclxvm`.
Commit-Messages mit `Co-Authored-By`. NIE das Modell-ID in Commits/Code schreiben.

---

## PWA – was bereits EXISTIERT (nicht erneut vorschlagen!)

### Architektur
- `js/app.js` – Router-Registrierung + Init (SW, Account-Restore).
- `js/router.js` – Hash-Routing, Cleanup-Hooks, Screen-Einblende-Animation (`screen-enter`).
- `js/store.js` – IndexedDB-KV-Store (**Singleton-DB-Promise**, kein Mehrfach-Open).
  Persistiert: quizzes, progress, settings, daily, marked, stats, error_diary,
  folders, fsrs, **coins** (Economy), **game_scores** (Highscores), achievements,
  math_tasks, materials, **profile** (Shop), **memory_text** + **memory_entries**
  (KI-Memory), **quick_actions** (Quick-Actions-Editor).
- `js/quiz-engine.js` – `checkAnswer` für ALLE Fragetypen, Leitner-`updateProgress`, `QuizSession`.
- `js/ai-service.js` – komplette OpenRouter-Anbindung (s.u.), `MODELS`-Liste mit tier/price/context/vision.
- `js/fsrs.js` – vollständiger FSRS-4.5-Scheduler (Anki-artig).
- `js/firebase-sync.js` – Auth + Sync (push/pull/Sync-Code).
- Utils: `games-util.js` (Quiz-Quelle-Picker für Games), `math-keyboard.js`,
  `editable-formula.js`, `blackout.js` (Bild-Schwärzung zum Abfragen),
  `canvas-util.js` (geteilte Canvas-Helfer: lerp, addFloater, roundRect …),
  `diagram.js` (Diagramm-Label-Setup, geteilt quiz/editor),
  `html-export.js` (quizToHtml/downloadQuiz – Export als HTML/JSON),
  `utils.js` (esc, escAttr, uid, CHIP_COLORS, getBoxCounts, loadPdfJs, renderMath/mathEsc).
- **KaTeX self-hosted** unter `pwa/lib/katex/` (kein CDN) + im SW vorgecacht.
  LaTeX-Rendering produktiv (`mathEsc`), per Setting **abschaltbar** (`latexEnabled`).
- **Navigation:** untere **Tab-Bar** (`#tab-bar` in `index.html`, gesteuert in
  `app.js`/`router.js`) für Haupt-Screens; restliche Screens per Hash-Routing.
- CSS: Token-System in `css/app.css` inkl. **Glass-Morphism** (`--glass-*`,
  `.card-glass`) und Light/Dark.
- PWA-Härtung: automatische Cache/SW-Recovery + Boot-Wächter in `index.html`.

### Fragetypen (alle in quiz-engine implementiert)
single_choice, multiple_choice, free_text, fill_blank (Lückentext),
drag_drop, drag_category, math_formula (mit Toleranz + Formel-Eval),
diagram_label (Labels auf Diagramm platzieren), mark_image (Region anklicken).
Freitext: Levenshtein-Tippfehlertoleranz + optional KI-Validierung.

### Screens (`js/screens/`) – alle vorhanden
- **home** – Welcome, Streak-Bar, Daily-Card, 4 Hauptkacheln, "Weitere Tools"-Grid, markiert/Fehler-Rows, zuletzt gelernt.
- **my-quizzes / quiz-modes / quiz / results** – Quiz-Liste, Modus-Wahl, Spielen, Auswertung.
  - **my-quizzes** bietet **Export** pro Quiz (HTML mit eingebetteten Bildern / JSON) via `html-export.js`.
  - **quiz** hat **„💡 Tipp"** (gestufte Hinweise via generateHints); KI-Freitext-Prüfung
    und FSRS-Aufzeichnung respektieren die Settings (`aiValidation`, `useFsrs`).
  - **results** hat **KI-Erklärung** + **KI-Tutor pro falscher Frage** + **„🔁 Einfacher erklären"**
    (simplifyExplanation) in der Detail-Ansicht, sowie **„🤖 Zusammenfassung"** (generateSummary)
    der gesamten Quiz-Runde. Vergibt Münz-Boni (idempotent via `session.coinsAwarded`)
    und sammelt bei Daily-Quizzes automatisch Schwächen ins KI-Memory.
- **editor** – manueller Quiz-Editor (alle Fragetypen) inkl. KI-Bearbeitung einzelner Fragen.
- **ai-generate** – Quiz aus Text / Bild / **PDF** generieren, Detailgrad wählbar.
  PDF-Modus 3-stufig: **Nur Text** (günstig), **Hybrid** (Volltext + nur Seiten mit
  wenig Text/Grafik als Bild – pro Seite erkannt via `VISUAL_PAGE_MIN_CHARS`),
  **Alle als Bild** (Vision). Auto-Empfehlung beim Laden je nach Textanteil.
- **daily** – täglicher Lernplan, fällige Fragen, falsche zum Wiederholen, Deep-Learn-Themenvorschläge.
  **Lernphasen-Wähler** (`learning_phase`: basics/deepen/…) und **Themen ausblenden** (`disabled_topics`).
- **stats** – Summary, **13-Wochen-Heatmap**, Leitner-Box-Chart, letzte 14 Tage. *(Heatmap existiert!)*
- **sr-dashboard** – Spaced-Repetition-Übersicht, Mastery pro Quiz.
- **achievements** – 17 Erfolge (Antworten-Meilensteine, Streaks 3/7/14/30, Perfekt, Box-5, Nachteule/Frühaufsteher …).
- **error-diary** – Fehler-Tagebuch. **marked** – markierte Fragen.
- **folders** – Ordner/Klausuren gruppieren, Countdown, schwache Fragen zählen.
- **tutor** – freier KI-Lerntutor-Chat. **deep-learn** – geführte Verständnis-Sessions (speicherbar).
- **socratic** – sokratischer Frage-Modus. **scaffold** – Formel-Training (PDF→KI extrahiert Teilaufgaben→löst Schritt für Schritt).
- **cloze** – Lückentext-Generator (KI-Zusammenfassung + Keywords). **study** – Karteikarten-Modus.
- **pomodoro** – Fokus-Timer.
- **random** – Zufalls-Modus: mischt Fragen aus ALLEN Quizzen zu einer Lernrunde
  (synthetisches Quiz → normale quiz-Engine; Fortschritt landet pro Frage-ID bei den Quellfragen).
- **formula-sheets** – Formelsammlung-Manager (Store-Key `formula_sheets`): Sammlungen pro Fach
  anlegen/ansehen/bearbeiten, LaTeX-Body via `mathEsc` gerendert (Desktop-Parität zu `fosa`).
- **image-editor** – eigenständiger Bild-Editor: Bild laden, mit Pinsel übermalen
  (Schwärzen/Weißen/Farben), Pinselgröße, Rückgängig, als PNG speichern (verallgemeinert `blackout.js`).
- **ai-generate** hat zusätzlich einen **Import-Modus** (`importQuiz`): übernimmt vorhandene
  Fragen aus Dokumenten 1:1 (Altklausur/Übungsblatt) statt neue zu generieren – inkl. Chunking.
- **settings** – Theme (auto/hell/dunkel), Account, Sync-Code, **API-Key + Modell-Selektor mit
  Kostensperre** (Free-Modelle direkt, kostenpflichtige hinter „Weitere Modelle anzeigen",
  pro Modell 🔒-Sperre via `disabledModels`, Bestätigung bei Paid-Modellen),
  **KI-Feature-Toggles** (`aiValidation`, `detailedAnswers`, `enableImages`),
  **FSRS-Schalter** (`useFsrs`), **LaTeX-Toggle** (`latexEnabled`),
  **KI-Memory** (`use_memory` + Memory-Manager), **Quick-Actions-Editor**,
  JSON-Import, Reset.

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
- **Münz-Boni**: +10 Münzen Quiz-Abschluss (≥3 Fragen), +5/+10 bei ≥60%/≥80%, +5 bei 100%.
  +15 Daily-Abschluss-Bonus. Streak-Meilensteine: 3d→15, 7d→30, 14d→50, 30d→100 (einmalig).
- Daily-State-Tracking: `results.js` aktualisiert `daily.completed`/`daily.wrong` nach Quiz.
- **Game Skins**: 5 Tower-Defense-Paletten, 4 Quiz-Battle-Paletten. Über `getGameSkin()` in
  `shop-catalog.js` abgerufen. Games lesen Skin aus `profile.gameSkins`. Shop-Tab "Games".
- **Haus-Dekoration**: 6 Deko-Items (Flagge, Blumen, Katze, Laterne, Baum, Brunnen).
  In `profile.house.decos[]` gespeichert, im Haus-SVG gerendert via `renderHouseSVG(level, size, decos)`.

### KI-Funktionen (`ai-service.js`)
generateQuiz (Text), generateQuizFromImage(s) (Vision/PDF-Seiten),
explainAnswer, askTutor, generateHints (3 gestufte Hinweise),
simplifyExplanation, analyzeClozeKeywords, aiValidateAnswer (Freitext),
editQuestionWithAI, checkFreeTextAI + quickExplain (schnelles Free-Modell für Games),
**generateHints** (im Quiz aktiv), **simplifyExplanation** + **generateSummary** (in results aktiv),
Mathe-Pipeline: extractMathTasks → solveMathTasks (calc_chain) → generateSimilarTasks (+Verify).

### KI-Memory (Personalisierung)
- Store-Keys `memory_text` (Freitext) + `memory_entries` (strukturierte Einträge).
- `getFullMemoryPrompt()` baut einen Memory-Block, der bei aktivem `use_memory` in KI-Prompts
  injiziert wird. Schwächen werden nach Daily-Quizzes **automatisch** erfasst (results.js).
- Verwaltung über Memory-Manager in **settings**.

### Konfigurierbarkeit (Settings-Gates) – beim Bauen beachten
- KI-Aufrufe respektieren `aiValidation`, `detailedAnswers`, `enableImages`, `disabledModels`.
- Spaced Repetition: `useFsrs` (Default an) – gilt einheitlich für quiz UND scaffold.
- `latexEnabled` steuert `renderMath`; Wert wird beim Boot in `utils.js` gesetzt (synchron).

---

## Mockup (`pwa/mockup.html`)
War **nur** ein statischer Klick-Prototyp für ein Redesign (Navigation, neue Screens,
Spielideen Block Blast / Mathe-Solver / Mix-Kampagne, LaTeX-Toggle). **Nicht die echte
App.** Für Feature-Status immer den echten Code unter `pwa/js/` ansehen, nicht das Mockup.

## Vor "neue Ideen": erst hier + im Code prüfen
Schon erledigt und NICHT als neu verkaufen: Heatmap, Achievements/Streaks,
KI-Erklärung bei Fehlern, Bild-/Diagramm-/Formel-Fragen, Fehler-Tagebuch,
Karteikarten, FSRS, Pomodoro, Deep-Learn/Sokrates, PDF→Quiz, Cloud-Sync,
**Shop/Coin-Economy** (Avatar/Haus/Skins/Game-Skins/Deko + Münz-Boni),
**Modell-Kostensperre** + KI-Feature-Toggles, **KI-Memory** (auto-Schwächen),
**Quick-Actions-Editor**, **HTML/JSON-Export**, **Lernphasen + Themen ausblenden**,
**Hybrid-PDF** (Text+Bildseiten), **untere Tab-Bar**, **gestufte Hinweise**,
**KI-Zusammenfassung**, **„Einfacher erklären"**, **LaTeX-Toggle**, KaTeX self-hosted,
**Fragetypen-Auswahl** (ausschließen vor Generierung, alle Pfade: Text/Bild/PDF),
**Text-Chunking** (große Texte abschnittsweise statt abschneiden, Granularität wählbar),
robustes **parseJSON** (repariert ungültige LaTeX-Escapes wie `\(`/`\sqrt`).

### KI-Generierung – Optionen (ai-generate.js + ai-service.js)
- `generateQuiz/generateQuizFromImage/generateQuizFromImages` akzeptieren `config.allowedTypes`
  (Fragetypen-Whitelist; Prompt-Constraint + Post-Filter-Fallback).
- `generateQuiz` unterstützt `config.chunkSize` (Zeichen) + `config.onProgress(i,n)`:
  Bei großem Text wird via `chunkText()` abschnittsweise generiert, mit Rolling-Context
  (bereits abgedeckte Themen) gegen Dopplungen, danach Dedupe über Fragetext.
  UI: Chunking-Selektor Auto/Aus/Grob/Mittel/Fein (Auto chunkt ab ~10k Zeichen).
- `parseJSON` probiert mehrere Reparatur-Varianten (Code-Fences strippen, äußersten
  JSON-Block extrahieren, ungültige Backslash-Escapes verdoppeln) bevor es wirft.

## Offen / noch NICHT umgesetzt (echte neue Ideen)
- **i18n / Mehrsprachigkeit** (PWA nur Deutsch; Desktop hat DE/EN via `i18n.py`).
- **Echtes Rolling-Summary** für Chunking (statt nur Themen-Liste als Kontext) –
  der Bild-/Hybrid-PDF-Pfad chunkt zudem noch nicht (nur der Text-Pfad).
- Mockup-Spiele noch nicht in echter PWA: **Block Blast, Math-Solver, Mix-Kampagne**.
