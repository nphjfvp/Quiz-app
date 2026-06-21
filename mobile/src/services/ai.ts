import { loadSettings } from "./storage";

export async function callAI(
  messages: { role: string; content: any }[],
  maxTokens: number = 2048
): Promise<string | null> {
  const settings = await loadSettings();
  const apiKey = settings.api_key;
  const model = settings.model || "deepseek/deepseek-chat";

  if (!apiKey) return null;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://quiz-lerntrainer.app",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export async function getHint(questionText: string, questionType: string): Promise<string | null> {
  return callAI([
    {
      role: "system",
      content:
        "Du bist ein hilfreicher Tutor. Gib einen Hinweis zur Frage, ohne die Antwort zu verraten. Nutze $LaTeX$ für Formeln.",
    },
    { role: "user", content: `Gib mir einen Hinweis zu: ${questionText}` },
  ], 512);
}

export async function getExplanation(
  questionText: string,
  correctAnswer: string,
  userAnswer: string
): Promise<string | null> {
  return callAI([
    {
      role: "system",
      content:
        "Du bist ein strenger aber fairer Tutor. Erkläre die richtige Antwort und was falsch war. Nutze $LaTeX$ für Formeln.",
    },
    {
      role: "user",
      content: `Frage: ${questionText}\nRichtige Antwort: ${correctAnswer}\nMeine Antwort: ${userAnswer}\nBitte erkläre.`,
    },
  ], 1024);
}

export async function analyzeMathDrawing(
  questionText: string,
  correctFormula: string,
  userAnswer: string,
  drawingBase64: string
): Promise<string | null> {
  return callAI([
    {
      role: "system",
      content:
        "Du bist ein Mathe-Tutor. Der Student hat seinen Rechenweg handschriftlich aufgeschrieben. " +
        "Analysiere das Bild Schritt für Schritt:\n" +
        "1. Erkenne die handschriftliche Rechnung\n" +
        "2. Prüfe jeden einzelnen Rechenschritt\n" +
        "3. Markiere GENAU wo der erste Fehler passiert\n" +
        "4. Erkläre was falsch war und wie es richtig wäre\n" +
        "Nutze $LaTeX$ für Formeln.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Aufgabe: ${questionText}\nKorrekte Lösung: ${correctFormula}\nEingegebene Antwort: ${userAnswer}\nHier ist der Rechenweg:`,
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${drawingBase64}` },
        },
      ],
    },
  ], 1500);
}

export async function chatWithAI(
  chatHistory: { role: string; content: string }[],
  systemPrompt?: string
): Promise<string | null> {
  const messages = [
    {
      role: "system",
      content: systemPrompt || "Du bist ein hilfreicher Lern-Tutor. Antworte auf Deutsch. Nutze $LaTeX$ für Formeln.",
    },
    ...chatHistory,
  ];
  return callAI(messages, 2048);
}
