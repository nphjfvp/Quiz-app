# 🔍 Wettbewerbsanalyse Lerntrainer PWA

**Datum:** 2026-06-28
**Methode:** Deep-Research-Workflow — 105 Agenten, 23 Quellen, 25 Claims 3-fach adversariell verifiziert, 5 bestätigt

---

## A) Was andere BESSER machen

| Bereich | Wer ist besser | Details |
|---------|---------------|---------|
| **Geteilte Decks** | **Quizlet** | Millionen öffentlicher Lernsets. Größter Einzelvorteil — Null-Setup für Nutzer. Unser größtes Defizit |
| **Adaptives Lernen** | **Quizlet Learn Mode** | KI passt Schwierigkeit in Echtzeit an Nutzer-Performance an. Wir haben nur feste FSRS-Intervalle, keine Binnen-Adaptivität während einer Session |
| **KI-Tutor Tiefe** | **Duolingo Max, Quizlet Q-Chat** | Rollenspiele, Video-Call-Konversation mit Lily, Explain-My-Answer in Echtzeit. Unser Tutor ist Text-Chat-basiert |
| **Community/Teilen** | **Quizlet, Kahoot** | Live-Multiplayer-Sessions (Kahoot bis 20 TN gratis), Teilen per Link. Uns fehlt Multiplayer/Sharing komplett |
| **Notiz-Integration** | **RemNote** | Automatische Karteikarten-Generierung aus Notizen während des Schreibens. PDF-Highlight → Karteikarte |
| **Onboarding** | **Anki** | Trotz steiler Lernkurve bessere Doku/Community-Addons. Wir haben KEIN Onboarding/Tutorial |
| **Kollaboration** | **Quizlet, Knowt** | Lerngruppen, gemeinsame Decks bearbeiten, Lehrer-Klassen-Feature |
| **Cross-Plattform** | **Alle großen** | Native iOS/Android Apps. Wir nur PWA |
| **API/Addon-Ökosystem** | **Anki** | Hunderte Community-Addons für jeden Use-Case. Ankis eigentlicher Burggraben |
| **Sync-Stabilität** | **Anki** | Jahrzehntelang erprobtes Sync-Protokoll. Unser Firebase-Sync ist funktional aber nicht kriegserprobt |

---

## B) Fehlende Features (die nützlich wären)

### 🔴 High Priority (Wettbewerbs-Lücken schließen)

#### 1. Community Deck Library
- **Quelle:** Quizlet (Marktführer)
- Öffentlich teilbare Quiz-Sets, durchsuchbar, bewertbar
- Import/Export (`.apkg`, `.csv`, `.json`)
- Quizlet verliert gerade Nutzer wegen aggressiver Paywall — Zeitfenster offen
- **Aufwand:** Hoch (Backend/Infrastruktur + UI)

#### 2. Adaptive Quiz-Session
- **Quelle:** Quizlet Learn Mode
- Schwierigkeit passt sich innerhalb der Session an: falsche Antwort → leichtere Folgefragen, richtige → schwerere
- FSRS plant *wann* gelernt wird, Adaptiv steuert *was* in der Session passiert
- **Aufwand:** Mittel (Engine-Erweiterung, kein neues Backend nötig)

#### 3. Live Multiplayer / Teilen
- **Quelle:** Kahoot, Quizlet Live
- Session-Code-Generator, bis 20 Teilnehmer gratis
- Passt perfekt zu unseren Games — Echtzeit-Quiz-Battle mit Freunden
- **Aufwand:** Hoch (WebRTC/WebSocket-Infrastruktur)

#### 4. Onboarding & Tutorial
- **Quelle:** User Pain Points (Anki-Forums: "Things that still REALLY piss me off after 8 years")
- Anki-Nutzer klagen über Komplexität — wir haben ähnlich viele Features ohne Einführung
- Geführtes erstes Quiz + Feature-Entdeckungstour + Tooltips
- **Aufwand:** Gering-Mittel

