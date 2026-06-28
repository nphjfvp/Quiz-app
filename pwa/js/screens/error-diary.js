import { loadErrorDiary, saveErrorDiary } from "../store.js";
import { navigate } from "../router.js";
import { esc, escAttr, mathEsc } from "../utils.js";

export async function render(root) {
  const diary = await loadErrorDiary();

  const topics = [...new Set(diary.map(e => e.topic).filter(Boolean))].sort();
  let filter = "";

  function renderList() {
    const filtered = filter ? diary.filter(e => e.topic === filter) : diary;

    let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="section-title">📕 Fehlertagebuch</div>`;

    if (topics.length > 0) {
      html += `<div class="mb-row">
        <select id="topic-filter" class="select-input">
          <option value="">Alle Themen</option>
          ${topics.map(t => `<option value="${escAttr(t)}" ${filter === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
      </div>`;
    }

    if (diary.length > 0) {
      html += `<button class="btn btn-danger btn-sm mb-row" id="clear-all">Alle löschen</button>`;
    }

    if (filtered.length === 0) {
      html += `<div class="empty">Noch keine Fehler! Weiter so! 🎉</div>`;
    } else {
      for (const entry of filtered) {
        const dateStr = entry.date ? new Date(entry.date).toLocaleDateString("de-DE") : "–";
        html += `<div class="card diary-card">
          <div class="q-card-head">
            <span class="q-card-quiz">${dateStr}</span>
            ${entry.topic ? `<span class="tag">${esc(entry.topic)}</span>` : ""}
          </div>
          <div class="q-card-text">${mathEsc(entry.questionText)}</div>
          <div class="diary-line"><span class="lbl-wrong">✗ Deine Antwort:</span> ${esc(entry.userAnswer)}</div>
          <div class="diary-line"><span class="lbl-ok">✓ Richtig:</span> ${esc(entry.correctAnswer)}</div>
          ${entry.quizName ? `<div class="q-card-quiz" style="margin-top:6px">${esc(entry.quizName)}</div>` : ""}
          ${entry.kiExplanation ? `<div class="diary-explain" style="margin-top:8px;padding:8px 12px;background:var(--card-glass-bg,var(--card-bg));border-radius:var(--radius-md);font-size:0.85rem;color:var(--text-light)">📚 ${mathEsc(entry.kiExplanation)}</div>` : ""}
          <div class="btn-row" style="margin-top:8px;gap:6px">
            <button class="btn btn-ghost btn-sm delete-entry" data-id="${escAttr(entry.id)}">Entfernen</button>
            <button class="btn btn-ghost btn-sm tutor-entry" data-id="${escAttr(entry.id)}">🤖 Mit KI besprechen</button>
          </div>
        </div>`;
      }
    }

    root.innerHTML = html;

    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

    const sel = root.querySelector("#topic-filter");
    if (sel) {
      sel.addEventListener("change", () => {
        filter = sel.value;
        renderList();
      });
    }

    const clearBtn = root.querySelector("#clear-all");
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        if (!confirm("Alle Fehlereinträge wirklich löschen?")) return;
        diary.length = 0;
        await saveErrorDiary(diary);
        renderList();
      });
    }

    root.querySelectorAll(".delete-entry").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const idx = diary.findIndex(e => String(e.id) === id);
        if (idx !== -1) {
          diary.splice(idx, 1);
          await saveErrorDiary(diary);
          renderList();
        }
      });
    });

    root.querySelectorAll(".tutor-entry").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const entry = diary.find(e => String(e.id) === id);
        if (!entry) return;
        const context = [
          `Frage: ${entry.questionText}`,
          `Deine Antwort: ${entry.userAnswer}`,
          `Richtige Antwort: ${entry.correctAnswer}`,
          entry.kiExplanation ? `KI-Erklärung: ${entry.kiExplanation}` : "",
          "Der Nutzer möchte diese falsch beantwortete Frage besprechen und verstehen, warum sie falsch war.",
        ].filter(Boolean).join("\n\n");
        navigate("tutor", { context });
      });
    });
  }

  renderList();
}
