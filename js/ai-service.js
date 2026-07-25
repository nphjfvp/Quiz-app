import { loadSettings, getFullMemoryPrompt } from "./store.js";
import { uid } from "./utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const VISION_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
// Ultra-fast, free model for real-time game checks (explanation + free-text grading)
const FAST_MODEL = "google/gemma-4-12b-it:free";

export const MODELS = [
  // ── Gratis (nur Text) ──
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super", tier: "gratis", context: 128000, vision: false, price: "$0" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B", tier: "gratis", context: 131072, vision: false, price: "$0" },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", name: "Qwen3 Next 80B", tier: "gratis", context: 262144, vision: false, price: "$0" },
  { id: "openai/gpt-oss-120b:free", name: "GPT-OSS 120B", tier: "gratis", context: 131072, vision: false, price: "$0" },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", tier: "gratis", context: 128000, vision: false, price: "$0" },
  // ── Gratis (mit Bildern) ──
  { id: "nvidia/nemotron-nano-12b-v2-vl:free", name: "Nemotron Nano VL", tier: "gratis", context: 128000, vision: true, price: "$0" },
  { id: "nvidia/nemotron-3.5-content-safety:free", name: "Nemotron 3.5 Safety", tier: "gratis", context: 128000, vision: true, price: "$0" },
  // ── Günstig ──
  { id: "openai/gpt-4o-mini-2024-07-18", name: "GPT-4o Mini", tier: "günstig", context: 128000, vision: true, price: "$0.15/M" },
  { id: "amazon/nova-2-lite-v1", name: "Amazon Nova 2 Lite", tier: "günstig", context: 300000, vision: true, price: "$0.30/M" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", tier: "günstig", context: 128000, vision: false, price: "$0.14/M" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", tier: "günstig", context: 164000, vision: false, price: "$0.70/M" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "günstig", context: 1000000, vision: true, price: "$0.15/M" },
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", tier: "günstig", context: 1000000, vision: true, price: "$0.075/M" },
  { id: "thudm/glm-4-32b:free", name: "GLM-4 32B", tier: "gratis", context: 32768, vision: false, price: "$0" },
  // ── Mittel ──
  { id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tier: "mittel", context: 200000, vision: true, price: "$1/M" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "mittel", context: 1000000, vision: true, price: "$1.25/M" },
  { id: "openai/gpt-4o", name: "GPT-4o", tier: "mittel", context: 128000, vision: true, price: "$2.50/M" },
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", tier: "mittel", context: 200000, vision: true, price: "$3/M" },
  // ── Premium ──
  { id: "anthropic/claude-opus-4-8", name: "Claude Opus 4.8", tier: "premium", context: 200000, vision: true, price: "$15/M" },
];

export function getModelContextLimit(modelId) {
  const m = MODELS.find(m => m.id === modelId);
  const ctx = m?.context || 128000;
  const reserveForOutput = 4000;
  const reserveForPrompt = 2000;
  const availableTokens = ctx - reserveForOutput - reserveForPrompt;
  return Math.floor(availableTokens * 3.5);
}

async function getConfig(overrides = {}) {
  const stored = await loadSettings();
  return {
    apiKey: overrides.apiKey ?? stored.apiKey ?? null,
    model: overrides.model ?? stored.aiModel ?? DEFAULT_MODEL,
  };
}

async function chatCompletion(messages, { apiKey, model, stream = false } = {}) {
  if (!apiKey) throw new Error("Kein API-Key konfiguriert. Bitte in den Einstellungen hinterlegen.");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": globalThis.location?.origin ?? "https://lerntrainer.app",
      "X-Title": "Lerntrainer PWA",
    },
    body: JSON.stringify({ model, messages, stream, temperature: 0.7, max_tokens: 8000 }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 && model !== DEFAULT_MODEL) {
      const fallback = confirm(
        `Das Modell "${model}" ist nicht verfügbar (404).\n\nSoll stattdessen "${DEFAULT_MODEL}" verwendet werden?`
      );
      if (fallback) {
        return chatCompletion(messages, { apiKey, model: DEFAULT_MODEL, stream });
      }
    }
    throw new Error(`OpenRouter-Fehler ${res.status}: ${body}`);
  }

  if (!stream) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  return res.body;
}

async function readStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") break;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) result += delta;
      } catch { /* skip malformed chunks */ }
    }
  }

  return result;
}

// JSON nur erlaubt \" \\ \/ \b \f \n \r \t \uXXXX. KI-Modelle schreiben aber oft
// LaTeX direkt in Strings (z. B. \( \frac \sqrt \\), was "Bad escaped character"
// auslöst. Wir verdoppeln jeden Backslash, der KEINE gültige JSON-Escape startet.
function sanitizeJSONEscapes(s) {
  return s.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
}

function parseJSON(text) {
  if (!text || !text.trim()) throw new SyntaxError("Empty AI response");
  let t = text.trim();
  if (t.includes("```json")) t = t.split("```json")[1].split("```")[0];
  else if (t.startsWith("```")) t = t.replace(/^```\w*\s*\n?/, "").replace(/\n?```\s*$/, "");
  t = t.trim();

  // Kandidaten in steigender Reparatur-Aggressivität durchprobieren.
  const candidates = [];
  const addBlock = (str) => {
    candidates.push(str);
    candidates.push(sanitizeJSONEscapes(str));
    for (const [open, close] of [["{", "}"], ["[", "]"]]) {
      const a = str.indexOf(open), b = str.lastIndexOf(close);
      if (a !== -1 && b > a) {
        const chunk = str.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1");
        candidates.push(chunk);
        candidates.push(sanitizeJSONEscapes(chunk));
      }
    }
  };
  addBlock(t);

  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }

  // Letzte Rettung: abgeschnittene Antworten (Token-Limit erreicht). Wir sammeln
  // alle VOLLSTÄNDIGEN {...}-Objekte aus dem Text; das letzte, unfertige fällt weg.
  const objs = extractCompleteObjects(t);
  if (objs.length) {
    const out = [];
    for (const o of objs) {
      for (const variant of [o, sanitizeJSONEscapes(o)]) {
        try { out.push(JSON.parse(variant)); break; } catch { /* next */ }
      }
    }
    if (out.length) {
      // Einzelobjekt-Antworten (z. B. editQuestionWithAI) nicht in ein Array zwingen.
      return (out.length === 1 && t.trimStart().startsWith("{")) ? out[0] : out;
    }
  }

  throw new SyntaxError("KI-Antwort enthält kein gültiges JSON. Bitte erneut versuchen.");
}

// Extrahiert alle vollständigen Top-Level-{...}-Objekte und respektiert dabei
// Strings/Escapes. Robust gegen abgeschnittene JSON-Arrays (Token-Limit).
function extractCompleteObjects(s) {
  const objs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { if (depth > 0 && --depth === 0 && start !== -1) { objs.push(s.slice(start, i + 1)); start = -1; } }
  }
  return objs;
}

// ─── Public API ──────────────────────────────────────────────────────

const QUIZ_ALL_TYPES = ["single_choice", "multiple_choice", "free_text", "fill_blank", "drag_drop", "drag_category", "math_formula", "key_points"];

export function normalizeQuizQuestion(q) {
  return {
    id: uid(),
    question_type: q.question_type,
    question_text: q.question_text,
    title: q.title ?? "",
    topic: q.topic ?? "",
    points: q.points ?? 1,
    options: q.options ?? [],
    correct_text: q.correct_text ?? "",
    blanks: q.blanks ?? [],
    drag_drop_pairs: q.drag_drop_pairs ?? [],
    correct_formula: q.correct_formula ?? "",
    tolerance: q.tolerance ?? 0.001,
    key_points: q.key_points ?? [],
    explanation: q.explanation ?? "",
  };
}

// Format-Regeln PRO TYP — nur die Regeln der erlaubten Typen landen im Prompt,
// damit abgewählte Typen dem Modell gar nicht erst vorgeschlagen werden.
const TYPE_RULES = {
  single_choice: '- Bei single_choice: genau eine Option ist korrekt, mindestens 3 Optionen.',
  multiple_choice: '- Bei multiple_choice: mindestens 2 Optionen sind korrekt, mindestens 4 Optionen.',
  free_text: `- Bei free_text: gib den korrekten Antworttext in "correct_text" an. Mehrere akzeptierte Antworten mit ';' trennen.`,
  fill_blank: '- Bei fill_blank: markiere Lücken im Fragetext mit ___ und liste die Lösungswörter in "blanks" auf.',
  drag_drop: '- Bei drag_drop: nur wenn 1:1-Zuordnungen (Begriff↔Definition). Liste Paare in "drag_drop_pairs" mit "source" und "target".',
  drag_category: '- Bei drag_category: wenn mehrere Begriffe in Kategorien eingeordnet werden sollen (z.B. 6 Begriffe auf 2 Kategorien). Nutze "drag_drop_pairs" wobei "source" der Begriff und "target" die Kategorie ist. Kategorien dürfen mehrfach vorkommen.',
  math_formula: '- Bei math_formula: Rechen-/Formelaufgabe. Gib die Lösung in "correct_formula" an (z.B. "x = 2" oder "a^2 + b^2").',
  key_points: `- Bei key_points: eine Aufzählungsfrage, bei der mehrere unabhängige Stichpunkte in BELIEBIGER Reihenfolge genannt werden müssen (z.B. "Nenne die Bestandteile von X", "Welche Ursachen hat Y"). Liste jeden Stichpunkt einzeln in "key_points" (Array von Strings). Pro Stichpunkt können Synonyme/alternative Formulierungen mit ';' angehängt werden (z.B. "Kohlensäure;CO2;Kohlendioxid"). Nutze 3-8 Stichpunkte.`,
};

// Baut einen prominent platzierten Block mit frei formulierten Nutzer-Anweisungen
// (z.B. "beachte nur rot markierte Stellen, lies die Hinweise") — wird an
// mehreren KI-Aufrufen wiederverwendet, deshalb als eigene Helper-Funktion.
function buildCustomInstructionsBlock(customInstructions) {
  const trimmed = (customInstructions || "").trim();
  if (!trimmed) return "";
  return `\nWICHTIGE ZUSATZANWEISUNG DES NUTZERS (unbedingt befolgen, hat Vorrang vor allgemeinen Regeln):\n${trimmed}\n`;
}

function buildQuizSystemPrompt(countRule, allowedArr, language, customInstructions) {
  const typesList = allowedArr.map(t => `"${t}"`).join(", ");
  const typesUnion = allowedArr.map(t => `"${t}"`).join(" | ");
  const typeRules = allowedArr.map(t => TYPE_RULES[t]).filter(Boolean).join("\n") +
    (allowedArr.length > 2 ? "\n- Bevorzuge Choice-/Text-Fragen; nutze Zuordnungs-/Formel-Typen nur, wo es inhaltlich passt." : "");
  return `Du bist ein erfahrener Pädagoge und Prüfungsexperte. Erstelle hochwertige Lernfragen auf Basis des gegebenen Textes.
WICHTIG: Extrahiere und erstelle Fragen zu ALLEN Inhalten des Textes – jedes Konzept, jede Definition, jeder Fakt soll abgedeckt werden. Überspringe NICHTS.
${buildCustomInstructionsBlock(customInstructions)}
Qualitätsregeln (entscheidend für gute Prüfungsfragen):
- Prüfe VERSTÄNDNIS und ANWENDUNG, nicht Wortlaut-Wiedergabe. Mische die Anspruchsniveaus:
  ~1/3 Reproduktion (Definitionen), ~1/3 Verständnis (Warum/Wie/Abgrenzung), ~1/3 Transfer (Anwendung auf neuen Fall).
- Falsche Antwortoptionen (Distraktoren) müssen PLAUSIBEL sein: typische Fehlvorstellungen,
  verwandte Begriffe, häufige Verwechslungen — niemals offensichtlich absurde Optionen.
- Jede Frage muss OHNE den Quelltext eigenständig verständlich sein. Verboten sind Formulierungen
  wie "laut Text", "im obigen Abschnitt", "wie in der Vorlesung erwähnt".
- Beziehe dich inhaltlich NUR auf den gegebenen Text. Erfinde keine Fakten, Zahlen oder Namen dazu.
- Vermeide Fragen zu Nebensächlichkeiten (Folien-Nummern, Beispielnamen, organisatorisches).

Format-Regeln:
- ${countRule}
- ABSOLUT VERBINDLICH: Das Feld "question_type" darf NUR einen dieser Werte haben: ${typesList}.
  Fragen mit anderen Typen werden VERWORFEN und sind verschwendete Arbeit. Wenn ein Inhalt nicht
  zu den erlaubten Typen passt, formuliere ihn passend um (z.B. als Frage des erlaubten Typs).
${typeRules}
- Sprache: ${language === "de" ? "Deutsch" : language}.

Antworte ausschließlich mit einem JSON-Array (kein Markdown, kein zusätzlicher Text) in diesem Format:
[
  {
    "question_type": ${typesUnion},
    "question_text": "Fragetext",
    "title": "Kurztitel der Frage",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "drag_drop_pairs": [{"source": "Begriff", "target": "Kategorie"}],
    "correct_formula": "",
    "key_points": ["Stichpunkt1;Synonym1", "Stichpunkt2"],
    "explanation": "Erklärung"
  }
]`;
}

