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
    body: JSON.stringify({ model, messages, stream, temperature: 0.7 }),
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

function parseJSON(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

// ─── Public API ──────────────────────────────────────────────────────

export async function generateQuiz(text, numQuestions = 5, language = "de", config = {}) {
  const { apiKey, model } = await getConfig(config);

  const auto = !(numQuestions > 0);
  const detail = config.detailLevel || "normal";
  const detailHint = detail === "thorough"
    ? " Sei MAXIMAL gründlich: Erstelle zu JEDEM Konzept, jeder Definition, jedem Fakt und jeder Formel mindestens eine Frage. Lieber zu viele Fragen als zu wenige!"
    : detail === "compact"
    ? " Konzentriere dich auf die wichtigsten Kernkonzepte und erstelle nur die wesentlichsten Fragen."
    : "";
  const countRule = auto
    ? `Entscheide selbst über die sinnvolle Anzahl Fragen, um den gesamten Stoff abzudecken (etwa eine Frage pro wichtigem Konzept). Erzeuge weder zu wenige noch unnötig viele.${detailHint}`
    : `Erstelle exakt ${numQuestions} Fragen.`;
  const countAsk = auto
    ? "So viele Prüfungsfragen wie sinnvoll"
    : `${numQuestions} Prüfungsfragen`;

  const systemPrompt = `Du bist ein erfahrener Pädagoge und Prüfungsexperte. Erstelle hochwertige Lernfragen auf Basis des gegebenen Textes.
WICHTIG: Extrahiere und erstelle Fragen zu ALLEN Inhalten des Textes – jedes Konzept, jede Definition, jeder Fakt soll abgedeckt werden. Überspringe NICHTS.

Regeln:
- ${countRule}
- Verwende eine sinnvolle Mischung aus: "single_choice", "multiple_choice", "free_text", "fill_blank", "drag_drop", "drag_category", "math_formula".
- Jede Frage muss eine klare, verständliche Erklärung enthalten, warum die richtige Antwort korrekt ist.
- Bei single_choice: genau eine Option ist korrekt, mindestens 3 Optionen.
- Bei multiple_choice: mindestens 2 Optionen sind korrekt, mindestens 4 Optionen.
- Bei free_text: gib den korrekten Antworttext in "correct_text" an. Mehrere akzeptierte Antworten mit ';' trennen.
- Bei fill_blank: markiere Lücken im Fragetext mit ___ und liste die Lösungswörter in "blanks" auf.
- Bei drag_drop: nur wenn 1:1-Zuordnungen (Begriff↔Definition). Liste Paare in "drag_drop_pairs" mit "source" und "target".
- Bei drag_category: wenn mehrere Begriffe in Kategorien eingeordnet werden sollen (z.B. 6 Begriffe auf 2 Kategorien). Nutze "drag_drop_pairs" wobei "source" der Begriff und "target" die Kategorie ist. Kategorien dürfen mehrfach vorkommen.
- Bei math_formula: nur bei mathematischen/naturwissenschaftlichen Inhalten. Gib die Lösung in "correct_formula" an (z.B. "x = 2" oder "a^2 + b^2").
- Bevorzuge Choice-/Text-Fragen; nutze drag_drop, drag_category und math_formula nur, wo es inhaltlich passt.
- Sprache: ${language === "de" ? "Deutsch" : language}.

Antworte ausschließlich mit einem JSON-Array (kein Markdown, kein zusätzlicher Text) in diesem Format:
[
  {
    "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank" | "drag_drop" | "drag_category" | "math_formula",
    "question_text": "Fragetext",
    "title": "Kurztitel der Frage",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "drag_drop_pairs": [{"source": "Begriff", "target": "Kategorie"}],
    "correct_formula": "",
    "explanation": "Erklärung"
  }
]`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Erstelle ${countAsk} auf Basis dieses Textes:\n\n${text}` },
  ];

  const body = await chatCompletion(messages, { apiKey, model, stream: true });
  const raw = await readStream(body);
  const questions = parseJSON(raw);

  if (!Array.isArray(questions)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");

  return questions.map((q) => ({
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

// Generiert Fragen direkt aus einem Bild (Screenshot, Foto, Diagramm) via Vision-Modell.
// imageUrl: data:-URL oder http-URL. Nutzt immer ein Vision-Modell.
export async function generateQuizFromImage(imageUrl, numQuestions = 3, language = "de", config = {}) {
  const { apiKey } = await getConfig(config);
  // Falls ein Vision-fähiges Modell gewählt wurde, dieses nutzen, sonst Default-Vision-Modell.
  let model = config.model;
  const chosen = MODELS.find((m) => m.id === model);
  if (!chosen || !chosen.vision) model = VISION_MODEL;

  const systemPrompt = `Du bist ein erfahrener Pädagoge. Analysiere das gezeigte Bild (Diagramm, Skizze, Screenshot, Tafelbild o.ä.) und erstelle daraus hochwertige Lernfragen.

Regeln:
- Erstelle bis zu ${numQuestions} Fragen, die sich auf den Bildinhalt beziehen.
- Verwende sinnvolle Typen aus: "single_choice", "multiple_choice", "free_text", "fill_blank".
- Wenn das Bild ein beschriftbares Diagramm ist, kannst du eine "diagram_label"-Frage erstellen: liste die zu beschriftenden Punkte in "diagram_labels" mit Name und relativer Position x/y (0-1) auf.
- Jede Frage braucht eine klare Erklärung.
- Bei single_choice: genau eine Option korrekt, min. 3 Optionen. Bei multiple_choice: min. 2 korrekt, min. 4 Optionen.
- Sprache: ${language === "de" ? "Deutsch" : language}.

Antworte ausschließlich mit einem JSON-Array (kein Markdown):
[
  {
    "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank" | "diagram_label",
    "question_text": "Fragetext",
    "title": "Kurztitel",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
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

  return questions.map((q) => ({
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

  const autoImg = !(numQuestions > 0);
  const detailImg = config.detailLevel || "normal";
  const detailHintImg = detailImg === "thorough"
    ? " Sei MAXIMAL gründlich: Erstelle zu JEDEM Konzept, jeder Definition, jedem Fakt, jeder Formel und jedem Diagramm mindestens eine Frage. Lieber zu viele als zu wenige!"
    : detailImg === "compact"
    ? " Konzentriere dich auf die wichtigsten Kernkonzepte."
    : "";
  const countRuleImg = autoImg
    ? `Entscheide selbst über die sinnvolle Anzahl Fragen, um den gesamten Inhalt aller Seiten abzudecken.${detailHintImg}`
    : `Erstelle exakt ${numQuestions} Fragen basierend auf dem Gesamtinhalt aller Seiten.`;
  const countAskImg = autoImg ? "So viele Prüfungsfragen wie sinnvoll" : `${numQuestions} Prüfungsfragen`;

  const systemPrompt = `Du bist ein erfahrener Pädagoge. Du erhältst ${imageUrls.length} Bilder (gerenderte PDF-Seiten). Analysiere den gesamten Inhalt — Text, Diagramme, Formeln, Grafiken — und erstelle daraus hochwertige Lernfragen.
WICHTIG: Erstelle Fragen zu ALLEN Inhalten auf ALLEN Seiten – jedes Konzept, jede Definition, jeder Fakt, jede Formel soll abgedeckt werden. Überspringe NICHTS.

Regeln:
- ${countRuleImg}
- Verwende eine sinnvolle Mischung aus: "single_choice", "multiple_choice", "free_text", "fill_blank".
- Achte besonders auf visuelle Inhalte: Diagramme, Grafiken, Formeln, Tabellen.
- Jede Frage muss eine klare Erklärung enthalten.
- Bei single_choice: genau eine Option korrekt, min. 3 Optionen. Bei multiple_choice: min. 2 korrekt, min. 4 Optionen.
- Sprache: ${language === "de" ? "Deutsch" : language}.

Antworte ausschließlich mit einem JSON-Array (kein Markdown):
[
  {
    "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank",
    "question_text": "Fragetext",
    "title": "Kurztitel",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "explanation": "Erklärung"
  }
]`;

  const contentParts = [
    { type: "text", text: `Erstelle ${countAskImg} auf Basis dieser ${imageUrls.length} PDF-Seiten.${additionalText ? `\n\nZusätzlicher Kontext:\n${additionalText}` : ""}` },
    ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contentParts },
  ];

  const body = await chatCompletion(messages, { apiKey, model, stream: true });
  const raw = await readStream(body);
  const questions = parseJSON(raw);
  if (!Array.isArray(questions)) throw new Error("KI-Antwort ist kein gültiges Fragen-Array.");

  return questions.map((q) => ({
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
- "math_formula": correct_formula, tolerance`;

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
function chunkText(text, maxLen = 9000) {
  const pages = text.split(/--- ?Seite ?---|\f/);
  const chunks = [];
  let buf = "";
  for (const p of pages) {
    if ((buf + p).length > maxLen && buf) { chunks.push(buf); buf = ""; }
    buf += p + "\n";
  }
  if (buf.trim()) chunks.push(buf);
  return chunks.length ? chunks : [text];
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
