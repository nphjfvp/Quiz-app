import { navigate } from "../router.js";
import { esc, mathEsc, loadPdfJs } from "../utils.js";

// ── Store helpers for persistent deep-learn sessions ──
const DB_KEY = "deep_learn_sessions";

async function loadSessions() {
  const { default: store } = await import("../store.js").catch(() => ({}));
  // Fallback: direct IndexedDB access via store's pattern
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("lerntrainer", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readonly");
      const rq = tx.objectStore("kv").get(DB_KEY);
      rq.onsuccess = () => res(rq.result ?? []);
      rq.onerror = () => rej(rq.error);
    });
  } catch { return []; }
}

async function saveSessions(sessions) {
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("lerntrainer", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(sessions, DB_KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* best effort */ }
}

// ── PDF ──
async function readFileAsText(file) {
  if (file.name.endsWith(".pdf")) {
    const lib = await loadPdfJs();
    const ab = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: ab }).promise;
    let txt = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const c = await page.getTextContent();
      txt += c.items.map(it => it.str).join(" ") + "\n--- Seite ---\n";
    }
    return txt;
  }
  return await file.text();
}

// ── Math detection ──
function detectMathFocus(text) {
  const mathSignals = (text.match(/[=∫∑∏√±≤≥≠∞∂αβγδθλμσπω∆Σ]/g) || []).length;
  const formulaLike = (text.match(/\b\d+[\s]*[+\-*/^]\s*\d+/g) || []).length;
  const mathWords = (text.match(/\b(Formel|Gleichung|Integral|Ableitung|Funktion|Matrix|Vektor|Sinus|Cosinus|Tangens|Logarithmus|Polynom|Bruch|Wurzel|Quotient|Faktor|Koeffizient|Variable|Ohm|Watt|Volt|Ampere|Newton|Joule|Kraft|Spannung|Strom|Widerstand|Impedanz|Frequenz)\b/gi) || []).length;
  return (mathSignals + formulaLike + mathWords) > 5;
}