export async function generateQuiz(text, numQuestions = 5, language = "de", config = {}) {
  const { apiKey, model } = await getConfig(config);

  const auto = !(numQuestions > 0);
  const detail = config.detailLevel || "normal";
  const detailHint = detail === "thorough"
    ? " Sei MAXIMAL gründlich: Erstelle zu JEDEM Konzept, jeder Definition, jedem Fakt und jeder Formel mindestens eine Frage. Lieber zu viele Fragen als zu wenige!"
    : detail === "compact"
    ? " Konzentriere dich auf die wichtigsten Kernkonzepte und erstelle nur die wesentlichsten Fragen."
    : "";

  const allowed = (Array.isArray(config.allowedTypes) && config.allowedTypes.length)
    ? QUIZ_ALL_TYPES.filter(t => config.allowedTypes.includes(t))
    : QUIZ_ALL_TYPES;
  const allowedArr = allowed.length ? allowed : QUIZ_ALL_TYPES;
  const onProgress = typeof config.onProgress === "function" ? config.onProgress : null;
  const customInstructions = config.customInstructions || "";

  // Wenn eine Chunk-Größe gesetzt ist und der Text größer ist als ein Chunk,
  // verarbeiten wir den Text abschnittsweise (kein Abschneiden bei großen PDFs).
  // Ein „Rolling Context" mit bereits abgedeckten Themen vermeidet Dopplungen.
  const chunkSize = Number(config.chunkSize) || 0;
  const useChunking = chunkSize > 0 && text.length > chunkSize;

  const runChunk = async (chunkText, perChunkRule, userPrefix) => {
    const systemPrompt = buildQuizSystemPrompt(perChunkRule, allowedArr, language, customInstructions);
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${userPrefix}\n\n${chunkText}` },
    ];
    const body = await chatCompletion(messages, { apiKey, model, stream: true });
    const raw = await readStream(body);
    const parsed = parseJSON(raw);
    if (!Array.isArray(parsed)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");
    return parsed;
  };

  let collected;
  if (useChunking) {
    const chunks = chunkText(text, chunkSize);
    // ceil statt round: lieber leicht überschießen und am Ende auf numQuestions
    // kappen, als die gewünschte Anzahl systematisch zu unterschreiten.
    const perChunkCount = auto ? 0 : Math.max(1, Math.ceil(numQuestions / chunks.length));
    const covered = []; // Titel/Themen bereits erzeugter Fragen (Rolling Context)
    collected = [];
    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(i + 1, chunks.length);
      const perChunkRule = auto
        ? `Erstelle zu diesem Abschnitt so viele sinnvolle Fragen wie nötig, um seinen Inhalt abzudecken.${detailHint}`
        : `Erstelle etwa ${perChunkCount} Fragen zu diesem Abschnitt.`;
      const contextHint = covered.length
        ? `Bereits erstellte Fragen (NICHT duplizieren):\n${covered.slice(-40).join("\n")}\n\n`
        : "";
      const prefix = `${contextHint}Abschnitt ${i + 1}/${chunks.length} des Lernmaterials:`;
      try {
        const part = await runChunk(chunks[i], perChunkRule, prefix);
        for (const q of part) {
          collected.push(q);
          const summary = q.topic ? `${q.topic}: ${(q.question_text || "").slice(0, 60)}` : (q.title || (q.question_text || "").slice(0, 60));
          covered.push(summary);
        }
      } catch (err) {
        // Ein fehlerhafter Abschnitt darf den Gesamtlauf nicht abbrechen.
        if (chunks.length === 1) throw err;
      }
    }
  } else {
    const countRule = auto
      ? `Entscheide selbst über die sinnvolle Anzahl Fragen, um den gesamten Stoff abzudecken (etwa eine Frage pro wichtigem Konzept). Erzeuge weder zu wenige noch unnötig viele.${detailHint}`
      : `Erstelle exakt ${numQuestions} Fragen.`;
    const countAsk = auto ? "So viele Prüfungsfragen wie sinnvoll" : `${numQuestions} Prüfungsfragen`;
    collected = await runChunk(text, countRule, `Erstelle ${countAsk} auf Basis dieses Textes:`);
  }

  // Typen STRIKT filtern. Vorher gab es einen stillen Fallback: lieferte das
  // Modell nur verbotene Typen, wurde die Nutzer-Auswahl komplett ignoriert.
  let filtered = collected;
  if (allowed.length && allowed.length < QUIZ_ALL_TYPES.length) {
    filtered = collected.filter(q => allowed.includes(q.question_type));
    if (!filtered.length && collected.length) {
      throw new Error(`Die KI hat keine Fragen der gewählten Typen erzeugt (${allowed.join(", ")}). ` +
        `Versuche es erneut oder wähle ein stärkeres Modell.`);
    }
  }

  // Dedupe über normalisierten Fragetext (wichtig bei Chunking-Überschneidungen)
  const seen = new Set();
  const deduped = [];
  for (const q of filtered) {
    const key = (q.question_text || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(q);
  }

  // Bei fester Anzahl + Chunking nicht über das Ziel hinausschießen
  const finalList = (useChunking && !auto && deduped.length > numQuestions)
    ? deduped.slice(0, numQuestions)
    : deduped;

  return finalList.map(normalizeQuizQuestion);
}

// Importiert BEREITS vorhandene Fragen 1:1 aus einem Dokument (Altklausur,
// Übungsblatt, Skript) – im Gegensatz zu generateQuiz, das neue Fragen erfindet.
// Unterstützt Chunking (config.chunkSize) + onProgress wie generateQuiz.
export async function importQuiz(text, language = "de", config = {}) {
  const { apiKey, model } = await getConfig(config);
  const onProgress = typeof config.onProgress === "function" ? config.onProgress : null;
  const customInstructions = config.customInstructions || "";

  // Optionale Typen-Whitelist: z.B. NUR math_formula aus einem Übungsblatt ziehen.
  const allowedImport = (Array.isArray(config.allowedTypes) && config.allowedTypes.length)
    ? QUIZ_ALL_TYPES.filter(t => config.allowedTypes.includes(t))
    : [];
  const importTypeRule = allowedImport.length
    ? `- ABSOLUT VERBINDLICH: Importiere NUR Fragen der Typen ${allowedImport.map(t => `"${t}"`).join(", ")}. ` +
      `Alle anderen Aufgaben im Dokument ÜBERSPRINGST du komplett.` +
      (allowedImport.includes("math_formula")
        ? `\n- Rechenaufgaben werden als "math_formula" importiert: Aufgabenstellung in "question_text", Lösung in "correct_formula".`
        : "")
    : `- Erkenne den Fragetyp automatisch: "single_choice", "multiple_choice", "free_text", "fill_blank", "drag_drop", "drag_category", "math_formula".
- Rechenaufgaben → "free_text" mit Lösung in "correct_text" (oder "math_formula" mit "correct_formula").`;

  const systemPrompt = `Du bist ein Experte für das Importieren von Prüfungsfragen aus Dokumenten.
Das Dokument enthält BEREITS fertige Fragen (z.B. aus Übungsskripten, Altklausuren, Arbeitsblättern).
Extrahiere ALLE vorhandenen Fragen und konvertiere sie 1:1 in das JSON-Format. ERFINDE KEINE neuen Fragen.

Regeln:
- Importiere ${allowedImport.length ? "jede passende" : "ABSOLUT JEDE einzelne"} Frage – überspringe ${allowedImport.length ? "nur Fragen fremder Typen" : "KEINE"}.
${importTypeRule}
- Behalte den originalen Fragentext möglichst bei.
- Wenn Antwortoptionen gegeben sind, markiere die richtigen via "is_correct".
- Bei fill_blank: Lücken mit ___ markieren, Lösungswörter in "blanks".
- Bei mehreren unabhängigen Gleichungen/Teilaufgaben (a, b, c …): JEDE wird eine EIGENE, eigenständig lösbare Frage.
- Sprache: ${language === "de" ? "Deutsch" : language}.
${buildCustomInstructionsBlock(customInstructions)}
Antworte ausschließlich mit einem JSON-Array (kein Markdown):
[
  {
    "question_type": "single_choice",
    "question_text": "Originaler Fragetext",
    "title": "Kurztitel",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "drag_drop_pairs": [{"source": "Begriff", "target": "Ziel"}],
    "correct_formula": "",
    "explanation": "Erklärung falls im Dokument vorhanden"
  }
]`;

  const runChunk = async (chunkStr, prefix) => {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${prefix}\n\n${chunkStr}` },
    ];
    const body = await chatCompletion(messages, { apiKey, model, stream: true });
    const raw = await readStream(body);
    const parsed = parseJSON(raw);
    if (!Array.isArray(parsed)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");
    return parsed;
  };

  const chunkSize = Number(config.chunkSize) || 0;
  const useChunking = chunkSize > 0 && text.length > chunkSize;

  let collected = [];
  if (useChunking) {
    const chunks = chunkText(text, chunkSize);
    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(i + 1, chunks.length);
      const prefix = `Importiere ALLE Fragen aus Abschnitt ${i + 1}/${chunks.length} dieses Dokuments:`;
      try {
        collected.push(...await runChunk(chunks[i], prefix));
      } catch (err) {
        if (chunks.length === 1) throw err;
      }
    }
  } else {
    collected = await runChunk(text, "Importiere ALLE Fragen aus diesem Dokument:");
  }

  // Typen-Whitelist strikt durchsetzen (Modelle ignorieren die Regel gelegentlich)
  if (allowedImport.length) {
    const kept = collected.filter(q => allowedImport.includes(q.question_type));
    if (!kept.length && collected.length) {
      throw new Error(`Im Dokument wurden keine Fragen der gewählten Typen gefunden (${allowedImport.join(", ")}).`);
    }
    collected = kept;
  }

  // Dedupe NUR beim Chunking (dort entstehen Überschneidungen an den
  // Abschnittsgrenzen). Ohne Chunking bleibt der Import strikt 1:1 —
  // Dokumente enthalten legitim identische Fragestämme ("Berechne:" …),
  // die vorher fälschlich verworfen wurden.
  let result = collected;
  if (useChunking) {
    const seen = new Set();
    result = [];
    for (const q of collected) {
      const key = (q.question_text || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      result.push(q);
    }
  }
  return result.map(normalizeQuizQuestion);
}

// Vordefinierte Schwierigkeitsstufen für generateDifficultyVariants(): jede
// Stufe bildet dieselbe Frage in einem anderen, zunehmend anspruchsvolleren
// Fragetyp ab. 3 Stufen überspringen multiple_choice, 4 Stufen nehmen es dazu.
export const VARIANT_LEVEL_PRESETS = {
  3: ["single_choice", "fill_blank", "free_text"],
  4: ["single_choice", "multiple_choice", "fill_blank", "free_text"],
};

/**
 * Wandelt eine Liste bereits importierter 1:1-Fragen (mit bekannter Lösung)
 * in denselben Fragetyp um — GLEICHE Reihenfolge, GLEICHE Anzahl, damit die
 * Frage an Index i über alle Schwierigkeitsstufen hinweg dieselbe bleibt und
 * die Level-Zuordnung rein über den Array-Index funktioniert.
 */
