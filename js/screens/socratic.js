import { loadQuizzes, loadProgress, getMaterial, loadErrorDiary } from "../store.js";
import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";

export async function render(root, params = {}) {
  let quizId = params.quizId || null;
  let mode = params.mode || "general"; // "general" | "math"
  const flowSourceText = params.sourceText || "";
  const wrongQuestions = Array.isArray(params.wrongQuestions) ? params.wrongQuestions : [];
  const fromLearnFlow = !!(flowSourceText || wrongQuestions.length || (params.topic && !quizId));

  // If no quiz was specified (e.g. from Home), show a picker first.
  // Skip the picker when arriving from the study-plan learning flow.
  if (!quizId && !fromLearnFlow) {
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
    if (flowSourceText) {
      const maxLen = 10000;
      const txt = flowSourceText.length > maxLen ? flowSourceText.slice(0, maxLen) + "\n[…]" : flowSourceText;
      ctx += `\nQuellmaterial (aus Lernplan):\n${txt}\n`;
    }
    if (topic) ctx += `\nGewünschtes Thema: ${topic}\n`;
    if (wrongQuestions.length) {
      ctx += `\nDer Lernende hat diese Fragen im Quiz FALSCH beantwortet — arbeite genau diese sokratisch auf:\n`;
      for (const w of wrongQuestions) {
        ctx += `- Frage: "${w.question}" → seine Antwort: "${w.userAnswer || "(leer)"}" (richtig wäre: "${w.correct}")\n`;
      }
    }

    const recentErrors = diary.slice(0, 10);
    if (recentErrors.length > 0) {
      ctx += `\nLetzte Fehler des Lernenden:\n`;
      for (const e of recentErrors) {
        ctx += `- "${e.question}" → antwortete: "${e.user_answer}" (richtig: "${e.correct}")\n`;
      }
    }
    return ctx;
  }

  const isMath = mode === "math";

  const systemPrompt = isMath ? `Du bist ein sokratischer Mathe-Tutor. Deine Regeln:
1. Gib NIEMALS direkt die Lösung oder das Endergebnis.
2. Stelle Gegenfragen, die den Lernenden Schritt für Schritt zum mathematischen Verständnis führen.
3. Bei Rechenfehlern: frage "Wie bist du darauf gekommen?" oder "Was passiert wenn du stattdessen X machst?"
4. Zerlege komplexe Probleme in kleine Schritte. Frage nach jedem Einzelschritt.
5. Wenn der Lernende feststeckt, gib einen winzigen Hinweis (z.B. "Welche Formel könntest du hier anwenden?") — aber NICHT die Lösung.
6. Nutze LaTeX für Formeln (Inline: \\\\(...\\\\)). Halte die Sprache einfach.
7. Passe dich dem Niveau an: wenn jemand unsicher ist, beginne mit den Grundlagen.
8. Fokussiere auf VERSTÄNDNIS, nicht auf Auswendiglernen.
9. Bei Diagramm-/Geometrie-Fragen: beschreibe, worauf der Lernende achten soll.
10. Ermutige und lobe korrekte Zwischenschritte — aber bleibe sokratisch.

Antworte IMMER auf Deutsch.` : `Du bist ein sokratischer Lerntutor. Deine Regeln:
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
    <h2>${isMath ? "📐 Mathe-Sokrates" : "🏛️ Sokratischer Modus"}</h2>
    <button class="btn btn-sm btn-ghost" id="soc-mode-toggle">${isMath ? "📚 Allgemein" : "📐 Mathe"}</button>
  </div>
  <div class="card" style="padding:12px;margin-bottom:12px">
    <p style="font-size:0.85rem;color:var(--text-light);margin:0">${isMath
      ? "Mathe-Fokus: Die KI gibt dir <strong>nie</strong> direkt die Lösung. Sie führt dich Schritt für Schritt mit Gegenfragen. Nutze die Mathe-Tastatur für Formeln."
      : "Die KI gibt dir <strong>nie</strong> direkt die Antwort — sie stellt Gegenfragen, bis du selbst draufkommst."}</p>
  </div>`;

  if (!quizId) {
    html += `<div class="soc-topic-row" style="margin-bottom:12px">
      <input type="text" class="input" id="soc-topic" placeholder="Thema eingeben (optional)..." value="${esc(topic)}">
    </div>`;
  }

  if (quiz && !isMath) {
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

  if (isMath) {
    html += `<div class="study-suggestions" id="suggestions">
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Stell mir eine Frage zu einem mathematischen Konzept. Fang mit den Grundlagen an und führe mich sokratisch zur Lösung.">🧠 Grundverständnis</button>
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Gib mir eine Gleichung zum Lösen. Sag mir nicht die Lösung, sondern führe mich Schritt für Schritt.">🔢 Gleichung lösen</button>
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Stell mir eine Aufgabe zur Ableitung oder zum Integrieren. Führe mich sokratisch durch die Lösung.">📈 Analysis</button>
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Gib mir eine Aufgabe zur linearen Algebra (Vektoren, Matrizen). Führe mich Schritt für Schritt.">🧮 Lineare Algebra</button>
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Stell mir eine Frage zur Geometrie oder Trigonometrie. Führe mich sokratisch.">📐 Geometrie</button>
      <button class="btn btn-ghost study-suggest-btn" data-prompt="Gib mir eine Aufgabe zur Stochastik oder Wahrscheinlichkeitsrechnung. Führe mich Schritt für Schritt.">🎲 Stochastik</button>
    </div>`;
  }

  html += `<div id="soc-messages" class="tutor-messages"></div>
  <div class="tutor-input-row">
    <textarea id="soc-input" class="input" placeholder="Deine Antwort / Frage…" rows="2"></textarea>
    <button id="soc-send" class="btn btn-primary" style="align-self:flex-end">▶</button>
  </div>`;
  if (isMath) html += `<div id="soc-kb-wrap" style="margin-top:4px"></div>`;

  root.innerHTML = `<div class="tutor-layout">${html}</div>`;

  const messagesEl = root.querySelector("#soc-messages");
  const inputEl = root.querySelector("#soc-input");
  const sendBtn = root.querySelector("#soc-send");
  const suggestionsEl = root.querySelector("#suggestions");

  root.querySelector("#soc-back").addEventListener("click", () => {
    if (quizId) navigate("study", { quizId });
    else navigate(isMath ? "math-tools" : "home");
  });
  root.querySelector("#soc-mode-toggle")?.addEventListener("click", () => {
    const newMode = isMath ? "general" : "math";
    navigate("socratic", { quizId, topic, mode: newMode });
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

  // Auto-start the Socratic dialogue when coming from the study-plan flow with
  // wrong answers, so the learner lands straight in the deepening conversation.
  if (fromLearnFlow && wrongQuestions.length) {
    if (suggestionsEl) suggestionsEl.style.display = "none";
    sendMessage("Ich habe gerade ein Quiz gemacht und einige Fragen falsch beantwortet. Bitte führe mich sokratisch durch genau diese falschen Fragen — beginne mit der ersten und stelle mir Gegenfragen, bis ich es selbst verstehe. Gib mir nicht direkt die Lösung.");
  }

  // Math keyboard integration
  if (isMath) {
    const kbWrap = root.querySelector("#soc-kb-wrap");
    if (kbWrap) {
      import("../math-keyboard.js").then(({ createMathKeyboard }) => {
        createMathKeyboard(kbWrap, { target: inputEl }).show();
      }).catch(() => {});
    }
  }
}