// ── Quiz text extraction ──
function quizToText(quiz) {
  const lines = [`Quiz: ${quiz.name || "Unbenannt"}\n`];
  for (const q of (quiz.questions || [])) {
    lines.push(`Frage: ${q.question_text || q.text || ""}`);
    if (q.topic) lines.push(`Thema: ${q.topic}`);
    if (q.correct_answer) lines.push(`Antwort: ${q.correct_answer}`);
    if (q.explanation) lines.push(`Erklärung: ${q.explanation}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ── Entry point ──
export async function render(root, params = {}) {
  const state = { text: null, topics: [], selected: null, chatHistory: [], systemPrompt: "", mathMode: null, sessionId: null };

  // Resume a session (e.g. from daily learn)
  if (params.sessionId) {
    const sessions = await loadSessions();
    const sess = sessions.find(s => s.id === params.sessionId);
    if (sess) {
      state.text = sess.sourceText;
      state.topics = sess.topics;
      state.mathMode = sess.mathMode;
      state.sessionId = sess.id;
      if (params.topicName) {
        state.selected = sess.topics.find(t => t.name === params.topicName) || sess.topics[0];
        state.chatHistory = (sess.chats || {})[state.selected.name] || [];
        startDeepChat(root, state, params.prompt || null);
      } else {
        showTopicPicker(root, state);
      }
      return;
    }
  }

  showMainMenu(root, state);
}

// ── Main menu: saved sessions + new import ──
async function showMainMenu(root, state) {
  const sessions = await loadSessions();

  let html = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Deep Learning</h2>
  </div>`;

  // Saved sessions
  if (sessions.length > 0) {
    html += `<div class="section-title">Gespeicherte Sessions</div>`;
    for (const sess of sessions) {
      const topicCount = (sess.topics || []).length;
      const chatCount = Object.keys(sess.chats || {}).length;
      html += `<div class="quiz-row" data-sess="${esc(sess.id)}" style="cursor:pointer">
        <div class="quiz-accent" style="background:${sess.mathMode ? 'var(--primary)' : 'var(--info)'}"></div>
        <div class="quiz-info">
          <h4>${esc(sess.name)}</h4>
          <small>${topicCount} Themen · ${chatCount} Chats · ${sess.mathMode ? '📐 MINT' : '📖 Text'}</small>
        </div>
        <button class="btn-icon dl-del" data-del="${esc(sess.id)}" title="Löschen" style="color:var(--danger);font-size:1.1rem">🗑</button>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  }

  // New import options
  html += `<div class="section-title" style="margin-top:16px">Neue Session</div>
  <div class="grid-2">
    <div class="grid-card" id="dl-file-import">
      <div class="icon">📄</div>
      <div class="title">PDF / Text</div>
      <div class="desc">Skript hochladen</div>
    </div>
    <div class="grid-card" id="dl-quiz-import">
      <div class="icon">📚</div>
      <div class="title">Aus Quiz</div>
      <div class="desc">Bestehendes Quiz</div>
    </div>
  </div>`;

  root.innerHTML = html;

  root.querySelector("#dl-back").addEventListener("click", () => navigate("home"));
  root.querySelector("#dl-file-import").addEventListener("click", () => showFileImport(root, state));
  root.querySelector("#dl-quiz-import").addEventListener("click", () => showQuizImport(root, state));

  // Resume saved session
  root.querySelectorAll("[data-sess]").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".dl-del")) return;
      const sess = sessions.find(s => s.id === el.dataset.sess);
      if (sess) {
        state.text = sess.sourceText;
        state.topics = sess.topics;
        state.mathMode = sess.mathMode;
        state.sessionId = sess.id;
        showTopicPicker(root, state);
      }
    });
  });

  // Delete session
  root.querySelectorAll(".dl-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      const updated = sessions.filter(s => s.id !== id);
      await saveSessions(updated);
      showMainMenu(root, state);
    });
  });
}

// ── File import ──
function showFileImport(root, state) {
  root.innerHTML = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Deep Learning</h2>
  </div>
  <div class="card" style="padding:16px;margin-bottom:16px">
    <label style="font-weight:600;margin-bottom:8px;display:block">Session-Name</label>
    <input type="text" id="dl-name" class="input" placeholder="z.B. Analysis Vorlesung 3" style="margin-bottom:12px">
    <label style="font-weight:600;margin-bottom:8px;display:block">Datei</label>
    <input type="file" id="dl-file" accept=".txt,.md,.pdf,.tex" style="margin-bottom:12px">
    <textarea id="dl-paste" class="input" rows="6"
      placeholder="…oder Text hier einfügen"></textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <label style="font-size:0.85rem;color:var(--text-light)">Modus:</label>
      <button class="btn btn-ghost btn-sm" id="dl-mode" style="font-size:0.85rem">🔬 Auto-Erkennung</button>
    </div>
    <button class="btn btn-primary" id="dl-go" style="margin-top:12px;width:100%">
      🚀 Themen extrahieren
    </button>
  </div>
  <div id="dl-status"></div>`;

  root.querySelector("#dl-back").addEventListener("click", () => showMainMenu(root, state));

  const modeBtn = root.querySelector("#dl-mode");
  const modes = [
    { key: null, label: "🔬 Auto-Erkennung" },
    { key: true, label: "📐 Mathe/MINT-Fokus" },
    { key: false, label: "📖 Text/Theorie-Fokus" },
  ];
  let modeIdx = 0;
  modeBtn.addEventListener("click", () => {
    modeIdx = (modeIdx + 1) % modes.length;
    state.mathMode = modes[modeIdx].key;
    modeBtn.textContent = modes[modeIdx].label;
  });

  root.querySelector("#dl-go").addEventListener("click", async () => {
    const file = root.querySelector("#dl-file").files[0];
    const pasted = root.querySelector("#dl-paste").value.trim();
    const name = root.querySelector("#dl-name").value.trim() || file?.name || "Unnamed Session";
    let text = pasted;

    if (file && !text) {
      const statusEl = root.querySelector("#dl-status");
      statusEl.innerHTML = `<div class="card" style="padding:12px">📄 Datei wird gelesen…</div>`;
      try { text = await readFileAsText(file); }
      catch (e) {
        statusEl.innerHTML = `<div class="card" style="padding:12px;color:var(--danger)">Fehler: ${esc(e.message)}</div>`;
        return;
      }
    }

    if (!text || text.length < 50) {
      root.querySelector("#dl-status").innerHTML =
        `<div class="card" style="padding:12px;color:var(--danger)">Bitte einen längeren Text eingeben oder eine Datei wählen.</div>`;
      return;
    }

    state.text = text;
    state.sessionName = name;
    if (state.mathMode === null) state.mathMode = detectMathFocus(text);
    await extractTopics(root, state);
  });
}

// ── Quiz import ──
async function showQuizImport(root, state) {
  const { loadQuizzes, loadFolders } = await import("../store.js");
  const [quizzes, folders] = await Promise.all([loadQuizzes(), loadFolders()]);

  let html = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Aus Quiz importieren</h2>
  </div>`;

  if (folders.length > 0) {
    html += `<div class="section-title">Ordner</div>`;
    for (const f of folders) {
      const quizCount = (f.quizIds || []).length;
      html += `<div class="quiz-row" data-folder="${esc(f.id)}" style="cursor:pointer">
        <div class="quiz-accent" style="background:var(--warning)"></div>
        <div class="quiz-info">
          <h4>📁 ${esc(f.name)}</h4>
          <small>${quizCount} Quizze</small>
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  }

  if (quizzes.length > 0) {
    html += `<div class="section-title">Einzelne Quizze</div>`;
    for (const q of quizzes) {
      const n = (q.questions || []).length;
      html += `<div class="quiz-row" data-quiz="${esc(q.id)}" style="cursor:pointer">
        <div class="quiz-accent"></div>
        <div class="quiz-info">
          <h4>${esc(q.name || "Quiz")}</h4>
          <small>${n} Fragen</small>
        </div>
        <span style="color:var(--text-light)">›</span>
      </div>`;
    }
  }

  if (!quizzes.length && !folders.length) {
    html += `<div class="empty">Keine Quizze vorhanden.</div>`;
  }

  root.innerHTML = html;
  root.querySelector("#dl-back").addEventListener("click", () => showMainMenu(root, state));

  // Single quiz
  root.querySelectorAll("[data-quiz]").forEach(el => {
    el.addEventListener("click", () => {
      const quiz = quizzes.find(q => q.id === el.dataset.quiz);
      if (!quiz) return;
      state.text = quizToText(quiz);
      state.sessionName = quiz.name;
      state.mathMode = detectMathFocus(state.text);
      extractTopics(root, state);
    });
  });

  // Folder (combine all quizzes in folder)
  root.querySelectorAll("[data-folder]").forEach(el => {
    el.addEventListener("click", () => {
      const folder = folders.find(f => f.id === el.dataset.folder);
      if (!folder) return;
      const folderQuizzes = (folder.quizIds || []).map(id => quizzes.find(q => q.id === id)).filter(Boolean);
      if (!folderQuizzes.length) return;
      state.text = folderQuizzes.map(q => quizToText(q)).join("\n\n---\n\n");
      state.sessionName = folder.name;
      state.mathMode = detectMathFocus(state.text);
      extractTopics(root, state);
    });
  });
}

// ── Topic extraction ──
async function extractTopics(root, state) {
  root.innerHTML = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Deep Learning</h2>
  </div>
  <div class="card" style="padding:16px;text-align:center">
    <div class="spinner"></div>
    <p style="margin-top:12px">KI analysiert den Text und extrahiert Themen…</p>
  </div>`;

  root.querySelector("#dl-back").addEventListener("click", () => showMainMenu(root, state));

  try {
    const { askTutor } = await import("../ai-service.js");

    const mathExtra = state.mathMode
      ? `Extrahiere ALLE Themen, Konzepte und Rechenverfahren.\nJedes Element: {"name":"<Themenname>","desc":"<1-Satz: welche Formeln/Verfahren gehören dazu>","difficulty":"basic|intermediate|advanced","formulas":["<wichtigste Formel(n) als LaTeX>"]}`
      : `Extrahiere ALLE Themen, Konzepte und Theorien.\nJedes Element: {"name":"<Themenname>","desc":"<1-Satz-Zusammenfassung>","difficulty":"basic|intermediate|advanced"}`;

    const prompt = `Analysiere den folgenden Text (Vorlesung/Skript/Aufgabenblatt).
${mathExtra}

Gib sie als JSON-Array zurück, sortiert nach logischer Reihenfolge (Grundlagen zuerst, darauf aufbauende Themen danach).
NUR das JSON-Array ausgeben, kein weiterer Text.

Text:
${state.text.slice(0, 15000)}`;

    const reply = await askTutor(prompt, "", []);
    let topics;
    try {
      const match = reply.match(/\[[\s\S]*\]/);
      if (match) topics = JSON.parse(match[0]);
      else topics = JSON.parse(reply);
    } catch {
      const clean = reply.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const match2 = clean.match(/\[[\s\S]*\]/);
      if (match2) topics = JSON.parse(match2[0]);
      else throw new Error("KI hat kein gültiges JSON zurückgegeben.");
    }

    state.topics = topics.filter(t => t && t.name);
    if (state.topics.length === 0) throw new Error("Keine Themen gefunden.");

    // Save session
    const sessions = await loadSessions();
    const id = state.sessionId || crypto.randomUUID?.() || `${Date.now()}`;
    const existing = sessions.find(s => s.id === id);
    if (existing) {
      existing.topics = state.topics;
    } else {
      sessions.unshift({
        id,
        name: state.sessionName || "Session",
        sourceText: state.text,
        topics: state.topics,
        mathMode: state.mathMode,
        chats: {},
        created: new Date().toISOString(),
      });
    }
    state.sessionId = id;
    await saveSessions(sessions);

    showTopicPicker(root, state);
  } catch (e) {
    root.innerHTML = `<div class="editor-header">
      <button class="btn-icon" id="dl-back">←</button>
      <h2>🔬 Deep Learning</h2>
    </div>
    <div class="card" style="padding:16px;color:var(--danger)">
      Fehler: ${esc(e.message)}
      <button class="btn btn-secondary" id="dl-retry" style="margin-top:12px;width:100%">Nochmal versuchen</button>
    </div>`;
    root.querySelector("#dl-back").addEventListener("click", () => showMainMenu(root, state));
    root.querySelector("#dl-retry").addEventListener("click", () => extractTopics(root, state));
  }
}

// ── Topic picker ──
function showTopicPicker(root, state) {
  const diffIcon = { basic: "🟢", intermediate: "🟡", advanced: "🔴" };
  const diffLabel = { basic: "Grundlagen", intermediate: "Mittel", advanced: "Fortgeschritten" };

  let html = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Thema wählen</h2>
  </div>
  <p style="color:var(--text-light);margin-bottom:12px">${state.topics.length} Themen gefunden — wähle eines zum Vertiefen:</p>`;

  // Load session to check which topics have chats
  const sessId = state.sessionId;

  for (const [i, t] of state.topics.entries()) {
    const icon = diffIcon[t.difficulty] || "⚪";
    const label = diffLabel[t.difficulty] || t.difficulty || "";
    const formulas = (t.formulas || []).join(", ");
    html += `<div class="quiz-row" data-idx="${i}" style="cursor:pointer">
      <div class="quiz-accent"></div>
      <div class="quiz-info">
        <h4>${icon} ${esc(t.name)}</h4>
        <small>${esc(t.desc || "")} · ${label}</small>
        ${formulas ? `<small style="opacity:0.7;display:block;margin-top:2px">${mathEsc(formulas)}</small>` : ""}
      </div>
      <span class="dl-chat-badge" data-topic="${esc(t.name)}"></span>
      <span style="color:var(--text-light)">›</span>
    </div>`;
  }

  root.innerHTML = html;

  // Show chat badges (how many messages per topic)
  loadSessions().then(sessions => {
    const sess = sessions.find(s => s.id === sessId);
    if (!sess?.chats) return;
    root.querySelectorAll(".dl-chat-badge").forEach(badge => {
      const name = badge.dataset.topic;
      const count = (sess.chats[name] || []).length;
      if (count > 0) badge.textContent = `💬 ${count / 2 | 0}`;
      badge.style.cssText = "font-size:0.75rem;color:var(--text-light);margin-right:4px";
    });
  });

  root.querySelector("#dl-back").addEventListener("click", () => showMainMenu(root, state));
  root.querySelectorAll("[data-idx]").forEach(el => {
    el.addEventListener("click", async () => {
      state.selected = state.topics[+el.dataset.idx];
      // Load persisted chat
      const sessions = await loadSessions();
      const sess = sessions.find(s => s.id === state.sessionId);
      state.chatHistory = (sess?.chats?.[state.selected.name]) || [];
      startDeepChat(root, state);
    });
  });
}

// ── Chat ──
function startDeepChat(root, state, initialPrompt = null) {
  const topic = state.selected;
  const relevantText = state.text.slice(0, 12000);
  const isMath = state.mathMode;

  state.systemPrompt = isMath
    ? `Du bist ein Experten-Tutor für Mathematik, Physik und Ingenieurwissenschaften. Der Lernende möchte das Thema "${topic.name}" wirklich TIEF verstehen.

Deine Regeln:
1. Erkläre das Thema anhand der konkreten Aufgaben/Beispiele aus dem hochgeladenen Material.
2. Beginne mit dem Grundprinzip: welche Formel, welcher Satz, welches physikalische Gesetz steckt dahinter?
3. Schreibe Formeln IMMER in LaTeX-Notation mit $...$ (inline) oder $$...$$ (Block).
4. Wenn der Lernende "warum" fragt: erkläre die mathematische/physikalische Herleitung. Woher kommt die Formel?
5. Wenn der Lernende "wie" fragt: zeige den Rechenweg Schritt für Schritt mit konkreten Zahlen aus dem Material.
6. Wenn der Lernende "was" fragt: erkläre die Bedeutung jeder Variablen und jedes Terms.
7. Nutze Analogien und Alltagsbeispiele, um abstrakte Konzepte greifbar zu machen.
8. Zeige typische Fallen und Vorzeichenfehler auf.
9. Am Ende jeder Antwort: stelle eine kurze Verständnisfrage ODER schlage eine Vertiefung vor.
10. Antworte IMMER auf Deutsch, klar und strukturiert.

Quellmaterial:
${relevantText}`
    : `Du bist ein Experten-Tutor. Der Lernende möchte das Thema "${topic.name}" wirklich TIEF verstehen.

Deine Regeln:
1. Erkläre das Thema anhand der konkreten Inhalte aus dem hochgeladenen Material.
2. Beginne mit dem Kernkonzept: was ist die zentrale Idee?
3. Wenn der Lernende "warum" fragt: erkläre die Hintergründe, Ursachen, Zusammenhänge.
4. Wenn der Lernende "wie" fragt: zeige den Ablauf/Prozess Schritt für Schritt.
5. Wenn der Lernende "was" fragt: definiere und erkläre die Begriffe genau.
6. Nutze Analogien und Alltagsbeispiele.
7. Zeige Zusammenhänge zu anderen Themen auf.
8. Am Ende jeder Antwort: stelle eine kurze Verständnisfrage ODER schlage eine Vertiefung vor.
9. Antworte IMMER auf Deutsch, klar und strukturiert.

Quellmaterial:
${relevantText}`;

  let html = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 ${esc(topic.name)}</h2>
  </div>
  <div class="card" style="padding:10px;margin-bottom:10px">
    <p style="font-size:0.85rem;color:var(--text-light);margin:0">
      Frag <strong>warum</strong>, <strong>wie</strong>, <strong>was</strong> — so oft du willst. Die KI erklärt immer tiefer. Chat wird gespeichert.
    </p>
  </div>`;

  if (state.chatHistory.length === 0) {
    html += `<div class="study-suggestions" id="dl-suggestions">
    ${isMath ? `
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Erkläre mir das Grundprinzip von '${esc(topic.name)}' — welche Formel/welches Gesetz steckt dahinter und woher kommt es?">💡 Grundprinzip</button>
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Zeig mir Schritt für Schritt mit konkreten Zahlen aus dem Material, wie man eine typische Aufgabe zu '${esc(topic.name)}' löst.">📝 Rechenbeispiel</button>
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Woher kommt die Formel? Leite sie mir her und erkläre jeden Schritt der Herleitung.">🔬 Herleitung</button>
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Welche typischen Rechen- und Vorzeichenfehler macht man bei '${esc(topic.name)}' und wie vermeidet man sie?">⚠️ Typische Fehler</button>
    ` : `
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Erkläre mir die Kernidee von '${esc(topic.name)}' — was ist das Wichtigste, das ich verstehen muss?">💡 Kernidee</button>
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Gib mir ein konkretes Beispiel aus dem Material, das '${esc(topic.name)}' veranschaulicht.">📝 Beispiel</button>
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Wie hängt '${esc(topic.name)}' mit den anderen Themen zusammen? Zeig mir das große Bild.">🔗 Zusammenhänge</button>
    <button class="btn btn-ghost study-suggest-btn" data-prompt="Was sind die häufigsten Missverständnisse bei '${esc(topic.name)}'?">⚠️ Missverständnisse</button>
    `}
    </div>`;
  }

  html += `<div id="dl-messages" class="tutor-messages"></div>
  <div class="tutor-input-row">
    <input id="dl-input" class="input" placeholder="Warum? Wie? Was genau…">
    <button id="dl-send" class="btn btn-primary">▶</button>
  </div>`;

  root.innerHTML = `<div class="tutor-layout">${html}</div>`;

  const messagesEl = root.querySelector("#dl-messages");
  const inputEl = root.querySelector("#dl-input");
  const sendBtn = root.querySelector("#dl-send");
  const suggestionsEl = root.querySelector("#dl-suggestions");

  root.querySelector("#dl-back").addEventListener("click", () => showTopicPicker(root, state));

  // Math keyboard for chat input
  if (isMath) {
    import("../math-keyboard.js").then(({ createMathKeyboard }) => {
      const inputRow = root.querySelector(".tutor-input-row");
      if (!inputRow) return;
      const kbWrap = document.createElement("div");
      inputRow.parentElement.insertBefore(kbWrap, inputRow);
      createMathKeyboard(kbWrap, inputEl);
    }).catch(() => {});
  }

  // Restore previous messages
  for (const msg of state.chatHistory) {
    const div = document.createElement("div");
    div.className = `tutor-bubble ${msg.role}`;
    div.innerHTML = mathEsc(msg.content);
    messagesEl.appendChild(div);
  }
  if (state.chatHistory.length > 0) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, content) {
    const div = document.createElement("div");
    div.className = `tutor-bubble ${role}`;
    div.innerHTML = mathEsc(content);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function persistChat() {
    const sessions = await loadSessions();
    const sess = sessions.find(s => s.id === state.sessionId);
    if (sess) {
      if (!sess.chats) sess.chats = {};
      sess.chats[topic.name] = state.chatHistory;
      await saveSessions(sessions);
    }
  }

  async function send(text) {
    if (!text?.trim()) return;
    inputEl.value = "";
    if (suggestionsEl) suggestionsEl.style.display = "none";
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
      const reply = await askTutor(text, state.systemPrompt, state.chatHistory);
      typing.remove();
      state.chatHistory.push({ role: "user", content: text });
      state.chatHistory.push({ role: "assistant", content: reply });
      addMessage("assistant", reply);
      await persistChat();
    } catch (err) {
      typing.remove();
      addMessage("assistant", `Fehler: ${err.message || "Unbekannter Fehler."}`);
    } finally {
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", () => send(inputEl.value.trim()));
  inputEl.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(inputEl.value.trim()); }
  });
  root.querySelectorAll(".study-suggest-btn").forEach(btn => {
    btn.addEventListener("click", () => send(btn.dataset.prompt));
  });

  inputEl.focus();

  // Auto-send initial prompt (from daily learn)
  if (initialPrompt) {
    setTimeout(() => send(initialPrompt), 100);
  }
}