export async function generateDifficultyVariants(baseQuestions, targetType, language = "de", config = {}) {
  const { apiKey, model } = await getConfig(config);
  const typeRule = TYPE_RULES[targetType] || "";
  const customInstructions = config.customInstructions || "";

  const runBatch = async (batch) => {
    const source = batch.map((q, i) => ({
      nr: i + 1,
      text: q.question_text,
      answer: q.correct_text || q.correct_formula ||
        (q.options || []).filter(o => o.is_correct).map(o => o.text).join("; ") ||
        (q.blanks || []).join("; "),
      explanation: q.explanation || "",
    }));
    const messages = [
      {
        role: "system",
        content: `Du wandelst Prüfungsfragen mit BEKANNTER Lösung in den Fragetyp "${targetType}" um.
Der geprüfte Fakt/die Lösung darf sich NICHT ändern — nur das FORMAT der Frage.
${typeRule}
KRITISCH: Antworte mit GENAU ${batch.length} Fragen, in DERSELBEN Reihenfolge wie die Eingabe (Feld "nr" beibehalten) — Frage Nr. 1 bleibt Nr. 1, etc.
Sprache: ${language === "de" ? "Deutsch" : language}.
${buildCustomInstructionsBlock(customInstructions)}
Antworte NUR mit JSON: {"questions":[{"nr":1,"question_type":"${targetType}","question_text":"...","title":"...","topic":"...","points":1,"options":[{"text":"...","is_correct":true}],"correct_text":"","blanks":[],"correct_formula":"","explanation":"..."}]}`,
      },
      { role: "user", content: `Wandle diese ${batch.length} Fragen um:\n${JSON.stringify(source, null, 1)}` },
    ];
    const raw = await chatCompletion(messages, { apiKey, model, stream: false });
    const parsed = parseJSON(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed?.questions;
    if (!Array.isArray(arr)) throw new Error(`Umwandlung nach "${targetType}" fehlgeschlagen (kein Array in Antwort).`);
    // Nach "nr" sortieren und auf Batch-Länge auffüllen, damit Index-Zuordnung
    // auch bei fehlenden/vertauschten Einträgen stabil bleibt.
    const byNr = new Map(arr.map(q => [q.nr, q]));
    return batch.map((orig, i) => {
      const q = byNr.get(i + 1) || arr[i];
      if (!q) return { ...orig, question_type: targetType }; // Fallback: Original-Typ behalten statt Frage zu verlieren
      return { ...q, question_type: targetType };
    });
  };

  // In Batches von 10, damit Antwortgröße/Reihenfolge stabil bleiben.
  const BATCH = 10;
  const out = [];
  for (let i = 0; i < baseQuestions.length; i += BATCH) {
    if (typeof config.onProgress === "function") {
      config.onProgress(Math.floor(i / BATCH) + 1, Math.ceil(baseQuestions.length / BATCH));
    }
    out.push(...await runBatch(baseQuestions.slice(i, i + BATCH)));
  }
  return out.map(normalizeQuizQuestion);
}

// Generiert Fragen direkt aus einem Bild (Screenshot, Foto, Diagramm) via Vision-Modell.
// imageUrl: data:-URL oder http-URL. Nutzt immer ein Vision-Modell.
export async function generateQuizFromImage(imageUrl, numQuestions = 3, language = "de", config = {}) {
  const { apiKey } = await getConfig(config);
  // Falls ein Vision-fähiges Modell gewählt wurde, dieses nutzen, sonst Default-Vision-Modell.
  let model = config.model;
  const chosen = MODELS.find((m) => m.id === model);
  if (!chosen || !chosen.vision) model = VISION_MODEL;

  const IMG_TYPES = ["single_choice", "multiple_choice", "free_text", "fill_blank", "diagram_label", "math_formula"];
  let allowedImg = IMG_TYPES;
  if (Array.isArray(config.allowedTypes) && config.allowedTypes.length) {
    allowedImg = IMG_TYPES.filter(t => config.allowedTypes.includes(t));
    // Leere Schnittmenge = Auswahl unerfüllbar → klarer Fehler statt stillem
    // Zurückfallen auf alle Typen (das hat die Nutzer-Auswahl ignoriert).
    if (!allowedImg.length) {
      throw new Error(`Die gewählten Fragetypen sind für Bild-Fragen nicht verfügbar. Unterstützt: ${IMG_TYPES.join(", ")}.`);
    }
  }
  const imgTypesList = allowedImg.map(t => `"${t}"`).join(", ");
  const imgTypesUnion = allowedImg.map(t => `"${t}"`).join(" | ");
  const customInstructions = config.customInstructions || "";

  const detail = config.detailLevel || "normal";
  const detailHintImg = detail === "thorough"
    ? " Sei MAXIMAL gründlich: erstelle zu jedem erkennbaren Konzept im Bild eine Frage."
    : detail === "compact"
    ? " Konzentriere dich auf die wichtigsten Kernaussagen des Bildes."
    : "";

  const systemPrompt = `Du bist ein erfahrener Pädagoge. Analysiere das gezeigte Bild (Diagramm, Skizze, Screenshot, Tafelbild o.ä.) und erstelle daraus hochwertige Lernfragen.

Regeln:
- Erstelle bis zu ${numQuestions} Fragen, die sich auf den Bildinhalt beziehen.${detailHintImg}
- Verwende AUSSCHLIESSLICH diese Fragetypen: ${imgTypesList}. Andere Typen sind NICHT erlaubt.
- Wenn das Bild ein beschriftbares Diagramm ist, kannst du eine "diagram_label"-Frage erstellen: liste die zu beschriftenden Punkte in "diagram_labels" mit Name und relativer Position x/y (0-1) auf.
- Jede Frage braucht eine klare Erklärung.
- Bei single_choice: genau eine Option korrekt, min. 3 Optionen. Bei multiple_choice: min. 2 korrekt, min. 4 Optionen.
${imgTypesList.includes("math_formula") ? '- Bei math_formula: Rechen-/Formelaufgabe aus dem Bildinhalt. Lösung in "correct_formula" (z.B. "x = 2" oder "a^2 + b^2").\n' : ""}- Sprache: ${language === "de" ? "Deutsch" : language}.
${buildCustomInstructionsBlock(customInstructions)}
Antworte ausschließlich mit einem JSON-Array (kein Markdown):
[
  {
    "question_type": ${imgTypesUnion},
    "question_text": "Fragetext",
    "title": "Kurztitel",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "correct_formula": "",
    "diagram_labels": [{"label": "Bezeichnung", "x": 0.5, "y": 0.5}],
    "explanation": "Erklärung"
  }
]`;

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: `Erstelle bis zu ${numQuestions} Prüfungsfragen auf Basis dieses Bildes.` },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];

  const body = await chatCompletion(messages, { apiKey, model, stream: true });
  const raw = await readStream(body);
  const questions = parseJSON(raw);
  if (!Array.isArray(questions)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");

  let filteredImg = questions;
  if (allowedImg.length && allowedImg.length < IMG_TYPES.length) {
    filteredImg = questions.filter(q => allowedImg.includes(q.question_type));
    if (!filteredImg.length && questions.length) {
      throw new Error(`Die KI hat keine Fragen der gewählten Typen erzeugt (${allowedImg.join(", ")}).`);
    }
  }

  return filteredImg.map((q) => ({
    id: uid(),
    question_type: q.question_type,
    question_text: q.question_text,
    title: q.title ?? "",
    topic: q.topic ?? "",
    points: q.points ?? 1,
    options: q.options ?? [],
    correct_text: q.correct_text ?? "",
    blanks: q.blanks ?? [],
    drag_drop_pairs: q.drag_drop_pairs ?? [],
    diagram_labels: (q.diagram_labels ?? []).map((l) => ({
      label: l.label ?? "", x: Number(l.x ?? 0.5), y: Number(l.y ?? 0.5), _placed: false,
    })),
    diagram_image: q.question_type === "diagram_label" ? imageUrl : "",
    image: (q.question_type === "single_choice" || q.question_type === "multiple_choice") ? imageUrl : "",
    correct_formula: q.correct_formula ?? "",
    tolerance: q.tolerance ?? 0.001,
    explanation: q.explanation ?? "",
  }));
}

export async function generateQuizFromImages(imageUrls, numQuestions = 5, language = "de", config = {}, additionalText = undefined) {
  const { apiKey } = await getConfig(config);
  let model = config.model;
  const chosen = MODELS.find((m) => m.id === model);
  if (!chosen || !chosen.vision) model = VISION_MODEL;

  const onProgress = typeof config.onProgress === "function" ? config.onProgress : null;
  const chunkSize = Number(config.chunkSize) || 0; // Images per chunk (0 = all at once)
  const IMGS_TYPES = ["single_choice", "multiple_choice", "free_text", "fill_blank", "math_formula"];
  let allowedImgs = IMGS_TYPES;
  if (Array.isArray(config.allowedTypes) && config.allowedTypes.length) {
    allowedImgs = IMGS_TYPES.filter(t => config.allowedTypes.includes(t));
    if (!allowedImgs.length) {
      throw new Error(`Die gewählten Fragetypen sind für PDF-Bild-Fragen nicht verfügbar. Unterstützt: ${IMGS_TYPES.join(", ")}.`);
    }
  }
  const imgsTypesList = allowedImgs.map(t => `"${t}"`).join(", ");
  const imgsTypesUnion = allowedImgs.map(t => `"${t}"`).join(" | ");
  const customInstructions = config.customInstructions || "";

  const autoImg = !(numQuestions > 0);
  const detailImg = config.detailLevel || "normal";
  const detailHintImg = detailImg === "thorough"
    ? " Sei MAXIMAL gründlich: Erstelle zu JEDEM Konzept, jeder Definition, jedem Fakt, jeder Formel und jedem Diagramm mindestens eine Frage."
    : detailImg === "compact"
    ? " Konzentriere dich auf die wichtigsten Kernkonzepte."
    : "";

  const USE_CHUNKING = chunkSize > 0 && imageUrls.length > chunkSize;
  const effectiveChunkSize = USE_CHUNKING ? chunkSize : imageUrls.length;

  // Build chunk function
  const runImageChunk = async (imageBatch, batchStart, batchEnd, coveredTopics) => {
    const batchSize = imageBatch.length;
    const countRule = autoImg
      ? `Entscheide selbst über die sinnvolle Anzahl Fragen für diese ${batchSize} Seiten.${detailHintImg}`
      : `Erstelle ca. ${Math.ceil(numQuestions * batchSize / imageUrls.length)} Fragen aus diesen ${batchSize} Seiten.`;
    const countAsk = autoImg ? "So viele Prüfungsfragen wie sinnvoll" : `${Math.ceil(numQuestions * batchSize / imageUrls.length)} Prüfungsfragen`;

    const coveredHint = coveredTopics.length
      ? `\n\nBEREITS ERSTELLTE FRAGEN (NICHT duplizieren oder wiederholen):\n${coveredTopics.join("\n")}\nErstelle KEINE Fragen zu diesen Themen. Fokussiere auf NEUE, noch nicht abgefragte Inhalte.`
      : "";

    const systemPrompt = `Du bist ein erfahrener Pädagoge. Du erhältst ${batchSize} Bilder (gerenderte PDF-Seiten ${batchStart}-${batchEnd}). Analysiere den gesamten Inhalt und erstelle daraus hochwertige Lernfragen.
WICHTIG: Erstelle Fragen zu ALLEN Inhalten auf diesen Seiten.${coveredHint}

Regeln:
- ${countRule}
- Verwende AUSSCHLIESSLICH diese Fragetypen: ${imgsTypesList}.
- Achte besonders auf visuelle Inhalte: Diagramme, Grafiken, Formeln, Tabellen.
- Jede Frage muss eine klare Erklärung enthalten.
- Bei single_choice: genau eine Option korrekt, min. 3 Optionen. Bei multiple_choice: min. 2 korrekt, min. 4 Optionen.
${imgsTypesList.includes("math_formula") ? '- Bei math_formula: Rechen-/Formelaufgabe aus dem Seiteninhalt. Lösung in "correct_formula" (z.B. "x = 2" oder "a^2 + b^2").\n' : ""}- Sprache: ${language === "de" ? "Deutsch" : language}.
${buildCustomInstructionsBlock(customInstructions)}
Antworte ausschließlich mit einem JSON-Array:
[{
  "question_type": ${imgsTypesUnion},
  "question_text": "Fragetext",
  "title": "Kurztitel",
  "topic": "Themengebiet",
  "points": 1,
  "options": [{"text": "Antwort", "is_correct": true}],
  "correct_text": "",
  "blanks": [],
  "correct_formula": "",
  "explanation": "Erklärung"
}]`;

    const contentParts = [
      { type: "text", text: `Erstelle ${countAsk} auf Basis dieser ${batchSize} PDF-Seiten (Seite ${batchStart}-${batchEnd}).${additionalText ? `\n\nZusätzlicher Kontext:\n${additionalText}` : ""}${coveredHint}` },
      ...imageBatch.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    const body = await chatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: contentParts },
    ], { apiKey, model, stream: true });
    const raw = await readStream(body);
    const questions = parseJSON(raw);
    if (!Array.isArray(questions)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");
    return questions;
  };

  // Run chunked or single-pass
  let allQuestions;
  if (USE_CHUNKING) {
    allQuestions = [];
    const coveredTopics = [];
    const numChunks = Math.ceil(imageUrls.length / effectiveChunkSize);
    for (let i = 0; i < imageUrls.length; i += effectiveChunkSize) {
      const chunkIdx = Math.floor(i / effectiveChunkSize) + 1;
      if (onProgress) onProgress(chunkIdx, numChunks);
      const batch = imageUrls.slice(i, i + effectiveChunkSize);
      const batchStart = i + 1;
      const batchEnd = Math.min(i + effectiveChunkSize, imageUrls.length);
      const chunkQuestions = await runImageChunk(batch, batchStart, batchEnd, coveredTopics);
      // Build rich rolling context: topic + question snippet (up to 80 chars), deduped
      const newSummaries = [...new Set(
        chunkQuestions
          .map(q => `${q.topic || "?"}: ${(q.question_text || "").slice(0, 80)}`)
          .filter(s => s.length > 3)
      )];
      coveredTopics.push(...newSummaries);
      allQuestions.push(...chunkQuestions);
    }
    // Dedupe: remove questions with near-identical text
    const seen = new Set();
    allQuestions = allQuestions.filter(q => {
      const key = (q.question_text || "").slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    // Original single-pass behavior
    const countRuleImg = autoImg
      ? `Entscheide selbst über die sinnvolle Anzahl Fragen, um den gesamten Inhalt aller Seiten abzudecken.${detailHintImg}`
      : `Erstelle exakt ${numQuestions} Fragen basierend auf dem Gesamtinhalt aller Seiten.`;
    const countAskImg = autoImg ? "So viele Prüfungsfragen wie sinnvoll" : `${numQuestions} Prüfungsfragen`;

    const systemPrompt = `Du bist ein erfahrener Pädagoge. Du erhältst ${imageUrls.length} Bilder (gerenderte PDF-Seiten). Analysiere den gesamten Inhalt — Text, Diagramme, Formeln, Grafiken — und erstelle daraus hochwertige Lernfragen.
WICHTIG: Erstelle Fragen zu ALLEN Inhalten auf ALLEN Seiten – jedes Konzept, jede Definition, jeder Fakt, jede Formel soll abgedeckt werden. Überspringe NICHTS.

Regeln:
- ${countRuleImg}
- Verwende AUSSCHLIESSLICH diese Fragetypen: ${imgsTypesList}. Andere Typen sind NICHT erlaubt.
- Achte besonders auf visuelle Inhalte: Diagramme, Grafiken, Formeln, Tabellen.
- Jede Frage muss eine klare Erklärung enthalten.
- Bei single_choice: genau eine Option korrekt, min. 3 Optionen. Bei multiple_choice: min. 2 korrekt, min. 4 Optionen.
${imgsTypesList.includes("math_formula") ? '- Bei math_formula: Rechen-/Formelaufgabe aus dem Seiteninhalt. Lösung in "correct_formula" (z.B. "x = 2" oder "a^2 + b^2").\n' : ""}- Sprache: ${language === "de" ? "Deutsch" : language}.
${buildCustomInstructionsBlock(customInstructions)}
Antworte ausschließlich mit einem JSON-Array (kein Markdown):
[
  {
    "question_type": ${imgsTypesUnion},
    "question_text": "Fragetext",
    "title": "Kurztitel",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "correct_formula": "",
    "explanation": "Erklärung"
  }
]`;

    const contentParts = [
      { type: "text", text: `Erstelle ${countAskImg} auf Basis dieser ${imageUrls.length} PDF-Seiten.${additionalText ? `\n\nZusätzlicher Kontext:\n${additionalText}` : ""}` },
      ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    const body = await chatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: contentParts },
    ], { apiKey, model, stream: true });
    const raw = await readStream(body);
    allQuestions = parseJSON(raw);
    if (!Array.isArray(allQuestions)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");
  }

  let filteredImgs = allQuestions;
  if (allowedImgs.length && allowedImgs.length < IMGS_TYPES.length) {
    filteredImgs = allQuestions.filter(q => allowedImgs.includes(q.question_type));
    if (!filteredImgs.length && allQuestions.length) {
      throw new Error(`Die KI hat keine Fragen der gewählten Typen erzeugt (${allowedImgs.join(", ")}).`);
    }
  }

  // Bei fester Anzahl nicht überschießen (ceil pro Batch summiert sich sonst auf)
  if (!autoImg && filteredImgs.length > numQuestions) {
    filteredImgs = filteredImgs.slice(0, numQuestions);
  }

  return filteredImgs.map((q) => ({
    id: uid(),
    question_type: q.question_type,
    question_text: q.question_text,
    title: q.title ?? "",
    topic: q.topic ?? "",
    points: q.points ?? 1,
    options: q.options ?? [],
    correct_text: q.correct_text ?? "",
    blanks: q.blanks ?? [],
    drag_drop_pairs: q.drag_drop_pairs ?? [],
    correct_formula: q.correct_formula ?? "",
    tolerance: q.tolerance ?? 0.001,
    explanation: q.explanation ?? "",
  }));
}