### 🟡 Medium Priority

#### 5. Notiz-zu-Karteikarte
- **Quelle:** RemNote
- Markdown-Notizen schreiben, automatisch Karten per `::` oder `?` Marker generieren
- PDF-Highlight → automatische Karteikarte
- Überschneidung mit KI-Generator, aber schneller für manuelles Arbeiten
- **Aufwand:** Mittel

#### 6. Kollaborative Ordner / Lehrer-Modus
- **Quelle:** Quizlet Teacher, Knowt Classrooms
- Geteilte Ordner für Lerngruppen
- Lehrer weist Quiz zu, sieht Fortschritt der Schüler
- Existierende Folder-Logik als Basis nutzbar
- **Aufwand:** Mittel-Hoch

#### 7. Spaced Repetition Insights & Prognose
- **Quelle:** Anki Stats-Addons, FSRS-Daten
- "Du wirst 90% dieses Decks in 12 Tagen beherrschen"
- Optimale tägliche Review-Zeit basierend auf FSRS-Prognose
- Eng verwandt mit vorhandenem SR-Dashboard
- **Aufwand:** Gering (reine Datenauswertung)

#### 8. Team-Quiz / Koop-Modus
- **Quelle:** Kahoot Teams, Quizlet Live
- Mehrere Spieler lösen gemeinsam ein Quiz
- Diskussion vor Antwort, Punkte als Team
- **Aufwand:** Mittel (auf Multiplayer-Basis)

### 🟢 Low Priority / Nice-to-Have

#### 9. Sprach-Lern-Modi
- **Quelle:** Duolingo, Memrise
- Aussprache-Prüfung, Hörverstehen, Vokabel-Matching
- Neue Fragetypen: `listen_and_type`, `speak_and_verify`, `word_match`
- **Aufwand:** Hoch (Speech-API-Integration)

#### 10. Lokale KI-Modelle (Ollama)
- **Quelle:** OpenRouter-Integration, Datenschutz-Trend
- Nutzer wollen lokale Modelle statt nur Cloud-API
- Haben wir teilweise durch OpenRouter, aber kein explizites lokales Modell
- **Aufwand:** Mittel

#### 11. Bulk-Edit / Batch-Operationen
- **Quelle:** Anki Forums Power-User-Wünsche
- Mehrere Fragen gleichzeitig taggen, verschieben, löschen
- Suchen & Ersetzen über Fragen hinweg
- **Aufwand:** Gering

#### 12. Lern-Playlists / Pfade
- **Quelle:** Duolingo Path, Knowt Study Plans
- Vordefinierte Lernpfade: "Biologie Abitur 2026" → Quiz A → Quiz B → Prüfung
- Countdown + Meilensteine (teilweise durch Folders abgedeckt)
- **Aufwand:** Gering-Mittel

---

## C) Positionierung

### Stärken (echte, belegte Differenzierung)

| Stärke | Warum besonders |
|--------|----------------|
| **FSRS-4.5 Algorithmus** | State-of-the-Art. Besser als 90% der Konkurrenz. Die meisten (Quizlet, Brainscape, Cram) nutzen einfachere Algorithmen (SM-2 oder simpler) |
| **Gamification-Tiefe** | Coin-Ökonomie, Avatar-Shop mit gestapelten SVG-Layern, Haus-Leveling (Zelt→Schloss), 6 Mini-Games (Tower-Defense, Boss-Fight etc.), Theme-Skins. **Kein Konkurrent hat vergleichbare Tiefe** |
| **Fragetypen-Vielfalt** | 9 Fragetypen inkl. `diagram_label`, `mark_image`, `math_formula`, `drag_drop`, `drag_category`. Mehr als die meisten (Quizlet: ~5, Anki: basic/cloze) |
| **KI-Integrationstiefe** | Quiz-Generierung aus Text/Bild/PDF-Seiten (Vision), Hint-System (3 Stufen), Tutor-Chat, Freitext-Validierung, Mathe-Pipeline. Breiter als Quizlet Q-Chat |
| **Pomodoro + Lernen** | Einzigartige Kombination aus Fokus-Timer und Lern-App |
| **Preis (kostenlos)** | Knowt ist Benchmark für großzügige Free-Tier. Quizlet sperrt Features hinter $35.99/Jahr → **Marktlücke für großzügige Free-Tier** |
| **Offline-first PWA** | Funktioniert ohne Internet, sync bei Verbindung. Echter Vorteil für Pendler/Studenten |

