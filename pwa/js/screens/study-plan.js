import { navigate } from "../router.js";
import { loadSettings, loadStudyPlans, saveStudyPlans } from "../store.js";
import { generateStudyPlan, getModelContextLimit, MODELS } from "../ai-service.js";
import { esc, loadPdfJs, uid } from "../utils.js";

const DIFFICULTY_LABELS = { beginner: "🟢 Grundlagen", intermediate: "🟡 Mittel", advanced: "🔴 Fortgeschritten" };
const DIFFICULTY_COLORS = { beginner: "var(--success)", intermediate: "var(--warning)", advanced: "var(--danger)" };

function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// Context/chunk granularity presets (mirrors ai-generate). 0 = no chunking.
const CHUNK_SIZES = { coarse: 12000, medium: 7000, fine: 3500 };
const CHUNK_HINTS = {
  auto: "Auto: Große Materialien werden automatisch in Abschnitte zerlegt, damit nichts abgeschnitten wird.",
  off: "Aus: Alles wird in EINEM Aufruf gesendet und ggf. auf das Kontextfenster gekürzt (schnell, günstig).",
  coarse: "Grob: ~12.000 Zeichen pro Abschnitt — wenige Aufrufe, schnell.",
  medium: "Mittel: ~7.000 Zeichen pro Abschnitt — ausgewogen.",
  fine: "Fein: ~3.500 Zeichen pro Abschnitt — gründlichste Abdeckung, aber die meisten KI-Aufrufe.",
};