export async function explainAnswer(question, userAnswer, correctAnswer, config = {}, imageUrl = null) {
  const { apiKey, model } = await getConfig(config);
  const useVision = !!imageUrl;
  const effectiveModel = useVision ? VISION_MODEL : model;

  let memoryPrefix = "";
  try {
    const s = await loadSettings();
    if (s.use_memory) memoryPrefix = await getFullMemoryPrompt();
  } catch (_) {}

  const textContent = `Frage: ${question}\n\nAntwort des Lernenden: ${userAnswer}\nRichtige Antwort: ${correctAnswer}\n\nErkläre bitte, warum die richtige Antwort korrekt ist und wo der Fehler lag (falls vorhanden).${useVision ? "\n\nDas Bild zeigt die zugehörige Aufgabe/das Diagramm. Beziehe dich in deiner Erklärung auf das Bild." : ""}`;

  const userContent = useVision
    ? [{ type: "text", text: textContent }, { type: "image_url", image_url: { url: imageUrl } }]
    : textContent;

  const messages = [
    {
      role: "system",
      content:
        (memoryPrefix ? memoryPrefix + "\n\n" : "") + "Du bist ein geduldiger Lerntutor. Erkläre dem Lernenden verständlich und ermutigend, warum eine Antwort richtig oder falsch ist." + (config.detailed ? " Gib eine AUSFÜHRLICHE Erklärung mit Hintergrundwissen und Beispielen." : " Antworte kompakt.") + " Antworte auf Deutsch." + (useVision ? " Dir wird auch ein Bild der Aufgabe gezeigt — beziehe dich darauf." : ""),
    },
    { role: "user", content: userContent },
  ];

  const body = await chatCompletion(messages, { apiKey, model: effectiveModel, stream: true });
  return readStream(body);
}

export async function askTutor(question, context = "", chatHistory = [], config = {}, imageUrl = null) {
  const { apiKey, model } = await getConfig(config);
  const useVision = !!imageUrl && chatHistory.length === 0;
  const effectiveModel = useVision ? VISION_MODEL : model;

  let memoryPrefix = "";
  try {
    const s = await loadSettings();
    if (s.use_memory) memoryPrefix = await getFullMemoryPrompt();
  } catch (_) {}

  const systemContent = (memoryPrefix ? memoryPrefix + "\n\n" : "") + `Du bist ein freundlicher und kompetenter Lerntutor. Hilf dem Lernenden, den Stoff zu verstehen.${config.detailed ? " Gib AUSFÜHRLICHE Antworten mit Hintergrundwissen, Beispielen und Eselsbrücken." : " Antworte kompakt."} Antworte auf Deutsch, klar und verständlich.${useVision ? " Dir wird ein Bild der Aufgabe gezeigt — beziehe dich darauf." : ""}${context ? `\n\nKontext:\n${context}` : ""}`;

  const userContent = useVision
    ? [{ type: "text", text: question }, { type: "image_url", image_url: { url: imageUrl } }]
    : question;

  const messages = [
    { role: "system", content: systemContent },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];

  const body = await chatCompletion(messages, { apiKey, model: effectiveModel, stream: true });
  return readStream(body);
}

export async function generateHints(question, config = {}) {
  const { apiKey, model } = await getConfig(config);

  const messages = [
    {
      role: "system",
      content:
        "Du bist ein Lerntutor. Erstelle 3 aufeinander aufbauende Hinweise für eine Prüfungsfrage. Der erste Hinweis soll allgemein sein, der zweite konkreter, der dritte fast die Antwort verraten. Antworte als JSON-Array mit 3 Strings. Kein Markdown.",
    },
    { role: "user", content: `Erstelle Hinweise für diese Frage:\n\n${question}` },
  ];

  const raw = await chatCompletion(messages, { apiKey, model, stream: false });
  const hints = parseJSON(raw);
  if (!Array.isArray(hints)) throw new Error("KI-Antwort ist kein gültiges Hinweis-Array.");
  return hints;
}

export async function explainWrongAnswers(question, wrongAnswers, config = {}) {
  const { apiKey, model } = await getConfig(config);

  const wrongList = wrongAnswers.map((a, i) =>
    `Versuch ${i + 1}: "${typeof a.answer === 'string' ? a.answer : JSON.stringify(a.answer)}"`).join("\n");

  const messages = [
    {
      role: "system",
      content:
        "Du bist ein geduldiger Lerntutor. Erkläre für eine falsch beantwortete Frage kurz und präzise (3-5 Sätze):\n" +
        "1. Warum die gegebenen Antworten falsch waren\n" +
        "2. Was die richtige Antwort ist und warum\n" +
        "3. Einen Merksatz, damit der Lernende es sich besser merken kann\n" +
        "Antworte auf Deutsch. Kein Markdown, reiner Text.",
    },
    {
      role: "user",
      content:
        `Frage: ${question.question_text || question.text || ""}\n` +
        `Fragetyp: ${question.question_type}\n` +
        `Richtige Antwort: ${question.correct_text || question.correct_answer || question.correct_formula || ""}\n` +
        `Optionen: ${JSON.stringify(question.options || question.blanks || [])}\n\n` +
        `Falsche Antworten des Nutzers:\n${wrongList}\n\n` +
        `Erkläre warum die Antworten falsch waren und gib die richtige Lösung.`,
    },
  ];

  const raw = await chatCompletion(messages, { apiKey, model, stream: false });
  return raw || "Keine Erklärung verfügbar.";
}

export async function simplifyExplanation(explanation, config = {}) {
  const { apiKey, model } = await getConfig(config);

  const messages = [
    {
      role: "system",
      content:
        "Du bist ein Lerntutor. Vereinfache die folgende Erklärung so, dass sie auch Anfänger verstehen. Verwende einfache Sprache, kurze Sätze und ggf. ein Beispiel. Antworte auf Deutsch.",
    },
    { role: "user", content: `Vereinfache diese Erklärung:\n\n${explanation}` },
  ];

  const body = await chatCompletion(messages, { apiKey, model, stream: true });
  return readStream(body);
}

export async function generateSummary(session, config = {}) {
  const { apiKey, model } = await getConfig(config);

  let memoryPrefix = "";
  try {
    const s = await loadSettings();
    if (s.use_memory) memoryPrefix = await getFullMemoryPrompt();
  } catch (_) {}

  const resultsText = session.questions.map((q, i) => {
    const r = session.answers[q.id];
    return `- Frage: ${q.question_text || q.text || ""}\n  Deine Antwort: ${r?.user_answer || "–"}\n  Richtig: ${r?.correct_answer || "–"}\n  Korrekt: ${r?.is_correct ? "Ja" : "Nein"}`;
  }).join("\n");

  const messages = [
    {
      role: "system",
      content:
        (memoryPrefix ? memoryPrefix + "\n\n" : "") + "Du bist ein hilfreicher Lernberater. Analysiere die Quiz-Ergebnisse und erstelle eine Zusammenfassung auf Deutsch mit drei Abschnitten:\n1. **Stärken** – Was der Student gut kann\n2. **Schwächen** – Wo Verbesserungsbedarf besteht\n3. **Lernempfehlungen** – Konkrete Tipps zum Verbessern",
    },
    { role: "user", content: `Hier sind meine Quiz-Ergebnisse:\n\n${resultsText}\n\nErstelle bitte eine Lernzusammenfassung.` },
  ];

  const body = await chatCompletion(messages, { apiKey, model, stream: true });
  return readStream(body);
}

const STUDY_PLAN_SYSTEM = `Du bist ein erfahrener Lernberater. Analysiere das folgende Lernmaterial (z.B. Klausur, Skript, Vorlesung, Übungsblatt) und erstelle einen strukturierten Lernplan.

Vorgehen (WICHTIG, in dieser Reihenfolge):
1. Verschaffe dir zuerst einen Überblick: Welche großen Themenblöcke/Kapitel deckt das Material ab?
2. Ein "Thema" ist ein OBERTHEMA (Kapitel-Ebene, z.B. "Quadratische Gleichungen"), NIEMALS ein Detail
   davon (z.B. "pq-Formel", "Diskriminante" — solche Details gehören als keyTerms UNTER das Oberthema).
3. Die Themenliste muss GEMEINSAM das GESAMTE Material abdecken — Breite geht vor Tiefe.
   Lass kein Oberthema weg, nur weil du Details eines anderen aufzählst.
4. Erkenne die Sprache des Dokuments automatisch.
5. Ordne die Themen in eine sinnvolle Lernreihenfolge (Grundlagen zuerst, dann aufbauend).
6. Erstelle für jedes Thema eine YouTube-Suchquery in der Dokumentsprache.
7. Schätze die Lernzeit pro Thema.

Negativbeispiel (FALSCH): 10 Themen, die alle Unterpunkte desselben Kapitels sind.
Positivbeispiel (RICHTIG): 5 Themen, die 5 verschiedene Kapitel des Materials abdecken,
jeweils mit den Detailbegriffen in keyTerms.

Antworte AUSSCHLIESSLICH mit diesem JSON (kein Markdown):
{
  "language": "de|en|...",
  "subject": "Fachbezeichnung",
  "title": "Lernplan: ...",
  "topics": [
    {
      "name": "Thema",
      "description": "Kurzbeschreibung was man lernen muss",
      "difficulty": "beginner|intermediate|advanced",
      "estimatedMinutes": 30,
      "youtubeQuery": "Suchbegriff für YouTube",
      "prerequisites": ["Vorheriges Thema falls nötig"],
      "keyTerms": ["Begriff1", "Begriff2"]
    }
  ],
  "totalHours": 10,
  "tips": ["Allgemeiner Lerntipp 1", "Tipp 2"]
}`;

