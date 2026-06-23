import { loadSettings } from "./store.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const VISION_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";

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

function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

  const systemPrompt = `Du bist ein erfahrener Pädagoge und Prüfungsexperte. Erstelle hochwertige Lernfragen auf Basis des gegebenen Textes.

Regeln:
- Erstelle exakt ${numQuestions} Fragen.
- Verwende eine Mischung aus diesen Fragetypen: "single_choice", "multiple_choice", "free_text", "fill_blank".
- Jede Frage muss eine klare, verständliche Erklärung enthalten, warum die richtige Antwort korrekt ist.
- Bei single_choice: genau eine Option ist korrekt, mindestens 3 Optionen.
- Bei multiple_choice: mindestens 2 Optionen sind korrekt, mindestens 4 Optionen.
- Bei free_text: gib den korrekten Antworttext in "correct_text" an.
- Bei fill_blank: markiere Lücken im Fragetext mit ___ und liste die Lösungswörter in "blanks" auf.
- Sprache: ${language === "de" ? "Deutsch" : language}.

Antworte ausschließlich mit einem JSON-Array (kein Markdown, kein zusätzlicher Text) in diesem Format:
[
  {
    "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank",
    "question_text": "Fragetext",
    "title": "Kurztitel der Frage",
    "topic": "Themengebiet",
    "points": 1,
    "options": [{"text": "Antwort", "is_correct": true}],
    "correct_text": "",
    "blanks": [],
    "explanation": "Erklärung"
  }
]`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Erstelle ${numQuestions} Prüfungsfragen auf Basis dieses Textes:\n\n${text}` },
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
    explanation: q.explanation ?? "",
  }));
}

export async function explainAnswer(question, userAnswer, correctAnswer, config = {}, imageUrl = null) {
  const { apiKey, model } = await getConfig(config);
  const useVision = !!imageUrl;
  const effectiveModel = useVision ? VISION_MODEL : model;

  const textContent = `Frage: ${question}\n\nAntwort des Lernenden: ${userAnswer}\nRichtige Antwort: ${correctAnswer}\n\nErkläre bitte, warum die richtige Antwort korrekt ist und wo der Fehler lag (falls vorhanden).${useVision ? "\n\nDas Bild zeigt die zugehörige Aufgabe/das Diagramm. Beziehe dich in deiner Erklärung auf das Bild." : ""}`;

  const userContent = useVision
    ? [{ type: "text", text: textContent }, { type: "image_url", image_url: { url: imageUrl } }]
    : textContent;

  const messages = [
    {
      role: "system",
      content:
        "Du bist ein geduldiger Lerntutor. Erkläre dem Lernenden verständlich und ermutigend, warum eine Antwort richtig oder falsch ist. Antworte auf Deutsch." + (useVision ? " Dir wird auch ein Bild der Aufgabe gezeigt — beziehe dich darauf." : ""),
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

  const systemContent = `Du bist ein freundlicher und kompetenter Lerntutor. Hilf dem Lernenden, den Stoff zu verstehen. Antworte auf Deutsch, klar und verständlich.${useVision ? " Dir wird ein Bild der Aufgabe gezeigt — beziehe dich darauf." : ""}${context ? `\n\nKontext:\n${context}` : ""}`;

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