export async function render(root) {
  const settings = await loadSettings();
  const disabledModels = settings.disabledModels || [];
  let currentModel = settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free";

  // Loaded lectures/materials — the single source of truth. Each: {id, name, text}.
  const sources = [];
  let chunkMode = "auto";
  let detailLevel = "coarse"; // coarse | medium | fine
  let lastPlan = null;

  root.innerHTML = `
    <div class="editor-header">
      <button class="btn-icon back-btn" id="sp-back">←</button>
      <h2>📋 Klausurvorbereitung</h2>
    </div>

    <div id="sp-saved"></div>

    <div class="card mt-section">
      <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px">
        Lade <strong>mehrere Vorlesungen/Skripte auf einmal</strong> hoch (oder füge Text ein).
        Die KI erkennt alle Themen über alle Materialien hinweg und erstellt einen Lernplan
        mit YouTube-Links. Du kannst Materialien auch <strong>nach dem Erstellen</strong> ergänzen oder entfernen.
      </p>

      <div class="input-group">
        <label>Vorlesungen / Materialien laden (.txt, .pdf — mehrere möglich)</label>
        <input type="file" id="sp-file" accept=".txt,.pdf" class="input" multiple>
        <div id="sp-file-progress" class="file-progress" style="display:none">
          <div class="file-track"><div id="sp-file-bar" class="file-fill"></div></div>
          <small id="sp-file-info" class="file-info">Extrahiere Text...</small>
        </div>
      </div>

      <div class="input-group">
        <label>Oder Text einfügen</label>
        <textarea id="sp-text" class="textarea input" rows="5" placeholder="Klausur-/Skripttext hier einfügen…"></textarea>
        <button id="sp-add-text" class="btn btn-ghost btn-sm" style="margin-top:6px">➕ Als Material hinzufügen</button>
      </div>

      <div id="sp-sources-wrap" style="display:none;margin-bottom:12px">
        <label style="font-size:0.8rem;color:var(--text-light)">Geladene Materialien</label>
        <div id="sp-sources"></div>
      </div>

      <div class="input-group">
        <label>Detailgrad (wie viele Themen erkannt werden)</label>
        <div id="sp-detail-presets" class="detail-presets">
          <button type="button" class="detail-preset active" data-detail="coarse">🎯 Grob (max 5)</button>
          <button type="button" class="detail-preset" data-detail="medium">⚖️ Mittel (max 10)</button>
          <button type="button" class="detail-preset" data-detail="fine">🔬 Fein</button>
        </div>
        <small class="file-hint" id="sp-detail-hint">Grob: Nur die übergeordneten Hauptthemen — wenige, breite Blöcke. Unterthemen einzeln aufklappbar.</small>
      </div>

      <div class="input-group">
        <label>Kontextgröße / Verarbeitung</label>
        <div id="sp-chunk-presets" class="detail-presets">
          <button type="button" class="detail-preset active" data-chunk="auto">⚙️ Auto</button>
          <button type="button" class="detail-preset" data-chunk="off">📄 Aus</button>
          <button type="button" class="detail-preset" data-chunk="coarse">🧱 Grob</button>
          <button type="button" class="detail-preset" data-chunk="medium">⚖️ Mittel</button>
          <button type="button" class="detail-preset" data-chunk="fine">🔬 Fein</button>
        </div>
        <small class="file-hint" id="sp-chunk-hint">${CHUNK_HINTS.auto}</small>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;margin-top:8px;cursor:pointer">
          <input type="checkbox" id="sp-rolling" checked>
          Rolling-Kontext (bereits erfasste Themen mitgeben → keine Dopplungen über Vorlesungen)
        </label>
      </div>

      <div class="input-group">
        <label>KI-Modell</label>
        <select id="sp-model" class="input">
          ${MODELS.filter(m => !disabledModels.includes(m.id)).map(m =>
            `<option value="${m.id}" ${m.id === currentModel ? "selected" : ""}>${esc(m.name)} (${m.tier})</option>`
          ).join("")}
        </select>
      </div>

      <div id="sp-error" class="error-box"></div>
      <button id="sp-generate" class="btn btn-primary btn-lg btn-block">🎯 Lernplan erstellen</button>
    </div>

    <div id="sp-result"></div>`;

  const textArea = root.querySelector("#sp-text");
  const fileInput = root.querySelector("#sp-file");
  const modelSelect = root.querySelector("#sp-model");
  const genBtn = root.querySelector("#sp-generate");
  const errorBox = root.querySelector("#sp-error");
  const resultDiv = root.querySelector("#sp-result");
  const fileProgress = root.querySelector("#sp-file-progress");
  const fileBar = root.querySelector("#sp-file-bar");
  const fileInfo = root.querySelector("#sp-file-info");
  const sourcesWrap = root.querySelector("#sp-sources-wrap");
  const sourcesEl = root.querySelector("#sp-sources");
  const chunkHintEl = root.querySelector("#sp-chunk-hint");
  const savedDiv = root.querySelector("#sp-saved");

  // ── Saved plans ────────────────────────────────────────────────────
  // Normalise: old study-plans format has {id, name, topics, examDate} at root;
  // new format wraps it in {id, plan: {title, topics, ...}, createdAt, sourceText}.
  function normalisePlan(p) {
    if (p.plan && p.plan.topics) return p; // new format
    return {
      id: p.id,
      createdAt: p.created ? new Date(p.created).getTime() : Date.now(),
      sourceText: p.sourceText || "",
      plan: {
        title: p.name || "Lernplan",
        subject: "",
        language: "de",
        topics: (p.topics || []).map(t => ({
          name: t.name,
          description: "",
          difficulty: t.difficulty === "hard" ? "advanced" : t.difficulty === "easy" ? "beginner" : "intermediate",
          estimatedMinutes: (t.estimatedHours || 1) * 60,
          youtubeQuery: t.name,
          keyTerms: [],
        })),
        totalHours: (p.topics || []).reduce((s, t) => s + (t.estimatedHours || 1), 0),
        tips: [],
      },
    };
  }

  async function renderSavedPlans() {
    const raw = await loadStudyPlans();
    const plans = raw.map(normalisePlan);
    if (!plans.length) { savedDiv.innerHTML = ""; return; }
    savedDiv.innerHTML = `
      <div class="section-title" style="margin-top:12px">Gespeicherte Lernpläne</div>
      ${plans.map(p => `
        <div class="card sp-saved-row" data-id="${p.id}" style="margin-top:6px;cursor:pointer;display:flex;align-items:center;gap:8px">
          <div style="flex:1;overflow:hidden">
            <div style="font-size:0.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.plan?.title || "Lernplan")}</div>
            <div style="font-size:0.75rem;color:var(--text-light)">${p.plan?.topics?.length || 0} Themen · ${esc(p.plan?.subject || "")} · ${new Date(p.createdAt).toLocaleDateString("de")}</div>
          </div>
          <button class="btn-icon btn-icon-sm sp-delete-plan" data-id="${p.id}" title="Löschen">✕</button>
        </div>
      `).join("")}`;
    savedDiv.querySelectorAll(".sp-saved-row").forEach(row => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".sp-delete-plan")) return;
        const p = plans.find(x => x.id === row.dataset.id);
        if (p) {
          renderPlan(resultDiv, p.plan, p.sourceText || "", modelSelect.value, renderSavedPlans);
          resultDiv.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    savedDiv.querySelectorAll(".sp-delete-plan").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!confirm("Lernplan wirklich löschen?")) return;
        const all = await loadStudyPlans();
        await saveStudyPlans(all.filter(p => p.id !== id));
        renderSavedPlans();
      });
    });
  }
  renderSavedPlans();
  const rollingCb = root.querySelector("#sp-rolling");

  root.querySelector("#sp-back").addEventListener("click", () => navigate("my-quizzes"));

  function getChunkSize(len) {
    if (chunkMode === "off") return 0;
    if (chunkMode === "auto") return len > 10000 ? 8000 : 0;
    return CHUNK_SIZES[chunkMode] || 0;
  }

  function totalChars() { return sources.reduce((s, x) => s + x.text.length, 0); }

  function renderSources() {
    sourcesWrap.style.display = sources.length ? "block" : "none";
    sourcesEl.innerHTML = sources.map(s => `
      <div class="sp-source-row" data-id="${s.id}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-top:6px">
        <span style="flex:1;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📄 ${esc(s.name)}</span>
        <span style="font-size:0.72rem;color:var(--text-light)">${(s.text.length / 1000).toFixed(1)}k Z.</span>
        <button class="btn-icon btn-icon-sm sp-remove" data-id="${s.id}" title="Entfernen">✕</button>
      </div>`).join("") +
      (sources.length ? `<div style="font-size:0.75rem;color:var(--text-light);margin-top:6px">Gesamt: ${(totalChars() / 1000).toFixed(1)}k Zeichen aus ${sources.length} Material(ien)</div>` : "");
    sourcesEl.querySelectorAll(".sp-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const idx = sources.findIndex(s => s.id === id);
        if (idx >= 0) sources.splice(idx, 1);
        renderSources();
      });
    });
  }

  function addSource(name, text) {
    const clean = (text || "").trim();
    if (!clean) return;
    sources.push({ id: "s" + Date.now() + Math.random().toString(36).slice(2, 6), name, text: clean });
    renderSources();
  }

  async function extractPdf(file) {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(" ") + "\n\n";
      fileBar.style.width = (10 + 90 * i / pdf.numPages) + "%";
      fileInfo.textContent = `${file.name}: Seite ${i}/${pdf.numPages}…`;
    }
    return text.trim();
  }

  function readTxt(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
      reader.readAsText(file);
    });
  }

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    errorBox.style.display = "none";
    fileProgress.style.display = "block";

    for (const file of files) {
      fileBar.style.width = "10%";
      fileInfo.textContent = `Lade ${file.name}…`;
      try {
        if (file.name.toLowerCase().endsWith(".txt")) {
          addSource(file.name, await readTxt(file));
        } else if (file.name.toLowerCase().endsWith(".pdf")) {
          addSource(file.name, await extractPdf(file));
        } else {
          errorBox.textContent = `„${file.name}" übersprungen — nur .txt oder .pdf.`;
          errorBox.style.display = "block";
        }
      } catch (err) {
        errorBox.textContent = `${file.name}: ${err.message || err}`;
        errorBox.style.display = "block";
      }
    }
    fileInfo.textContent = `✓ ${sources.length} Material(ien) geladen`;
    setTimeout(() => { fileProgress.style.display = "none"; }, 1500);
    fileInput.value = ""; // allow re-adding the same file later
  });

  root.querySelector("#sp-add-text").addEventListener("click", () => {
    const t = textArea.value.trim();
    if (t.length < 30) {
      errorBox.textContent = "Der eingefügte Text ist zu kurz.";
      errorBox.style.display = "block";
      return;
    }
    errorBox.style.display = "none";
    addSource(`Eingefügter Text ${sources.filter(s => s.name.startsWith("Eingefügter Text")).length + 1}`, t);
    textArea.value = "";
  });

  const DETAIL_HINTS = {
    coarse: "Grob: Nur die übergeordneten Hauptthemen — wenige, breite Blöcke. Unterthemen einzeln aufklappbar.",
    medium: "Mittel: Hauptthemen mit den wichtigsten Unterpunkten (max 10).",
    fine: "Fein: Jedes Konzept und jeden Unterpunkt einzeln auflisten.",
  };
  const detailHintEl = root.querySelector("#sp-detail-hint");
  root.querySelectorAll("#sp-detail-presets .detail-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("#sp-detail-presets .detail-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      detailLevel = btn.dataset.detail;
      if (detailHintEl) detailHintEl.textContent = DETAIL_HINTS[detailLevel] || "";
    });
  });

  root.querySelectorAll("#sp-chunk-presets .detail-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("#sp-chunk-presets .detail-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      chunkMode = btn.dataset.chunk;
      if (chunkHintEl) chunkHintEl.textContent = CHUNK_HINTS[chunkMode] || "";
    });
  });

  genBtn.addEventListener("click", async () => {
    // Include any unsaved pasted text as a source automatically.
    if (textArea.value.trim().length >= 30) {
      addSource(`Eingefügter Text ${sources.filter(s => s.name.startsWith("Eingefügter Text")).length + 1}`, textArea.value);
      textArea.value = "";
    }

    if (!sources.length) {
      errorBox.textContent = "Bitte mindestens ein Material laden oder Text hinzufügen.";
      errorBox.style.display = "block";
      return;
    }

    // Combine all materials; \f marks lecture boundaries so chunkText splits there.
    let inputText = sources.map(s => s.text).join("\n\n\f\n\n");
    if (inputText.length < 50) {
      errorBox.textContent = "Die Materialien sind zu kurz für eine sinnvolle Analyse.";
      errorBox.style.display = "block";
      return;
    }

    const model = modelSelect.value;
    let chunkSize = getChunkSize(inputText.length);
    // Without chunking, respect the model's context window.
    if (!chunkSize) {
      const charLimit = getModelContextLimit(model);
      if (inputText.length > charLimit) inputText = inputText.slice(0, charLimit);
    }

    errorBox.style.display = "none";
    genBtn.disabled = true;
    genBtn.textContent = "⏳ Analysiere Materialien…";

    try {
      const onProgress = (i, n) => { genBtn.textContent = `⏳ Abschnitt ${i}/${n}…`; };
      const plan = await generateStudyPlan(inputText, {
        model, chunkSize, onProgress, rollingContext: rollingCb.checked, detailLevel,
      });
      lastPlan = plan;
      renderPlan(resultDiv, plan, inputText, model, renderSavedPlans);
      resultDiv.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      errorBox.textContent = err.message || "Fehler bei der Lernplan-Erstellung.";
      errorBox.style.display = "block";
    }
    genBtn.disabled = false;
    genBtn.textContent = lastPlan ? "🔄 Lernplan aktualisieren" : "🎯 Lernplan erstellen";
  });
}