export async function generateStudyPlan(text, config = {}) {
  const { apiKey, model } = await getConfig(config);
  const onProgress = typeof config.onProgress === "function" ? config.onProgress : null;

  let memoryPrefix = "";
  try {
    const s = await loadSettings();
    if (s.use_memory) memoryPrefix = await getFullMemoryPrompt();
  } catch (_) {}

  const detail = config.detailLevel || "coarse";
  const DETAIL_CAPS = { coarse: 5, medium: 10, fine: 50 };
  const globalCap = DETAIL_CAPS[detail] || 10;
  const detailHint = detail === "coarse"
    ? `\n\nWICHTIG zum Detailgrad: Extrahiere NUR die großen Hauptthemen-Blöcke. Fasse verwandte Konzepte zu EINEM Thema zusammen. MAXIMAL ${globalCap} Themen insgesamt, eher weniger. Keine Unterpunkte, keine Einzeldetails.`
    : detail === "fine"
    ? "\n\nWICHTIG zum Detailgrad: Extrahiere JEDES einzelne Konzept, jede Formel, jeden Unterpunkt als eigenes Thema. Sei maximal gründlich."
    : `\n\nWICHTIG zum Detailgrad: Extrahiere die Hauptthemen mit ihren wichtigsten Unterpunkten. MAXIMAL ${globalCap} Themen insgesamt. Ausgewogene Granularität.`;
  const systemContent = (memoryPrefix ? memoryPrefix + "\n\n" : "") + STUDY_PLAN_SYSTEM + detailHint;

  const runChunk = async (chunk, prefix) => {
    const messages = [
      { role: "system", content: systemContent },
      { role: "user", content: `${prefix}\n\n${chunk}` },
    ];
    const body = await chatCompletion(messages, { apiKey, model, stream: true });
    const raw = await readStream(body);
    const plan = parseJSON(raw);
    if (!plan || !Array.isArray(plan.topics)) throw new Error("KI-Antwort enthält keinen gültigen Lernplan.");
    return plan;
  };

  const chunkSize = Number(config.chunkSize) || 0;
  const useChunking = chunkSize > 0 && text.length > chunkSize;

  if (!useChunking) {
    const plan = await runChunk(text, "Analysiere dieses Lernmaterial und erstelle einen Lernplan:");
    // Detailgrad-Limit auch hier im Code durchsetzen (nicht nur im Prompt)
    if (detail !== "fine" && plan.topics.length > globalCap) {
      plan.topics = plan.topics.slice(0, globalCap);
      plan.totalHours = Math.round(plan.topics.reduce((s, t) => s + (t.estimatedMinutes || 30), 0) / 60);
    }
    return plan;
  }

  // Chunked: über mehrere Abschnitte/Vorlesungen hinweg Themen sammeln.
  // Rolling Context: bereits gefundene Themennamen mitgeben, damit die KI
  // im nächsten Abschnitt keine Dopplungen erzeugt.
  const chunks = chunkText(text, chunkSize);
  const merged = { language: "", subject: "", title: "", topics: [], tips: [] };
  const seenTopics = new Set();
  const seenTips = new Set();

  const useRolling = config.rollingContext !== false; // default on
  // Budget GLEICHMÄSSIG über alle Abschnitte verteilen. Ein früher Abbruch am
  // Gesamtlimit würde spätere Vorlesungen komplett überspringen — deren
  // Oberthemen fehlten dann im Plan, obwohl das Limit eigentlich nur die
  // Granularität steuern soll.
  const perChunkBudget = Math.max(1, Math.ceil(globalCap / chunks.length));
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i + 1, chunks.length);
    const covered = useRolling ? merged.topics.map(t => t.name).slice(-50) : [];
    const contextHint = covered.length
      ? `Bereits erfasste Themen (NICHT wiederholen, nur NEUE ergänzen — falls ein Abschnitt zu einem bereits erfassten Thema gehört, überspringe ihn):\n${covered.join("\n")}\n\n`
      : "";
    const budgetHint = ` Extrahiere MAXIMAL ${perChunkBudget} neue OBERTHEMEN aus diesem Abschnitt (Details als keyTerms zusammenfassen).`;
    const prefix = `${contextHint}Abschnitt ${i + 1}/${chunks.length} des Lernmaterials.${budgetHint} Extrahiere die hier vorkommenden Themen:`;
    try {
      const part = await runChunk(chunks[i], prefix);
      if (!merged.language && part.language) merged.language = part.language;
      if (!merged.subject && part.subject) merged.subject = part.subject;
      if (!merged.title && part.title) merged.title = part.title;
      for (const t of part.topics || []) {
        const key = (t.name || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || seenTopics.has(key)) continue;
        seenTopics.add(key);
        merged.topics.push(t);
      }
      for (const tip of part.tips || []) {
        const key = String(tip).toLowerCase().trim();
        if (!key || seenTips.has(key)) continue;
        seenTips.add(key);
        merged.tips.push(tip);
      }
    } catch (err) {
      if (chunks.length === 1) throw err;
    }
  }

  if (!merged.topics.length) throw new Error("KI-Antwort enthält keinen gültigen Lernplan.");
  // Weicher Cap: etwas Überhang zulassen (1 Thema pro Abschnitt), damit spätere
  // Vorlesungen nicht durch hartes Abschneiden aus dem Plan fallen.
  const hardCap = globalCap + chunks.length;
  if (merged.topics.length > hardCap) merged.topics = merged.topics.slice(0, hardCap);
  merged.totalHours = Math.round(merged.topics.reduce((s, t) => s + (t.estimatedMinutes || 30), 0) / 60);
  return merged;
}

export async function generateSubtopics(topicName, sourceText, language = "de", config = {}) {
  const { apiKey, model } = await getConfig(config);
  const maxSrc = Math.min((sourceText || "").length, 10000);
  const src = sourceText ? sourceText.slice(0, maxSrc) : "";
  const messages = [
    {
      role: "system",
      content: `Du bist ein Lernberater. Zerlege das angegebene Oberthema in konkrete Unterthemen/Lernschritte.
Pro Unterthema: Name, Kurzbeschreibung, Schwierigkeitsgrad, geschätzte Lernzeit, YouTube-Suchquery, Schlüsselbegriffe.
Antworte AUSSCHLIESSLICH mit einem JSON-Array (kein Markdown):
[
  {
    "name": "Unterthema",
    "description": "Was man lernen muss",
    "difficulty": "beginner|intermediate|advanced",
    "estimatedMinutes": 15,
    "youtubeQuery": "Suchbegriff",
    "keyTerms": ["Begriff1", "Begriff2"]
  }
]`
    },
    {
      role: "user",
      content: `Oberthema: "${topicName}" (Sprache: ${language})\n\n${src ? `Quellmaterial:\n${src}` : "Kein Quellmaterial vorhanden — nutze dein Wissen."}\n\nErstelle 3–6 Unterthemen für dieses Oberthema.`,
    },
  ];
  const body = await chatCompletion(messages, { apiKey, model, stream: true });
  const raw = await readStream(body);
  const parsed = parseJSON(raw);
  if (!Array.isArray(parsed)) throw new Error("KI-Antwort ist kein gültiges Unterthemen-Array.");
  return parsed;
}

export async function analyzeClozeKeywords(text, minChars = 1200, maxChars = 2500, config = {}) {
  const { apiKey, model } = await getConfig(config);
  const lengthHint = `Der Text soll zwischen ${minChars} und ${maxChars} Zeichen lang sein. `;

  const messages = [
    {
      role: "system",
      content:
        "Du bist ein Experte für Lernmaterial. Erstelle eine EIGENE Zusammenfassung des gegebenen " +
        "Textes als Fließtext. KOPIERE NICHT den Originaltext! " +
        lengthHint +
        "Identifiziere dann die wichtigsten Fachbegriffe, Zahlen und Schlüsselwörter im Text. " +
        'Antworte mit exakt diesem JSON-Format:\n' +
        '{"summary": "Dein zusammenfassender Fließtext hier...", ' +
        '"keywords": [{"word": "Wort1", "index": 0}, {"word": "Wort2", "index": 50}]}\n' +
        "WICHTIG: 'index' ist die Zeichenposition wo das Wort im summary-Text BEGINNT. " +
        "Jedes keyword muss EXAKT so im summary vorkommen wie angegeben. " +
        "Identifiziere 10-30 relevante Wörter.",
    },
    {
      role: "user",
      content: `Erstelle eine lernfreundliche Zusammenfassung und identifiziere Schlüsselwörter:\n\n${text}`,
    },
  ];

  const raw = await chatCompletion(messages, { apiKey, model, stream: false });
  if (!raw) return { summary: text, keywords: [] };

  try {
    const obj = parseJSON(raw);
    const summary = obj.summary || text;
    const keywords = (obj.keywords || [])
      .filter(kw => kw.word && summary.includes(kw.word))
      .map(kw => ({ word: kw.word, index: summary.indexOf(kw.word) }));
    return { summary, keywords };
  } catch {
    return { summary: text, keywords: [] };
  }
}

export async function aiValidateAnswer(questionText, correctAnswer, userAnswer, config = {}) {
  const { apiKey, model } = await getConfig(config);
  const messages = [
    {
      role: "system",
      content:
        "Du bist ein Prüfungsbewerter. Prüfe ob die Antwort des Studenten inhaltlich korrekt ist. " +
        "Ignoriere Tippfehler und kleine Formulierungsunterschiede. " +
        "Antworte NUR mit 'JA' oder 'NEIN'.",
    },
    {
      role: "user",
      content:
        `Frage: ${questionText}\nRichtige Antwort: ${correctAnswer}\nAntwort des Studenten: ${userAnswer}\n\nIst die Antwort inhaltlich korrekt? Antworte nur mit JA oder NEIN.`,
    },
  ];
  const raw = await chatCompletion(messages, { apiKey, model, stream: false });
  if (!raw) return false;
  return raw.trim().toUpperCase().startsWith("JA");
}

export async function editQuestionWithAI(question, instruction, targetType = null, config = {}) {
  const { apiKey, model } = await getConfig(config);

  const typeHint = targetType && targetType !== question.question_type
    ? `\nWICHTIG: Wandle die Frage in den Typ "${targetType}" um. Passe Optionen/Felder entsprechend an.`
    : "";

  const systemPrompt = `Du bist ein Prüfungsexperte. Du erhältst eine bestehende Quizfrage als JSON und eine Änderungsanweisung.
Gib die überarbeitete Frage als einzelnes JSON-Objekt zurück (kein Array, kein Markdown).
Behalte alle Felder bei und ändere nur, was nötig ist.${typeHint}

Fragetypen und ihre Pflichtfelder:
- "single_choice": options (Array mit is_correct, genau 1x true), min 3 Optionen
- "multiple_choice": options (Array mit is_correct, min 2x true), min 4 Optionen
- "free_text": correct_text (String)
- "fill_blank": question_text mit ___ Lücken, blanks (Array der Lösungswörter)
- "drag_drop": options mit drag_items und drop_targets Arrays
- "diagram_label": diagram_labels Array
- "mark_image": mark_regions Array
- "math_formula": correct_formula, tolerance
- "key_points": key_points (Array von Stichpunkt-Strings, Synonyme mit ';' trennen)`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Aktuelle Frage:\n${JSON.stringify(question, null, 2)}\n\nAnweisung: ${instruction}` },
  ];

  const raw = await chatCompletion(messages, { apiKey, model, stream: false });
  const edited = parseJSON(raw);
  if (!edited || typeof edited !== "object") throw new Error("KI-Antwort ist kein gültiges Fragen-Objekt.");
  edited.id = question.id;
  return edited;
}

// ── Fast helpers for mini-games (use ultra-fast free model, no streaming) ──

async function chatFast(messages, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": globalThis.location?.origin ?? "https://lerntrainer.app",
        "X-Title": "Lerntrainer PWA",
      },
      body: JSON.stringify({ model: FAST_MODEL, messages, temperature: 0.3, max_tokens: 300 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? "").trim();
  } catch { return null; }
}

// Check a free-text answer using AI. Returns { correct: bool, feedback: string }.
export async function checkFreeTextAI(question, userAnswer, acceptedAnswers) {
  const { apiKey } = await getConfig();
  if (!apiKey) return null;
  const messages = [
    {
      role: "system",
      content: `Du bist ein strenger aber fairer Lehrer. Prüfe ob die Antwort des Schülers inhaltlich korrekt ist.
Akzeptierte Antworten als Referenz: ${acceptedAnswers.join(", ")}
Antworte NUR mit einem JSON-Objekt: {"correct":true/false,"feedback":"kurze Begründung in 1 Satz"}
Sei tolerant bei Tippfehlern und Synonymen, aber die Kernaussage muss stimmen.`,
    },
    { role: "user", content: `Frage: ${question}\nAntwort: ${userAnswer}` },
  ];
  const raw = await chatFast(messages, apiKey);
  if (!raw) return null;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

// Generate a short explanation for a wrong answer on demand.
export async function quickExplain(question, correctAnswer, userAnswer) {
  const { apiKey } = await getConfig();
  if (!apiKey) return null;
  const messages = [
    {
      role: "system",
      content: "Du bist ein Lerntutor. Erkläre in 2-3 kurzen Sätzen, warum die richtige Antwort korrekt ist. Einfache Sprache, auf Deutsch.",
    },
    {
      role: "user",
      content: `Frage: ${question}\nRichtige Antwort: ${correctAnswer}${userAnswer ? `\nAntwort des Schülers: ${userAnswer}` : ""}\n\nErkläre kurz.`,
    },
  ];
  return chatFast(messages, apiKey);
}

// ─── Math scaffolding pipeline ───────────────────────────────────────
// Mirrors the desktop pipeline: extract individual sub-tasks → solve each
// step by step (multi-step calc_chain) → optionally generate similar tasks.

// Tolerant JSON extraction: handles prose around the JSON and code fences.
function parseJSONLoose(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.includes("```json")) t = t.split("```json")[1].split("```")[0];
  else if (t.startsWith("```")) t = t.replace(/^```\w*\s*\n?/, "").replace(/\n?```\s*$/, "");
  try { return JSON.parse(t.trim()); } catch { /* fall through */ }
  // Grab the outermost {...} or [...] block
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const s = t.indexOf(open), e = t.lastIndexOf(close);
    if (s !== -1 && e > s) {
      let chunk = t.slice(s, e + 1).replace(/,\s*([}\]])/g, "$1"); // strip trailing commas
      try { return JSON.parse(chunk); } catch { /* try next */ }
    }
  }
  return null;
}

const MATH_EXTRACT_PROMPT = `Du bist ein Experte für Mathematik-Aufgaben. Extrahiere ALLE Rechenaufgaben aus dem Text.
WICHTIG: Jede eigenständige Teilaufgabe wird EINZELN extrahiert. Wenn eine Aufgabe Teilaufgaben a) b) c) hat, die zusammengehören (gleicher Kontext), fasse sie als eine Aufgabe. Wenn es jedoch unterschiedliche, unabhängige Gleichungen/Aufgaben sind (z.B. g, h, i, j, k), wird JEDE eine eigene Aufgabe.

Antworte NUR mit JSON:
{
  "tasks": [
    {
      "text": "Vollständiger Aufgabentext",
      "given": {"a": 2, "b": 5, "c": -3},
      "sought": "x",
      "topic": "Quadratische Gleichungen"
    }
  ]
}`;

