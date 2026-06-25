import { navigate } from "../router.js";
import { esc, mathEsc } from "../utils.js";

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    sc.onload = () => {
      const lib = window.pdfjsLib;
      if (lib) { lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; resolve(lib); }
      else reject(new Error("pdf.js nicht geladen"));
    };
    sc.onerror = () => reject(new Error("pdf.js nicht geladen"));
    document.head.appendChild(sc);
  });
}

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

function detectMathFocus(text) {
  const mathSignals = (text.match(/[=∫∑∏√±≤≥≠∞∂αβγδθλμσπω∆Σ]/g) || []).length;
  const formulaLike = (text.match(/\b\d+[\s]*[+\-*/^]\s*\d+/g) || []).length;
  const mathWords = (text.match(/\b(Formel|Gleichung|Integral|Ableitung|Funktion|Matrix|Vektor|Sinus|Cosinus|Tangens|Logarithmus|Polynom|Bruch|Wurzel|Quotient|Faktor|Koeffizient|Variable|Ohm|Watt|Volt|Ampere|Newton|Joule|Kraft|Spannung|Strom|Widerstand|Impedanz|Frequenz)\b/gi) || []).length;
  return (mathSignals + formulaLike + mathWords) > 5;
}

export async function render(root) {
  const state = { text: null, topics: [], selected: null, chatHistory: [], systemPrompt: "", mathMode: null };

  showUpload(root, state);
}

function showUpload(root, state) {
  root.innerHTML = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Deep Learning</h2>
  </div>
  <div class="card" style="padding:16px;margin-bottom:16px">
    <p style="margin:0 0 12px;font-size:0.9rem;color:var(--text-light)">
      Lade ein Skript oder Aufgabenblatt hoch. Die KI extrahiert die Themen,
      du wählst eines aus und kannst es Schritt für Schritt verstehen —
      mit unbegrenzten Warum/Was/Wie-Fragen.
    </p>
    <input type="file" id="dl-file" accept=".txt,.md,.pdf,.tex" style="margin-bottom:12px">
    <textarea id="dl-paste" class="input" rows="6"
      placeholder="…oder Text hier einfügen"></textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <label style="font-size:0.85rem;color:var(--text-light)">Modus:</label>
      <button class="btn btn-ghost btn-sm" id="dl-mode" style="font-size:0.85rem">🔬 Auto-Erkennung</button>
    </div>
    <button class="btn btn-primary" id="dl-go" style="margin-top:12px;width:100%">
      Themen extrahieren
    </button>
  </div>
  <div id="dl-status"></div>`;

  root.querySelector("#dl-back").addEventListener("click", () => navigate("home"));

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
    let text = pasted;

    if (file && !text) {
      const statusEl = root.querySelector("#dl-status");
      statusEl.innerHTML = `<div class="card" style="padding:12px">📄 Datei wird gelesen…</div>`;
      try {
        text = await readFileAsText(file);
      } catch (e) {
        statusEl.innerHTML = `<div class="card" style="padding:12px;color:var(--danger)">Fehler beim Lesen: ${esc(e.message)}</div>`;
        return;
      }
    }

    if (!text || text.length < 50) {
      root.querySelector("#dl-status").innerHTML =
        `<div class="card" style="padding:12px;color:var(--danger)">Bitte einen längeren Text eingeben oder eine Datei wählen.</div>`;
      return;
    }

    state.text = text;
    if (state.mathMode === null) {
      state.mathMode = detectMathFocus(text);
    }
    await extractTopics(root, state);
  });
}

async function extractTopics(root, state) {
  root.innerHTML = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Deep Learning</h2>
  </div>
  <div class="card" style="padding:16px;text-align:center">
    <div class="spinner"></div>
    <p style="margin-top:12px">KI analysiert den Text und extrahiert Themen…</p>
  </div>`;

  root.querySelector("#dl-back").addEventListener("click", () => showUpload(root, state));

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
    root.querySelector("#dl-back").addEventListener("click", () => showUpload(root, state));
    root.querySelector("#dl-retry").addEventListener("click", () => extractTopics(root, state));
  }
}

function showTopicPicker(root, state) {
  const diffIcon = { basic: "🟢", intermediate: "🟡", advanced: "🔴" };
  const diffLabel = { basic: "Grundlagen", intermediate: "Mittel", advanced: "Fortgeschritten" };

  let html = `<div class="editor-header">
    <button class="btn-icon" id="dl-back">←</button>
    <h2>🔬 Thema wählen</h2>
  </div>
  <p style="color:var(--text-light);margin-bottom:12px">${state.topics.length} Themen gefunden — wähle eines zum Vertiefen:</p>`;

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
      <span style="color:var(--text-light)">›</span>
    </div>`;
  }

  root.innerHTML = html;
  root.querySelector("#dl-back").addEventListener("click", () => showUpload(root, state));
  root.querySelectorAll("[data-idx]").forEach(el => {
    el.addEventListener("click", () => {
      state.selected = state.topics[+el.dataset.idx];
      state.chatHistory = [];
      startDeepChat(root, state);
    });
  });
}

function startDeepChat(root, state) {
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
      Frag <strong>warum</strong>, <strong>wie</strong>, <strong>was</strong> — so oft du willst. Die KI erklärt immer tiefer.
    </p>
  </div>
  <div class="study-suggestions" id="dl-suggestions">
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
  </div>
  <div id="dl-messages" class="tutor-messages"></div>
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

  function addMessage(role, content) {
    const div = document.createElement("div");
    div.className = `tutor-bubble ${role}`;
    div.innerHTML = mathEsc(content);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
}
