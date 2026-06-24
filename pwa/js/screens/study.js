import { loadQuizzes, loadProgress, getMaterial, loadErrorDiary } from "../store.js";
import { askTutor } from "../ai-service.js";
import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";

export async function render(root, params = {}) {
  const quizId = params.quizId;
  if (!quizId) { navigate("home"); return; }

  const [quizzes, progress, material, diary] = await Promise.all([
    loadQuizzes(), loadProgress(), getMaterial(quizId), loadErrorDiary(),
  ]);
  const quiz = quizzes.find(q => q.id === quizId);
  if (!quiz) { navigate("home"); return; }

  const questions = quiz.questions || [];
  const weak = questions.filter(q => {
    const p = progress[q.id];
    return !p || p.box <= 2 || p.times_wrong > p.times_correct;
  });
  const strong = questions.filter(q => {
    const p = progress[q.id];
    return p && p.box >= 4;
  });
  const unseen = questions.filter(q => !progress[q.id]);
  const quizErrors = diary.filter(e => e.quizName === quiz.name).slice(0, 20);

  const topics = [...new Set(questions.map(q => q.topic).filter(Boolean))];

  const weakTopics = [...new Set(weak.map(q => q.topic).filter(Boolean))];

  const chatHistory = [];

  function buildMaterialContext() {
    let ctx = `Quiz: "${quiz.name}" (${questions.length} Fragen)\n`;
    if (topics.length) ctx += `Themen: ${topics.join(", ")}\n`;
    ctx += `\nLernstand:\n`;
    ctx += `- ${weak.length} schwache Fragen (Box 1-2)\n`;
    ctx += `- ${unseen.length} noch nie beantwortet\n`;
    ctx += `- ${strong.length} gut gelernt (Box 4-5)\n`;

    if (weakTopics.length) {
      ctx += `\nSchwache Themen: ${weakTopics.join(", ")}\n`;
    }

    if (weak.length > 0) {
      ctx += `\nBeispiele für Schwächen:\n`;
      for (const q of weak.slice(0, 8)) {
        const p = progress[q.id];
        ctx += `- "${q.question_text || q.text}" (${p ? p.times_wrong + "x falsch" : "unbeantwortet"})\n`;
      }
    }

    if (quizErrors.length > 0) {
      ctx += `\nLetzte Fehler:\n`;
      for (const e of quizErrors.slice(0, 5)) {
        ctx += `- Frage: "${e.question}" → User: "${e.user_answer}" (Richtig: "${e.correct}")\n`;
      }
    }

    if (material?.text) {
      const maxLen = 12000;
      const txt = material.text.length > maxLen ? material.text.slice(0, maxLen) + "\n[… gekürzt]" : material.text;
      ctx += `\n── Quellmaterial (Skript/Vorlesung) ──\n${txt}\n`;
    }

    return ctx;
  }

  const context = buildMaterialContext();

  let html = `<div class="editor-header">
    <button class="btn-icon" id="study-back">←</button>
    <h2>📖 Lernmodus</h2>
  </div>

  <div class="card study-overview">
    <h3>${esc(quiz.name)}</h3>
    <div class="study-stats-row">
      <div class="study-stat"><span class="study-stat-num">${weak.length}</span><span class="study-stat-label">Schwach</span></div>
      <div class="study-stat"><span class="study-stat-num">${unseen.length}</span><span class="study-stat-label">Ungesehen</span></div>
      <div class="study-stat"><span class="study-stat-num">${strong.length}</span><span class="study-stat-label">Gut</span></div>
    </div>
    ${material ? '<div class="study-material-badge">📄 Quellmaterial verknüpft</div>' : '<div class="study-material-badge" style="opacity:0.5">Kein Quellmaterial verknüpft</div>'}
  </div>

  <div class="study-suggestions" id="suggestions">
    <div class="section-title">Vorschläge</div>
    <div class="study-suggest-grid">
      ${weak.length > 0 ? `<button class="btn btn-ghost study-suggest-btn" data-prompt="Erkläre mir die Themen, bei denen ich am schwächsten bin. Fang mit dem Wichtigsten an.">🎯 Schwächen erklären</button>` : ""}
      ${weakTopics.length > 0 ? weakTopics.slice(0, 3).map(t => `<button class="btn btn-ghost study-suggest-btn" data-prompt="Erkläre mir das Thema '${t}' ausführlich. Ich habe damit Probleme.">📚 ${esc(t)}</button>`).join("") : ""}
      ${material ? `<button class="btn btn-ghost study-suggest-btn" data-prompt="Fasse das Quellmaterial zusammen — was sind die wichtigsten Konzepte und Zusammenhänge?">📝 Zusammenfassung</button>` : ""}
      ${material ? `<button class="btn btn-ghost study-suggest-btn" data-prompt="Welche wichtigen Themen aus dem Quellmaterial werden im Quiz NICHT abgefragt? Was sollte ich noch wissen?">🔍 Was fehlt im Quiz?</button>` : ""}
      ${quizErrors.length > 0 ? `<button class="btn btn-ghost study-suggest-btn" data-prompt="Analysiere meine letzten Fehler und erkläre mir, wo meine Denkfehler liegen.">❌ Fehler analysieren</button>` : ""}
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Stelle mir 3 Verständnisfragen zu den wichtigsten Konzepten. Warte auf meine Antwort bevor du die nächste stellst.">❓ Mich abfragen</button>
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Erstelle mir eine kurze Übersicht / Karteikarten zu den wichtigsten Definitionen und Formeln.">🗂️ Karteikarten</button>
    </div>
    <button class="btn btn-ghost" id="go-socratic" style="margin-top:8px;width:100%">🏛️ Sokratischer Modus — KI fragt, du antwortest</button>
  </div>

  <div id="study-messages" class="tutor-messages"></div>

  <div class="tutor-input-row">
    <input id="study-input" class="input" placeholder="Was möchtest du lernen?">
    <button id="study-send" class="btn btn-primary">▶</button>
  </div>`;

  root.innerHTML = `<div class="tutor-layout">${html}</div>`;

  const messagesEl = root.querySelector("#study-messages");
  const inputEl = root.querySelector("#study-input");
  const sendBtn = root.querySelector("#study-send");
  const suggestionsEl = root.querySelector("#suggestions");

  root.querySelector("#study-back").addEventListener("click", () => navigate("quiz-modes", { quizId }));
  root.querySelector("#go-socratic")?.addEventListener("click", () => navigate("socratic", { quizId }));

  function addMessage(role, content) {
    const div = document.createElement("div");
    div.className = `tutor-bubble ${role}`;
    div.innerHTML = mathEsc(content);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addTypingIndicator() {
    const div = document.createElement("div");
    div.id = "typing-indicator";
    div.className = "tutor-bubble assistant typing";
    div.textContent = "...";
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTypingIndicator() {
    const el = messagesEl.querySelector("#typing-indicator");
    if (el) el.remove();
  }

  async function sendMessage(text) {
    if (!text?.trim()) return;
    inputEl.value = "";
    suggestionsEl.style.display = "none";
    addMessage("user", text);
    sendBtn.disabled = true;
    inputEl.disabled = true;
    addTypingIndicator();

    try {
      const reply = await askTutor(text, context, chatHistory);
      removeTypingIndicator();
      chatHistory.push({ role: "user", content: text });
      chatHistory.push({ role: "assistant", content: reply });
      addMessage("assistant", reply);
    } catch (err) {
      removeTypingIndicator();
      addMessage("assistant", `Fehler: ${err.message || "Unbekannter Fehler."}`);
    } finally {
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", () => sendMessage(inputEl.value.trim()));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value.trim()); }
  });

  root.querySelectorAll(".study-suggest-btn").forEach(btn => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.prompt));
  });

  inputEl.focus();
}