const MATH_SOLVE_PROMPT = `Du bist ein Mathematik-Tutor. Löse die Aufgabe SCHRITT FÜR SCHRITT.

{user_instructions}

WICHTIG: Viele Aufgaben erfordern MEHRERE Rechenschritte mit verschiedenen Formeln.
Beispiel: Erst R_ges = R1 + R2 berechnen, dann I = U / R_ges, dann P = U * I.
Jeder Rechenschritt ist ein eigener Eintrag in "calc_chain"!

Antworte NUR mit JSON:
{
  "calc_chain": [
    {
      "step_nr": 1,
      "formula_name": "Reihenschaltung Gesamtwiderstand",
      "formula_latex": "R_{ges} = R_1 + R_2",
      "description": "Gesamtwiderstand berechnen",
      "inputs": [
        {"symbol": "R_1", "name": "Widerstand 1", "unit": "Ω", "value": 100},
        {"symbol": "R_2", "name": "Widerstand 2", "unit": "Ω", "value": 200}
      ],
      "result_symbol": "R_ges",
      "result_unit": "Ω",
      "result_numeric": [300],
      "result_text": "R_ges = 300 Ω",
      "linear_notation": "R_ges = 100 + 200 = 300"
    },
    {
      "step_nr": 2,
      "formula_name": "Ohmsches Gesetz",
      "formula_latex": "I = \\\\frac{U}{R_{ges}}",
      "description": "Strom berechnen (nutzt R_ges aus Schritt 1)",
      "inputs": [
        {"symbol": "U", "name": "Spannung", "unit": "V", "value": 12},
        {"symbol": "R_ges", "name": "Gesamtwiderstand", "unit": "Ω", "value": 300, "from_step": 1}
      ],
      "result_symbol": "I",
      "result_unit": "A",
      "result_numeric": [0.04],
      "result_text": "I = 0,04 A",
      "linear_notation": "I = 12 / 300 = 0,04"
    }
  ],
  "final_result_text": "R_ges = 300 Ω, I = 0,04 A",
  "final_result_numeric": [300, 0.04]
}

Regeln:
- JEDER Rechenschritt mit eigener Formel = eigener Eintrag in "calc_chain"
- Nutzt ein Schritt ein vorheriges Ergebnis: "from_step" setzen
- Auch einfache Aufgaben → calc_chain mit EINEM Eintrag
- "result_numeric" als Array (z.B. [1, -1.75] bei quadratischer Gleichung)
- Runde auf sinnvolle Nachkommastellen`;

const MATH_GENERATE_PROMPT = `Du bist ein Mathematik-Aufgaben-Generator. Erstelle {count} neue Aufgaben vom selben Typ und Schwierigkeitsgrad wie die Beispielaufgabe.

Beispielaufgabe:
{example}

Antworte NUR mit JSON:
{
  "tasks": [
    {"text": "Aufgabentext", "given": {"a": 2, "b": 5, "c": -3}, "sought": "x", "result_text": "x1 = 0,5; x2 = -3", "result_numeric": [0.5, -3]}
  ]
}

Regeln:
- Variiere die Zahlen, behalte Typ bei
- Wähle Zahlen die schöne Ergebnisse ergeben
- Rechne jede Aufgabe KORREKT durch`;

const MATH_VERIFY_PROMPT = `Du bist ein präziser Mathematik-Prüfer. Rechne die Aufgabe unabhängig nach und korrigiere das behauptete Ergebnis falls nötig.
Antworte NUR mit JSON: {"correct": true/false, "result_text": "...", "result_numeric": [...]}`;

// Split text on page markers / large gaps so each call sees a coherent chunk.
// Falls back to paragraph-based splitting when no page markers exist.
function chunkText(text, maxLen = 9000) {
  const pages = text.split(/--- ?Seite ?---|\f/);
  // If no markers were found (single element = original text), split on paragraphs
  const parts = pages.length <= 1
    ? text.split(/\n\s*\n/)
    : pages;
  const chunks = [];
  let buf = "";
  for (const p of parts) {
    if (buf && (buf + p).length > maxLen) { chunks.push(buf); buf = ""; }
    buf += (buf ? "\n\n" : "") + p;
  }
  if (buf.trim()) chunks.push(buf);
  // If a single chunk still exceeds maxLen (e.g. one giant paragraph), force-split it
  const final = [];
  for (const c of chunks) {
    if (c.length <= maxLen) { final.push(c); continue; }
    for (let i = 0; i < c.length; i += maxLen) final.push(c.slice(i, i + maxLen));
  }
  return final.length ? final : [text];
}

// ═══════════════════════════════════════════════════════════════════════════
// "Trick erkennen"-Modus: Mathe-Aufgaben, bei denen der entscheidende Kniff
// (Umformung/Vereinfachung) erkannt werden muss, bevor man weiterrechnet.
// Extrahiert Aufgabe + Trick + vollständigen LaTeX-Lösungsweg, prüft dann die
// Nutzer-Eingabe des erkannten Tricks semantisch (nicht wortgleich).
// ═══════════════════════════════════════════════════════════════════════════

const TRICK_EXTRACT_PROMPT = `Du bist ein Mathematik-Dozent. Analysiere den gegebenen Text (Übungsblatt, Skript, Klausur) und finde Aufgaben, bei denen ein entscheidender TRICK/KNIFF nötig ist, um effizient zur Lösung zu kommen — z.B.:
- Quadratische Form in Nullstellenform umschreiben, um einen Bruch zu kürzen
- Binomische Formel erkennen statt stur auszumultiplizieren
- Substitution, um eine Gleichung auf bekannte Form zu bringen
- Erweitern/Kürzen, um eine Definitionslücke zu beheben oder einen Grenzwert zu berechnen
- Trigonometrische Identität statt direkter Berechnung
- Partialbruchzerlegung, quadratische Ergänzung, geschicktes Faktorisieren, etc.

Ignoriere reine Rechenaufgaben ohne einen solchen Kniff — nur Aufgaben mit einem klar benennbaren "Aha-Moment" zählen.

Für jede gefundene Aufgabe:
- "text": vollständige Aufgabenstellung (LaTeX für Formeln, z.B. $...$)
- "trick_name": kurzer Name des Tricks (z.B. "Nullstellenform statt Faktorisieren", "3. Binomische Formel")
- "trick_hint": 1 Satz, WARUM/WANN man diesen Trick anwendet (ohne die Lösung zu verraten)
- "trick_explanation": 2-3 Sätze, die den Trick nach dem Erkennen erklären (LaTeX für Formeln)
- "steps": Array von Lösungsschritten als LaTeX-Strings, chronologisch. Der Schritt, in dem der Trick angewendet wird, bekommt zusätzlich "isTrickStep": true.
- "finalAnswer": Endergebnis (LaTeX)

Antworte NUR mit JSON: {"tasks":[{"text":"...","trick_name":"...","trick_hint":"...","trick_explanation":"...","steps":[{"text":"...","isTrickStep":false}],"finalAnswer":"..."}]}`;

export async function extractMathTricks(text, config = {}, onProgress = null) {
  const { apiKey, model } = await getConfig(config);
  const chunks = chunkText(text);
  const all = [];
  const seen = new Set();
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i + 1, chunks.length, "Tricks erkennen");
    const raw = await chatCompletion(
      [{ role: "system", content: TRICK_EXTRACT_PROMPT },
       { role: "user", content: `Abschnitt ${i + 1}/${chunks.length} des Materials:\n\n${chunks[i]}` }],
      { apiKey, model }
    );
    const parsed = parseJSONLoose(raw);
    for (const t of (parsed?.tasks ?? [])) {
      const key = (t.text || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (key && !seen.has(key)) { seen.add(key); all.push(t); }
    }
  }
  return all;
}

/** Prüft SEMANTISCH, ob die Nutzer-Eingabe den richtigen Trick trifft (nicht wortgleich). */
export async function checkTrickGuess(task, userGuess, config = {}) {
  const { apiKey, model } = await getConfig(config);
  const raw = await chatCompletion([
    {
      role: "system",
      content: `Du prüfst, ob ein Lernender den entscheidenden Lösungs-Trick einer Mathe-Aufgabe erkannt hat.
Die Eingabe muss NICHT wortgleich sein — akzeptiere Synonyme, Umgangssprache und unvollständige aber inhaltlich richtige Beschreibungen.
Sei bei der Kernidee streng: eine vage/falsche Antwort ("irgendwas kürzen") ohne den eigentlichen Kniff zu benennen ist FALSCH.
Antworte NUR mit JSON: {"correct": true, "feedback": "1-2 Sätze Feedback"}`,
    },
    {
      role: "user",
      content: `Aufgabe: ${task.text}\nGesuchter Trick: "${task.trick_name}" — ${task.trick_explanation}\n\nEingabe des Lernenden: "${userGuess}"\n\nHat der Lernende den Trick richtig erkannt?`,
    },
  ], { apiKey, model, stream: false });
  const result = parseJSONLoose(raw);
  if (!result || typeof result.correct !== "boolean") {
    return { correct: false, feedback: "Antwort konnte nicht geprüft werden — versuch es erneut." };
  }
  return result;
}

export async function extractMathTasks(text, instructions = "", config = {}, onProgress = null) {
  const { apiKey, model } = await getConfig(config);
  const chunks = chunkText(text);
  const all = [];
  const seen = new Set();
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i + 1, chunks.length, "Aufgaben extrahieren");
    const sys = MATH_EXTRACT_PROMPT + (instructions ? `\n\nBenutzer-Anweisungen: ${instructions}` : "");
    const raw = await chatCompletion(
      [{ role: "system", content: sys },
       { role: "user", content: `Abschnitt ${i + 1}/${chunks.length}:\n\n${chunks[i]}` }],
      { apiKey, model }
    );
    const parsed = parseJSONLoose(raw);
    for (const t of (parsed?.tasks ?? [])) {
      const key = ((t.text || "") + "|" + JSON.stringify(t.given || {})).toLowerCase().trim();
      if (key && !seen.has(key)) { seen.add(key); all.push(t); }
    }
  }
  return all;
}

export async function solveMathTasks(tasks, instructions = "", config = {}, onProgress = null) {
  const { apiKey, model } = await getConfig(config);
  const instrText = instructions ? `WICHTIG – Benutzer-Anweisungen: ${instructions}` : "";
  const sys = MATH_SOLVE_PROMPT.replace("{user_instructions}", instrText);
  let done = 0;
  // Solve concurrently – each task is an independent call.
  const results = await Promise.all(tasks.map(async (task) => {
    const raw = await chatCompletion(
      [{ role: "system", content: sys },
       { role: "user", content: `Aufgabe: ${task.text}\nGegeben: ${JSON.stringify(task.given || {})}\nGesucht: ${task.sought || "?"}` }],
      { apiKey, model }
    );
    const sol = parseJSONLoose(raw) || {};
    done++;
    if (onProgress) onProgress(done, tasks.length, "Aufgaben lösen");
    return { ...task, ...sol };
  }));
  return results;
}

export async function generateSimilarTasks(example, count = 5, config = {}, verify = true) {
  const { apiKey, model } = await getConfig(config);
  const sys = MATH_GENERATE_PROMPT
    .replace("{count}", count)
    .replace("{example}", JSON.stringify(example, null, 2));
  const raw = await chatCompletion(
    [{ role: "system", content: sys },
     { role: "user", content: `Erstelle ${count} ähnliche Aufgaben.` }],
    { apiKey, model }
  );
  let tasks = (parseJSONLoose(raw)?.tasks) ?? [];
  if (verify && tasks.length) {
    tasks = await Promise.all(tasks.map(async (task) => {
      try {
        const v = parseJSONLoose(await chatCompletion(
          [{ role: "system", content: MATH_VERIFY_PROMPT },
           { role: "user", content: `Aufgabe: ${task.text}\nGegeben: ${JSON.stringify(task.given || {})}\nGesucht: ${task.sought || "?"}\nBehauptetes Ergebnis: ${task.result_text || ""} ${JSON.stringify(task.result_numeric || [])}` }],
          { apiKey, model }
        ));
        if (v && v.correct === false) {
          if (v.result_text) task.result_text = v.result_text;
          if (v.result_numeric) task.result_numeric = v.result_numeric;
        }
      } catch { /* keep original on verify failure */ }
      return task;
    }));
  }
  return tasks;
}

// ═══════════════════════════════════════════════════════════════════════════
// Probeklausur-Pipeline: Seiten analysieren → Aufgaben lösen → verifizieren →
// Nutzer-Antworten bewerten → Klausuren im Stil generieren.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analysiert gerenderte Klausur-Seiten (Bilder) via Vision:
 * erkennt alle Aufgaben mit Position (für Screenshots), Punkten und Typ.
 */
export async function analyzeExamPages(imageUrls, config = {}) {
  const { apiKey } = await getConfig(config);
  let model = config.model;
  const chosen = MODELS.find((m) => m.id === model);
  if (!chosen || !chosen.vision) model = VISION_MODEL;

  const batchSize = 3;
  const style = { subject: "", title: "", examType: "", totalPoints: 0, durationMin: 0, styleNotes: "" };
  const tasks = [];

  for (let i = 0; i < imageUrls.length; i += batchSize) {
    const batch = imageUrls.slice(i, i + batchSize);
    if (config.onProgress) config.onProgress(Math.floor(i / batchSize) + 1, Math.ceil(imageUrls.length / batchSize), "Analysiere Seiten");
    const raw = await chatCompletion([
      {
        role: "system",
        content: `Du analysierst Klausur-Seiten. Erkenne JEDE Aufgabe/Teilaufgabe (a, b, c zählen als eigene Aufgaben, wenn eigenständig lösbar).
Für jede Aufgabe:
- "number": Aufgabennummer wie gedruckt (z.B. "1", "2a").
- "page": Seitenindex innerhalb DIESER Bilder (1 = erstes Bild dieser Nachricht).
- "yStart"/"yEnd": vertikale Position der Aufgabe auf der Seite (0 = oben, 1 = unten), großzügig geschätzt.
- "text": vollständige Aufgabenstellung als Text (Formeln in LaTeX).
- "type": "calc" (Rechnen), "proof" (Beweis/Herleitung), "text" (Erklärung/Definition), "draw" (Zeichnen/Skizzieren), "multiple_choice".
- "points": gedruckte Punktzahl; wenn KEINE gedruckt ist, schätze realistisch und setze "pointsEstimated": true.
- "solvable": false NUR wenn die Lösung nicht als Text darstellbar ist (z.B. Zeichnung anfertigen).
Erkenne außerdem Metadaten (nur beim ersten Vorkommen): "subject" (Fach), "title", "examType" (z.B. "Klausur", "Probeklausur"), "durationMin", "styleNotes" (2-3 Sätze: Aufgabenstil, Schwierigkeitsgrad, Struktur — als Vorlage für ähnliche Klausuren).
Antworte NUR mit JSON: {"meta":{"subject":"...","title":"...","examType":"...","durationMin":0,"styleNotes":"..."},"tasks":[{"number":"...","page":1,"yStart":0.1,"yEnd":0.4,"text":"...","type":"calc","points":4,"pointsEstimated":false,"solvable":true}]}`,
      },
      {
        role: "user",
        content: [
          ...batch.map(url => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: `Analysiere diese ${batch.length} Klausur-Seiten (Seiten ${i + 1}-${i + batch.length} der Klausur). Erkenne ALLE Aufgaben.` },
        ],
      },
    ], { apiKey, model, stream: false });
    const parsed = parseJSON(raw);
    if (parsed?.meta) {
      for (const k of ["subject", "title", "examType", "styleNotes"]) {
        if (!style[k] && parsed.meta[k]) style[k] = parsed.meta[k];
      }
      if (!style.durationMin && parsed.meta.durationMin) style.durationMin = parsed.meta.durationMin;
    }
    for (const t of parsed?.tasks || []) {
      // Batch-Offset → globaler Seitenindex; points immer als Zahl normalisieren
      tasks.push({ ...t, page: (t.page || 1) + i, points: Number(t.points) || 1 });
    }
  }

  style.totalPoints = tasks.reduce((s, t) => s + (Number(t.points) || 0), 0);
  return { style, tasks };
}

