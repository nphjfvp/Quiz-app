import { loadErrorDiary, saveErrorDiary } from "../store.js";
import { navigate } from "../router.js";

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
          ${topics.map(t => `<option value="${t}" ${filter === t ? "selected" : ""}>${t}</option>`).join("")}
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
            ${entry.topic ? `<span class="tag">${entry.topic}</span>` : ""}
          </div>
          <div class="q-card-text">${entry.questionText}</div>
          <div class="diary-line"><span class="lbl-wrong">✗ Deine Antwort:</span> ${entry.userAnswer}</div>
          <div class="diary-line"><span class="lbl-ok">✓ Richtig:</span> ${entry.correctAnswer}</div>
          ${entry.quizName ? `<div class="q-card-quiz" style="margin-top:6px">${entry.quizName}</div>` : ""}
          <button class="btn btn-ghost btn-sm delete-entry" data-id="${entry.id}" style="margin-top:8px">Entfernen</button>
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
  }

  renderList();
}
