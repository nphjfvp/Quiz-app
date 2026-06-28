import { loadStudyPlans, saveStudyPlans, trackRecent } from "../store.js";
import { navigate } from "../router.js";
import { esc, uid } from "../utils.js";
import { extractStudyTopics } from "../ai-service.js";

// Lernplan: Themen aus Vorlesungen extrahieren, auf Tage bis zur Klausur verteilen.
// Plan: { id, name, examDate, sourceText, topics: [{name, difficulty, estimatedHours, scheduledDate?}] }

export async function render(root, params = {}) {
  const plans = await loadStudyPlans();

  if (params.planId && params.action === "view") {
    const plan = plans.find(p => p.id === params.planId);
    if (plan) return showDetail(root, plan);
  }

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="list-header">
      <div class="section-title" style="margin:0">📅 Lernpläne</div>
      <button class="btn btn-primary btn-sm" id="new-plan">+ Neuer Plan</button>
    </div>
    <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px">
      Vorlesungen hochladen → Themen extrahieren → auf Tage bis zur Klausur verteilen.
    </p>`;

  if (!plans.length) {
    html += `<div class="empty">Noch keine Lernpläne.<br>Lade eine Vorlesung hoch und erstelle deinen ersten Plan!</div>`;
  } else {
    for (const p of plans) {
      const daysLeft = p.examDate ? Math.max(0, Math.ceil((new Date(p.examDate) - new Date()) / 86400000)) : "?";
      html += `<div class="quiz-row" data-plan-id="${p.id}">
        <div class="quiz-accent" style="background:var(--secondary, #f59e0b)"></div>
        <div class="quiz-info">
          <h4>${esc(p.name)}</h4>
          <small>${p.topics?.length || 0} Themen · Klausur: ${p.examDate ? new Date(p.examDate).toLocaleDateString("de") : "?"} · Noch ${daysLeft} Tage</small>
        </div>
        <button class="btn-icon btn-icon-sm" data-del-plan="${p.id}">🗑️</button>
        <span class="row-chev">›</span>
      </div>`;
    }
  }

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#new-plan").addEventListener("click", () => showCreator(root));
  root.querySelectorAll("[data-plan-id]").forEach(el =>
    el.addEventListener("click", () => {
      const p = plans.find(x => x.id === el.dataset.planId);
      if (p) showDetail(root, p);
    }));
  root.querySelectorAll("[data-del-plan]").forEach(b =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const p = plans.find(x => x.id === b.dataset.delPlan);
      if (!p) return;
      if (!confirm(`Lernplan „${p.name}" löschen?`)) return;
      await saveStudyPlans(plans.filter(x => x.id !== p.id));
      render(root);
    }));
}

// ── Creator ────────────────────────────────────────────────────────────────