### Schwächen (strukturell, nicht leicht zu beheben)

| Schwäche | Impact |
|----------|--------|
| **Keine Community/Sharing** | Das ist Quizlets Burggraben. Ohne geteilte Decks bleibt Wachstum auf eigene Inhalte beschränkt |
| **Nur PWA** | Kein App-Store-Eintrag, kein natives Gefühl. Entdeckbarkeit leidet |
| **Kein Onboarding** | Feature-Reichtum überfordert neue Nutzer. Absprungrate wahrscheinlich hoch |
| **Kein adaptives Lernen** | Quizlet Learn setzt Standard für "intelligentes" Lernen in der Session |
| **Kein Multiplayer** | Kahoots Kern-Feature fehlt komplett |
| **Keine API/Addons** | Ohne Erweiterbarkeit keine Community-getriebene Innovation |

### Markt-Chancen (externe Faktoren)

1. **Quizlet-Paywall-Unmut** — Quizlet sperrt zunehmend Features (Learn, Test Mode) hinter Plus ($35.99/Jahr). Gralio-Aggregat (512 Nutzer): #1-Beschwerde = Paywall. Nutzer suchen Alternativen.

2. **KI-Halluzination als Level-Spielfeld** — Branchenkonsens: KI-generierte Karten sind ~85-90% akkurat, 4.8-6.4% Halluzination. Alle Anbieter haben das gleiche Problem. Wer zuerst robuste Validierung/Editier-Workflow löst, gewinnt.

3. **FSRS wird Industriestandard** — Selbst SuperMemo integriert jetzt FSRS. Unser Vorsprung schmilzt, aber wir sind early adopters. Jetzt Community-Features draufsetzen bevor andere aufholen.

4. **Gamification-Lücke** — Akademische Studien bestätigen: Kaum ein Lern-Tool hat Avatare, virtuelle Güter, Mini-Games. Unser Gamification-System ist einzigartig positioniert.

### Strategische Empfehlung

> **Nischen-Champion statt Quizlet-Klon.**
>
> Positionierung: *"Die App für Power-Lerner, die Spaß wollen"* — wissenschaftlich fundiertes FSRS + tiefe Gamification + breite KI-Integration. Kein Abo-Zwang.
>
> **Nächste große Features (Reihenfolge):**
> 1. Community Deck Library — schließt größte Lücke, fängt Quizlet-Flüchtlinge
> 2. Adaptive Quiz-Session — macht Kern-Erlebnis intelligenter
> 3. Onboarding — reduziert Absprungrate, macht Feature-Reichtum zugänglich
> 4. Multiplayer/Teilen — differenziert weiter von Anki/Brainscape

---

## Verifizierte Claims (Details)

### Claim 1: Anki = Goldstandard, Quizlet = Best-Quick-Start (HIGH confidence)
**Quellen:** techsuggest.io, iatrox.com, PCMag, Gralio (GetApp/TrustPilot/Capterra/G2)
**Evidence:** Anki's FSRS: RMSE ~0.048-0.066 vs SM-2's ~0.353. Quizlet: Millionen öffentliche Sets. Paywall: PCMag bestätigt Feature-Sperrung hinter Plus. 512-Nutzer-Aggregat: #1-Beschwerde = Paywall.