/**
 * Löst eine Klausur-Aufgabe (mit Seiten-Screenshot als Kontext).
 * Nicht lösbare Aufgaben (Zeichnungen etc.) werden nur beschrieben.
 */
export async function solveExamTask(task, pageImage, config = {}) {
  const { apiKey } = await getConfig(config);
  let model = config.model;
  const chosen = MODELS.find((m) => m.id === model);
  if (pageImage && (!chosen || !chosen.vision)) model = VISION_MODEL;

  const content = [];
  if (pageImage) content.push({ type: "image_url", image_url: { url: pageImage } });
  content.push({
    type: "text",
    text: `Aufgabe ${task.number} (${task.points} Punkte, Typ: ${task.type}):\n${task.text}\n\n` +
      (task.solvable === false
        ? "Diese Aufgabe kann nicht als Text gelöst werden (z.B. Zeichnung). BESCHREIBE stattdessen präzise, was eine korrekte Lösung enthalten muss."
        : "Löse diese Aufgabe vollständig, Schritt für Schritt."),
  });

  const raw = await chatCompletion([
    {
      role: "system",
      content: `Du bist ein Experte, der Klausur-Aufgaben löst. Arbeite präzise und prüfe Rechnungen doppelt.
Formeln in LaTeX (Inline: $...$).
Antworte NUR mit JSON:
{"canSolve": true, "describeOnly": false, "finalAnswer": "kurzes Endergebnis", "steps": ["Schritt 1 …", "Schritt 2 …"], "keyPoints": ["was für volle Punktzahl nötig ist"]}
Bei nicht als Text lösbaren Aufgaben (Zeichnen etc.): "canSolve": true, "describeOnly": true und beschreibe in steps/keyPoints, was die Lösung enthalten muss.`,
    },
    { role: "user", content },
  ], { apiKey, model, stream: false });
  const sol = parseJSON(raw);
  if (!sol || (!sol.finalAnswer && !sol.steps?.length)) throw new Error(`Aufgabe ${task.number}: Lösung konnte nicht erzeugt werden.`);
  return sol;
}

/**
 * Verifiziert eine Lösung in einem ZWEITEN, unabhängigen KI-Aufruf
 * ("Tool, das wirklich nochmal checkt"). Bei Fehlern wird korrigiert.
 */
export async function verifyExamSolution(task, solution, config = {}) {
  const { apiKey, model } = await getConfig(config);
  try {
    const raw = await chatCompletion([
      {
        role: "system",
        content: `Du bist ein extrem kritischer Korrektor. Prüfe die Lösung UNABHÄNGIG: rechne selbst nach, prüfe jeden Schritt auf Rechen- und Logikfehler.
Antworte NUR mit JSON:
{"correct": true, "issues": [], "correctedAnswer": "", "correctedSteps": []}
Bei Fehlern: "correct": false, beschreibe die Fehler in "issues" und liefere korrigierte Antwort/Schritte.`,
      },
      {
        role: "user",
        content: `Aufgabe ${task.number}: ${task.text}\n\nBehauptete Lösung: ${solution.finalAnswer}\nLösungsweg:\n${(solution.steps || []).join("\n")}`,
      },
    ], { apiKey, model, stream: false });
    const v = parseJSON(raw);
    if (v && v.correct === false && (v.correctedAnswer || v.correctedSteps?.length)) {
      return {
        verified: true, corrected: true,
        finalAnswer: v.correctedAnswer || solution.finalAnswer,
        steps: v.correctedSteps?.length ? v.correctedSteps : solution.steps,
        verifyNote: (v.issues || []).join("; "),
      };
    }
    return { verified: true, corrected: false, finalAnswer: solution.finalAnswer, steps: solution.steps, verifyNote: "" };
  } catch {
    // Verifikation fehlgeschlagen → Original behalten, aber als unverifiziert markieren
    return { verified: false, corrected: false, finalAnswer: solution.finalAnswer, steps: solution.steps, verifyNote: "" };
  }
}

/** Bewertet die Nutzer-Antwort auf eine Klausur-Aufgabe (Teilpunkte möglich). */
export async function gradeExamAnswer(task, solution, userAnswer, config = {}) {
  const { apiKey, model } = await getConfig(config);
  const raw = await chatCompletion([
    {
      role: "system",
      content: `Du bist ein fairer Klausur-Korrektor. Vergleiche die Antwort des Studierenden mit der Musterlösung.
Vergib Teilpunkte für richtige Ansätze/Zwischenschritte, auch wenn das Endergebnis falsch ist. Sei fair, aber nicht geschenkt.
Bei describeOnly-Aufgaben (Zeichnungen): bewerte, ob die BESCHREIBUNG des Studierenden die Kernpunkte trifft.
Antworte NUR mit JSON:
{"score": 3.5, "maxScore": ${Number(task.points) || 1}, "verdict": "correct|partial|wrong", "feedback": "2-4 Sätze: was war gut, was fehlte"}`,
    },
    {
      role: "user",
      content: `Aufgabe ${task.number} (${task.points} Punkte): ${task.text}\n\nMusterlösung: ${solution.finalAnswer}\nLösungsweg: ${(solution.steps || []).join(" | ")}\nKernpunkte: ${(solution.keyPoints || []).join("; ")}\n\nAntwort des Studierenden:\n${userAnswer || "(keine Antwort)"}`,
    },
  ], { apiKey, model, stream: false });
  const g = parseJSON(raw);
  if (!g || typeof g.score !== "number") return { score: 0, maxScore: Number(task.points) || 1, verdict: "wrong", feedback: "Bewertung fehlgeschlagen." };
  g.score = Math.max(0, Math.min(g.score, Number(task.points) || 1));
  return g;
}

/** Experimentell: erzeugt eine NEUE Klausur im Stil einer hochgeladenen. */
export async function generateExamInStyle(exam, config = {}) {
  const { apiKey, model } = await getConfig(config);
  const sampleTasks = (exam.tasks || []).slice(0, 8).map(t =>
    `Aufgabe ${t.number} (${t.points}P, ${t.type}): ${(t.text || "").slice(0, 300)}`).join("\n");
  const raw = await chatCompletion([
    {
      role: "system",
      content: `Du erstellst eine NEUE Übungsklausur im exakten Stil einer Vorlage: gleiches Fach, gleiche Aufgabentypen, gleicher Schwierigkeitsgrad, ähnliche Punkteverteilung — aber NEUE Aufgaben (andere Zahlen, andere Beispiele, keine Kopien).
Formeln in LaTeX. Antworte NUR mit JSON:
{"title":"...","tasks":[{"number":"1","text":"...","type":"calc","points":4,"solvable":true}]}`,
    },
    {
      role: "user",
      content: `Fach: ${exam.style?.subject || "?"}\nKlausur-Stil: ${exam.style?.styleNotes || "?"}\nGesamtpunkte: ~${exam.style?.totalPoints || 40}\n\nVorlage-Aufgaben:\n${sampleTasks}\n\nErstelle eine neue Klausur mit ${(exam.tasks || []).length} Aufgaben in diesem Stil.`,
    },
  ], { apiKey, model, stream: false });
  const parsed = parseJSON(raw);
  if (!parsed || !Array.isArray(parsed.tasks) || !parsed.tasks.length) throw new Error("Klausur-Generierung fehlgeschlagen.");
  return parsed;
}

export async function crossCheckQuiz(questions, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key für Cross-Check verfügbar.");

  const simplified = questions.map((q, i) => ({
    nr: i + 1,
    type: q.question_type,
    text: (q.question_text || q.text || "").slice(0, 300),
    options: (q.options || []).map(o => `${o.is_correct ? "✓" : "✗"} ${o.text}`),
    correctText: q.correct_text || "",
    correctAnswer: q.correct_answer || "",
    explanation: q.explanation || "",
  }));

  const messages = [
    {
      role: "system",
      content: "Du bist ein Qualitätsprüfer für Lern-Quizze. Prüfe jede Frage auf:\n" +
        "1. Ist die korrekte Antwort wirklich richtig?\n" +
        "2. Sind falsche Optionen tatsächlich falsch?\n" +
        "3. Ist die Frage klar und eindeutig formuliert?\n" +
        "4. Bei Freitext: Werden Synonyme/Tippfehler fair behandelt?\n" +
        "5. Passt der Fragetyp zum Inhalt?\n\n" +
        'Antworte NUR mit JSON: {"findings":[{"nr":1,"issue":"...","severity":"high|medium|low","suggestion":"..."}]}\n' +
        'Falls keine Probleme: {"findings":[]}',
    },
    {
      role: "user",
      content: `Prüfe folgende ${questions.length} Quiz-Fragen auf Fehler:\n\n${JSON.stringify(simplified, null, 2)}`,
    },
  ];

  const raw = await chatCompletion(messages, { apiKey, model: model || "nvidia/nemotron-3-super-120b-a12b:free", stream: false });
  try {
    const parsed = parseJSON(raw);
    return parsed?.findings || [];
  } catch {
    return [{ nr: 0, issue: "Cross-Check konnte nicht geparst werden.", severity: "low", suggestion: "Manuell prüfen." }];
  }
}

// ── Formula Sheet Generation ──────────────────────────────────────────────

/**
 * Generate a formula sheet from text (pure text or PDF-extracted).
 * Returns structured formula entries: [{name, formula, variables}]
 */
