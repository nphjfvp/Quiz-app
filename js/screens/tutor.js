import { askTutor } from "../ai-service.js";
import { navigate } from "../router.js";

export async function render(root, params = {}) {
  const chatHistory = [];

  let html = "";

  // Header
  html += `<div class="editor-header">
    <button class="back-btn" id="tutor-back">&larr;</button>
    <h2 class="section-title" style="margin:0">KI-Lerntutor</h2>
  </div>`;

  // Question context card
  const questionImage = params.question?.image || null;
  if (params.question) {
    const qText = params.question.text || params.question.question || JSON.stringify(params.question);
    html += `<div class="card" style="margin-bottom:0.5rem;padding:0.75rem;font-size:0.9rem;opacity:0.9">
      <strong>Frage:</strong> ${escapeHtml(qText)}
      ${questionImage ? `<img src="${escapeHtml(questionImage)}" style="max-width:100%;border-radius:8px;margin-top:8px" alt="Aufgabenbild">` : ""}
      ${questionImage ? `<div style="font-size:0.75rem;color:var(--text-light,#888);margin-top:4px">📷 Bild wird automatisch an die KI gesendet</div>` : ""}
    </div>`;
  }

  // Chat area
  html += `<div id="tutor-messages" style="
    flex:1;overflow-y:auto;padding:0.5rem;display:flex;flex-direction:column;gap:0.5rem;
  "></div>`;

  // Input area
  html += `<div style="display:flex;gap:0.5rem;padding:0.5rem;border-top:1px solid var(--border,#ddd)">
    <input id="tutor-input" class="input" style="flex:1" placeholder="Frage stellen..." />
    <button id="tutor-send" class="btn btn-primary btn-icon" style="min-width:2.5rem">&#9654;</button>
  </div>`;

  root.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;max-height:100vh">${html}</div>`;

  const messagesEl = root.querySelector("#tutor-messages");
  const inputEl = root.querySelector("#tutor-input");
  const sendBtn = root.querySelector("#tutor-send");

  root.querySelector("#tutor-back").addEventListener("click", () => navigate("home"));

  function escapeHtmlInline(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function addMessage(role, content) {
    const div = document.createElement("div");
    const isUser = role === "user";
    div.style.cssText = `
      max-width:80%;padding:0.6rem 0.8rem;border-radius:0.75rem;line-height:1.4;word-wrap:break-word;white-space:pre-wrap;
      ${isUser
        ? "align-self:flex-end;background:#009688;color:#fff;border-bottom-right-radius:0.2rem;"
        : "align-self:flex-start;background:var(--card-bg,#fff);color:var(--text,#333);border-bottom-left-radius:0.2rem;box-shadow:0 1px 2px rgba(0,0,0,0.1);"
      }
    `;
    div.innerHTML = escapeHtmlInline(content);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addTypingIndicator() {
    const div = document.createElement("div");
    div.id = "typing-indicator";
    div.style.cssText = "align-self:flex-start;padding:0.6rem 0.8rem;border-radius:0.75rem;background:var(--card-bg,#fff);color:var(--text,#999);box-shadow:0 1px 2px rgba(0,0,0,0.1);font-style:italic;";
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
      if (params.question.answers) {
        parts.push(`Antworten: ${JSON.stringify(params.question.answers)}`);
      }
      if (params.question.correct !== undefined) {
        parts.push(`Richtige Antwort: ${params.question.correct}`);
      }
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  inputEl.focus();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