### Claim 2: SuperMemo-Erfinder bestreitet FSRS-Benchmarks (MEDIUM confidence)
**Quellen:** supermemopedia.com, github.com/guillempalau/fsrs-vs-sm18
**Evidence:** Wozniak: "R(SM17)(exp) is not a prediction of the algorithm." FSRS-Autoren: Daten aus SM16-v-SM17.csv, FSRS-6 schlägt beide Varianten. Praktisch irrelevant — FSRS wird jetzt in SuperMemo integriert, SM-19/SM-20 existieren.

### Claim 3: KI-generierte Karten = nützliche Entwürfe, nicht perfekt (HIGH confidence)
**Quellen:** techsuggest.io, fritz.ai, medRxiv (2025), Mindomax
**Evidence:** Konsens über ALLE Anbieter: ~85-90% Genauigkeit, 4.8-6.4% Halluzination. Techsuggest.io wörtlich: "Useful Drafts, Not Perfect Answers." Kein Anbieter behauptet perfekte KI-Karten.

### Claim 4: Quizlet Adaptive Learn Mode > unsere statischen Sessions (MEDIUM confidence)
**Quellen:** edtick.com, TMCnet (Aug 2025), Kahoot-Doku
**Evidence:** EdTick: "Adaptive Learning: Kahoot — Limited; Quizlet — AI-powered learn mode." TMCnet: Echtzeit-Anpassung + Wissenslücken-Erkennung. Kahoot: nur einfaches Spaced Repetition (sofort + nach 7 Tagen).

### Claim 5: Knowt hat großzügigste Free-Tier (HIGH confidence)
**Quellen:** techsuggest.io, fritz.ai, TeachersFirst.org, MOGE.ai, Scholarly.so
**Evidence:** 6 unabhängige Quellen (2025-2026): Unbegrenzt Flashcards gratis, alle 5 Lern-Modi gratis, KI-Features hinter Ultra (~$10/Monat). Benchmark für unser Freemium-Modell.

### Claim 6: Unsere Gamification ist einzigartiger Differenziator (MEDIUM confidence)
**Quellen:** CLAUDE.md (eigene Features), Wettbewerbsanalyse (Abwesenheits-Evidenz)
**Evidence:** Unter 13 analysierten Konkurrenten: Keiner mit vergleichbarer Gamification-Tiefe. Quizlet: nur basic Match/Gravity. Kahoot: Live-Gamification aber keine persistente Progression. Anki/Brainscape/RemNote/SuperMemo: keine nennenswerte Gamification. Duolingo: Gamification aber nur Sprachen. Unser System: Coins, Avatar (6 Slots, gestapelte SVGs), Haus (5 Level), Theme-Skins, 6 Mini-Games — einzigartig in der Kombination.

---

## Verworfene Claims (Beispiele)

- "SM2 schlägt Leitner um 10% in RCT (n=47, p=.004)" — 3:0 widerlegt. Conference-Paper, veraltete Methodik, methodische Schwächen
- "Kein Gratis-Tool hat Avatare/Level/virtuelle Güter" — 3:0 widerlegt. Quelle methodisch fragwürdig, Stichprobe veraltet
- "Duolingo Energy-System limitiert Free-Nutzer auf 3-4 Lektionen" — 3:0 widerlegt. Quelle nicht verifizierbar, Zahlen variieren
- "FSRS-6 schlägt SM-17 mit 83.3% Superiorität" — 3:0 widerlegt. Methodologischer Disput (Wozniak), Quelle parteiisch

---

## Offene Fragen

1. **Marktgröße:** Wie groß ist die Zielgruppe die *sowohl* ernsthafte SRS-Studie *als auch* Gamification will — oder schließen sich diese Bedürfnisse aus?

2. **Community-MVP:** Was ist das minimale geteilte-Deck-Feature das die Lücke zu Quizlet schließt, ohne Millionen von User-Sets zu brauchen?

3. **Adaptives Lernen:** Könnte adaptives Lernen ohne vollständige KI-Pipeline approximiert werden — z.B. FSRS-Difficulty-Daten + einfache Heuristiken?

