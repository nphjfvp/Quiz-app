import { loadQuizzes, loadProgress, getMaterial, loadErrorDiary } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";

export async function render(root, params = {}) {
  let quizId = params.quizId || null;

  // If no quiz was specified (e.g. from Home), show a picker first.
  if (!quizId) {
    const allQ = await loadQuizzes();
    if (allQ.length) {
      const BACK = Symbol("back");
      const FREE = Symbol("free");
      const choice = await new Promise((resolve) => {
        let html = `<div class="game-setup">
          <h2 class="game-setup-title">🏛️ Sokratischer Modus</h2>
          <p class="game-setup-sub">Welches Quiz möchtest du sokratisch üben?</p>
          <div class="game-setup-list">
            <button class="game-src-btn" data-idx="free">
              <span class="game-src-name">💬 Freies Thema</span>
              <span class="game-src-meta">ohne Quiz</span>
            </button>`;
        allQ.forEach((q, i) => {
          const n = (q.questions || []).length;
          html += `<button class="game-src-btn" data-idx="${i}">
            <span class="game-src-name">${esc(q.name || "Quiz")}</span>
            <span class="game-src-meta">${n} Fragen</span>
          </button>`;
        });
        html += `</div>
          <button class="btn-secondary" id="gs-back" style="margin-top:16px;width:100%">← Zurück</button>
        </div>`;
        root.innerHTML = html;
        root.querySelectorAll(".game-src-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const idx = btn.dataset.idx;
            resolve(idx === "free" ? FREE : allQ[+idx]?.id || FREE);
          });
        });
        root.querySelector("#gs-back").addEventListener("click", () => {
          navigate("home"); resolve(BACK);
        });
      });
      if (choice === BACK) return;
      if (choice !== FREE) quizId = choice;
    }
  }

  const [quizzes, progress, diary] = await Promise.all([
    loadQuizzes(), loadProgress(), loadErrorDiary(),
  ]);

  let quiz = null;
  let material = null;
  let topic = params.topic || "";

  if (quizId) {
    quiz = quizzes.find(q => q.id === quizId);
    material = await getMaterial(quizId);
  }

  const chatHistory = [];

  function buildContext() {
    let ctx = "";
    if (quiz) {
      const questions = quiz.questions || [];
      const weak = questions.filter(q => {
        const p = progress[q.id];
        return !p || p.box <= 2 || (p && p.times_wrong > p.times_correct);
      });
      ctx += `Quiz: "${quiz.name}" (${questions.length} Fragen)\n`;
      if (weak.length > 0) {
        ctx += `Schwache Fragen:\n`;
        for (const q of weak.slice(0, 10)) {
          ctx += `- ${q.question_text || q.text}\n`;
        }
      }
    }
    if (material?.text) {
      const maxLen = 10000;
      const txt = material.text.length > maxLen ? material.text.slice(0, maxLen) + "\n[…]" : material.text;
      ctx += `\nQuellmaterial:\n${txt}\n`;
    }
    if (topic) ctx += `\nGewünschtes Thema: ${topic}\n`;

    const recentErrors = diary.slice(0, 10);
    if (recentErrors.length > 0) {
      ctx += `\nLetzte Fehler des Lernenden:\n`;
      for (const e of recentErrors) {
        ctx += `- "${e.question}" → antwortete: "${e.user_answer}" (richtig: "${e.correct}")\n`;
      }
    }
    return ctx;
  }

  const systemPrompt = `Du bist ein sokratischer Lerntutor. Deine Regeln:
1. Gib NIEMALS direkt die Antwort auf eine Frage.
2. Stelle stattdessen Gegenfragen, die den Lernenden Schritt für Schritt zur Antwort führen.
3. Wenn der Lernende komplett feststeckt, gib einen kleinen Hinweis — aber NICHT die Lösung.
4. Wenn der Lernende die richtige Antwort findet, bestätige es und erkläre WARUM es richtig ist.
5. Nutze einfache Sprache (Deutsch). Sei geduldig und ermutigend.
6. Wenn du ein neues Thema abfragst, beginne mit einer offenen Frage dazu.
7. Passe dich dem Niveau des Lernenden an — wenn er viel falsch hat, fang einfacher an.

Antworte IMMER auf Deutsch.`;

  let html = `<div class="editor-header">
    <button class="btn-icon" id="soc-back">←</button>
    <h2>🏛️ Sokratischer Modus</h2>
  </div>
  <div class="card" style="padding:12px;margin-bottom:12px">
    <p style="font-size:0.85rem;color:var(--text-light);margin:0">Die KI gibt dir <strong>nie</strong> direkt die Antwort — sie stellt Gegenfragen, bis du selbst draufkommst.</p>
  </div>`;

  if (!quizId) {
    html += `<div class="soc-topic-row" style="margin-bottom:12px">
      <input type="text" class="input" id="soc-topic" placeholder="Thema eingeben (optional)..." value="${esc(topic)}">
    </div>`;
  }

  if (quiz) {
    const questions = quiz.questions || [];
    const weak = questions.filter(q => {
      const p = progress[q.id];
      return !p || p.box <= 2;
    });
    const topics = [...new Set(questions.map(q => q.topic).filter(Boolean))];

    html += `<div class="study-suggestions" id="suggestions">
      ${weak.length > 0 ? `<button class="btn btn-ghost study-suggest-btn" data-prompt="Frag mich zu meinen schwachen Themen ab. Fang mit dem an, wo ich am meisten Probleme habe.">🎯 Schwächen abfragen</button>` : ""}
      ${topics.slice(0, 4).map(t => `<button class="btn btn-ghost study-suggest-btn" data-prompt="Frag mich zum Thema '${t}' ab. Beginne mit einer grundlegenden Verständnisfrage.">📚 ${esc(t)}</button>`).join("")}
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Stell mir eine Frage zu einem zufälligen wichtigen Thema aus dem Quellmaterial.">🎲 Zufälliges Thema</button>
    </div>`;
  }

  html += `<div id="soc-messages" class="tutor-messages"></div>
  <div class="tutor-input-row">
    <input id="soc-input" class="input" placeholder="Deine Antwort / Frage…">
    <button id="soc-send" class="btn btn-primary">▶</button>
  </div>`;

  root.innerHTML = `<div class="tutor-layout">${html}</div>`;

  const messagesEl = root.querySelector("#soc-messages");
  const inputEl = root.querySelector("#soc-input");
  const sendBtn = root.querySelector("#soc-send");
  const suggestionsEl = root.querySelector("#suggestions");

  root.querySelector("#soc-back").addEventListener("click", () => {
    if (quizId) navigate("study", { quizId });
    else navigate("home");
  });

  function addMessage(role, content) {
    const div = document.createElement("div");
    div.className = `tutor-bubble ${role}`;
    div.innerHTML = mathEsc(content);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage(text) {
    if (!text?.trim()) return;
    inputEl.value = "";
    if (suggestionsEl) suggestionsEl.style.display = "none";

    const topicEl = root.querySelector("#soc-topic");
    if (topicEl && topicEl.value.trim() && !topic) {
      topic = topicEl.value.trim();
    }

    addMessage("user", text);
    sendBtn.disabled = true;
    inputEl.disabled = true;

    const typing = document.createElement("div");
    typing.className = "tutor-bubble assistant typing";
    typing.textContent = "...";
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const { askTutor } = await import("../ai-service.js");
      const context = buildContext();
      const fullContext = systemPrompt + "\n\n" + context;
      const reply = await askTutor(text, fullContext, chatHistory);
      typing.remove();
      chatHistory.push({ role: "user", content: text });
      chatHistory.push({ role: "assistant", content: reply });
      addMessage("assistant", reply);
    } catch (err) {
      typing.remove();
      addMessage("assistant", `Fehler: ${err.message || "Unbekannter Fehler."}`);
    } finally {
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", () => sendMessage(inputEl.value.trim()));
  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value.trim()); }
  });
  root.querySelectorAll(".study-suggest-btn").forEach(btn => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.prompt));
  });

  inputEl.focus();
}
