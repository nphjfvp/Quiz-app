import { navigate } from "../router.js";
import { loadSettings } from "../store.js";
import { generateStudyPlan, getModelContextLimit, MODELS } from "../ai-service.js";
import { esc, loadPdfJs } from "../utils.js";

const DIFFICULTY_LABELS = { beginner: "🟢 Grundlagen", intermediate: "🟡 Mittel", advanced: "🔴 Fortgeschritten" };
const DIFFICULTY_COLORS = { beginner: "var(--success)", intermediate: "var(--warning)", advanced: "var(--danger)" };

function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export async function render(root) {
  const settings = await loadSettings();
  const disabledModels = settings.disabledModels || [];
  let currentModel = settings.aiModel || "nvidia/nemotron-3-super-120b-a12b:free";

  root.innerHTML = `
    <div class="editor-header">
      <button class="btn-icon back-btn" id="sp-back">←</button>
      <h2>📋 Lernplan erstellen</h2>
    </div>

    <div class="card mt-section">
      <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px">
        Lade eine Klausur, ein Skript oder Übungsblatt hoch — die KI erkennt alle Themen,
        erstellt einen Lernplan und liefert YouTube-Links zum Lernen.
      </p>

      <div class="input-group">
        <label>Text eingeben oder Datei hochladen</label>
        <textarea id="sp-text" class="textarea input" rows="8" placeholder="Klausur-/Skripttext hier einfügen…"></textarea>
      </div>

      <div class="input-group">
        <label>Datei laden (.txt, .pdf)</label>
        <input type="file" id="sp-file" accept=".txt,.pdf" class="input">
        <div id="sp-file-progress" class="file-progress">
          <div class="file-track"><div id="sp-file-bar" class="file-fill"></div></div>
          <small id="sp-file-info" class="file-info">Extrahiere Text...</small>
        </div>
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

  root.querySelector("#sp-back").addEventListener("click", () => navigate("my-quizzes"));

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    errorBox.style.display = "none";

    if (file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = () => { textArea.value = reader.result; };
      reader.readAsText(file);
      return;
    }

    if (file.name.endsWith(".pdf")) {
      fileProgress.style.display = "block";
      fileBar.style.width = "10%";
      fileInfo.textContent = "Lade PDF…";
      try {
        const pdfjsLib = await loadPdfJs();
        fileBar.style.width = "30%";
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(it => it.str).join(" ") + "\n\n";
          fileBar.style.width = (30 + 70 * i / pdf.numPages) + "%";
          fileInfo.textContent = `Seite ${i}/${pdf.numPages}…`;
        }
        textArea.value = text.trim();
        fileInfo.textContent = `✓ ${pdf.numPages} Seiten extrahiert`;
        setTimeout(() => { fileProgress.style.display = "none"; }, 2000);
      } catch (err) {
        errorBox.textContent = "PDF konnte nicht gelesen werden: " + (err.message || err);
        errorBox.style.display = "block";
        fileProgress.style.display = "none";
      }
      return;
    }
    errorBox.textContent = "Bitte eine .txt oder .pdf Datei wählen.";
    errorBox.style.display = "block";
  });

  genBtn.addEventListener("click", async () => {
    const text = textArea.value.trim();
    if (!text) {
      errorBox.textContent = "Bitte Text eingeben oder eine Datei hochladen.";
      errorBox.style.display = "block";
      return;
    }
    if (text.length < 50) {
      errorBox.textContent = "Der Text ist zu kurz für eine sinnvolle Analyse.";
      errorBox.style.display = "block";
      return;
    }

    const model = modelSelect.value;
    const charLimit = getModelContextLimit(model);
    let inputText = text;
    if (inputText.length > charLimit) {
      inputText = inputText.slice(0, charLimit);
    }

    errorBox.style.display = "none";
    genBtn.disabled = true;
    genBtn.textContent = "⏳ Analysiere Dokument…";

    try {
      const plan = await generateStudyPlan(inputText, { model });
      renderPlan(resultDiv, plan);
    } catch (err) {
      errorBox.textContent = err.message || "Fehler bei der Lernplan-Erstellung.";
      errorBox.style.display = "block";
    }
    genBtn.disabled = false;
    genBtn.textContent = "🎯 Lernplan erstellen";
  });
}

function renderPlan(container, plan) {
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
    </div>`;

  if (plan.tips?.length) {
    html += `<div class="card" style="margin-top:8px">
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:6px">💡 Lerntipps</div>
      <ul style="margin:0;padding-left:18px;font-size:0.85rem;color:var(--text-light)">
        ${plan.tips.map(t => `<li>${esc(t)}</li>`).join("")}
      </ul>
    </div>`;
  }

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
        <a href="${ytUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-primary" style="margin-top:8px;display:inline-flex;align-items:center;gap:4px;text-decoration:none">
          ▶️ YouTube: ${esc(topic.youtubeQuery || topic.name)}
        </a>
      </div>`;
  });

  html += `</div>`;

  container.innerHTML = html;

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
}