function renderPlan(container, plan, sourceText, model, onSaved) {
  const lang = plan.language === "en" ? "Englisch" : plan.language === "de" ? "Deutsch" : plan.language || "Auto";
  let completedTopics = new Set();

  let html = `
    <div class="card" style="margin-top:16px;border-left:4px solid var(--primary)">
      <h3 style="margin:0 0 4px">${esc(plan.title || "Lernplan")}</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.85rem;color:var(--text-light)">
        <span>📚 ${esc(plan.subject || "–")}</span>
        <span>🌐 ${esc(lang)}</span>
        <span>📝 ${plan.topics.length} Themen</span>
        <span>⏱️ ~${plan.totalHours || Math.round(plan.topics.reduce((s, t) => s + (t.estimatedMinutes || 30), 0) / 60)} Stunden</span>
      </div>
      <button class="btn btn-sm btn-primary sp-save-btn" style="margin-top:10px">💾 Lernplan speichern</button>
    </div>`;

  if (plan.tips?.length) {
    html += `<div class="card" style="margin-top:8px">
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px">💡 Lerntipps</div>
      <ul style="margin:0;padding-left:18px;font-size:0.85rem;color:var(--text-light)">
        ${plan.tips.map(t => `<li>${esc(t)}</li>`).join("")}
      </ul>
    </div>`;
  }

  html += `<div class="card" style="margin-top:8px;background:var(--primary-subtle)">
    <div style="font-size:0.82rem;color:var(--text)">
      <strong>So lernst du am besten:</strong> pro Thema erst das <strong>▶️ Video</strong> ansehen (passiv verstehen),
      dann <strong>🎯 Quiz</strong> machen (aktiv abfragen). Falsch beantwortete Fragen kannst du direkt danach
      im <strong>🏛️ Sokrates-Modus</strong> vertiefen.
    </div>
  </div>`;

  html += `<div class="section-title" style="margin-top:16px">Themen-Reihenfolge</div>
    <div id="sp-topics">`;

  plan.topics.forEach((topic, i) => {
    const diff = DIFFICULTY_LABELS[topic.difficulty] || "⚪ " + (topic.difficulty || "–");
    const diffColor = DIFFICULTY_COLORS[topic.difficulty] || "var(--text-light)";
    const ytUrl = youtubeSearchUrl(topic.youtubeQuery || topic.name);
    const mins = topic.estimatedMinutes || 30;
    const prereqs = (topic.prerequisites || []).filter(p => p);

    html += `
      <div class="card sp-topic-card" data-idx="${i}" style="margin-top:8px;position:relative;transition:opacity 0.3s">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="sp-check" data-idx="${i}" style="cursor:pointer;font-size:1.2rem">☐</span>
              <strong style="font-size:1rem">${i + 1}. ${esc(topic.name)}</strong>
            </div>
            <p style="font-size:0.85rem;color:var(--text-light);margin:0 0 6px">${esc(topic.description || "")}</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:0.78rem;color:var(--text-light)">
              <span style="color:${diffColor}">${diff}</span>
              <span>⏱️ ~${mins} Min</span>
              ${prereqs.length ? `<span>↩ ${prereqs.map(p => esc(p)).join(", ")}</span>` : ""}
            </div>
            ${topic.keyTerms?.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
              ${topic.keyTerms.map(t => `<span style="font-size:0.72rem;background:var(--primary-subtle);color:var(--primary);padding:2px 6px;border-radius:8px">${esc(t)}</span>`).join("")}
            </div>` : ""}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <a href="${ytUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-primary" style="display:inline-flex;align-items:center;gap:4px;text-decoration:none">
            ▶️ Video
          </a>
          <button class="btn btn-sm btn-secondary sp-quiz-btn" data-idx="${i}">🎯 Quiz dazu</button>
          <button class="btn btn-sm btn-ghost sp-subtopics-btn" data-idx="${i}">🔍 Unterthemen</button>
        </div>
        <div class="sp-quiz-status" data-idx="${i}" style="display:none;font-size:0.8rem;color:var(--text-light);margin-top:6px"></div>
        <div class="sp-subtopics" data-idx="${i}" style="display:none;margin-top:8px;padding-left:12px;border-left:3px solid var(--primary-subtle)"></div>
      </div>`;
  });

  html += `</div>`;

  container.innerHTML = html;

  // Save button
  container.querySelector(".sp-save-btn")?.addEventListener("click", async () => {
    const btn = container.querySelector(".sp-save-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Speichere…";
    try {
      const all = await loadStudyPlans();
      all.unshift({
        id: uid(),
        createdAt: Date.now(),
        plan,
        sourceText: sourceText.slice(0, 50000),
      });
      await saveStudyPlans(all);
      btn.textContent = "✓ Gespeichert!";
      btn.style.background = "var(--success)";
      btn.style.color = "#fff";
      if (typeof onSaved === "function") onSaved();
    } catch (err) {
      btn.textContent = "❌ " + (err.message || "Speichern fehlgeschlagen");
      btn.style.background = "var(--danger)";
      btn.style.color = "#fff";
      console.error("Study plan save error:", err);
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = "💾 Lernplan speichern"; btn.style.background = ""; btn.style.color = ""; }, 3000);
  });

  container.querySelectorAll(".sp-check").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx);
      const card = container.querySelector(`.sp-topic-card[data-idx="${idx}"]`);
      if (completedTopics.has(idx)) {
        completedTopics.delete(idx);
        el.textContent = "☐";
        card.style.opacity = "1";
      } else {
        completedTopics.add(idx);
        el.textContent = "☑";
        card.style.opacity = "0.5";
      }
    });
  });

  // 🎯 Quiz dazu — generate a short quiz focused on this topic from the source
  // material, then run it through the normal quiz engine. The quiz carries a
  // _learnFlow marker so the results screen can offer the Socratic follow-up.
  container.querySelectorAll(".sp-quiz-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const topic = plan.topics[idx];
      const statusEl = container.querySelector(`.sp-quiz-status[data-idx="${idx}"]`);
      const lang = plan.language === "en" ? "en" : "de";
      btn.disabled = true;
      btn.textContent = "⏳ Erstelle Quiz…";
      if (statusEl) { statusEl.style.display = "block"; statusEl.textContent = "Die KI erstellt Fragen zu diesem Thema…"; }

      try {
        const { generateQuiz } = await import("../ai-service.js");
        const focus = lang === "en"
          ? `Focus exclusively on the topic: "${topic.name}".`
          : `Fokussiere dich ausschließlich auf das Thema: "${topic.name}".`;
        const quizText = `${focus}\n\n${sourceText}`;
        const questions = await generateQuiz(quizText, 5, lang, { model });
        if (!Array.isArray(questions) || !questions.length) {
          throw new Error(lang === "en" ? "No questions generated." : "Keine Fragen erzeugt.");
        }
        const quiz = {
          id: "sp-" + Date.now(),
          name: topic.name,
          questions,
          _learnFlow: {
            topic: topic.name,
            sourceText: sourceText.slice(0, 12000),
            language: lang,
          },
        };
        navigate("quiz", { quiz, mode: "single" });
      } catch (err) {
        if (statusEl) statusEl.textContent = "Fehler: " + (err.message || "Quiz konnte nicht erstellt werden.");
        btn.disabled = false;
        btn.textContent = "🎯 Quiz dazu";
      }
    });
  });

  // 🔍 Unterthemen — expand a topic into subtopics on demand
  container.querySelectorAll(".sp-subtopics-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const topic = plan.topics[idx];
      const subEl = container.querySelector(`.sp-subtopics[data-idx="${idx}"]`);
      if (!subEl) return;

      // Toggle: if already loaded, just show/hide
      if (subEl.dataset.loaded === "1") {
        subEl.style.display = subEl.style.display === "none" ? "block" : "none";
        btn.textContent = subEl.style.display === "none" ? "🔍 Unterthemen" : "🔍 Einklappen";
        return;
      }

      btn.disabled = true;
      btn.textContent = "⏳ Lade…";
      subEl.style.display = "block";
      subEl.innerHTML = `<div style="font-size:0.8rem;color:var(--text-light)">Erstelle Unterthemen…</div>`;

      try {
        const { generateSubtopics } = await import("../ai-service.js");
        const subs = await generateSubtopics(topic.name, sourceText.slice(0, 12000), lang === "Englisch" ? "en" : "de", { model });
        let subHtml = "";
        subs.forEach((sub, si) => {
          const diff = DIFFICULTY_LABELS[sub.difficulty] || "⚪";
          const diffColor = DIFFICULTY_COLORS[sub.difficulty] || "var(--text-light)";
          const ytUrl = youtubeSearchUrl(sub.youtubeQuery || sub.name);
          subHtml += `
            <div style="padding:8px 0;${si > 0 ? "border-top:1px solid var(--border)" : ""}">
              <div style="display:flex;align-items:center;gap:6px">
                <strong style="font-size:0.88rem">${idx + 1}.${si + 1} ${esc(sub.name)}</strong>
              </div>
              <p style="font-size:0.8rem;color:var(--text-light);margin:2px 0 4px">${esc(sub.description || "")}</p>
              <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.75rem;color:var(--text-light);align-items:center">
                <span style="color:${diffColor}">${diff}</span>
                <span>⏱️ ~${sub.estimatedMinutes || 15} Min</span>
                <a href="${ytUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;font-size:0.75rem">▶️ Video</a>
              </div>
              ${sub.keyTerms?.length ? `<div style="margin-top:4px;display:flex;gap:3px;flex-wrap:wrap">
                ${sub.keyTerms.map(t => `<span style="font-size:0.68rem;background:var(--primary-subtle);color:var(--primary);padding:1px 5px;border-radius:6px">${esc(t)}</span>`).join("")}
              </div>` : ""}
            </div>`;
        });
        subEl.innerHTML = subHtml;
        subEl.dataset.loaded = "1";
        btn.textContent = "🔍 Einklappen";
      } catch (err) {
        subEl.innerHTML = `<div style="font-size:0.8rem;color:var(--danger)">Fehler: ${esc(err.message || "Unterthemen konnten nicht erstellt werden.")}</div>`;
        btn.textContent = "🔍 Unterthemen";
      }
      btn.disabled = false;
    });
  });
}