async function showCreator(root) {
  let extractedTopics = null;

  function renderCreator() {
    let html = `<button class="back-btn" id="cr-back">‹ Zurück</button>
      <div class="section-title">📅 Neuer Lernplan</div>
      <div class="card" style="padding:14px">
        <div class="input-group">
          <label>Vorlesungsstoff (Text oder PDF)</label>
          <textarea id="sp-text" class="textarea input" rows="8" placeholder="Skript, Vorlesungsmitschrift hier einfügen…"></textarea>
          <div style="margin-top:6px">
            <input type="file" id="sp-file" accept=".txt,.pdf,.tex" class="input" style="padding:8px">
            <small class="file-hint">.txt, .pdf oder .tex</small>
          </div>
        </div>
        <div class="input-group">
          <label>Name des Plans</label>
          <input type="text" id="sp-name" class="input" placeholder="z.B. Analysis 1 – Klausurvorbereitung">
        </div>
        <div class="input-group">
          <label>Klausurdatum</label>
          <input type="date" id="sp-date" class="input">
        </div>
        <div id="sp-err" class="error-box" style="display:none"></div>
        <button class="btn btn-primary btn-block" id="sp-extract">🔍 Themen extrahieren</button>
      </div>`;

    if (extractedTopics && extractedTopics.length) {
      html += `<div class="card" style="padding:14px;margin-top:12px">
        <div style="font-weight:600;margin-bottom:10px">📚 ${extractedTopics.length} Themen extrahiert</div>`;
      for (const t of extractedTopics) {
        const diffLabel = t.difficulty === "hard" ? "🔴" : t.difficulty === "medium" ? "🟡" : "🟢";
        html += `<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <span>${diffLabel} ${esc(t.name)}</span>
          <span style="font-size:0.75rem;color:var(--text-light)">~${t.estimatedHours}h</span>
        </div>`;
      }
      html += `<button class="btn btn-primary btn-block" id="sp-distribute" style="margin-top:10px">📅 Auf Tage verteilen & speichern</button>
      </div>`;
    }

    root.innerHTML = html;

    root.querySelector("#cr-back").addEventListener("click", () => render(root));

    root.querySelector("#sp-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const textArea = root.querySelector("#sp-text");
      if (file.name.endsWith(".pdf")) {
        textArea.value = "⏳ Extrahiere PDF-Text…";
        try {
          const { getPdfText } = await import("../utils.js");
          const pages = await getPdfText(file);
          textArea.value = pages.map(p => p.text).join("\n\n") || "";
        } catch { textArea.value = "❌ Fehler beim Lesen."; }
      } else {
        const reader = new FileReader();
        reader.onload = () => { textArea.value = reader.result; };
        reader.readAsText(file);
      }
    });

    root.querySelector("#sp-extract")?.addEventListener("click", async () => {
      const text = root.querySelector("#sp-text").value.trim();
      if (!text || text.startsWith("⏳")) return;
      const btn = root.querySelector("#sp-extract");
      const errBox = root.querySelector("#sp-err");
      btn.textContent = "⏳ Extrahiere…";
      btn.disabled = true;
      try {
        extractedTopics = await extractStudyTopics(text);
        renderCreator();
      } catch (err) {
        errBox.textContent = err.message || "Fehler";
        errBox.style.display = "block";
        btn.textContent = "🔍 Themen extrahieren";
        btn.disabled = false;
      }
    });

    root.querySelector("#sp-distribute")?.addEventListener("click", async () => {
      const name = root.querySelector("#sp-name").value.trim() || "Lernplan";
      const dateStr = root.querySelector("#sp-date").value;
      const examDate = dateStr ? new Date(dateStr + "T23:59:59") : null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (examDate) {
        const totalDays = Math.max(1, Math.ceil((examDate - today) / 86400000));
        const totalHours = extractedTopics.reduce((s, t) => s + (t.estimatedHours || 1), 0);
        let dayOffset = 0;
        for (const t of extractedTopics) {
          const daysForTopic = Math.max(1, Math.ceil((t.estimatedHours / totalHours) * totalDays * 0.7));
          const sched = new Date(today);
          sched.setDate(sched.getDate() + dayOffset);
          t.scheduledDate = sched.toISOString().split("T")[0];
          dayOffset += daysForTopic;
        }
      }

      const plan = {
        id: uid(),
        name,
        examDate: examDate ? examDate.toISOString() : null,
        sourceText: root.querySelector("#sp-text").value.trim().slice(0, 2000),
        topics: extractedTopics,
        created: new Date().toISOString(),
      };

      const plans = await loadStudyPlans();
      await saveStudyPlans([...plans, plan]);
      render(root);
    });
  }

  renderCreator();
}

// ── Detail ──────────────────────────────────────────────────────────────────

function showDetail(root, plan) {
  trackRecent("plan", plan.id, plan.name);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = `<button class="back-btn" id="det-back">‹ Zurück</button>
    <div class="section-title">${esc(plan.name)}</div>
    <p style="color:var(--text-light);font-size:0.85rem;margin:0 0 12px">
      ${plan.examDate ? `Klausur: ${new Date(plan.examDate).toLocaleDateString("de")}` : "Kein Datum"}
      · ${plan.topics?.length || 0} Themen
    </p>`;

  if (plan.topics?.length) {
    html += `<div class="card">`;
    for (const t of plan.topics) {
      const schedDate = t.scheduledDate ? new Date(t.scheduledDate + "T00:00:00") : null;
      const isToday = schedDate && schedDate.getTime() === today.getTime();
      const isPast = schedDate && schedDate < today;
      const diffLabel = t.difficulty === "hard" ? "🔴" : t.difficulty === "medium" ? "🟡" : "🟢";
      const bgStyle = isToday ? "background:var(--primary-bg, #eff6ff);margin:0 -12px;padding-left:12px;padding-right:12px" : "";
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--border);${bgStyle}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${diffLabel} <strong>${esc(t.name)}</strong></span>
          <div style="display:flex;gap:4px;align-items:center">
            <button class="btn btn-sm btn-primary exercise-topic-btn" data-topic="${esc(t.name)}" style="font-size:0.7rem">🎯 Üben</button>
            <span style="font-size:0.75rem">~${t.estimatedHours}h</span>
          </div>
        </div>
        ${schedDate ? `<div style="font-size:0.72rem;color:${isPast ? "var(--text-light)" : "var(--primary)"}">
          📅 ${schedDate.toLocaleDateString("de")}${isToday ? " ← HEUTE" : ""}${isPast ? " ✓" : ""}
        </div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  html += `<button class="btn btn-ghost btn-block" id="det-back2" style="margin-top:10px">Zurück zur Liste</button>`;

  root.innerHTML = html;
  root.querySelector("#det-back")?.addEventListener("click", () => render(root));
  root.querySelector("#det-back2")?.addEventListener("click", () => render(root));
  root.querySelectorAll(".exercise-topic-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("exercise-mode", { topic: btn.dataset.topic, planId: plan.id });
    });
  });
}