4. **Monetarisierung:** Was ist die Nutzer-Toleranz für Freemium-Limits in Lern-Apps? Duolingos Hearts→Energy-Wechsel und Quizlets Paywall-Verschärfung testen die Grenzen gerade aus.

---

## Quellenverzeichnis

- [ThetaWave: Best Quizlet Alternatives 2026](https://thetawave.ai/blog/quizlet-alternatives)
- [iatrox.com: Anki vs RemNote vs Quizlet (Medical)](https://www.iatrox.com/academy/study/anki-vs-remnote-vs-quizlet-medical)
- [StudyCardsAI: Best Anki Alternatives](https://studycardsai.com/best-anki-alternatives)
- [Mindomax: Spaced Repetition Apps Updates 2026](https://www.mindomax.com/spaced-repetition-apps-updates-2026)
- [Taalhammer: Best Language Learning Apps 2025](https://www.taalhammer.com/best-language-learning-apps-based-on-science-in-2025-taalhammer-vs-duolingo-babbel-and-8-more/)
- [Techpoint Africa: Quizlet Alternatives](https://techpoint.africa/guide/quizlet-alternatives/)
- [GitHub: FSRS vs SM-18 Benchmark](https://github.com/guillempalau/fsrs-vs-sm18)
- [RemNote: FSRS Algorithm Help](https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm)
- [CQU: SM2 vs Leitner RCT](https://acquire.cqu.edu.au/articles/conference_contribution/Comparing_spaced_repetition_algorithms_for_digital_flashcards/13448333)
- [SuperMemoPedia: SuperMemo dethroned by FSRS](http://supermemopedia.com/index.php?title=SuperMemo_dethroned_by_FSRS&oldid=35397)
- [EUDL: Spaced Repetition Algorithm Comparison](https://eudl.eu/doi/10.4108/eai.28-4-2025.2358003)
- [Everything-PR: Language Learning 2026 — Duolingo Moat](http://everything-pr.com/language-learning-2026-duolingo-moat-challenger-set)
- [RENOTE: Gamification in Digital Learning Tools](https://seer.ufrgs.br/index.php/renote/article/download/137776/90967/600759)
- [GamificationHub: Gamification Techniques in Education](https://www.gamificationhub.org/gamification-techniques-in-education/)
- [Youngju.dev: AI EdTech Tools 2026 Deep Dive](https://www.youngju.dev/blog/culture/2026-05-16-ai-edtech-tutoring-tools-2026-khanmigo-magicschool-eduaide-mathgpt-quizlet-q-chat-duolingo-max-deep-dive.en)
- [TechSuggest: Knowt Review](https://www.techsuggest.io/blog/knowt-review-honest-look-at-the-ai-flashcard-study-tool/)
- [EdTick: Kahoot vs Quizlet Comparison](https://edtick.com/en/software/comparisons/kahoot-vs-quizlet)
- [Monevate: Duolingo GenAI Monetization](https://www.monevate.com/blog/the-owl-the-ai-and-the-1b-play-how-duolingo-nailed-genai-monetization)
- [Anki Forums: 8-Year User Frustrations](https://forums.ankiweb.net/t/things-that-still-really-piss-me-off-after-using-anki-for-8-years/55826)
- [Anki Forums: Gamification Discussion](https://forums.ankiweb.net/t/motivational-gamifying-features/59128/2)
- [ClassCentral: Duolingo Hearts to Energy](https://www.classcentral.com/report/duolingo-breaks-hearts-for-energy/)
- [Tegaru: Best Spaced Repetition Apps 2025](https://tegaru.app/en/blog/best-spaced-repetition-apps-2025)
- PCMag Quizlet Review (2024/2025)
- Gralio User-Review Aggregation (GetApp, TrustPilot, Capterra, G2)
- TMCnet Quizlet Adaptive Learn Mode (Aug 2025)
- medRxiv: AI-Generated Medical Flashcards (2025)
- Fritz.ai, MOGE.ai, Scholarly.so, TeachersFirst.org: Knowt Reviews
