import { loadSettings } from "./store.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const VISION_MODEL = "openai/gpt-4o-mini";

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
