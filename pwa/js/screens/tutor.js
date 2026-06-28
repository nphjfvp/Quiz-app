import { askTutor } from "../ai-service.js";
import { navigate } from "../router.js";
import { esc, mathEsc, escAttr } from "../utils.js";
import { trackRecent } from "../store.js";

export async function render(root, params = {}) {
  trackRecent("tutor", "", "KI-Tutor");
  const chatHistory = [];

  let html = `<div class="editor-header">
    <button class="btn-icon" id="tutor-back">←</button>
    <h2>KI-Lerntutor</h2>
  </div>`;

  const questionImage = params.question?.image || null;
  if (params.question) {
    const qText = params.question.text || params.question.question || JSON.stringify(params.question);
    html += `<div class="card tutor-context">
      <strong>Frage:</strong> ${esc(qText)}
      ${questionImage ? `<img src="${escAttr(questionImage)}" alt="Aufgabenbild">` : ""}
      ${questionImage ? `<div class="tutor-img-hint">📷 Bild wird automatisch an die KI gesendet</div>` : ""}
    </div>`;
  }

  // Quick Actions
  try {
    const { loadQuickActions } = await import("../store.js");
    const qas = await loadQuickActions();
    if (qas.length) {
      html += `<div id="tutor-qa" style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0">`;
      for (const qa of qas) {
        html += `<button class="btn btn-sm btn-ghost" data-qa-prompt="${escAttr(qa.prompt)}">⚡ ${esc(qa.name)}</button>`;
      }
      html += `</div>`;
    }
  } catch (_) {}

  html += `<div id="tutor-messages" class="tutor-messages"></div>`;

  html += `<div class="tutor-input-row">
    <input id="tutor-input" class="input" placeholder="Frage stellen…">
    <button id="tutor-send" class="btn btn-primary">&#9654;</button>
  </div>`;

  root.innerHTML = `<div class="tutor-layout">${html}</div>`;

  const messagesEl = root.querySelector("#tutor-messages");
  const inputEl = root.querySelector("#tutor-input");
  const sendBtn = root.querySelector("#tutor-send");

  root.querySelector("#tutor-back").addEventListener("click", () => navigate("home"));

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
    return div;
  }

  function removeTypingIndicator() {
    const el = messagesEl.querySelector("#typing-indicator");
    if (el) el.remove();
  }

  function buildContext() {
    if (!params.question && !params.context) return "";
    const parts = [];
    if (params.question) {
      const qText = params.question.text || params.question.question || JSON.stringify(params.question);
      parts.push(`Bezugsfrage: ${qText}`);
      if (params.question.answers) parts.push(`Antworten: ${JSON.stringify(params.question.answers)}`);
      if (params.question.correct !== undefined) parts.push(`Richtige Antwort: ${params.question.correct}`);
    }
    if (params.context) parts.push(params.context);
    return parts.join("\n");
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = "";
    addMessage("user", text);
    sendBtn.disabled = true;
    inputEl.disabled = true;

    addTypingIndicator();

    try {
      const reply = await askTutor(text, buildContext(), chatHistory, {}, questionImage);
      removeTypingIndicator();
      chatHistory.push({ role: "user", content: text });
      chatHistory.push({ role: "assistant", content: reply });
      addMessage("assistant", reply);
    } catch (err) {
      removeTypingIndicator();
      chatHistory.push({ role: "user", content: text });
      addMessage("assistant", `Fehler: ${err.message || "Unbekannter Fehler. Bitte versuche es erneut."}`);
    } finally {
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Quick-Actions buttons
  root.querySelectorAll("[data-qa-prompt]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const prompt = btn.dataset.qaPrompt;
      if (!prompt) return;
      const qaText = `${prompt}\n\nFrage: ${params.question?.text || params.question?.question || ""}`;
      addMessage("user", `⚡ ${btn.textContent.trim()}`);
      sendBtn.disabled = true;
      inputEl.disabled = true;
      addTypingIndicator();
      try {
        const reply = await askTutor(qaText, buildContext(), chatHistory, {}, questionImage);
        removeTypingIndicator();
        chatHistory.push({ role: "user", content: qaText });
        chatHistory.push({ role: "assistant", content: reply });
        addMessage("assistant", reply);
      } catch (err) {
        removeTypingIndicator();
        addMessage("assistant", `Fehler: ${err.message || "Unbekannter Fehler."}`);
      } finally {
        sendBtn.disabled = false;
        inputEl.disabled = false;
      }
    });
  });

  inputEl.focus();
}