export async function generateFormulaSheet(text, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key für Formelsammlung verfügbar.");

  const customPrompt = config.customPrompt || "";
  const includeSources = config.includeSources === true;
  const promptExtra = customPrompt
    ? `\nZusätzliche Nutzer-Anweisung: ${customPrompt}`
    : "";

  const sourceInstruction = includeSources
    ? '\nGib für jede Formel zusätzlich ein Feld "source_quote" an – ein wörtliches Zitat (1-2 Sätze) aus dem Originaltext, aus dem die Formel extrahiert wurde.'
    : "";

  const sourceField = includeSources
    ? ',"source_quote":"..."'
    : "";

  const systemPrompt = "Du bist ein Mathematik-Experte. Extrahiere AUSSCHLIESSLICH reine Formeln aus dem gegebenen Text.\n" +
    "WICHTIG: KEINE Beispielrechnungen, KEINE Zahlenbeispiele, KEINE Textaufgaben.\n" +
    "Nur allgemeingültige Formeln, die man anwenden kann (wie pq-Formel, abc-Formel, Satz des Pythagoras, Ableitungsregeln, etc.).\n" +
    "\nLaTeX-Regeln für das Feld \"formula\" (STRIKT einhalten):\n" +
    "- NUR gültiges KaTeX-LaTeX, OHNE $-Delimiter und ohne Prosa.\n" +
    "- Brüche als \\frac{a}{b} (nie a/b bei mehrgliedrigen Termen), Potenzen als x^{2}, Indizes als x_{1}.\n" +
    "- Wurzeln als \\sqrt{x}, griechische Buchstaben als \\alpha, \\sigma usw.\n" +
    "- KEINE Unicode-Mathe-Zeichen (², ×, ÷, √, ≤) — immer die LaTeX-Befehle (^{2}, \\cdot, \\div, \\sqrt, \\le).\n" +
    "- ACHTUNG: Der Eingabetext stammt aus einer PDF-Text-Extraktion und kann Formeln VERSTÜMMELT enthalten " +
    "(verlorene Hoch-/Tiefstellungen, fehlende Bruchstriche). Rekonstruiere die fachlich korrekte Standardform " +
    "der Formel; wenn eine Formel nicht sicher rekonstruierbar ist, lass sie WEG statt zu raten.\n" +
    "\nBeispiel eines korrekten Eintrags:\n" +
    '{"name":"Normalverteilung (Dichte)","formula":"f(x) = \\\\frac{1}{\\\\sigma\\\\sqrt{2\\\\pi}} e^{-\\\\frac{(x-\\\\mu)^{2}}{2\\\\sigma^{2}}}","variables":[{"symbol":"\\\\mu","description":"Erwartungswert"},{"symbol":"\\\\sigma","description":"Standardabweichung"}]}\n' +
    sourceInstruction +
    '\nAntworte NUR mit JSON: {"formulas":[{"name":"...","formula":"...","variables":[{"symbol":"...","description":"..."}]' + sourceField + '}]}';

  const runChunk = async (chunk, hint) => {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extrahiere alle Formeln aus diesem Text (KEINE Beispielrechnungen, nur allgemeine Formeln):${promptExtra}${hint}\n\n${chunk}` },
    ];
    const raw = await chatCompletion(messages, { apiKey, model: model || "deepseek/deepseek-chat", stream: false });
    const parsed = parseJSON(raw);
    return parsed?.formulas || [];
  };

  // Große Skripte abschnittsweise verarbeiten statt hart bei 8k Zeichen
  // abzuschneiden (vorher fehlten alle Formeln nach ~3 Seiten kommentarlos).
  const chunks = chunkText(text, 7000);
  const all = [];
  const seen = new Set();
  for (let i = 0; i < chunks.length; i++) {
    if (typeof config.onProgress === "function") config.onProgress(i + 1, chunks.length);
    const hint = chunks.length > 1 ? ` (Abschnitt ${i + 1}/${chunks.length})` : "";
    try {
      for (const f of await runChunk(chunks[i], hint)) {
        const key = String(f.formula || "").replace(/\s+/g, "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push(f);
      }
    } catch (err) {
      if (chunks.length === 1) throw err;
    }
  }
  return all;
}

/**
 * Derive a formula sheet with explanations from existing formula entries.
 */
export async function deriveFormulaExplanations(formulas, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key verfügbar.");

  const input = formulas.map(f => `${f.name}: ${f.formula}`).join("\n");
  const messages = [
    {
      role: "system",
      content: "Du bist ein Mathematik-Dozent. Für jede Formel: erkläre kurz (2-3 Sätze), wofür sie verwendet wird und was sie bedeutet.\n" +
        'Antworte NUR mit JSON: {"formulas":[{"name":"...","formula":"...","explanation":"..."}]}',
    },
    { role: "user", content: `Erkläre diese Formeln:\n${input}` },
  ];

  const raw = await chatCompletion(messages, { apiKey, model: model || "deepseek/deepseek-chat", stream: false });
  try {
    const parsed = parseJSON(raw);
    const explained = parsed?.formulas || [];
    return formulas.map(f => {
      const match = explained.find(e => e.name === f.name || e.formula === f.formula);
      return { ...f, explanation: match?.explanation || "" };
    });
  } catch {
    return formulas.map(f => ({ ...f, explanation: "" }));
  }
}

/**
 * Derive a formula sheet with formulas rearranged for each variable.
 */
export async function deriveFormulaByVariable(formulas, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key verfügbar.");

  const input = formulas.map(f => `${f.name}: ${f.formula}`).join("\n");
  const messages = [
    {
      role: "system",
      content: "Du bist ein Mathematik-Experte. Stelle jede Formel nach jeder ihrer Variablen um.\n" +
        "Beispiel: U = R·I → I = U/R, R = U/I\n" +
        "Gib für jede Umstellung Name, umgestellte Formel und die isolierte Variable an.\n" +
        'Antworte NUR mit JSON: {"formulas":[{"name":"...","formula":"...","solvedFor":"..."}]}',
    },
    { role: "user", content: `Stelle diese Formeln nach jeder Variable um:\n${input}` },
  ];

  const raw = await chatCompletion(messages, { apiKey, model: model || "deepseek/deepseek-chat", stream: false });
  try {
    const parsed = parseJSON(raw);
    return parsed?.formulas || [];
  } catch {
    return [];
  }
}

// ── Study Plan Generation ──────────────────────────────────────────────────

/**
 * Extract topics from lecture text and estimate study time per topic.
 */
export async function extractStudyTopics(text, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key verfügbar.");

  const messages = [
    {
      role: "system",
      content: "Du bist ein Lernplan-Experte. Analysiere den Text und extrahiere alle Themen/Unterthemen.\n" +
        "Schätze für jedes Thema: Schwierigkeit (easy/medium/hard) und geschätzte Lernstunden.\n" +
        "Sortiere didaktisch sinnvoll (Grundlagen zuerst).\n" +
        'Antworte NUR mit JSON: {"topics":[{"name":"...","difficulty":"easy|medium|hard","estimatedHours":1.5}]}',
    },
    { role: "user", content: `Extrahiere Themen aus diesem Vorlesungstext:\n\n${text.slice(0, 12000)}` },
  ];

  const raw = await chatCompletion(messages, { apiKey, model: model || "deepseek/deepseek-chat", stream: false });
  try {
    const parsed = parseJSON(raw);
    return parsed?.topics || [];
  } catch {
    return [{ name: "Gesamter Stoff", difficulty: "medium", estimatedHours: 10 }];
  }
}

// ── Exercise Mode ──────────────────────────────────────────────────────────

/**
 * Generate a single exercise for a given topic.
 */
export async function generateExercise(topic, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key verfügbar.");

  const messages = [
    {
      role: "system",
      content: "Du bist ein Übungsaufgaben-Ersteller. Erstelle EINE Aufgabe zum gegebenen Thema.\n" +
        "Formuliere klar, was zu tun ist. Gib auch die korrekte Lösung an (mit Lösungsweg).\n" +
        'Antworte NUR mit JSON: {"question":"Aufgabentext","solution":"Lösungsweg und Endergebnis","hint":"Kleiner Tipp"}',
    },
    { role: "user", content: `Erstelle eine Übungsaufgabe zum Thema: ${topic}` },
  ];

  const raw = await chatCompletion(messages, { apiKey, model: model || "deepseek/deepseek-chat", stream: false });
  try {
    return parseJSON(raw);
  } catch {
    return { question: `Aufgabe zum Thema: ${topic}`, solution: "Lösung nicht verfügbar.", hint: "" };
  }
}

/**
 * Check a user's solution and find where they went wrong.
 */
export async function checkExerciseSolution(exercise, userAnswer, userImageBase64, config = {}) {
  const { apiKey, model } = await getConfig(config);
  if (!apiKey) throw new Error("Kein API-Key verfügbar.");

  const hasImage = !!userImageBase64;
  const chosen = MODELS.find((m) => m.id === (model || ""));
  const useVision = hasImage && chosen?.vision;

  const contentParts = [];
  let textPrompt = `Aufgabe:\n${exercise.question}\n\nKorrekte Lösung:\n${exercise.solution}\n\nNutzer-Lösung:\n${userAnswer || "(keine Text-Lösung)"}\n\nAnalysiere die Lösung des Nutzers. Finde heraus, WO genau der Fehler liegt (nicht nur ob falsch, sondern was falsch ist). Erkläre den Fehler verständlich.`;
  if (hasImage && !useVision) {
    textPrompt += "\n\n⚠️ Der Nutzer hat ein Bild seiner Lösung eingereicht, aber das aktuelle Modell kann Bilder nicht verarbeiten. Weise den Nutzer darauf hin, seine Lösung als Text einzugeben.";
  }
  contentParts.push({ type: "text", text: textPrompt });
  if (useVision && userImageBase64) {
    contentParts.push({ type: "image_url", image_url: { url: userImageBase64 } });
  }

  const messages = [
    {
      role: "system",
      content: "Du bist ein geduldiger Mathe-Tutor. Analysiere die Nutzer-Lösung und finde den GENAUEN Fehler im Lösungsweg.\n" +
        "Nicht nur 'falsch' sagen — sondern zeigen WO und WARUM.\n" +
        'Antworte NUR mit JSON: {"isCorrect":false,"errorStep":"...","explanation":"...","tip":"..."}',
    },
    { role: "user", content: contentParts },
  ];

  const raw = await chatCompletion(messages, { apiKey, model: useVision ? (model || VISION_MODEL) : (model || "deepseek/deepseek-chat"), stream: false });
  try {
    return parseJSON(raw);
  } catch {
    return { isCorrect: false, errorStep: "Analyse fehlgeschlagen", explanation: raw?.slice(0, 300) || "Unbekannter Fehler", tip: "Versuch es nochmal mit mehr Details." };
  }
}

// ── Formula Extraction from Images (Chunked) ──────────────────────────

/**
 * Extract formulas from multiple images with chunking and rolling context.
 * Mirrors the generateQuizFromImages chunking pattern: batches images,
 * feeds previously extracted formulas as dedup hints, deduplicates at end.
 */
export async function extractFormulasFromImages(imageUrls, config = {}) {
  if (!imageUrls?.length) return [];

  const { apiKey, model } = await getConfig(config);
  const chunkSize = config.chunkSize || 3;
  const totalChunks = Math.ceil(imageUrls.length / chunkSize);

  const coveredFormulas = []; // rolling context: "Name: formula" strings
  const allFormulas = [];

  for (let i = 0; i < imageUrls.length; i += chunkSize) {
    const chunkIdx = Math.floor(i / chunkSize) + 1;
    if (config.onProgress) config.onProgress(chunkIdx, totalChunks);

    const batch = imageUrls.slice(i, i + chunkSize);
    const batchStart = i + 1;
    const batchEnd = Math.min(i + chunkSize, imageUrls.length);

    // Build dedup hint from previously extracted formulas
    const dedupHint = coveredFormulas.length
      ? `\n\nBereits extrahierte Formeln (NICHT erneut extrahieren):\n${coveredFormulas.join("\n")}`
      : "";

    const messages = [
      {
        role: "system",
        content: "Du bist ein Mathematik-Experte. Extrahiere ALLE mathematischen Formeln aus den gegebenen Bildern.\n" +
          "WICHTIG: KEINE Beispielrechnungen, KEINE Zahlenbeispiele, KEINE Textaufgaben.\n" +
          "Nur allgemeingültige Formeln (wie pq-Formel, Ableitungsregeln, physikalische Gesetze, etc.).\n" +
          "Gib für jede Formel einen sprechenden Namen und die Formel in korrektem LaTeX an.\n" +
          "LaTeX-Regeln (STRIKT): NUR gültiges KaTeX-LaTeX ohne $-Delimiter. Brüche als \\frac{a}{b}, " +
          "Potenzen als x^{2}, Indizes als x_{1}, Wurzeln als \\sqrt{x}, griechische Buchstaben als \\alpha usw. " +
          "KEINE Unicode-Mathe-Zeichen (², ×, ÷, √) — übertrage exakt die Formel aus dem Bild, nichts erfinden.\n" +
          "Gib zusätzlich pro Formel ein Feld 'source_section' an, das beschreibt, WO im Bild die Formel zu finden ist (z.B. 'oberer Abschnitt', 'Seite 5, Kasten links', 'unter der Überschrift Dynamik').\n" +
          'Antworte NUR mit JSON: {"formulas":[{"name":"...","formula":"...","source_section":"..."}]}' +
          dedupHint,
      },
      {
        role: "user",
        content: [
          ...batch.map(url => ({
            type: "image_url",
            image_url: { url },
          })),
          {
            type: "text",
            text: `Extrahiere ALLE Formeln aus diesen ${batch.length} Bildern (Seiten ${batchStart}-${batchEnd}). KEINE Beispielrechnungen — nur allgemeingültige Formeln.`,
          },
        ],
      },
    ];

    const raw = await chatCompletion(messages, {
      apiKey,
      model: model || VISION_MODEL,
      stream: false,
    });

    let chunkFormulas = [];
    try {
      const parsed = parseJSON(raw);
      chunkFormulas = parsed?.formulas || [];
    } catch {
      // Fallback: try colon-separated lines
      const lines = raw.split("\n").filter(l => l.trim());
      for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0 && colonIdx < 80) {
          chunkFormulas.push({
            name: line.slice(0, colonIdx).trim(),
            formula: line.slice(colonIdx + 1).trim(),
            source_section: `Seiten ${batchStart}-${batchEnd}`,
          });
        } else if (line.trim()) {
          chunkFormulas.push({
            name: "",
            formula: line.trim(),
            source_section: `Seiten ${batchStart}-${batchEnd}`,
          });
        }
      }
    }

    // Build rolling context from this batch
    for (const f of chunkFormulas) {
      const summary = `${f.name || "?"}: ${(f.formula || "").slice(0, 80)}`;
      if (summary.length > 3) coveredFormulas.push(summary);
    }

    allFormulas.push(...chunkFormulas);
  }

  // Dedup: normalize LaTeX (strip whitespace, unify braces) and deduplicate by name+formula
  const norm = (s) => (s || "").replace(/\s+/g, " ").replace(/\{/g, "{").replace(/\}/g, "}").trim();
  const seen = new Set();
  const deduped = [];
  for (const f of allFormulas) {
    const key = `${(f.name || "").toLowerCase().trim()}|${norm(f.formula)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }

  return deduped;
}

// ── Formula Photo → LaTeX ─────────────────────────────────────────────────

export async function formulaPhotoToLatex(imageBase64, config = {}) {
  const { apiKey } = await getConfig(config);
  const messages = [{
    role: "system",
    content: "Extrahiere ALLE mathematischen Formeln aus diesem Bild als LaTeX-Code. Antworte NUR mit einem JSON-Objekt: {\"formulas\":[{\"name\":\"Formelname\",\"formula\":\"\\\\frac{a}{b}\"}]}. Keine Erklärungen, keine Einleitung.",
  }, {
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageBase64 } },
    ],
  }];
  const raw = await chatCompletion(messages, { apiKey, model: config.model || VISION_MODEL, stream: false });
  const parsed = parseJSON(raw);
  if (parsed?.formulas?.length) return parsed.formulas;
  // Fallback: try colon-separated lines
  const lines = raw.split("\n").filter(l => l.trim());
  const formulas = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 80) {
      formulas.push({ name: line.slice(0, colonIdx).trim(), formula: line.slice(colonIdx + 1).trim() });
    } else {
      formulas.push({ name: "", formula: line.trim() });
    }
  }
  return formulas;
}
